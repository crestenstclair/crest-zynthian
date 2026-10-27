# Node/HTML controller validation

The Node.js server and browser HTML interface ran against the supplied Zynthian
backend in this Mac's Linux ARM64 Docker runtime. Tests used live backend state,
FluidSynth and native MIDI sequencing/mixing, not fixture-driven screen data.
The visible application contains HTML controls; no native window stream is used.

## Crest Tracker frontend pass — 2026-10-27 UTC

### Direct properties, category navigation and tracker OFF

This follow-up replaces the nested pattern-options workflow with a full HTML
property page. Shift/Circle + Up exposes the native pattern and sequence values
directly. Play mode, length, resolution, tempo, quantization, swing, humanization,
probability, scale, root, input rest and chord settings use existing native
controllers and setters. Destructive length/resolution changes retain native
confirmation. Song details target the frontend's selected clip. Engine categories
now open a separate engine list, with local Back navigation to categories.

Held Cross adjustment on an empty tracker cell inserts and edits in one native
history operation. The Event field replaces the primary Length column and selects
Empty, Note or OFF. New notes sustain to the next event or pattern end. An OFF is
a native zero-velocity MIDI note-on; preceding held notes end there. Clearing it
restores sustain. Existing fixed durations are preserved until explicitly edited.
No native engine, event database, clock or snapshot format was replaced.

Run: `2026-10-27T04:11:09.108Z`; branch `experiment/crest-tracker-ui`; base
`22f6dc49a5953784450d8d65550eb7bb270cb363` plus uncommitted changes. The image is
`sha256:75f35b26ab00471c9b775c4b6d544115558b7162a086d5d5dfc5336871ee60c4`
with read-only source mounts. Evidence remains in `/tmp/crest-controls-khI2fC`.
`direct-controls-source-manifest.json` hashes 57 files, SHA-256
`a6368219f17ea8a5673b8bc66997a3b91728f196a23728ebb06f7bc711e1c498`.
This validation entry was written after that source capture.

- 20 Node unit tests and 59 bridge tests passed.
- 13 browser checks passed across controls, input, recall, navigation and delayed
  replies. The direct-properties workflow was rerun after final visual changes.
- Live checks changed Play mode and Swing on the property page without opening
  another menu; cancelled pattern truncation without losing notes; entered a note
  by holding Cross; inserted OFF; cleared it; undid the clear; saved and recalled
  the native events; entered Sampler and Synth lists and returned to categories.
- Song details opened the locally selected second clip. The 650 ms delayed-reply
  regression still kept row movement local and preserved mounted controls.
- Safari restored `004-New Snapshot.zss`, retaining the user's FluidSynth and Calf
  Wavetable instruments and second-clip notes. It is left on the direct Pattern
  options page. `direct-properties-safari.png` captures this session;
  `tracker-native-off.png` captures OFF in disposable test data.
- `git diff --check` passed; test logs contained no traceback or allocator crash.
  C++ host code was unchanged. Physical input/audio timing was not requalified.

The optional sustain/OFF clarification had no reply before implementation; the
existing manual's empty/sustain and explicit-OFF behavior guided this pass.
Independent tracks and per-note MIDI channel assignment remain outside this pass.
The user preview remains on port 8768; only the disposable test container on 8770
is stopped afterward. Evidence directories contain credentials and must not be
published wholesale.

### Responsive controls follow-up

Navigation had been sending a backend request for every tracker row and rebuilding
the screen on pending/acknowledgement transitions. The frontend now owns cursor
and field movement. Writes carry explicit note coordinates; native events,
validation, history and persistence remain owned by Zynthian. Backend replies
cannot overwrite newer local selection. Routine command acknowledgements do not
change Connected to Working or disable and rebuild the whole screen.

