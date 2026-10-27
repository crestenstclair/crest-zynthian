# Zynthian controller interface

> This branch's Crest Tracker experiment was abandoned on 2026-10-26
> (2026-10-27 UTC). Its controls, behavior and performance did not meet the
> intended workflow. The implementation and validation history are preserved for
> reference, not acceptance. Keep only the desired visual style as a reference
> for the fresh Crest Zynth approach; do not treat this interaction model as its
> specification. See the [style archive](../../docs/archive/crest-tracker-ui/index.html).

This is the controller webview supplied in this repository's source archive,
connected to its matching Zynthian application and native libraries. The design
reference is the [offline controller manual](../../docs/zynthian-controller-manual.html),
including its 52 embedded screenshots. The [sequencer previews](../../docs/zynthian-sequencer-mockups.html)
remain available offline.

The desktop application is a C++ / Qt WebEngine host with native SDL2 controller
input. It embeds the shared Node/HTML frontend using the manual's supplied
HTML/CSS style. On `experiment/crest-tracker-ui`, the shared frontend uses the
Crest Tracker layout described below. The browser version retains Gamepad API support. Menus, parameters, routing, mixer, players, settings, snapshots,
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

### Crest Tracker source preview

With the controller image already built, run:

```sh
bash tools/zynthian-controller/zynthian-controller preview browser
```

This opens Safari on macOS at port **8768**. Use `preview open` for the existing
C++/Qt host with SDL controller input. Close the other preview window first;
only one controller connection is accepted at a time.

The preview mounts this checkout's Node frontend and presentation bridge
read-only over the installed controller image. It uses container
`crest-zynthian-tracker` and separate data in
`~/Library/Application Support/crest-zynthian-tracker/` on macOS, or
`${XDG_DATA_HOME:-~/.local/share}/crest-zynthian-tracker/` on Linux. The normal
controller on 8766 and stock runtime on 8765 keep their existing sessions.
Source mounts and data ownership are checked before reuse, and a session
directory already used by another running container is rejected.

Reload after frontend edits. After bridge edits, run `preview stop` followed by
`preview browser`. `preview status` and `preview logs` inspect this separate
runtime. Native-library changes still require an image rebuild.

- **Song** shows the native scene/launcher. Select a pad to open its phrase;
  **Launch** or **Play** starts the selected native clip. Row follow actions and
  scene options stay in the context menu.
- **Phrase** opens a single-track tracker, with a piano-roll alternative over
  the same native events. Move between rows and Note / Velocity / Event /
  Offset / Chance / Stutter fields. Hold Cross and use directions to enter or
  adjust a note without a separate insertion tap. The Event field cycles through
  Empty, Note and OFF; Select cycles it too. New notes sustain through empty rows
  until the next note, OFF or pattern end. Clear cell removes the event; clearing
  OFF restores the preceding sustain. Undo/Redo use native pattern history.
  Existing notes keep their timing until edited; fixed lengths remain available
  through the native note editor and length shortcuts.
  Circle + Up opens a full Pattern options page with directly editable play mode,
  length, resolution, tempo, swing, quantization, scale and other properties.
  Circle + Down returns to the phrase. Length/resolution changes that can lose
  notes retain the native confirmation.
- **Instruments** lists loaded Zynthian sounds. Each opens its processors,
  bank/preset browser, parameters and MIDI/audio routing. **Routing graph**
  exposes native chain/processor operations. **+ Add instrument** at the bottom
  opens engine categories directly. Selecting a category opens only that engine
  list; Circle + Left returns to categories. There is no tracker Chain layer.
- **Mixer** provides native level faders, balance, mute and solo. Select a
  strip's control to expose its additional output controls.
- **Workspaces** is the top-level menu: Sequencer, Instruments, Mixer, Song
  files, Performance, recordings and Settings. Circle + Left moves back through
  Phrase, Song and Workspaces. **Triangle** opens Quick jump, including native
  routing, clock, snapshots, ZS3 and the native main menu.

The single-track tracker stores sustain as native note duration and OFF as a
native zero-velocity MIDI note-on, which releases the note. Per-note MIDI channels
and independent tracker tracks remain unimplemented. Euclidean and Randomizer
remain design previews. No alternate note store, engine, clock or snapshot format
has been introduced.

### Standard controller runtime

For a physical Raspberry Pi with Pisound, see the
[Pi trial guide](runtime/RASPBERRY-PI.md). It uses this same HTML controller with
ALSA audio/MIDI and SSH browser access, while keeping the existing OS and data.

Start Docker. Install Qt WebEngine, Qt WebChannel, SDL2, CMake and pkg-config on
the desktop host (see the [native host guide](controller-webview/README.md)), then
from the repository root:

