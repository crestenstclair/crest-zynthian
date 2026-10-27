// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QObject>
#include <QTimer>
#include <QVariantMap>
#include <SDL.h>
#include <map>
#include <set>

class Input : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)
    Q_PROPERTY(QVariantMap gamepadState READ gamepadState NOTIFY gamepadStateChanged)
public:
    explicit Input(QObject* parent = nullptr);
    ~Input() override;
    void setActive(bool active);
    QString status() const { return status_; }
    QVariantMap gamepadState() const { return gamepadState_; }
signals:
    void actionTriggered(const QString& action, bool fine);
    void statusChanged(const QString& status);
    void gamepadStateChanged(const QVariantMap& state);
protected:
    bool eventFilter(QObject* watched, QEvent* event) override;
private:
    void poll();
    void open(int index);
    void handleEvent(const SDL_Event& event);
    void updateArmed();
    void updateStatus();
    void updateGamepadState();
    void setStatus(const QString& status);
    bool neutral(SDL_GameController* controller) const;
    bool fineAdjustment(SDL_JoystickID device) const;
    QString status_;
    QTimer timer_;
    std::map<SDL_JoystickID, SDL_GameController*> controllers_;
    // Track each device separately: one controller's release must not latch another.
    std::map<std::pair<SDL_JoystickID, int>, Uint32> held_;
    std::set<SDL_JoystickID> armed_;
    bool active_ = true;
    QVariantMap gamepadState_;
};
