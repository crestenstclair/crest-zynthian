// SPDX-License-Identifier: GPL-2.0-or-later
#include "model.hpp"
#include <QJsonArray>
#include <QJsonDocument>
#include <algorithm>

Model::Model(QObject* parent) : QObject(parent) {
    reconnect_.setInterval(1000);
    deadline_.setSingleShot(true);
    deadline_.setInterval(30000);
    connect(&reconnect_, &QTimer::timeout, this, [this] {
        if (socket_.state() == QLocalSocket::UnconnectedState) socket_.connectToServer(path_);
    });
    connect(&socket_, &QLocalSocket::connected, this, [this] {
        incoming_.clear();
        socket_.write("{\"method\":\"state\"}\n");
        deadline_.start();
    });
    connect(&socket_, &QLocalSocket::readyRead, this, &Model::read);
    connect(&socket_, &QLocalSocket::disconnected, this, &Model::disconnected);
    connect(&socket_, &QLocalSocket::errorOccurred, this, [this] {
        error_ = socket_.errorString();
        disconnected();
    });
    connect(&deadline_, &QTimer::timeout, this, [this] {
        error_ = "Zynthian did not respond. Reconnecting; the last action may have completed.";
        socket_.abort();
        disconnected();
    });
}

Model::~Model() {
    // Socket teardown emits signals. Stop callbacks before member state is destroyed.
    socket_.disconnect(this);
    socket_.abort();
}

void Model::connectTo(const QString& path) {
    path_ = path;
    socket_.connectToServer(path_);
    reconnect_.start();
}

void Model::disconnected() {
    ready_ = false;
    pending_ = 0;
    selected_ = 0;
    incoming_.clear();
    view_ = {};
    deadline_.stop();
    emit changed();
}

QString Model::state() const {
    auto result = view_;
    result["connected"] = ready_;
    result["selected"] = selected_;
    result["busy"] = pending_ != 0 || view_.value("backendBusy").toBool();
    result["error"] = error_;
    result["inputStatus"] = inputStatus_;
    result["canvasFocus"] = canvasFocus_;
    return QString::fromUtf8(QJsonDocument(result).toJson(QJsonDocument::Compact));
}

void Model::setInputStatus(const QString& status) {
    inputStatus_ = status;
    emit changed();
}

void Model::receiveState(const QJsonObject& state) {
    if (state.value("protocol").toInt() != 1 || !state.value("items").isArray() ||
        !state.value("revision").isString()) {
        error_ = "Incompatible Zynthian bridge protocol";
        socket_.abort();
        disconnected();
        return;
    }
    const auto oldItems = view_.value("items").toArray();
    const QString oldId = oldItems.at(selected_).toObject().value("id").toString();
    const bool sameScreen = view_.value("screen") == state.value("screen");
    const bool newConfirm = state.value("kind").toString() == "confirm" &&
                            view_.value("revision") != state.value("revision");
    const bool newEditor = state.value("inlineEditor").toBool() &&
                           (!view_.value("inlineEditor").toBool() || !sameScreen);
    view_ = state;
    if (!sameScreen) canvasFocus_ = true;
    if (newEditor) canvasFocus_ = false;
    const auto items = view_.value("items").toArray();
    selected_ = -1;
    if (sameScreen && !newConfirm) {
        for (int i = 0; i < items.size(); ++i)
            if (items.at(i).toObject().value("id").toString() == oldId &&
                items.at(i).toObject().value("enabled").toBool()) selected_ = i;
    }
    if (selected_ < 0) {
        selected_ = 0;
        for (int i = 0; i < items.size(); ++i)
            if (items.at(i).toObject().value("enabled").toBool()) { selected_ = i; break; }
    }
    ready_ = true;
    if (!pending_) deadline_.stop();
    emit changed();
}

void Model::read() {
    incoming_ += socket_.readAll();
    if (incoming_.size() > 1024 * 1024) {
        error_ = "Bridge response exceeded the frame limit";
        socket_.abort();
        disconnected();
        return;
    }
    while (incoming_.contains('\n')) {
        const auto end = incoming_.indexOf('\n');
        const auto line = incoming_.left(end);
        incoming_.remove(0, end + 1);
        QJsonParseError parseError;
        const auto doc = QJsonDocument::fromJson(line, &parseError);
        if (parseError.error != QJsonParseError::NoError || !doc.isObject()) {
            error_ = "Malformed bridge response";
            socket_.abort();
            disconnected();
            return;
        }
        const auto message = doc.object();
        if (message.contains("state")) receiveState(message.value("state").toObject());
        if (pending_ && message.value("id").toInt() == pending_) {
            pending_ = 0;
            deadline_.stop();
            error_ = message.value("ok").toBool() ? QString() : message.value("error").toString();
            emit changed();
        }
    }
}

