// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QObject>
#include <QJsonObject>
#include <QJsonArray>
#include <QTimer>
#include <QElapsedTimer>
#include <array>
#include <functional>

// Authored track identity is independent of the channel of each note.
class Composer : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString state READ state NOTIFY changed)
public:
    explicit Composer(QString project = {}, QObject* parent = nullptr);
    ~Composer() override;
    QString state() const;
    void setMidiSink(std::function<bool(int,int,int)> sink);
    void setOutputStatus(QString status);
    Q_INVOKABLE void command(const QString& json);
    void input(const QString& action, bool fine = false);
    // Explicit clock input makes sustain, retrigger and OFF behavior testable.
    void advance();
    Q_INVOKABLE void setMenuOpen(bool open) { menuOpen_ = open; }
signals:
    void changed();
    void midi(int status, int note, int velocity);
    void menuRequested();
    void menuInput(const QString& action);
private:
    void execute(const QJsonObject& command);
    void checkpoint();
    void restore(const QJsonObject& document);
    void generate(const QString& kind, const QJsonObject& options);
    void play();
    void stop();
    void tick();
    void release(int track);
    void releaseDue();
    void playTrack(int track, int row, bool anySolo);
    void send(int status, int note, int velocity);
    double stepMilliseconds(int row) const;
    void save();
    QJsonObject document_;
    QList<QJsonObject> history_, future_;
    QString project_, error_, outputStatus_ = "MIDI output unavailable";
    std::function<bool(int,int,int)> sink_;
    struct Held { int channel = -1; int pitch = -1; double until = -1; };
    std::array<Held,16> held_{};
    std::array<std::array<int,128>,16> voices_{};
    int row_ = 0, track_ = 0, playhead_ = -1, travel_ = 1;
    double next_ = 0;
    bool playing_ = false, menuOpen_ = false;
    QTimer timer_;
    QElapsedTimer clock_;
};
