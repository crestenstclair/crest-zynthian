// SPDX-License-Identifier: GPL-2.0-or-later
// Documentation renderer: local files only, no Zynthian process or audio engine.
#include <QApplication>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPixmap>
#include <QTimer>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineUrlRequestInterceptor>
#include <QWebEngineView>
#include <cstdio>

class LocalOnly : public QWebEngineUrlRequestInterceptor {
public:
    void interceptRequest(QWebEngineUrlRequestInfo& info) override {
        auto scheme = info.requestUrl().scheme();
        if (scheme != "file" && scheme != "data" && scheme != "qrc" && scheme != "about") info.block(true);
    }
};

int main(int argc, char** argv) {
    QApplication app(argc, argv);
    if (argc != 2) return 2;
    QFile manifest(argv[1]);
    if (!manifest.open(QIODevice::ReadOnly)) return 2;
    const auto jobs = QJsonDocument::fromJson(manifest.readAll()).array();
    QWebEngineView view;
    LocalOnly localOnly;
    QWebEngineProfile profile;
    profile.setUrlRequestInterceptor(&localOnly);
    QWebEnginePage page(&profile);
    view.setPage(&page);
    int index = 0;
    bool capturing = false;
    std::function<void()> next;
    next = [&] {
        if (index >= jobs.size()) { app.exit(0); return; }
        const auto job = jobs[index].toObject();
        view.resize(job["width"].toInt(1280), job["height"].toInt(800));
        view.load(QUrl::fromLocalFile(job["html"].toString()));
        view.show();
    };
    QObject::connect(&view, &QWebEngineView::loadFinished, &app, [&](bool ok) {
        if (!ok) { app.exit(3); return; }
        if (capturing) return;
        capturing = true;
        const auto job = jobs[index].toObject();
        page.runJavaScript(job["script"].toString(), [&, job](const QVariant&) {
            QTimer::singleShot(500, &app, [&, job] {
                page.runJavaScript(R"JS((()=>{
                  const selected=document.querySelector('.item.selected');
                  const r=selected?.getBoundingClientRect();
                  return JSON.stringify({title:document.title,width:innerWidth,height:innerHeight,
                    overflow:document.documentElement.scrollWidth>innerWidth,
                    items:document.querySelectorAll('.item').length,
                    images:[...document.images].map(i=>({ok:i.complete&&i.naturalWidth>0,src:i.alt})),
                    selected:r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom}:null,
                    manualSections:document.querySelectorAll('section').length,
                    hasRenderer:typeof render==='function',
                    checks:window.manualChecks||null});
                })())JS", [&, job](const QVariant& result) {
                    if (!view.grab().save(job["png"].toString())) { app.exit(4); return; }
                    QFile qa(job["png"].toString() + ".json");
                    if (qa.open(QIODevice::WriteOnly)) qa.write(result.toString().toUtf8());
                    std::printf("Captured %s\n", qPrintable(job["png"].toString()));
                    std::fflush(stdout);
                    ++index;
                    capturing = false;
                    next();
                });
            });
        });
    });
    QTimer::singleShot(120000, &app, [&] { app.exit(5); });
    next();
    return app.exec();
}
