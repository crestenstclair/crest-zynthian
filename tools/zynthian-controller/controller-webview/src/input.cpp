// SPDX-License-Identifier: GPL-2.0-or-later
#include "input.hpp"
#include <QEvent>
#include <QKeyEvent>

static QString buttonAction(int button) {
    switch (button) {
    case 100: return "left";
    case 101: return "right";
    case 102: return "up";
    case 103: return "down";
    case 104: return "lengthLess";
    case 105: return "lengthMore";
    case 106: return "velocityMore";
    case 107: return "velocityLess";
    case SDL_CONTROLLER_BUTTON_A: return "select";
    case SDL_CONTROLLER_BUTTON_B: return "back";
    case SDL_CONTROLLER_BUTTON_Y: return "bold";
    case SDL_CONTROLLER_BUTTON_X: return "play";
    case SDL_CONTROLLER_BUTTON_LEFTSTICK: return "focus";
    case SDL_CONTROLLER_BUTTON_RIGHTSTICK: return "block";
    case SDL_CONTROLLER_BUTTON_START: return "home";
    case SDL_CONTROLLER_BUTTON_BACK: return "mixer";
    case SDL_CONTROLLER_BUTTON_RIGHTSHOULDER: return "snapshots";
    case SDL_CONTROLLER_BUTTON_DPAD_UP: return "up";
    case SDL_CONTROLLER_BUTTON_DPAD_DOWN: return "down";
    case SDL_CONTROLLER_BUTTON_DPAD_LEFT: return "left";
    case SDL_CONTROLLER_BUTTON_DPAD_RIGHT: return "right";
    default: return {};
    }
}

Input::Input(Model& model, QObject* parent) : QObject(parent), model_(model) {
    SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, "1");
    if (SDL_InitSubSystem(SDL_INIT_GAMECONTROLLER | SDL_INIT_EVENTS) != 0) {
        model_.setInputStatus(QString("Controller unavailable: %1").arg(SDL_GetError()));
        return;
    }
    model_.setInputStatus("Keyboard / touch · no controller connected");
    for (int i = 0; i < SDL_NumJoysticks(); ++i) open(i);
    connect(&timer_, &QTimer::timeout, this, &Input::poll);
    timer_.start(8);
}

Input::~Input() {
    for (const auto& entry : controllers_) SDL_GameControllerClose(entry.second);
    SDL_QuitSubSystem(SDL_INIT_GAMECONTROLLER | SDL_INIT_EVENTS);
}

void Input::open(int index) {
    if (!SDL_IsGameController(index)) return;
    auto* controller = SDL_GameControllerOpen(index);
    if (!controller) return;
    const auto id = SDL_JoystickInstanceID(SDL_GameControllerGetJoystick(controller));
    if (controllers_.contains(id)) { SDL_GameControllerClose(controller); return; }
    controllers_[id] = controller;
    model_.setInputStatus(QString::fromUtf8(SDL_GameControllerName(controller)));
}

void Input::setActive(bool active) { active_ = active; held_.clear(); }

