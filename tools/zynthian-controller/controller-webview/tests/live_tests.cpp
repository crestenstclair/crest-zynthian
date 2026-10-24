// SPDX-License-Identifier: GPL-2.0-or-later
// Exercises the real bridge and embedded frontend. Requires a fresh runtime/data directory.
#include "model.hpp"
#include "input.hpp"
#include <QApplication>
#include <QDir>
#include <QFile>
#include <QDirIterator>
#include <QProcess>
#include <QJsonArray>
#include <QJsonDocument>
#include <QWebChannel>
#include <QWebEngineView>
#include <QtTest>

class LiveTests : public QObject {
    Q_OBJECT
    Model model;
    Input input{model};
    QWebEngineView view;
    QWebChannel channel;
    QJsonObject state() const { return QJsonDocument::fromJson(model.state().toUtf8()).object(); }
    void capture(const QString& name) {
        QTest::qWait(300);
        const QString root=qEnvironmentVariable("CONTROLLER_EVIDENCE", "/data/evidence");
        QDir().mkpath(root);
        QVERIFY(view.grab().save(root+"/"+name+".png"));
        QFile file(root+"/"+name+".json"); QVERIFY(file.open(QIODevice::WriteOnly));
        file.write(QJsonDocument(state()).toJson());
        qInfo().noquote()<<name<<state()["screen"].toString()<<state()["title"].toString();
    }
    void action(const QString& action) {
        QTRY_VERIFY_WITH_TIMEOUT(!state()["busy"].toBool(),15000);
        model.input(action);
        QTRY_VERIFY_WITH_TIMEOUT(!state()["busy"].toBool(),15000);
        QVERIFY2(state()["error"].toString().isEmpty(),qPrintable(model.state()));
        QTest::qWait(200);
    }
    void choose(const QString& label) {
        QTRY_VERIFY_WITH_TIMEOUT(!state()["busy"].toBool(),15000);
        QString id;
        for(auto value:state()["items"].toArray()) {
            auto item=value.toObject();
            if(item["enabled"].toBool() && item["label"].toString().contains(label,Qt::CaseInsensitive)) { id=item["id"].toString();break; }
        }
        QVERIFY2(!id.isEmpty(),qPrintable("Missing "+label+": "+model.state()));
        model.choose(id);
        QTRY_VERIFY_WITH_TIMEOUT(!state()["busy"].toBool(),15000);
        QVERIFY2(state()["error"].toString().isEmpty(),qPrintable(model.state()));
        QTest::qWait(300);
    }
private slots:
    void initTestCase() {
        QVERIFY2(!qEnvironmentVariable("ZYNTHIAN_WEBVIEW_SOCKET").isEmpty(),"Run through runtime test session");
        qApp->installEventFilter(&input);
        channel.registerObject("zynthian",&model);view.page()->setWebChannel(&channel);
        view.resize(1280,800);view.show();
        bool loaded=false;
        const auto loadConnection=connect(&view,&QWebEngineView::loadFinished,this,[&](bool ok){loaded=ok;});
        view.load(QUrl("qrc:/ui/index.html"));
        QTRY_VERIFY_WITH_TIMEOUT(loaded,15000);
        disconnect(loadConnection);
        model.connectTo(qEnvironmentVariable("ZYNTHIAN_WEBVIEW_SOCKET"));
        QTRY_VERIFY_WITH_TIMEOUT(state()["connected"].toBool(),30000);
        QTRY_VERIFY_WITH_TIMEOUT(!state()["busy"].toBool(),30000);
        action("home");
        QCOMPARE(state()["screen"].toString(),QString("main_menu"));
        capture("01-main-menu");
    }
    void instrumentWorkflow() {
        choose("Add Chain");capture("02-add-chain");
        choose("Instrument");capture("03-instrument-selector");
        // Selection order is owned by Zynthian; the output captures show each step.
        for(int i=0;i<6 && state()["screen"]!="chain_control";++i) {
            const auto screen=state()["screen"].toString();
            if(screen=="engine") { choose("Category · Sampler"); choose("FluidSynth: SF2, SF3"); }
            else if(screen=="midi_chan") choose("1");
            else if(screen=="bank") choose("FluidR3");
            else if(screen=="preset") action("select");
            else QFAIL(qPrintable("Unexpected screen: "+model.state()));
            capture(QString("04-instrument-%1").arg(i));
        }
        QCOMPARE(state()["screen"].toString(),QString("chain_control"));
        capture("05-chain-control");
        choose("Banks / presets · FluidSynth"); capture("05-bank-preset-browser");
        if(state()["screen"]=="bank") { choose("FluidR3"); capture("05-presets"); }
        if(state()["screen"]=="preset") { action("select"); }
        QCOMPARE(state()["screen"].toString(),QString("chain_control"));
        // Follow existing controls through the same bridge used by the webview.
        choose("volume");
        action("left"); action("right");
        capture("05-parameter-edit");
        choose("Audio output"); capture("05-audio-routing");
        action("mixer");capture("06-mixer");
        action("home");choose("Chain Manager");capture("07-chain-manager");
    }
    void utilityWorkflow() {
        action("home");choose("MIDI Input");capture("08-midi-input");
        action("home");choose("MIDI Output");capture("09-midi-output");
        action("home");choose("Tempo");capture("10-tempo");
        action("snapshots");capture("11-snapshots");
        action("home");choose("ZS3");capture("12-zs3");
        action("home");choose("Admin");capture("13-admin");
    }
    void sequencerWorkflow() {
        action("launcher");capture("14-launcher");
        QCOMPARE(state()["kind"].toString(),QString("sequencer"));
        action("left");action("bold");capture("15-pattern");
        QCOMPARE(state()["screen"].toString(),QString("pattern_editor"));
        action("select");capture("16-note-entered");
        action("lengthMore");action("velocityLess");capture("17-note-adjusted");
        QProcess audio;
        audio.start("python3", {"/opt/controller/runtime/tests/audio.py", "/data/evidence/sequence.wav"});
        QVERIFY(audio.waitForStarted()); QTest::qWait(500);
        action("play");QTest::qWait(3500);action("play");
        QTRY_VERIFY_WITH_TIMEOUT(audio.state()==QProcess::NotRunning,10000);
        qInfo().noquote()<<audio.readAllStandardOutput();
        QVERIFY2(audio.exitCode()==0,audio.readAllStandardError().constData());
        action("menu");capture("18-context-menu");
        QVERIFY(!state()["canvasFocus"].toBool());
        choose("Edit CC");capture("19-cc");
        QCOMPARE(state()["sequence"].toObject()["type"].toString(),QString("cc"));
        action("select");action("up");capture("20-cc-event");
        action("home");
    }
    void snapshotRecall() {
        if(qEnvironmentVariable("CONTROLLER_RECALL")!="1") return;
        action("snapshots");choose("001-New Snapshot");choose("Load");
        QTest::qWait(1500);capture("23-snapshot-recalled");
        action("launcher");capture("24-recalled-launcher");
        bool hasInstrument=false;
        for(auto c:state()["sequence"].toObject()["columns"].toArray())
            hasInstrument |= c.toObject()["label"].toString().contains("FluidSynth");
        QVERIFY(hasInstrument);
        const auto columns=state()["sequence"].toObject()["columns"].toArray();
        int instrument=-1;
        for(auto c:columns) if(c.toObject()["label"].toString().contains("FluidSynth")) instrument=c.toObject()["id"].toInt();
        QVERIFY(instrument>=0);
        model.sequence("cell",0,instrument);
        QTRY_VERIFY(!state()["busy"].toBool());
        action("bold");capture("25-recalled-notes");
        QCOMPARE(state()["screen"].toString(),QString("pattern_editor"));
        QVERIFY(!state()["sequence"].toObject()["cells"].toArray().isEmpty());
        QProcess audio;audio.start("python3", {"/opt/controller/runtime/tests/audio.py", "/data/evidence/recalled-sequence.wav"});
        QVERIFY(audio.waitForStarted()); QTest::qWait(500);
        action("play");QTest::qWait(3500);action("play");
        QTRY_VERIFY_WITH_TIMEOUT(audio.state()==QProcess::NotRunning,10000);
        qInfo().noquote()<<audio.readAllStandardOutput();
        QVERIFY2(audio.exitCode()==0,audio.readAllStandardError().constData());
    }
    void snapshotWorkflow() {
        action("snapshots"); choose("Save as new snapshot"); capture("21-snapshot-name");
        QCOMPARE(state()["screen"].toString(),QString("keyboard"));
        choose("Save"); QTest::qWait(1000); capture("22-snapshot-saved");
        QDirIterator files("/data/user-data/snapshots", {"*.zss"}, QDir::Files, QDirIterator::Subdirectories);
        QVERIFY(files.hasNext());
        action("home");
    }
};
QTEST_MAIN(LiveTests)
#include "live_tests.moc"
