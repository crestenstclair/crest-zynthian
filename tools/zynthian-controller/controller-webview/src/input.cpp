// SPDX-License-Identifier: GPL-2.0-or-later
#include "input.hpp"
#include <QEvent>
#include <QKeyEvent>
#include <QDebug>
#include <QStringList>

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

Input::Input(QObject* parent) : QObject(parent) {
    SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, "1");
    if (SDL_InitSubSystem(SDL_INIT_GAMECONTROLLER | SDL_INIT_EVENTS) != 0) {
        setStatus(QString("Controller unavailable: %1").arg(SDL_GetError()));
        return;
    }
    setStatus("SDL · no controller connected");
    for (int i = 0; i < SDL_NumJoysticks(); ++i) open(i);
    connect(&timer_, &QTimer::timeout, this, &Input::poll);
    timer_.start(8);
}

Input::~Input() {
    for (const auto& entry : controllers_) SDL_GameControllerClose(entry.second);
    SDL_QuitSubSystem(SDL_INIT_GAMECONTROLLER | SDL_INIT_EVENTS);
}

void Input::open(int index) {
    if (!SDL_IsGameController(index)) {
        if (controllers_.empty()) setStatus(QString("SDL · unmapped controller: %1").arg(SDL_JoystickNameForIndex(index)));
        return;
    }
    auto* controller = SDL_GameControllerOpen(index);
    if (!controller) { setStatus(QString("SDL · %1").arg(SDL_GetError())); return; }
    const auto id = SDL_JoystickInstanceID(SDL_GameControllerGetJoystick(controller));
    if (controllers_.contains(id)) { SDL_GameControllerClose(controller); return; }
    controllers_[id] = controller;
    updateStatus();
}

void Input::setStatus(const QString& status) {
    if (status_ == status) return;
    status_ = status;
    qInfo().noquote() << status;
    emit statusChanged(status);
}

void Input::updateStatus() {
    QStringList names;
    for (const auto& [id, controller] : controllers_) {
        Q_UNUSED(id);
        names.append(QString::fromUtf8(SDL_GameControllerName(controller)));
    }
    setStatus(names.isEmpty() ? "SDL · no controller connected" : "SDL · " + names.join(" / "));
}

void Input::setActive(bool active) {
    active_ = active;
    held_.clear();
    armed_.clear();
}

bool Input::neutral(SDL_GameController* controller) const {
    for (int button = 0; button < SDL_CONTROLLER_BUTTON_MAX; ++button)
        if (SDL_GameControllerGetButton(controller, SDL_GameControllerButton(button))) return false;
    for (int axis = SDL_CONTROLLER_AXIS_LEFTX; axis <= SDL_CONTROLLER_AXIS_RIGHTY; ++axis)
        if (std::abs(int(SDL_GameControllerGetAxis(controller, SDL_GameControllerAxis(axis)))) > 10000) return false;
    return true;
}

void Input::updateArmed() {
    if (!active_) return;
    for (const auto& [id, controller] : controllers_)
        if (!armed_.contains(id) && neutral(controller)) armed_.insert(id);
}

bool Input::fineAdjustment(SDL_JoystickID device) const {
    const auto found = controllers_.find(device);
    // SDL batches state updates; event order need not put LB before X/Y.
    return found != controllers_.end() &&
        SDL_GameControllerGetButton(found->second, SDL_CONTROLLER_BUTTON_LEFTSHOULDER);
}

void Input::poll() {
    SDL_Event event;
    while (SDL_PollEvent(&event)) handleEvent(event);
    updateArmed();
    if (!active_) return;
    for (auto& [key, next] : held_) {
        if ((key.second < SDL_CONTROLLER_BUTTON_DPAD_UP || key.second > SDL_CONTROLLER_BUTTON_DPAD_RIGHT) &&
            (key.second < 100 || key.second > 107)) continue;
        if (Sint32(SDL_GetTicks() - next) >= 0) {
            next = SDL_GetTicks() + 100;
            emit actionTriggered(buttonAction(key.second), fineAdjustment(key.first));
        }
    }
}

void Input::handleEvent(const SDL_Event& event) {
    if (event.type == SDL_CONTROLLERDEVICEADDED) open(event.cdevice.which);
    else if (event.type == SDL_CONTROLLERDEVICEREMOVED) {
        auto it = controllers_.find(event.cdevice.which);
        if (it != controllers_.end()) { SDL_GameControllerClose(it->second); controllers_.erase(it); }
        std::erase_if(held_, [&](const auto& p) { return p.first.first == event.cdevice.which; });
        armed_.erase(event.cdevice.which);
        updateStatus();
    } else if (event.type == SDL_CONTROLLERAXISMOTION && active_ && armed_.contains(event.caxis.which) && event.caxis.axis <= SDL_CONTROLLER_AXIS_RIGHTY) {
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
            emit actionTriggered(buttonAction(direction), fineAdjustment(key.first));
        }
    } else if (event.type == SDL_CONTROLLERBUTTONUP) {
        held_.erase({event.cbutton.which, event.cbutton.button});
    } else if (event.type == SDL_CONTROLLERBUTTONDOWN && active_ && armed_.contains(event.cbutton.which)) {
        const auto key = std::make_pair(event.cbutton.which, int(event.cbutton.button));
        if (held_.contains(key)) return;
        held_[key] = SDL_GetTicks() + 350;
        auto action = buttonAction(event.cbutton.button);
        const bool fine = fineAdjustment(event.cbutton.which);
        if (fine && action == "bold") action = "menu";
        if (fine && action == "play") action = "record";
        if (!action.isEmpty()) emit actionTriggered(action, fine);
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
        emit actionTriggered(action, key->modifiers().testFlag(Qt::ShiftModifier));
    return true;
}