The run used branch `experiment/crest-tracker-ui`, base
`22f6dc49a5953784450d8d65550eb7bb270cb363` plus uncommitted changes, and image
`sha256:75f35b26ab00471c9b775c4b6d544115558b7162a086d5d5dfc5336871ee60c4`
with source mounts. Evidence is retained in `/tmp/crest-controls-khI2fC`.
`responsive-source-manifest.json` records 54 source/test/documentation files at
`2026-10-27T03:37:45.052Z`, SHA-256
`e1fdeb540c13f6465ed5c542c8afbddc2e75d2e36cf31949bae350097dc6cd2e`.
This validation entry was written afterward. Results are recorded separately in
`responsive-validation-results.json`, preserving the earlier run's manifest.

- 19 Node unit tests and 56 bridge tests passed.
- Six browser input tests, two live controls workflows, recall and navigation
  workflows, and two responsive-controls regressions passed.
- Ten tracker row moves sent zero backend commands and retained the same DOM
  nodes. With replies delayed 650 ms, an edit targeted step 10 while the cursor
  moved to step 12 immediately and stayed there after acknowledgement.
- Piano cursor movement retained the same SVG, moved the visible highlight and
  sent no backend commands. Native events project into local pitch/step pages.
  CC editing and clip-move actions retain their native command path.
- Simulated Circle showed the held modifier immediately, emitted no Play even
  with Play focused, and opened details only when Up was added. Long holds,
  overlapping modifiers and transport release ordering did not emit trailing
  taps or playback. `responsive-circle-held.png` captures simulated input.
- Safari reloaded the final frontend and exercised local row movement against
  the user's preview. The session was preserved as `003-New Snapshot.zss` before
  the backend update; note duration 1.9 and offset 0.02 remained intact.
- `git diff --check` passed. Backend logs contained no traceback, segmentation
  fault or allocator error. C++ code was unchanged in this follow-up; the prior
  host build/core result below remains the applicable native check.

Physical Circle behavior is **not verified** in this run: Safari reported
“Browser sees no controller” pending the user's physical button trial. These
tests establish frontend gesture handling and responsiveness under delayed
replies, not hardware input, real-time audio or latency guarantees. Edits remain
serialized while acknowledgements are pending; there is no speculative note
store or new sequencer clock. The preview remains on port 8768; only disposable
test container `crest-controls-test` on port 8770 is stopped after verification.

### Controller gestures and single-track editing follow-up

The follow-up used the same base commit and native image below, with the current
uncommitted Node/HTML, C++ input and presentation-adapter changes. Local evidence
is `/tmp/crest-controls-khI2fC`, using disposable container `crest-controls-test`
on port 8770. Its `source-manifest.json` records the exact 54 source/test files
across `controller-node`, `controller-webview` and `zynwebview`; documentation
in this validation file was written afterward.
The manifest was captured at `2026-10-27T02:47:34.750Z`, SHA-256
`627c4ea34d98aae2484a7055b7388d3bb76129b9d42da9ce61e72a6e22dcb7f5`.

- 16 Node unit tests, 55 bridge tests and the native `controller-core` suite
  passed; the C++/Qt host rebuilt successfully.
- Six input browser tests passed: SDL/WebChannel initialization, shared held
  Cross/Circle gestures, keyboard chords, text-field escape and reconnects.
  Three existing offline design-demo checks also passed.
- Two live controls workflows passed: note selection, empty-cell insertion,
  pitch semitone/octave changes, velocity/length edits, pointer adjustments,
  explicit removal, single-step Undo/Redo, details/inline-value return,
  root/quick-jump navigation, Instruments/Add, instrument details, naming
  cancellation and saved-note recall.
- Native duration callbacks own their history snapshots; the adapter no longer
  adds a duplicate undo entry. Tracker row/window focus is presentation state;
  continuation cells address the native note onset without rewriting events.
  Boundary tests cover a long note across tracker windows and stale commands.
- Live navigation and post-restart snapshot/audio checks passed. Audio capture
  contained 28,160 scalar PCM samples, RMS 0.0247171562, peak 0.1022184640.
  The test logs contained no Python traceback or segmentation/allocator error.
- Safari exercised Shift + Up/Down detail entry/return and Shift + Left from
  Phrase through Song to Workspaces. The user's existing session was saved as
  `002-New Snapshot` before updating port 8768 and restored afterward.

