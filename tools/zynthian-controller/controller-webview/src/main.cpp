// SPDX-License-Identifier: GPL-2.0-or-later
#include "input.hpp"
#include "model.hpp"
#include "composer.hpp"
#include "midi_output.hpp"
#include <QLockFile>
#include <QStandardPaths>
#include <QMessageBox>
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
    parser.addOption({"project", "Controller project JSON (separate from Zynthian snapshots)", "path"});
    parser.process(app);
    QString project = parser.value("project");
    if (project.isEmpty()) {
        const auto directory = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
        QDir().mkpath(directory);
        project = directory + "/project.json";
    }
    QLockFile projectLock(project + ".lock");
    if (!projectLock.tryLock()) { qCritical("Project already in use or directory not writable"); return 2; }
    MidiOutput output;
    Composer composer(project);
    composer.setMidiSink([&](int status,int note,int velocity) { return output.send(status,note,velocity); });
    QTimer outputStatus;
    QObject::connect(&outputStatus,&QTimer::timeout,&composer,[&] { composer.setOutputStatus(output.status()); });
    outputStatus.start(1000);

    Model model;
    Input input(model);
    QObject::connect(&model, &Model::nativeInput, &composer, &Composer::input);
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
    channel.registerObject("composer", &composer);
    page.setWebChannel(&channel);
    view.setPage(&page);
    view.resize(1280, 800);
    view.setWindowTitle("Zynthian Controller");
    view.setUrl(QUrl("qrc:/ui/index.html"));
    if (parser.isSet("fullscreen")) view.showFullScreen(); else view.show();
    if (!parser.value("socket").isEmpty()) model.connectTo(parser.value("socket"));
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
