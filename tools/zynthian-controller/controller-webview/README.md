# C++ controller web host

The desktop application uses **C++ / Qt 6 WebEngine with SDL2 controller input**.
It embeds the current HTML frontend from the local Node server. The same frontend
also works in a browser using the browser Gamepad API. Both input sources drive
the same JavaScript action model, screen navigation and backend commands.

Zynthian's existing Python backend, native engines, MIDI router, mixer, sequencer
and session storage remain in place. This host does not replace their algorithms.
The stock Steam Deck runtime remains separate.

## Build and launch

On this Mac, install native dependencies through Homebrew:

```sh
brew install cmake pkg-config qtwebengine qtwebchannel sdl2
bash tools/zynthian-controller/zynthian-controller host-build
bash tools/zynthian-controller/zynthian-controller open
```

`open` starts the existing controller runtime and opens the native application.
It incrementally builds the host, without rebuilding or replacing the backend
container. Docker must be running. The first backend installation still uses
`zynthian-controller build`; see the [runtime guide](../README.md).

The macOS app bundle is `build/controller-webview/zynthian-controller.app` at the
repository root. It can also be opened directly while the backend is running.
The host reads the existing `access-token` from the controller data directory;
credentials are not embedded in the binary or command line. Set
`ZYNTHIAN_CONTROLLER_DATA` to use an existing alternative data directory.

For Debian / Ubuntu dependencies:

```sh
sudo apt install build-essential cmake pkg-config qt6-base-dev qt6-webengine-dev qt6-webchannel-dev libsdl2-dev
```

The host requires CMake 3.22+, C++20, Qt 6.4+ and SDL2 2.24+. Qt Test and Python 3
are used by the existing regression suite. On Linux the native executable is
`build/controller-webview/zynthian-controller`.

Optional native arguments:

```sh
build/controller-webview/zynthian-controller --url http://localhost:8766/ \
  --token-file /absolute/path/to/access-token --fullscreen
```

For the browser version, run `zynthian-controller browser` (Safari on this Mac),
or use the authenticated URL printed by `start`. The backend currently accepts
one control window at a time: close the previous frontend when switching between
native and browser. The launcher still binds only to localhost; this change does
not expose the backend on the network.

## Native and browser input

SDL opens connected controllers and watches hotplug events in the C++ process.
Qt WebChannel delivers normalized button/axis states and connection status to
the HTML gesture interpreter shared with browser controllers.
The status line identifies the native source with `SDL`. Native input is inactive
when the app loses focus. Controllers must return to neutral after connection,
focus changes or page reload before actions resume. Directional controls repeat;
activation does not. Cross and Circle short taps commit on release; held chords
and holds of at least 350 ms consume their tap. The HTML frontend displays the
held modifier immediately. Circle/L1 + directions navigate; Cross + directions
adjust. The host must expose normalized `gamepadStateChanged` input; an older
host reports that it needs rebuilding rather than falling back to old actions. See the
Sony-position mappings in the controller guide.

The native host leaves keyboard and text-field handling with the HTML frontend.
It disables browser gamepad polling to avoid duplicate actions. A browser without
the native channel uses the existing Gamepad API mappings. No browser gamepad
permission or browser extension is needed by the native SDL path.

The current mappings remain provisional. See the [controller guide](../README.md#controls)
and [offline manual](../../../docs/zynthian-controller-manual.html). The shared
[screen map](../controller-node/SCREEN-COVERAGE.md) describes current HTML coverage.
The live tracker edits one native track; Euclidean and randomizer remain previews.

## Transport and security

The host uses an in-memory Qt WebEngine profile. Only the selected localhost
origin can navigate the webview and receive its native input channel. It injects
Qt's bundled WebChannel script directly; the server's CSP, token/Origin checks
and Chromium sandbox remain enabled. The channel exposes controller actions and
status, not arbitrary filesystem or shell access.

Node handles HTTP/WebSocket transport to the existing backend. The host uses the
same browser audio stream and **Enable audio** button. Physical MIDI routing
and engine playback remain Zynthian's responsibility.

The older C++ `Model` and direct-socket live tests remain as compatibility test
code; the desktop host uses the current shared JavaScript model so it does not
lose newer HTML screens, parameter entry, navigation or error handling.

## Verify

From the repository root:

```sh
cmake -S tools/zynthian-controller/controller-webview -B build/controller-webview -DCMAKE_BUILD_TYPE=Release
cmake --build build/controller-webview --parallel 4
ctest --test-dir build/controller-webview --output-on-failure
cd tools/zynthian-controller/controller-node
npm test
npx playwright test --grep 'native input:|browser input:'
```

The native tests cover SDL virtual-controller navigation, hold/repeat behavior,
focus rearming, simultaneous modifiers, endpoint restrictions and the existing
backend protocol. Browser tests cover both orders of WebChannel initialization,
text-field editing and the browser Gamepad path. Virtual-controller tests do not
establish physical hardware behavior; native device status and user interaction
must also be checked on the connected controller.

Local development run on 2026-10-26 used the uncommitted working tree based on
`a8619a8e0787d483c0649b42340f261daae2d9d3`. The native build and both CTest suites
passed, as did all 10 Node tests and the three targeted Playwright input tests.
The macOS host connected to the existing backend and reported
`SDL · Nintendo Switch Pro Controller`; the user confirmed D-pad Right moved
the selection from Add Chain to Chain Manager. The latest build was then
relaunched successfully with audio enabled. Audible playback in this native
session has not yet been confirmed.

That run used backend image
`sha256:75f35b26ab00471c9b775c4b6d544115558b7162a086d5d5dfc5336871ee60c4`,
with the Xvfb display-allocation fix and updated `boot.mjs` / `input.mjs` applied
to the existing container. It was not a fresh image build or hardware audio test.

All supplied license notices remain intact; new host code is GPL-2.0-or-later.
