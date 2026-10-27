# HTML screen coverage

This maps the 51 screen IDs registered by the supplied
`zyngui/zynthian_gui.py:create_screens`. The primary interface is HTML served by
Node. The bridge reads each screen's current native controllers and menu items,
then delegates edits to its existing callbacks. There is no native-window fallback.

The design references are the [offline visual manual](../../../docs/zynthian-controller-manual.html)
and [sequencer mockups](../../../docs/zynthian-sequencer-mockups.html). Their original
52 screenshots describe the design baseline, not test results. The official
[user guide](https://wiki.zynthian.org/index.php/Zynthian_Users_Guide) and
[help](https://help.zynthian.org/) were consulted for navigation and screen roles.
No other source repository was consulted.

## Screen map

Menu rows, choices, toggles and parameter pages are rendered from live backend
state. Options invokes the existing bold action; Screen options invokes the
screen menu. Numeric parameters have direct entry and minus/plus buttons.
Selectors, dialogs and file pickers are contextual: open them through their
parent workflow so the backend retains the correct chain, processor or callback.
Initial selector focus follows the backend. Screen options uses the focused HTML
row without activating it first. Buttons retain keyboard focus across live state
updates; native loading and screen transitions block further commands.

The Crest shell has a local Workspaces menu and Triangle quick jump. Circle /
Shift + Left navigates parents; Up opens directly editable Pattern options on
phrases (native contextual details elsewhere) and Down
returns to the workspace. Cross selects on release; holding it with directions
adjusts the focused value without a trailing activation. SDL and browser
controllers share this gesture interpreter. See the [current controls](../README.md#controls).

| Screen IDs | Entry / HTML controls |
| --- | --- |
| `main_menu`, `grid_sel` | Main Menu and contextual choice grids; buttons invoke their existing actions. |
| `add_chain`, `engine` | Add Chain; chain type, category page, then a separate installed-engine list. Back returns to categories before leaving the workflow. |
| `midi_chan` | Add-chain workflow or chain MIDI configuration; channel choices. |
| `bank`, `preset` | Chain Control / Banks & Presets; bank and preset lists, per-item options. |
| `chain_control` | Instruments / loaded sound, Mixer strip or Navigation / Current instrument; processor selection and chain MIDI/audio sections. |
| `chain_options`, `processor_options` | Chain/processor Options; native rename, routing, clone, move and removal menus. |
| `chain_manager` | Instruments lists loaded sounds; Routing graph exposes native chain and processor nodes with selection/options. |
| `control`, `tempo`, `alsa_mixer`, `audio_player` | Processor parameter pages; Tempo, Audio Levels and Audio Player navigation. Path parameters open the native file picker. Custom widget scalar monitors appear as HTML readouts. |
| `control_xy` | Parameter Options / assign X and Y / Show touchpad; both axes exposed as editable controls. |
| `mixer`, `root` | Mixer; level faders, balance, mute and solo, plus the selected strip's other supplied controls. Chain buttons open Chain Control. |
| `launcher` | Song; scene/clip grid, pad selection/open, explicit launch/stop, copy/paste, phrase arrangement and native options. |
| `pattern_editor` | Song / select a pad; single-track tracker with selectable Note / Velocity / Length / Offset / Chance / Stutter cells and a piano-roll alternative. Native note insertion/removal, editing, record, block selection, Undo/Redo and pattern details. |
| `pated_cc` | Piano roll / Menu / Edit CC; event grid, controller selection, event values and native CC options. |
| `midi_config` | Global MIDI Input/Output or Chain Control; device routing and options. |
| `midi_key_range` | Chain MIDI input / Note Range & Transpose; low/high notes, octave/semitone transpose, MIDI learn and range strip. |
| `midi_cc`, `midi_cc_single`, `midi_cc_range` | Parameter Options / MIDI learn; channel/CC selection, learned CC options and range controls. |
| `midi_prog` | Contextual program-change selector; native program choices. |
| `audio_in`, `audio_out` | Chain Control / Audio input or Audio output; backend port/routing choices. |
| `snapshot` | Snapshots; existing load/save/rename/delete menus and confirmation. |
| `zs3`, `zs3_options` | Navigation / Performance states / ZS3; save, rename, restore options, move up/down, previous/next recall and program-change learn/stop. |
| `midi_recorder` | Navigation / MIDI recordings; file list, transport, recording and loop controls. |
| `admin`, `midi_profile` | Administration; native settings/service menus and MIDI profiles. Inline settings expose the original parameter editor. |
| `wifi`, `bluetooth` | Administration's connectivity menus; native device/network lists and actions when their services are available. |
| `brightness_config`, `cv_config` | Administration's hardware settings; native controllers when the relevant hardware is present. CV registration is conditional. |
| `control_test` | Administration / control test; native control values and test readout. |
| `touchscreen_calibration` | Administration / calibration; instructions and Cancel. Calibration itself requires the physical Zynthian touchscreen. |
| `tts` | Administration / accessibility; native voice, speed, volume and output settings. |
| `option`, `confirm` | Context menus and confirmations; explicit Cancel/Confirm, with Cancel initially selected. |
| `keyboard`, `file_selector` | Naming/save/load workflows; direct text entry with native Save/Cancel, controller character keys and directory/file selection. Escape / Shift + Left cancels naming. |
| `info`, `help` | Native information output, Help index/topics and selectable links. |
| `none`, `splash`, `loading` | Empty/start/stop/busy state with application navigation or status text. |

Main Menu starts/stops audio and MIDI recording, with status visible throughout
the HTML interface. Audio Player's Files / recordings action opens the native
bank/file browser, including existing captured WAV files; it remains available
after a recording is loaded. MIDI file options include rename and confirmed
deletion. Numeric naming dialogs expose their native numeric keys, including zero.

Live checks cover processor insertion/preset selection, bypass, movement/removal,
audio and MIDI route toggles, MIDI CC learn, two named/reordered ZS3 states,
snapshot save/restore, simultaneous audio/MIDI recording, file rename and
deletion cancellation, and recorded-audio playback. Fresh-process recall checks
both ZS3 values and an incoming learned CC. Other entries above remain mappings,
not exhaustive workflow validation.

## Ownership and boundaries

`web/model.mjs` owns presentation focus, the local sequencer cursor and pending
commands. Tracker and piano-roll windows project the complete native event list;
moving the cursor sends no backend command. Mutations carry explicit targets and
remain serialized. A delayed reply cannot reset newer local cursor movement.
Cursor, modifier and playhead updates preserve mounted controls; only changed
content or a new page requires a render. `server.mjs`
serves fixed assets and authenticated WebSockets; it cannot run shell commands or
arbitrary backend methods. `zynwebview/bridge.py` resolves targets against the
current native screen revision. Native callbacks run serially off the Tk event
loop so loading waits cannot deadlock it. Stale, busy and invalid commands are rejected;
reconnections never replay mutations. Zynthian owns note data, parameter ranges,
routing, instruments, undo/history and snapshot serialization.

All registered screen types have an HTML presentation path. This is basic
functional coverage, not a claim of feature parity for every custom canvas.
Custom engine waveforms/graphs are represented by parameters and available scalar
readouts; X/Y is currently two axis controls. Physical display calibration cannot
be performed from a remote browser. Host Wi-Fi, Bluetooth, CV, audio hardware,
appliance services and optional engines are not added by a screen mapping.
Desktop container service failures remain backend limitations, not successful UI
operations. The disabled legacy arranger is not registered; arrangement uses
Zynthian phrases. The Crest tracker projects and edits native note durations,
including polyphony outside the piano roll's visible pitch range. Independent
tracker tracks and per-note MIDI channels remain design work. Single-track
sustain/OFF edits now use native note durations and zero-velocity note-on events;
clearing OFF restores sustain, with native undo and snapshot recall.
Euclidean and randomizer remain interactive previews.

The [validation record](../runtime/VALIDATION.md) separates actual browser
workflows from mappings inspected in source. Screen coverage does not mean all
51 workflows or hardware combinations have been exercised.
