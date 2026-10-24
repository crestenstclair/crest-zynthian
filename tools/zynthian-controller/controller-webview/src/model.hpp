// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QJsonObject>
#include <QLocalSocket>
#include <QObject>
#include <QTimer>

class Model : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString state READ state NOTIFY changed)
public:
    explicit Model(QObject* parent = nullptr);
    void connectTo(const QString& path);
    QString state() const;
    void receiveState(const QJsonObject& state);
    void setInputStatus(const QString& status);
    Q_INVOKABLE void input(const QString& action, bool fine = false);
    Q_INVOKABLE void choose(const QString& id);
    Q_INVOKABLE void sequence(const QString& action, int first = 0, int second = 0, bool fine = false);
    Q_INVOKABLE void setTextEditing(bool editing) { textEditing_ = editing; }
    bool textEditing() const { return textEditing_; }
    Q_INVOKABLE void setNativeMode(bool active) { nativeMode_ = active; }
signals:
    void nativeInput(const QString& action, bool fine);
    void changed();
    void commandIssued(const QJsonObject& command);
private:
    void send(QJsonObject command);
    void read();
    void move(int delta);
    void disconnected();
    bool nativeMode_ = false, textEditing_ = false;
    QLocalSocket socket_;
    QTimer reconnect_;
    QTimer deadline_;
    QByteArray incoming_;
    QString path_;
    QString error_;
    QString inputStatus_;
    QJsonObject view_;
    int selected_ = 0;
    int sequence_ = 0;
    int pending_ = 0;
    bool ready_ = false;
    bool canvasFocus_ = true;
};