void Input::poll() {
    SDL_Event event;
    while (SDL_PollEvent(&event)) {
        if (event.type == SDL_CONTROLLERDEVICEADDED) open(event.cdevice.which);
        else if (event.type == SDL_CONTROLLERDEVICEREMOVED) {
            auto it = controllers_.find(event.cdevice.which);
            if (it != controllers_.end()) { SDL_GameControllerClose(it->second); controllers_.erase(it); }
            std::erase_if(held_, [&](const auto& p) { return p.first.first == event.cdevice.which; });
            if (controllers_.empty()) model_.setInputStatus("Keyboard / touch · no controller connected");
        } else if (event.type == SDL_CONTROLLERAXISMOTION && active_ && event.caxis.axis <= SDL_CONTROLLER_AXIS_RIGHTY) {
            // Digital navigation with a dead zone and hysteresis; separate state per device.
            const int base = 100 + event.caxis.axis * 2;
            const auto negative = std::make_pair(event.caxis.which, base);
            const auto positive = std::make_pair(event.caxis.which, base + 1);
            if (event.caxis.value > -10000) held_.erase(negative);
            if (event.caxis.value < 10000) held_.erase(positive);
            const int direction = event.caxis.value < -18000 ? base : event.caxis.value > 18000 ? base + 1 : -1;
            const auto key = std::make_pair(event.caxis.which, direction);
            if (direction >= 0 && !held_.contains(key)) {
                held_[key] = SDL_GetTicks() + 350;
                model_.input(buttonAction(direction), held_.contains({key.first, SDL_CONTROLLER_BUTTON_LEFTSHOULDER}));
            }
        } else if (event.type == SDL_CONTROLLERBUTTONUP) {
            held_.erase({event.cbutton.which, event.cbutton.button});
        } else if (event.type == SDL_CONTROLLERBUTTONDOWN && active_) {
            const auto key = std::make_pair(event.cbutton.which, int(event.cbutton.button));
            if (held_.contains(key)) continue;
            held_[key] = SDL_GetTicks() + 350;
            auto action = buttonAction(event.cbutton.button);
            const bool fine = held_.contains({event.cbutton.which, SDL_CONTROLLER_BUTTON_LEFTSHOULDER});
            if (fine && action == "bold") action = "menu";
            if (fine && action == "play") action = "record";
            if (!action.isEmpty()) model_.input(action, fine);
        }
    }
    if (!active_) return;
    for (auto& [key, next] : held_) {
        if ((key.second < SDL_CONTROLLER_BUTTON_DPAD_UP || key.second > SDL_CONTROLLER_BUTTON_DPAD_RIGHT) &&
            (key.second < 100 || key.second > 107)) continue;
        if (Sint32(SDL_GetTicks() - next) >= 0) {
            next = SDL_GetTicks() + 100;
            model_.input(buttonAction(key.second), held_.contains({key.first, SDL_CONTROLLER_BUTTON_LEFTSHOULDER}));
        }
    }
}

bool Input::eventFilter(QObject*, QEvent* event) {
    if (!active_ || (event->type() != QEvent::KeyPress && event->type() != QEvent::KeyRelease)) return false;
    const auto* key = static_cast<QKeyEvent*>(event);
    QString action;
    bool repeat = false;
    switch (key->key()) {
    case Qt::Key_Up: action = "up"; repeat = true; break;
    case Qt::Key_Down: action = "down"; repeat = true; break;
    case Qt::Key_Left: action = "left"; repeat = true; break;
    case Qt::Key_Right: action = "right"; repeat = true; break;
    case Qt::Key_PageUp: action = "pageUp"; repeat = true; break;
    case Qt::Key_PageDown: action = "pageDown"; repeat = true; break;
    case Qt::Key_Return: case Qt::Key_Enter: action = "select"; break;
    case Qt::Key_Escape: case Qt::Key_Backspace: action = "back"; break;
    case Qt::Key_Home: action = "home"; break;
    case Qt::Key_F2: action = "mixer"; break;
    case Qt::Key_F3: action = "snapshots"; break;
    case Qt::Key_F4: action = "bold"; break;
    case Qt::Key_F5: action = "menu"; break;
    case Qt::Key_F6: action = "launcher"; break;
    case Qt::Key_F7: action = "block"; break;
    case Qt::Key_Space: action = "play"; break;
    case Qt::Key_R: action = "record"; break;
    case Qt::Key_Tab: action = "focus"; break;
    case Qt::Key_BracketLeft: action = "lengthLess"; repeat = true; break;
    case Qt::Key_BracketRight: action = "lengthMore"; repeat = true; break;
    case Qt::Key_Minus: action = "velocityLess"; repeat = true; break;
    case Qt::Key_Equal: action = "velocityMore"; repeat = true; break;
    case Qt::Key_F12: action = "panic"; break;
    default: return false;
    }
    if (event->type() == QEvent::KeyPress && (!key->isAutoRepeat() || repeat))
        model_.input(action, key->modifiers().testFlag(Qt::ShiftModifier));
    return true;
}
