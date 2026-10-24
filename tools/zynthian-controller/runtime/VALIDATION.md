# Node/HTML controller validation

The Node.js server and browser HTML interface ran against the supplied Zynthian
backend in this Mac's Linux ARM64 Docker runtime. Tests used live backend state,
FluidSynth and native MIDI sequencing/mixing, not fixture-driven screen data.
The visible application contains HTML controls; no native window stream is used.

## Exact build and run

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
