// SPDX-License-Identifier: GPL-2.0-or-later
#include "input.hpp"
#include "model.hpp"
#include <QJsonArray>
#include <QJsonDocument>
#include <QKeyEvent>
#include <QLocalServer>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QtTest>
#include <cerrno>
#include <sys/socket.h>
#include <unistd.h>

static bool unixSocketsDenied() {
    const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return errno == EPERM || errno == EACCES;
    ::close(fd);
    return false;
}

class CoreTests : public QObject {
    Q_OBJECT
private slots:
    void sequencerFocusSurvivesUpdatesAndResetsOnScreenChange() {
        Model model;
        QJsonObject state{{"protocol", 1}, {"screen", "pattern_editor"}, {"kind", "sequencer"}, {"revision", "a"},
                          {"items", QJsonArray{QJsonObject{{"id", "seq:play"}, {"enabled", true}}}}};
        const auto current = [&] { return QJsonDocument::fromJson(model.state().toUtf8()).object(); };
        model.receiveState(state);
        QVERIFY(current()["canvasFocus"].toBool());
        QSignalSpy commands(&model, &Model::commandIssued);
        model.input("menu"); // F5 / LB+Y opens the local popover, not native options.
        QVERIFY(!current()["canvasFocus"].toBool());
        QCOMPARE(commands.size(), 0);
        state["revision"] = "b";
        model.receiveState(state);
        QVERIFY(!current()["canvasFocus"].toBool());
        model.input("back");
        QVERIFY(current()["canvasFocus"].toBool());
        QCOMPARE(commands.size(), 0); // Dismissal must not leave the native editor.
        model.input("focus");
        QVERIFY(!current()["canvasFocus"].toBool());
        model.input("focus");
        QVERIFY(current()["canvasFocus"].toBool());
        state["inlineEditor"] = true;
        model.receiveState(state);
        QVERIFY(!current()["canvasFocus"].toBool());
        model.input("back");
        model.receiveState(state);
        QVERIFY(current()["canvasFocus"].toBool()); // Polls must not force a dismissed menu open.
        state.remove("inlineEditor");
        state["screen"] = "pated_cc";
        model.receiveState(state);
        QVERIFY(current()["canvasFocus"].toBool());
    }

    void sequencerCommandsUseCurrentRevision() {
        if (unixSocketsDenied()) QSKIP("Local sockets are denied by this environment");
        QTemporaryDir dir;
        QLocalServer server;
        QVERIFY(server.listen(dir.filePath("sequencer.sock")));
        Model model;
        model.connectTo(server.fullServerName());
        QTRY_VERIFY(server.hasPendingConnections());
        auto* peer = server.nextPendingConnection();
        QTRY_VERIFY(peer->bytesAvailable() > 0);
        peer->readAll();
        QJsonObject state{{"protocol", 1}, {"screen", "pattern_editor"}, {"kind", "sequencer"}, {"revision", "cursor-4"},
            {"sequenceActions", QJsonArray{"up", "select", "lengthMore"}},
            {"items", QJsonArray{QJsonObject{{"id", "seq:play"}, {"enabled", true}}}}};
        model.receiveState(state);
        model.input("up", true);
        QTRY_VERIFY(peer->bytesAvailable() > 0);
        auto cmd = QJsonDocument::fromJson(peer->readAll().trimmed()).object();
        QCOMPARE(cmd["method"].toString(), "sequence");
        QCOMPARE(cmd["action"].toString(), "up");
        QCOMPARE(cmd["revision"].toString(), "cursor-4");
        QVERIFY(cmd["fine"].toBool());
        state["revision"] = "cursor-5";
        peer->write(QJsonDocument(QJsonObject{{"id",cmd["id"]},{"ok",true},{"state",state}}).toJson(QJsonDocument::Compact)+'\n');
        QTRY_VERIFY(!QJsonDocument::fromJson(model.state().toUtf8()).object()["busy"].toBool());
        model.sequence("cell", 7, 64);
        QTRY_VERIFY(peer->bytesAvailable() > 0);
        cmd = QJsonDocument::fromJson(peer->readAll().trimmed()).object();
        QCOMPARE(cmd["revision"].toString(), "cursor-5");
        QCOMPARE(cmd["first"].toInt(), 7);
        QCOMPARE(cmd["second"].toInt(), 64);
        delete peer;
    }
    void navigationAndStaleFocus() {
        Model model;
        QJsonObject state{{"protocol", 1}, {"screen", "preset"}, {"revision", "a"},
                          {"items", QJsonArray{
                            QJsonObject{{"id", "heading"}, {"enabled", false}},
                            QJsonObject{{"id", "p1"}, {"enabled", true}},
                            QJsonObject{{"id", "divider"}, {"enabled", false}},
                            QJsonObject{{"id", "p2"}, {"enabled", true}}}}};
        const auto current = [&] { return QJsonDocument::fromJson(model.state().toUtf8()).object(); };
        model.receiveState(state);
        QCOMPARE(current()["selected"].toInt(), 1);
        model.input("down");
        QCOMPARE(current()["selected"].toInt(), 3);
        model.input("down");
        QCOMPARE(current()["selected"].toInt(), 3);
        state["revision"] = "b";
        model.receiveState(state);
        QCOMPARE(current()["selected"].toInt(), 3);
        state["screen"] = "confirm";
        state["kind"] = "confirm";
        state["items"] = QJsonArray{QJsonObject{{"id", "cancel"}, {"enabled", true}},
                                    QJsonObject{{"id", "confirm"}, {"enabled", true}}};
        model.receiveState(state);
        QCOMPARE(current()["selected"].toInt(), 0);
        model.input("down");
        QCOMPARE(current()["selected"].toInt(), 1);
        state["revision"] = "c";
        model.receiveState(state);
        QCOMPARE(current()["selected"].toInt(), 0);
    }

