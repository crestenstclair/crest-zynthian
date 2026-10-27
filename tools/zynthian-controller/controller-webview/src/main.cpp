// SPDX-License-Identifier: GPL-2.0-or-later
#include "host.hpp"
#include <QApplication>
#include <QCommandLineParser>
#include <QDir>
#include <QFile>
#include <QMessageBox>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QUrlQuery>
#include <stdexcept>

static QString defaultTokenPath() {
    const auto data = qEnvironmentVariable("ZYNTHIAN_CONTROLLER_DATA",
        QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation) + "/crest-zynthian-controller");
    return QDir(data).filePath("access-token");
}

static QUrl authenticatedEndpoint(const QString& address, const QString& tokenPath) {
    QUrl endpoint(address);
    if (!HostPage::isLocalEndpoint(endpoint)) throw std::runtime_error("Use the local controller URL, normally http://localhost:8766/.");
    QFile file(tokenPath);
    if (!file.open(QIODevice::ReadOnly) || file.size() > 1024)
        throw std::runtime_error("Cannot read runtime access token. Start the backend with zynthian-controller start.");
    const auto token = QString::fromUtf8(file.readAll()).trimmed();
    if (!QRegularExpression("^[A-Za-z0-9_-]{32,512}$").match(token).hasMatch())
        throw std::runtime_error("Runtime access token is invalid.");
    QUrlQuery fragment;
    fragment.addQueryItem("token", token);
    endpoint.setFragment(fragment.toString(QUrl::FullyEncoded));
    return endpoint;
}

int main(int argc, char** argv) {
    QApplication app(argc, argv);
    app.setApplicationName("zynthian-controller");
    app.setApplicationDisplayName("Zynthian Controller");
    app.setApplicationVersion("0.3.0");
    QCommandLineParser parser;
    parser.setApplicationDescription("C++ / Qt web host with native SDL controller input");
    parser.addHelpOption();
    parser.addVersionOption();
    parser.addOption({"url", "Local Node/HTML frontend URL", "url", "http://localhost:8766/"});
    parser.addOption({"token-file", "Runtime access-token file", "path", defaultTokenPath()});
    parser.addOption({"fullscreen", "Start fullscreen"});
    parser.addOption({"screenshot", "Save the rendered view then exit (UI check)", "path"});
    parser.process(app);
    try {
        HostWindow view(authenticatedEndpoint(parser.value("url"), parser.value("token-file")));
        if (parser.isSet("screenshot")) {
            QObject::connect(&view, &QWebEngineView::loadFinished, &app, [&](bool ok) {
                if (!ok) { app.exit(1); return; }
                QTimer::singleShot(2000, &app, [&] { app.exit(view.grab().save(parser.value("screenshot")) ? 0 : 1); });
            });
        }
        if (parser.isSet("fullscreen")) view.showFullScreen(); else view.show();
        return app.exec();
    } catch (const std::exception& error) {
        qCritical("%s", error.what());
        QMessageBox::critical(nullptr, "Zynthian Controller", error.what());
        return 1;
    }
}
