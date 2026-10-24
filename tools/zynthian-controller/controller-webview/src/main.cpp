// SPDX-License-Identifier: GPL-2.0-or-later
#include "input.hpp"
#include "model.hpp"
#include <QApplication>
#include <QCommandLineParser>
#include <QDir>
#include <QWebChannel>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QWebEngineView>

class LocalPage : public QWebEnginePage {
public:
    using QWebEnginePage::QWebEnginePage;
protected:
    bool acceptNavigationRequest(const QUrl& url, NavigationType, bool) override {
        return url == QUrl("qrc:/ui/index.html");
    }
};

int main(int argc, char** argv) {
    QApplication app(argc, argv);
    QApplication::setApplicationName("zynthian-controller");
    QApplication::setApplicationVersion("0.1.0");
    QCommandLineParser parser;
    parser.setApplicationDescription("Controller webview for the existing Zynthian application");
    parser.addHelpOption();
    parser.addVersionOption();
    parser.addOption({"socket", "Path to ZYNTHIAN_WEBVIEW_SOCKET", "path", qEnvironmentVariable("ZYNTHIAN_WEBVIEW_SOCKET")});
    parser.addOption({"fullscreen", "Start fullscreen"});
    parser.addOption({"screenshot", "Save a screenshot after rendering, then exit (UI check)", "path"});
    parser.process(app);
    if (parser.value("socket").isEmpty()) parser.showHelp(2);

    Model model;
    Input input(model);
    app.installEventFilter(&input);
    QObject::connect(&app, &QGuiApplication::applicationStateChanged, &input,
                     [&](Qt::ApplicationState state) { input.setActive(state == Qt::ApplicationActive); });
    QWebEngineView view;
    // In-memory profile and local embedded assets; no remote browser navigation.
    QWebEngineProfile profile;
    LocalPage page(&profile, &view);
    page.settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessRemoteUrls, false);
    page.settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessFileUrls, false);
    page.settings()->setAttribute(QWebEngineSettings::JavascriptCanOpenWindows, false);
    QWebChannel channel;
    channel.registerObject("zynthian", &model);
    page.setWebChannel(&channel);
    view.setPage(&page);
    view.resize(1280, 800);
    view.setWindowTitle("Zynthian Controller");
    view.setUrl(QUrl("qrc:/ui/index.html"));
    if (parser.isSet("fullscreen")) view.showFullScreen(); else view.show();
    model.connectTo(parser.value("socket"));
    if (parser.isSet("screenshot")) {
        QObject::connect(&view, &QWebEngineView::loadFinished, &app, [&](bool ok) {
            if (!ok) { app.exit(1); return; }
            QTimer::singleShot(1500, &app, [&] {
                app.exit(view.grab().save(parser.value("screenshot")) ? 0 : 1);
            });
        });
    }
    return app.exec();
}
