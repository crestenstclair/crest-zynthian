# Zynthian controller interface

This is the controller webview supplied in this repository's source archive,
connected to its matching Zynthian application and native libraries. The design
reference is the [offline controller manual](../../docs/zynthian-controller-manual.html),
including its 52 embedded screenshots. The [sequencer previews](../../docs/zynthian-sequencer-mockups.html)
remain available offline.

The visible application is Node.js and HTML, using the manual's supplied
HTML/CSS style. Menus, parameters, routing, mixer, players, settings, snapshots,
launcher, piano roll and CC editing are browser controls. The browser does not
display a streamed Python window. Keyboard and standard browser gamepads drive
the same interface as touch and mouse.

Zynthian still owns engines, MIDI routing, sequencing and session files. The
existing Python bridge invokes those backend callbacks; Python/Tk runs on a
private display because the supplied backend still couples state and callbacks
to its screen classes. This is a frontend replacement, not a rewrite of the
engine/backend. See the [screen map](controller-node/SCREEN-COVERAGE.md) for all
51 registered screen IDs, their HTML controls and hardware limits.

## Run on this Mac or Linux desktop

Start Docker, then from the repository root:

```sh
bash tools/zynthian-controller/zynthian-controller build
bash tools/zynthian-controller/zynthian-controller open
```

The build uses the already installed `localhost/zynthian-web:oram` image for
system dependencies, engines and factory data. It installs the Node transport
and compiles this directory's matching native libraries. It does not fetch any source
repositories or change the stock image. Ubuntu development packages are installed
only inside the derived image.

`start` prints the local URL instead of opening it. Click **Enable audio** in the
browser to hear Zynthian. Add Chain → Instrument → Category · Sampler →
FluidSynth: SF2, SF3 → MIDI channel → FluidR3 GM → preset creates a playable chain.
Banks / presets in Chain Control returns to the native sound browser.

Processor Options exposes insert, bypass, move and removal. ZS3 supports naming,
reordering, program-change learn and recall through the existing snapshot state.
Main Menu starts/stops audio and MIDI recording; recording indicators remain
visible while navigating. Audio Player → Files / recordings opens saved audio,
including the existing capture directory. MIDI Player / Recorder exposes file
playback, stop, rename and deletion confirmation.

```sh
bash tools/zynthian-controller/zynthian-controller start
bash tools/zynthian-controller/zynthian-controller status
bash tools/zynthian-controller/zynthian-controller logs
bash tools/zynthian-controller/zynthian-controller stop
```

The controller uses port **8766**, container `crest-zynthian-controller`, and its
own host data directory. The stock browser runtime on 8765 and Steam Deck package
remain separate. Only localhost is published; the existing browser transport's
token, Host and Origin checks remain in force. Only one control tab is accepted
at a time. Reopen the printed URL if a new tab has no access token.

## Controls

The manual defines the mappings. Arrows / D-pad navigate, Enter / A selects,
Esc / B goes back, Home / Start opens Main Menu, F2 opens Mixer, F3 opens
Snapshots, and F6 opens the launcher. In editors, Space / X plays, F4 / Y edits,
Tab / left-stick click opens the context menu, and Shift / LB gives fine changes.
Right stick changes note length and velocity; F7 / right-stick click selects a
block. Visible Options buttons expose per-item actions; More screens opens the
remaining navigation routes. Parameter rows have minus/plus and numeric entry.
Controller layout remains provisional. Physical gamepad validation is outstanding.

## Sessions and updates

Save work with **Snapshots**. Instrument state and native sequencer events use
Zynthian's existing snapshot files. There is no separate controller project.

Host data defaults to:

- macOS: `~/Library/Application Support/crest-zynthian-controller/`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/crest-zynthian-controller/`

Configuration, snapshots, presets, recordings and logs stay there. Set
`ZYNTHIAN_CONTROLLER_DATA` to another absolute directory before creating the
container. Existing containers with a different data directory or ownership
label are rejected. Existing data and containers are never silently replaced.
After rebuilding, stop and rename the old controller container before starting
the replacement, so it remains available for rollback. Keep the data directory
and previous image. Never run two containers against the same session data.

## Build and validation

The frontend source is in `controller-node/`. For unit tests and browser test
dependencies:

```sh
cd tools/zynthian-controller/controller-node
npm ci
npm test
npx playwright install chromium
```

From the repository root, run bridge tests, actual HTML workflows, browser PCM
audio checks and a fresh-process snapshot recall using disposable data:

```sh
bash tools/zynthian-controller/runtime/tests/run.sh /tmp/controller-validation-run
```

The destination must not exist. It receives logs, state JSON, screenshots, audio metrics
and the exact tested image identity. See [validation record](runtime/VALIDATION.md)
for the checked run and limits.
The current pass includes 53 unit tests and six live workflows, with non-silent
recording/playback, processor and routing edits, and ZS3/MIDI-learn restoration
after a backend restart. It does not establish every optional engine or hardware
workflow.

The existing tracker, Euclidean and randomizer designs remain interactive
previews. They are not promoted to native playback by this runtime work.
The original manual is a design reference; the screen map records current HTML
coverage. Custom engine graphs currently expose their parameter pages and scalar
monitor values. Wi-Fi, Bluetooth, ALSA, CV and physical display controls depend
on hardware/services available to Zynthian. Mapping their screens does not add
those devices to Docker. Desktop VM checks do not establish physical
Steam Deck/Pi/USB operation, real-time latency or thermal performance.
Raspberry Pi hardware testing remains deferred.

The supplied C++/Qt host remains in `controller-webview/` as optional source. The
current launcher and validation use Node/HTML; they do not build or run Qt.

All supplied license notices are retained; see [LICENSE.txt](LICENSE.txt).
