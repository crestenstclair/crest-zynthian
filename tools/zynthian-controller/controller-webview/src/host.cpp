// SPDX-License-Identifier: GPL-2.0-or-later
#include "host.hpp"
#include <QApplication>
#include <QFile>
#include <QWebEngineScript>
#include <QWebEngineScriptCollection>
#include <QWebEngineSettings>
#include <stdexcept>

HostPage::HostPage(QWebEngineProfile* profile, const QUrl& endpoint, QObject* parent)
    : QWebEnginePage(profile, parent), origin_(endpoint.adjusted(QUrl::RemovePath | QUrl::RemoveQuery | QUrl::RemoveFragment)) {
    if (!isLocalEndpoint(endpoint)) throw std::invalid_argument("Host URL must use HTTP on localhost or 127.0.0.1, with no credentials or query.");
}

bool HostPage::isLocalEndpoint(const QUrl& url) {
    return url.isValid() && url.scheme() == "http" &&
        (url.host() == "localhost" || url.host() == "127.0.0.1") &&
        url.userInfo().isEmpty() && url.query().isEmpty() &&
        (url.path().isEmpty() || url.path() == "/") && url.port(80) > 0;
}

bool HostPage::permitsNavigation(const QUrl& url) const {
    return isLocalEndpoint(url) &&
        url.adjusted(QUrl::RemovePath | QUrl::RemoveQuery | QUrl::RemoveFragment) == origin_;
}

bool HostPage::acceptNavigationRequest(const QUrl& url, NavigationType, bool) {
    return permitsNavigation(url);
}

static QWebEngineScript nativeInputScript() {
    QFile library(":/qtwebchannel/qwebchannel.js");
    if (!library.open(QIODevice::ReadOnly)) throw std::runtime_error("Qt WebChannel JavaScript is unavailable.");
    QWebEngineScript script;
    script.setName("Zynthian native controller input");
    script.setInjectionPoint(QWebEngineScript::DocumentCreation);
    script.setWorldId(QWebEngineScript::MainWorld);
    script.setRunsOnSubFrames(false);
    // Inject Qt's bundled bridge without adding a remote script or weakening CSP.
    script.setSourceCode("window.zynthianNativeHost = true;\n" + QString::fromUtf8(library.readAll()) + R"JS(
new QWebChannel(qt.webChannelTransport, channel => {
    window.zynthianNativeInput = channel.objects.controllerInput;
    window.dispatchEvent(new Event('zynthian-native-ready'));
});
)JS");
    return script;
}

HostWindow::HostWindow(const QUrl& endpoint, QWidget* parent)
    : QWebEngineView(parent), page_(&profile_, endpoint, this) {
    input_.setActive(false);
    profile_.setPersistentCookiesPolicy(QWebEngineProfile::NoPersistentCookies);
    page_.settings()->setAttribute(QWebEngineSettings::JavascriptCanOpenWindows, false);
    page_.settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessFileUrls, false);
    channel_.registerObject("controllerInput", &input_);
    page_.setWebChannel(&channel_);
    page_.scripts().insert(nativeInputScript());
    setPage(&page_);
    resize(1280, 800);
    setWindowTitle("Zynthian Controller");
    connect(this, &QWebEngineView::loadStarted, this, [this] {
        loaded_ = false;
        updateInputFocus();
    });
    connect(this, &QWebEngineView::loadFinished, this, [this](bool ok) {
        loaded_ = ok;
        updateInputFocus();
    });
    connect(qApp, &QGuiApplication::applicationStateChanged, this, [this] { updateInputFocus(); });
    setUrl(endpoint);
}

void HostWindow::updateInputFocus() {
    input_.setActive(loaded_ && QGuiApplication::applicationState() == Qt::ApplicationActive);
}
