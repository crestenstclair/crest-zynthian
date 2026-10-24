// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QObject>
#include <QTimer>
#include <SDL.h>
#include <map>
#include <set>
#include "model.hpp"

class Input : public QObject {
    Q_OBJECT
public:
    explicit Input(Model& model, QObject* parent = nullptr);
    ~Input() override;
    void setActive(bool active);
protected:
    bool eventFilter(QObject* watched, QEvent* event) override;
private:
    void poll();
    void open(int index);
    Model& model_;
    QTimer timer_;
    std::map<SDL_JoystickID, SDL_GameController*> controllers_;
    // Track each device separately: one controller's release must not latch another.
    std::map<std::pair<SDL_JoystickID, int>, Uint32> held_;
    bool active_ = true;
};