    void socketRoundTripAndDisconnect() {
        QTemporaryDir dir;
        QLocalServer server;
        // The managed build environment denies socket creation. Preserve these as
        // integration tests for an ordinary Linux machine; do not fake a pass.
        if (unixSocketsDenied())
            QSKIP("Local sockets are denied by this environment");
        QVERIFY(server.listen(dir.filePath("bridge.sock")));
        Model model;
        model.connectTo(server.fullServerName());
        QTRY_VERIFY(server.hasPendingConnections());
        auto* peer = server.nextPendingConnection();
        QTRY_VERIFY(peer->bytesAvailable() > 0);
        QVERIFY(peer->readAll().contains("state"));
        QJsonObject state{{"protocol", 1}, {"screen", "control"}, {"revision", "first"},
            {"items", QJsonArray{QJsonObject{{"id", "cutoff"}, {"kind", "control"}, {"enabled", true}}}}};
        const auto frame = QJsonDocument(QJsonObject{{"state", state}}).toJson(QJsonDocument::Compact) + '\n';
        // Deliberately fragmented framing across socket reads.
        peer->write(frame.left(7));
        peer->flush();
        QTest::qWait(10);
        peer->write(frame.mid(7));
        QTRY_VERIFY(QJsonDocument::fromJson(model.state().toUtf8()).object()["connected"].toBool());
        QSignalSpy commands(&model, &Model::commandIssued);
        model.input("right", true);
        QTRY_VERIFY(peer->bytesAvailable() > 0);
        auto command = QJsonDocument::fromJson(peer->readAll().trimmed()).object();
        QCOMPARE(command["target"].toString(), "cutoff");
        QCOMPARE(command["revision"].toString(), "first");
        QVERIFY(command["fine"].toBool());
        QCOMPARE(command["delta"].toInt(), 1);
        model.input("right"); // No queue of parameter changes while operation is busy.
        QCOMPARE(commands.size(), 1);
        peer->write(QJsonDocument(QJsonObject{{"id", command["id"]}, {"ok", false},
                                             {"error", "Screen changed; command discarded"}}).toJson(QJsonDocument::Compact) + '\n');
        QTRY_VERIFY(!QJsonDocument::fromJson(model.state().toUtf8()).object()["busy"].toBool());
        QVERIFY(QJsonDocument::fromJson(model.state().toUtf8()).object()["error"].toString().contains("discarded"));
        peer->disconnectFromServer();
        QTRY_VERIFY(!QJsonDocument::fromJson(model.state().toUtf8()).object()["connected"].toBool());
        model.input("select");
        QCOMPARE(commands.size(), 1);
        QVERIFY(QJsonDocument::fromJson(model.state().toUtf8()).object()["items"].toArray().isEmpty());
        delete peer;
    }

    void keyboardDoesNotRepeatActivation() {
        QTemporaryDir dir;
        QLocalServer server;
        if (unixSocketsDenied())
            QSKIP("Local sockets are denied by this environment");
        QVERIFY(server.listen(dir.filePath("bridge.sock")));
        Model model;
        Input input(model);
        QObject target;
        target.installEventFilter(&input);
        QSignalSpy commands(&model, &Model::commandIssued);
        model.connectTo(server.fullServerName());
        QTRY_VERIFY(server.hasPendingConnections());
        auto* peer = server.nextPendingConnection();
        model.receiveState({{"protocol", 1}, {"screen", "confirm"}, {"revision", "r"},
                            {"items", QJsonArray{QJsonObject{{"id", "cancel"}, {"enabled", true}}}}});
        QKeyEvent held(QEvent::KeyPress, Qt::Key_Return, Qt::NoModifier, {}, true);
        QCoreApplication::sendEvent(&target, &held);
        QCOMPARE(commands.size(), 0);
        input.setActive(false);
        QKeyEvent press(QEvent::KeyPress, Qt::Key_Return, Qt::NoModifier);
        QCoreApplication::sendEvent(&target, &press);
        QCOMPARE(commands.size(), 0);
        input.setActive(true);
        QCoreApplication::sendEvent(&target, &press);
        QCOMPARE(commands.size(), 1);
        delete peer;
    }
};
QTEST_GUILESS_MAIN(CoreTests)
#include "core_tests.moc"