This pass keeps one native track and the existing engines, routing and snapshot
format. SDL virtual-controller tests and browser input samples establish gesture
logic, not a new physical held-button trial. Docker audio used the dummy clock;
this does not validate physical speakers, latency, Steam Deck or Raspberry Pi.
Evidence contains credentials/session data; do not publish its directory wholesale.

This later run used branch `experiment/crest-tracker-ui`, base commit
`22f6dc49a5953784450d8d65550eb7bb270cb363` plus uncommitted frontend and presentation
bridge changes. The base commit alone does not contain this implementation.
The installed native runtime image remained
`sha256:75f35b26ab00471c9b775c4b6d544115558b7162a086d5d5dfc5336871ee60c4`.
The current `controller-node` and `zynwebview` directories were mounted read-only
over that image; engine libraries and session formats were unchanged.

Evidence directories:

- `/tmp/crest-tracker-live-JNK7Tn`: native note/tracker/audio/save and fresh-process recall.
- `/tmp/crest-tracker-regression-vpFYmW`: existing screen, routing, recorder and recall
  regressions; final layout captures; C++ and Safari screenshots.
- The latter directory's `source-manifest.json` records 551 source files,
  branch, base, image and capture time. SHA-256:
  `4effe2595e90fa3e78feaf445c0adbdd35cb5e757c699e449ce010511fdca0be`.
  Documentation was updated after capture. Final cursor/control hint text was
  checked in Safari after the automated workflow pass.

Results:

- 13 Node unit tests and 49 bridge tests passed. Added checks cover local
  navigation, hidden routing/mixer controls, tracker axes, atomic pad opening,
  stale keymaps and notes outside the piano roll's pitch window.
- Eight browser input/offline-plan checks passed. Fixture plan results do not
  establish live tracker sustain/OFF semantics.
- Three Crest browser workflows passed: create FluidSynth, edit four native
  notes in piano/tracker, change velocity and undo, set mixer level to 0.61,
  save; restart and explicitly recall; navigate using the keyboard menu and
  inspect live layouts/cursor visibility.
- The existing HTML screen workflow, three routing/MIDI-learn/ZS3/recording
  workflows and two fresh-process recall workflows passed with the new shell.
- C++ host build and `controller-core` CTest suite passed. The host rendered
  the live frontend on port 8768 and reported Nintendo Switch Pro Controller.
  This proves device detection, not a new physical button-mapping trial.
- Safari loaded the saved snapshot, displayed the restored 0.61 mixer level,
  opened Song/Phrase/Tracker and started/stopped playback with audio enabled.
- Shell syntax, refusal to share the running controller's data directory,
  existing-container reuse, and `git diff --check` passed.

The first Crest audio capture contained 31,232 scalar PCM samples, RMS
0.0304628 and peak 0.134057. A separate backend process restored the four notes
and produced non-silent browser audio again. Backend logs contained no Python
traceback, segmentation fault or allocator corruption. JACK used the Docker
dummy clock and reported XRUNs; this is not physical audio or latency validation.