```sh
bash tools/zynthian-controller/zynthian-controller build
bash tools/zynthian-controller/zynthian-controller open
```

`open` builds and launches the native C++ app. Use `host-build` to build only the
host, or `browser` to open the shared frontend in Safari on this Mac. Close the
previous controller window when switching; the backend accepts one at a time.

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

Use the [offline control-mapping workbook](../../docs/zynthian-control-mapping.html)
to specify your preferred controls. It lists 62 gamepad, keyboard and Deck/touch
inputs, global defaults and all 51 registered screens. Add custom controls or
screen modes, describe press/hold/modifier behavior in plain English, then choose
**Save JSON bundle**. Load JSON reopens the design for editing; a browser-local
draft is saved automatically where storage is available. This is a design
handoff for implementation, not a live runtime configuration loader. See the
[workbook format and source](control-map/README.md).

The live Crest frontend uses Sony button positions on all standard controllers:

| Input | Behavior | Keyboard |
| --- | --- | --- |
| D-pad | Move rows and fields / menu selection | Arrows |
| × Cross (bottom) | Select; insert into an empty note cell | X or Enter |
| Hold × + Left / Right | Smaller change | Hold X + Left / Right |
| Hold × + Up / Down | Larger change | Hold X + Up / Down |
| ○ Circle (right) | Tap Back; hold as Shift | O; Escape for Back |
| Hold ○ + Left | Parent; keep held to reach Workspaces | Shift + Left |
| Hold ○ + Right | Enter selected destination | Shift + Right |
| Hold ○ + Up | Pattern options / context details | Shift + Up |
| Hold ○ + Down | Return from details to workspace | Shift + Down |
| △ Triangle (top) | Quick jump | Y, T or F5 |
| □ Square (left) | Context options | S |
| Start / Options | Play / stop in sequencer | Space |
| Back / Share | Workspaces | Home |

L1 is another Shift button. Holding Circle shows `○ SHIFT`; holding Cross shows
`× ADJUST`. A short tap commits on release. A chord or a hold of at least 350 ms
consumes the tap, so releasing an adjustment or navigation gesture does not
also select or go back. Play/record presses are suppressed while either modifier
is held and stay suppressed until that transport button is released.
Pitch changes are one semitone or octave; velocity changes are 1 or 10. The
Event field cycles Empty / Note / OFF. Parameter controls use their native
fine/coarse steps. Pointer buttons provide equivalent edits and Clear cell.
Row, field and piano-roll cursor movement is local to the frontend, including
while an edit awaits acknowledgement. Edits send explicit step and pitch-row
targets to Zynthian; replies do not move a cursor that has since moved elsewhere.
Routine acknowledgements leave the connection label and mounted editor intact.
Naming has a normal text field, Save and Cancel, plus the controller keyboard.
Escape or Shift + Left leaves naming without saving.

F2 opens Mixer, F3 Song files and F6 Song. Right stick retains length/velocity
shortcuts; F7 / right-stick click selects a native block. Visible Options buttons
expose per-item actions. The original manual and offline design demo retain
earlier proposed mappings; the table above describes this branch's live UI.
The native status line identifies devices
read by SDL; browser previews use the browser Gamepad API. Physical mapping
validation is separate from virtual-controller regression tests.

## Sessions and updates

Save work with **Snapshots**. Instrument state and native sequencer events use
Zynthian's existing snapshot files. There is no separate controller project.
LV2 snapshots also embed unsaved plugin state and Lilv-managed resources without
creating a user preset. Rebuild the matching base runtime so Jalv provides the
state commands used by this backend. See the [runtime state behavior and limits](../zynthian-steamdeck/README.md#audio-and-persistence).

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

The full tracker sustain/OFF design, Euclidean and randomizer designs remain
interactive previews. The Crest tracker projection described above edits and
plays existing native notes without implementing those additional semantics.
The original manual is a design reference; the screen map records current HTML
coverage. Custom engine graphs currently expose their parameter pages and scalar
monitor values. Wi-Fi, Bluetooth, ALSA, CV and physical display controls depend
on hardware/services available to Zynthian. Mapping their screens does not add
those devices to Docker. Desktop VM checks do not establish physical
Steam Deck/Pi/USB operation, real-time latency or thermal performance.
Raspberry Pi hardware testing remains deferred.

The C++/Qt desktop host is in `controller-webview/`; `open` builds and launches
it. Its native controller tests complement the existing Node/HTML backend and
screen tests. See the [native host guide](controller-webview/README.md).

All supplied license notices are retained; see [LICENSE.txt](LICENSE.txt).
