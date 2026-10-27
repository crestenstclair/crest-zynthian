// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include "input.hpp"
#include <QWebChannel>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineView>

// Only the local application's origin receives the native input channel.
class HostPage : public QWebEnginePage {
public:
    HostPage(QWebEngineProfile* profile, const QUrl& endpoint, QObject* parent);
    static bool isLocalEndpoint(const QUrl& url);
    bool permitsNavigation(const QUrl& url) const;
protected:
    bool acceptNavigationRequest(const QUrl& url, NavigationType, bool) override;
private:
    QUrl origin_;
};

class HostWindow : public QWebEngineView {
public:
    explicit HostWindow(const QUrl& endpoint, QWidget* parent = nullptr);
    Input& input() { return input_; }
private:
    void updateInputFocus();
    QWebEngineProfile profile_;
    HostPage page_;
    Input input_;
    QWebChannel channel_;
    bool loaded_ = false;
};