The retained source preview uses container `crest-zynthian-tracker`, port 8768,
and separate host data. A copy of the task-created `001-New Snapshot` is available
there for exploration. Existing user containers on 8765/8766 were not replaced.
See [preview commands](../README.md#crest-tracker-source-preview).

This pass adds a tracker projection of native note durations and polyphony.
Independent tracks, empty-cell sustain/OFF conversion, per-note MIDI channel
assignment, Euclidean and Randomizer playback remain unimplemented. No alternate
sequencer clock, event database, engine algorithm or snapshot format was added.
Physical Steam Deck, Raspberry Pi, USB and sustained real-time checks remain
outstanding. Evidence directories contain access tokens/session data; do not
publish them wholesale.

## Exact build and run

The sections below describe the preceding 2026-10-24 validation.

- Run: `2026-10-24` UTC (`2026-10-23`, America/Los_Angeles).
- Repository base: `3d60032a019f031931917951b36a4e073b5d2fbd` **plus uncommitted
  controller changes**. The base commit alone is not the validated implementation.
- Supplied archive: `docs/zynthian-controller-source.zip`, SHA-256
  `b96b411b0d5c4c786da52c5bf83d1b09b98c9769f6c7d32b2d5cfc58e790f149`.
- Retained image: `localhost/zynthian-controller:parity-validated-20261024`.
- Tested image ID:
  `sha256:75f35b26ab00471c9b775c4b6d544115558b7162a086d5d5dfc5336871ee60c4`.
- Image created: `2026-10-24T06:02:54.621174175Z`.
- Local evidence: `/tmp/crest-parity-verified-20261024`.
- `source-manifest.json` SHA-256:
  `396de77626105dc5df4c3a1e631f2050fed53320dd5fe70d687097a72b797628`.
  All 523 bundled source files matched the working tree during the run, excluding
  dependency/build/cache/output directories. This document, README and screen
  coverage notes were updated afterward. The manifest records file contents,
  not a new Git commit.

The derived image reuses the installed `localhost/zynthian-web:oram` dependencies,
engines and factory data. It compiles the supplied matching native libraries and
installs Node dependencies from the lockfile. No other source repository was
fetched or consulted. Steam Deck packaging and source pins were not changed.

## Results

This command passed against the built image, without source bind mounts:

```sh
bash tools/zynthian-controller/runtime/tests/run.sh /tmp/crest-parity-verified-20261024
```

- Node unit tests: 7 passed, including command gating, reconnect state, gamepad
  intents, confirmation focus, Host/Origin/token checks and single-client access.
- Python bridge tests: 46 passed, including native screen/parameter delegation,
  bounded values, stale commands, sequencer operations, special screen views,
  asynchronous callback ownership, busy/loading transitions, focused menus,
  numeric keyboard keys and MIDI rename callback identity.
- Playwright HTML workflow: passed.
- Playwright chain/routing, MIDI learn/ZS3 and recording/file workflows: 3 passed.
- Playwright snapshot and ZS3/MIDI-learn recall in a fresh backend process: 2 passed.
- Offline previews were unchanged in this pass. Their 27 browser checks passed
  in the preceding `/tmp/crest-node-final-20261024` run; they were not rerun here.
- Shell syntax and `git diff --check`: passed.
- All three test phases exited with code 0 after their backend processes shut down.
  Audio clients are closed before JACK to avoid shutdown deadlocks.
  Captured logs contained no Python
  traceback, segmentation fault or allocator corruption.

Live HTML workflows covered Add Chain, engine categories, FluidSynth, MIDI
channel selection, FluidR3 bank/preset selection and Chain Control. They changed
native volume through numeric entry, opened parameter options and CC value range,
assigned X/Y controls, edited a MIDI key range, opened audio routing and cancelled
a chain-removal confirmation with Cancel initially selected.

Navigation exercised Chain Manager, global MIDI input/output, Audio Player,
MIDI Player/Recorder, Tempo, ZS3, Administration, inline settings, Help and Mixer.
Sequencer checks opened the clip launcher, entered and lengthened a note, opened
the context menu and entered a CC event. The workflow saved
`001-New Snapshot.zss`. A separate backend process explicitly loaded that snapshot
and played its sequence through the restored FluidSynth chain.

The additional parity pass inserted Calf Reverb with its Ambience preset,
toggled bypass, moved it past the chain mixer and removed it through Confirm.
It then toggled the instrument chain's Main audio route and browser MIDI input
route off/on. Parameter-button focus survived the live state update.

MIDI CC21 was learned through HTML and synthetic browser MIDI; incoming CC
changed FluidSynth volume. The pass saved volume 30 and 70 as ZS3 states named
`verse` and `chorus`, reordered them, toggled program-change learn, recalled each,
and saved `002-parity-session.zss`. After restart, both ZS3 values and CC21 control
were restored. Program-change learn entry/exit was checked, not a full incoming
program-change assignment.

Audio and MIDI recording ran simultaneously through the native recorders.
The saved WAV contained non-silent 16-bit stereo PCM at 48 kHz. The MIDI file
contained note-on and note-off events for notes 60, 64, 67 and 72. HTML controls
started/stopped MIDI-file playback, renamed the file, and cancelled deletion
without removing it. Audio Player selected the captured WAV and played it over
the browser stream. These operations used disposable test data only.

Browser audio arrived as stereo float PCM at 48 kHz over the authenticated Node
WebSocket proxy. These counts are interleaved scalar samples, not stereo frames:

| Capture | Samples | RMS | Peak |
| --- | ---: | ---: | ---: |
| Sequence before restart | 486912 | 0.01314268078517129 | 0.10971195995807648 |
| Sequence after snapshot recall | 499200 | 0.012979913567009461 | 0.10971195995807648 |
| Recorded WAV (16-bit PCM) | 229376 | 0.022055183756974468 | 0.126495361328125 |
| Recorded WAV browser playback | 336384 | 0.014569910908702929 | 0.10119626671075821 |

All captures were non-silent and unclipped. Capture windows are not sample
aligned; this is functional playback proof, not a null test or physical-speaker
measurement. Metrics are in `evidence/25-browser-audio.json` and
`evidence/30-recalled-browser-audio.json` and `recording-files.json`.

The evidence contains 42 live PNG screenshots with corresponding state JSON,
unit/workflow logs, three backend shutdown logs, image metadata and source hashes.
The offline manual preserves its 52 unique original design screenshots. The
[screen map](../controller-node/SCREEN-COVERAGE.md) accounts for all 51 registered
screen IDs; this run does not claim to exercise all 51 workflows.

## Limits and preserved behavior

The frontend is Node/HTML. Existing Python screen callbacks and the bridge still
own access to the Zynthian backend; Tk runs privately because those supplied
classes couple UI objects with application state. Engines, routing rules, native
sequence data and snapshot serialization remain Zynthian's responsibility.
Compatibility fixes cover the packaged router ABI, help renderer API, missing
file-browser directories and shutdown lifetimes. This pass also supplies the
native recorder's `jack_capture` executable, exposes the existing capture
directory in the audio browser, and fixes MIDI rename to retain the selected
file across keyboard closure. Native callbacks run serially off the Tk event
loop, preserving its loading-screen waits. No engine DSP was rewritten.

Custom engine graphs currently expose parameter pages and available scalar
monitor values. X/Y uses two editable axes. Physical touchscreen calibration
still needs the real display. Wi-Fi, Bluetooth, ALSA, CV, appliance services and
optional engines depend on the host/backend. Desktop logs report unavailable
Pi sensors, ALSA `hw:0`, systemd and `nmcli`; mapping their screens does not make
those services operate in the VM.

Tracker, Euclidean and randomizer remain interactive previews, without new
native MIDI playback or persistence. The registered native note/CC editors and
phrase launcher are integrated. Controller layout remains provisional.

JACK used its dummy clock inside Docker and logged XRUNs. This run does not
validate uninterrupted real-time audio, latency, physical gamepads, Steam Deck,
Raspberry Pi, USB devices or thermal performance. Physical Pi testing remains
deferred. The stock browser runtime remains separate on port 8765; the Node
controller uses port 8766.

Evidence remains local. Its parent directory also contains an access token and
disposable session data; publish only the specific evidence files needed.

The preceding Node image remains tagged
`localhost/zynthian-controller:node-validated-20261024`, with evidence at
`/tmp/crest-node-final-20261024`. Its production container is retained as
`crest-zynthian-controller-parity-backup-20261024` during the local update.

## Earlier C++ validation

The earlier Qt host passed a separate run at
`/tmp/crest-controller-verified-20261024`, using retained image
`localhost/zynthian-controller:validated-20261024`, ID
`sha256:a7dbe948115564d5aad598bbfe8b428bcf2aedd16224348d10b7597c47206daa`.
Those 31 captures and native audio checks describe the earlier C++ frontend,
not the current Node runtime. The previous production container is retained as
`crest-zynthian-controller-qt-backup-20261024` for rollback.
