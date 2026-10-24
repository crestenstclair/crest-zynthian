// SPDX-License-Identifier: GPL-2.0-or-later
#include "composer.hpp"
#include <QFile>
#include <QSaveFile>
#include <QJsonDocument>
#include <QRandomGenerator>
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace {
int integer(const QJsonObject& object, const char* key, int low, int high) {
    const auto value = object.value(key);
    const double number = value.toDouble(low - 1);
    if (!value.isDouble() || !std::isfinite(number) || number != std::floor(number) || number < low || number > high)
        throw std::runtime_error(QString("Invalid %1 (%2–%3)").arg(key).arg(low).arg(high).toStdString());
    return int(number);
}
QJsonObject cell(int pitch, int channel, int velocity, int gate = 0) {
    return {{"pitch",pitch},{"channel",channel},{"velocity",velocity},{"gate",gate}};
}
QJsonArray emptyCells() { QJsonArray cells; for (int i=0;i<64;++i) cells.append(QJsonValue()); return cells; }
QJsonObject emptyTrack() { return {{"mute",false},{"solo",false},{"cells",emptyCells()}}; }
void validateTrack(const QJsonObject& track) {
    if (!track["mute"].isBool() || !track["solo"].isBool() || track["cells"].toArray().size()!=64)
        throw std::runtime_error("Invalid track");
    for (const auto& value : track["cells"].toArray()) {
        if (value.isNull()) continue;
        if (!value.isObject()) throw std::runtime_error("Invalid cell");
        auto c=value.toObject();
        integer(c,"pitch",-1,127); integer(c,"channel",1,16);
        integer(c,"velocity",1,127); integer(c,"gate",0,6400);
    }
}
void validate(const QJsonObject& document) {
    integer(document,"version",1,1);
    const auto config=document["config"].toObject();
    integer(config,"steps",1,64); integer(config,"tracks",1,16); integer(config,"tempo",20,300);
    integer(config,"swing",0,75); integer(config,"gate",1,100); integer(config,"root",0,11);
    const int division=integer(config,"division",4,64);
    if ((division & (division-1)) || !QStringList{"Straight","Triplet","Dotted"}.contains(config["timing"].toString()) ||
        !QStringList{"Forward","Reverse","Ping-pong"}.contains(config["direction"].toString()) ||
        !QStringList{"Chromatic","Major","Natural minor","Harmonic minor"}.contains(config["scale"].toString()))
        throw std::runtime_error("Invalid timing, direction or scale");
    if (!QStringList{"notes","tracker","euclidean","randomizer"}.contains(document["view"].toString()) || document["tracks"].toArray().size()!=16)
        throw std::runtime_error("Invalid project");
    for (auto track : document["tracks"].toArray()) validateTrack(track.toObject());
}
QJsonObject initialDocument() {
    QJsonArray tracks; for(int i=0;i<16;++i) tracks.append(emptyTrack());
    return {{"version",1},{"view","tracker"},{"config",QJsonObject{{"steps",16},{"tracks",8},{"division",16},
        {"timing","Straight"},{"tempo",120},{"swing",0},{"gate",75},{"direction","Forward"},{"root",0},{"scale","Natural minor"}}},{"tracks",tracks}};
}
QList<int> pitchesFor(const QJsonObject& config, int low, int high) {
    const QMap<QString,QList<int>> scales{{"Chromatic",{0,1,2,3,4,5,6,7,8,9,10,11}},
        {"Major",{0,2,4,5,7,9,11}},{"Natural minor",{0,2,3,5,7,8,10}},{"Harmonic minor",{0,2,3,5,7,8,11}}};
    QList<int> pitches;
    for(int pitch=low;pitch<=high;++pitch)
        if(scales[config["scale"].toString()].contains((pitch-config["root"].toInt()+12)%12)) pitches.append(pitch);
    if(pitches.isEmpty()) throw std::runtime_error("Pitch range contains no notes in selected scale");
    return pitches;
}
}
Composer::Composer(QString project, QObject* parent) : QObject(parent), document_(initialDocument()), project_(std::move(project)) {
    if (!project_.isEmpty() && QFile::exists(project_)) {
        QFile file(project_);
        if (!file.open(QIODevice::ReadOnly) || file.size()>1024*1024) error_="Cannot read project";
        else {
            try { restore(QJsonDocument::fromJson(file.readAll()).object()); }
            catch(const std::exception& e) { error_=QString("Project not loaded: %1. Save disabled to protect file.").arg(e.what()); project_.clear(); }
        }
    }
    timer_.setTimerType(Qt::PreciseTimer); timer_.setInterval(1);
    connect(&timer_, &QTimer::timeout, this, &Composer::tick);
}
Composer::~Composer() { stop(); }
void Composer::setMidiSink(std::function<bool(int,int,int)> sink) { sink_=std::move(sink); }
void Composer::setOutputStatus(QString status) { outputStatus_=std::move(status); emit changed(); }
QString Composer::state() const {
    auto result=document_;
    result["row"]=row_; result["track"]=track_; result["playhead"]=playhead_;
    result["playing"]=playing_; result["error"]=error_; result["output"]=outputStatus_;
    result["canUndo"]=!history_.isEmpty(); result["canRedo"]=!future_.isEmpty(); result["project"]=project_;
    return QString::fromUtf8(QJsonDocument(result).toJson(QJsonDocument::Compact));
}
void Composer::checkpoint() { stop(); history_.append(document_); if(history_.size()>100) history_.removeFirst(); future_.clear(); }
void Composer::restore(const QJsonObject& document) {
    validate(document); stop(); document_=document;
    auto config=document_["config"].toObject(); row_=std::min(row_,config["steps"].toInt()-1); track_=std::min(track_,config["tracks"].toInt()-1);
}
void Composer::command(const QString& json) {
    try {
        if(json.size()>1024*1024) throw std::runtime_error("Command too large");
        QJsonParseError parse;
        auto request=QJsonDocument::fromJson(json.toUtf8(),&parse);
        if(parse.error!=QJsonParseError::NoError || !request.isObject()) throw std::runtime_error("Invalid command JSON");
        error_.clear(); execute(request.object());
    } catch(const std::exception& e) { error_=QString::fromUtf8(e.what()); }
    emit changed();
}
void Composer::execute(const QJsonObject& request) {
    const auto action=request["action"].toString();
    auto next=document_; auto config=document_["config"].toObject(); auto tracks=document_["tracks"].toArray();
    if(action=="play") { playing_?stop():play(); return; }
    if(action=="stop") { stop(); return; }
    if(action=="save") { save(); return; }
    if(action=="undo" || action=="redo") {
        auto& from=action=="undo"?history_:future_; auto& to=action=="undo"?future_:history_;
        if(!from.isEmpty()) { to.append(document_); restore(from.takeLast()); } return;
    }
    if(action=="cursor") { row_=integer(request,"row",0,config["steps"].toInt()-1); track_=integer(request,"track",0,config["tracks"].toInt()-1); return; }
    if(action=="generate") { generate(request["kind"].toString(),request); return; }
    if(action=="view") next["view"]=request["view"];
    else if(action=="config") next["config"]=request["config"];
    else if(action=="cell" || action=="mute" || action=="solo") {
        int index=integer(request,"track",0,config["tracks"].toInt()-1); auto track=tracks[index].toObject();
        if(action=="cell") {
            auto cells=track["cells"].toArray(); int row=integer(request,"row",0,config["steps"].toInt()-1);
            if(!request.contains("cell")) throw std::runtime_error("Missing cell");
            cells[row]=request["cell"]; track["cells"]=cells;
        } else { if(!request["value"].isBool()) throw std::runtime_error("Expected boolean"); track[action]=request["value"]; }
        tracks[index]=track; next["tracks"]=tracks;
    } else throw std::runtime_error("Unknown command");
    validate(next); checkpoint(); restore(next);
}
void Composer::generate(const QString& kind, const QJsonObject& request) {
    auto config=document_["config"].toObject(); int steps=config["steps"].toInt();
    int track=integer(request,"track",0,config["tracks"].toInt()-1), channel=integer(request,"channel",1,16);
    int velocity=integer(request,"velocity",1,127), gate=config["gate"].toInt();
    auto tracks=document_["tracks"].toArray(); auto lane=tracks[track].toObject(); auto cells=lane["cells"].toArray();
    if(kind=="euclidean") {
        int hits=integer(request,"hits",0,steps), rotation=integer(request,"rotation",0,steps-1), pitch=integer(request,"pitch",0,127);
        for(int row=0;row<steps;++row) cells[row]=((row-rotation+steps)%steps*hits)%steps<hits ? QJsonValue(cell(pitch,channel,velocity,gate)) : QJsonValue();
    } else if(kind=="randomizer") {
        int low=integer(request,"low",0,127), high=integer(request,"high",low,127);
        int density=integer(request,"density",0,100), seed=integer(request,"seed",0,1000000);
        auto pitches=pitchesFor(config,low,high); QRandomGenerator random{quint32(seed)};
        for(int row=0;row<steps;++row) {
            bool hit=int(random.bounded(100u))<density; int pitch=pitches[int(random.bounded(quint32(pitches.size())))];
            cells[row]=hit?QJsonValue(cell(pitch,channel,velocity,gate)):QJsonValue();
        }
    } else throw std::runtime_error("Unknown generator");
    lane["cells"]=cells; tracks[track]=lane; checkpoint(); document_["tracks"]=tracks;
}
void Composer::send(int status,int note,int velocity) {
    emit midi(status,note,velocity);
    if(sink_ && !sink_(status,note,velocity)) { error_="MIDI output failed; playback stopped"; playing_=false; timer_.stop(); }
}
void Composer::release(int track) {
    auto& held=held_[track];
    if(held.channel<0) return;
    if(--voices_[held.channel][held.pitch]==0) send(0x80|held.channel,held.pitch,0);
    held={};
}
void Composer::stop() {
    playing_=false; timer_.stop(); for(int track=0;track<16;++track) release(track); playhead_=-1;
}
double Composer::stepMilliseconds(int row) const {
    const auto config=document_["config"].toObject();
    double duration=60000.0/config["tempo"].toInt()*4/config["division"].toInt();
    if(config["timing"]=="Triplet") duration*=2.0/3;
    if(config["timing"]=="Dotted") duration*=1.5;
    // An unpaired final step stays unswung, preserving odd-length loop duration.
    if(!(config["steps"].toInt()%2 && row==config["steps"].toInt()-1)) duration*=1+(row%2?-1:1)*config["swing"].toInt()/100.0;
    return duration;
}
void Composer::play() {
    if(!sink_) throw std::runtime_error("No MIDI output connected; editing and saving remain available");
    stop(); playing_=true; playhead_=-1; travel_=1; next_=0; clock_.start(); advance(); timer_.start();
}
void Composer::releaseDue() {
    double now=clock_.isValid()?clock_.nsecsElapsed()/1000000.0:0;
    for(int track=0;track<16;++track) if(held_[track].until>=0 && held_[track].until<=now) release(track);
}
void Composer::playTrack(int index,int row,bool anySolo) {
    auto track=document_["tracks"].toArray()[index].toObject();
    if(track["mute"].toBool() || (anySolo && !track["solo"].toBool())) { release(index); return; }
    auto value=track["cells"].toArray()[row];
    if(value.isNull()) return; // Empty is sustain, never an implicit note-off.
    auto c=value.toObject(); release(index);
    int pitch=c["pitch"].toInt(); if(pitch<0) return; // Explicit OFF is track-local.
    int channel=c["channel"].toInt()-1;
    if(voices_[channel][pitch]++==0) send(0x90|channel,pitch,c["velocity"].toInt());
    held_[index]={channel,pitch,c["gate"].toInt()?next_+stepMilliseconds(row)*c["gate"].toInt()/100.0:-1};
}
void Composer::advance() {
    auto config=document_["config"].toObject(); int steps=config["steps"].toInt();
    const auto direction=config["direction"].toString();
    if(playhead_<0) playhead_=direction=="Reverse"?steps-1:0;
    else if(direction=="Reverse") playhead_=(playhead_+steps-1)%steps;
    else if(direction=="Ping-pong" && steps>1) {
        if(playhead_+travel_>=steps || playhead_+travel_<0) travel_=-travel_;
        playhead_+=travel_;
    } else playhead_=(playhead_+1)%steps;
    const auto tracks=document_["tracks"].toArray(); bool anySolo=false;
    for(int i=0;i<config["tracks"].toInt();++i) anySolo|=tracks[i].toObject()["solo"].toBool();
    for(int i=0;i<config["tracks"].toInt();++i) playTrack(i,playhead_,anySolo);
    next_+=stepMilliseconds(playhead_); emit changed();
}
void Composer::tick() {
    if(!playing_) return;
    const double now=clock_.nsecsElapsed()/1000000.0;
    if(now-next_>250) { stop(); error_="Clock stalled; stopped to avoid a burst of late notes"; emit changed(); return; }
    releaseDue(); if(now>=next_) advance();
}
void Composer::save() {
    if(project_.isEmpty()) throw std::runtime_error("No writable project path configured");
    QSaveFile file(project_); auto bytes=QJsonDocument(document_).toJson();
    if(!file.open(QIODevice::WriteOnly) || file.write(bytes)!=bytes.size() || !file.commit()) throw std::runtime_error("Could not atomically save project");
}
void Composer::input(const QString& action,bool fine) {
    if(menuOpen_) { emit menuInput(action); return; }
    auto config=document_["config"].toObject();
    if(action=="left") track_=std::max(0,track_-1);
    else if(action=="right") track_=std::min(config["tracks"].toInt()-1,track_+1);
    else if(action=="up") row_=std::max(0,row_-1);
    else if(action=="down") row_=std::min(config["steps"].toInt()-1,row_+1);
    else if(action=="pageUp") row_=std::max(0,row_-16);
    else if(action=="pageDown") row_=std::min(config["steps"].toInt()-1,row_+16);
    else if(action=="play") command("{\"action\":\"play\"}");
    else if(action=="panic") { stop(); }
    else if(action=="select" || action=="bold" || action=="focus" || action=="menu" || action=="back") emit menuRequested();
    else if(action.startsWith("velocity") || action.startsWith("length")) {
        auto c=document_["tracks"].toArray()[track_].toObject()["cells"].toArray()[row_].toObject();
        if(!c.isEmpty() && c["pitch"].toInt()>=0) {
            const bool velocity=action.startsWith("velocity"); const auto key=velocity?"velocity":"gate";
            const int delta=(action.endsWith("More")?1:-1)*(fine?1:10);
            c[key]=std::clamp(c[key].toInt()+delta,1,velocity?127:6400);
            command(QString::fromUtf8(QJsonDocument(QJsonObject{{"action","cell"},{"row",row_},{"track",track_},{"cell",c}}).toJson()));
        }
    }
    emit changed();
}