void Model::send(QJsonObject command) {
    if (!ready_ || pending_ || view_.value("backendBusy").toBool() || socket_.state() != QLocalSocket::ConnectedState) return;
    command["revision"] = view_.value("revision");
    command["id"] = ++sequence_;
    pending_ = sequence_;
    error_.clear();
    socket_.write(QJsonDocument(command).toJson(QJsonDocument::Compact) + '\n');
    deadline_.start();
    emit commandIssued(command);
    emit changed();
}

void Model::move(int delta) {
    const auto items = view_.value("items").toArray();
    if (items.isEmpty()) return;
    int next = std::clamp(selected_ + delta, 0, int(items.size() - 1));
    const int direction = delta < 0 ? -1 : 1;
    while (next >= 0 && next < items.size()) {
        if (items.at(next).toObject().value("enabled").toBool()) {
            selected_ = next;
            emit changed();
            return;
        }
        next += direction;
    }
}

void Model::input(const QString& action, bool fine) {
    if (!ready_) return;
    if (view_.value("kind").toString() == "sequencer") {
        if (action == "focus" || action == "menu") { canvasFocus_ = !canvasFocus_; emit changed(); return; }
        if (action == "back" && !canvasFocus_) { canvasFocus_ = true; emit changed(); return; }
        if (pending_) return;
        if (canvasFocus_ && view_.value("sequenceActions").toArray().contains(action)) {
            sequence(action, 0, 0, fine);
            return;
        }
    }
    if (pending_) return;
    const auto item = view_.value("items").toArray().at(selected_).toObject();
    const int cols = std::max(1, view_.value("columns").toInt(1));
    if (action == "up" || action == "down") { move(action == "up" ? -cols : cols); return; }
    if (action == "pageUp" || action == "pageDown") { move(action == "pageUp" ? -8 : 8); return; }
    if (action == "left" || action == "right") {
        const int delta = action == "left" ? -1 : 1;
        if (item.value("kind").toString() == "control" && !item.value("path").toBool())
            send({{"method", "adjust"}, {"target", item.value("id")}, {"delta", delta}, {"fine", fine}});
        else move(delta);
        return;
    }
    if (action == "select" || action == "bold") {
        if (item.value("enabled").toBool()) {
            if (view_.value("kind").toString() == "sequencer" && item.value("kind").toString() != "control")
                canvasFocus_ = true;
            send({{"method", "activate"}, {"target", item.value("id")}, {"bold", action == "bold"}});
        }
        return;
    }
    if (action == "back" || action == "home" || action == "mixer" || action == "snapshots" || action == "panic" || action == "launcher" ||
        view_.value("screenActions").toObject().contains(action) || view_.value("navigation").toObject().contains(action))
        send({{"method", "action"}, {"action", action}});
}

void Model::choose(const QString& id) {
    activate(id, false);
}

void Model::activate(const QString& id, bool bold) {
    if (!ready_ || pending_) return;
    const auto items = view_.value("items").toArray();
    for (int i = 0; i < items.size(); ++i) {
        const auto item = items.at(i).toObject();
        if (item.value("id").toString() == id && item.value("enabled").toBool()) {
            selected_ = i;
            canvasFocus_ = false;
            emit changed();
            input(bold ? "bold" : "select");
            return;
        }
    }
}

void Model::adjust(const QString& id, int delta, bool fine) {
    if (delta < -10 || delta > 10) return;
    for (const auto& value : view_.value("items").toArray()) {
        const auto item = value.toObject();
        if (item.value("id").toString() == id && item.value("kind").toString() == "control" &&
            item.value("enabled").toBool() && !item.value("path").toBool()) {
            send({{"method", "adjust"}, {"target", id}, {"delta", delta}, {"fine", fine}});
            return;
        }
    }
}

void Model::sequence(const QString& action, int first, int second, bool fine) {
    if (!ready_ || pending_ || view_.value("kind").toString() != "sequencer") return;
    if (action != "cell" && !view_.value("sequenceActions").toArray().contains(action)) return;
    if (action == "cell") canvasFocus_ = true;
    send({{"method", "sequence"}, {"action", action}, {"first", first}, {"second", second}, {"fine", fine}});
}
