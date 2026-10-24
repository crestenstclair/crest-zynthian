# Visual manual and screenshots

The documentation generator uses the frontend's actual HTML, CSS and JavaScript
with synthetic, explicitly labeled screen states. It does not launch Zynthian,
open its control socket, load an engine, or change the production frontend.
Main-menu, Add Chain and Play & Record structures are extracted from upstream
methods through the existing boundary-test helpers. Other sample rows and values
are illustrations. The full registered-screen inventory is extracted with AST.

From the repository root, using a normal desktop user and the Qt development
dependencies already required by the frontend (plus Python Pillow):

```sh
python3 controller-webview/docs/generate_manual.py \
  --repo "$PWD" --output "$PWD/manual-output" --phase fixtures

g++ -std=c++20 controller-webview/docs/capture.cpp -o /tmp/zynthian-doc-capture \
  $(pkg-config --cflags --libs Qt6WebEngineWidgets Qt6WebChannel)

QT_QPA_PLATFORM=offscreen QTWEBENGINE_CHROMIUM_FLAGS=--disable-gpu \
  /tmp/zynthian-doc-capture "$PWD/manual-output/capture-manifest.json"

python3 controller-webview/docs/generate_manual.py \
  --repo "$PWD" --output "$PWD/manual-output" --phase manual
```

The capture tool reads a JSON job array, renders local files, writes PNGs and
records DOM-layout checks in adjacent `.png.json` files. An interceptor blocks
network requests. The generator verifies the screenshot count, expected item
count and document overflow before writing the self-contained HTML manual,
full-resolution screenshot ZIP and overview PNG. A configured Qt platform / GPU
backend may require different offscreen settings on another host.

The root-run managed environment used a sandbox exception only for this isolated
documentation renderer. Do not copy that exception into the frontend deployment.

Outputs include all fixture states and captions in `screen-reference.json`.
The resulting manual contains no remote assets and can be opened directly from
disk. Its screen search, category filter, image enlargement and PNG downloads
work offline. All live runtime and hardware-validation limits remain visible.

The gallery also includes eight explicitly marked sequencer mockup screens.
Their isolated source lives in `../mockups/`. The generator emits
`zynthian-sequencer-mockups.html`, a self-contained interactive preview, and adds
it to the screenshot ZIP and the manual's download links. These proposals do
not change the production frontend or claim native integration.
