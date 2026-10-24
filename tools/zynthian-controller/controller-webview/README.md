# Zynthian controller webview

An experimental C++ / Qt 6 WebEngine frontend for this Zynthian fork. Qt
WebChannel connects the embedded HTML interface to C++; SDL2 reads gamepads.
An opt-in local adapter exposes the **existing running Zynthian application**.
Engine discovery, hosting, presets, MIDI, audio, snapshots and state remain
Zynthian's responsibility. The frontend has no audio engine or audio dependency.

This work is independent of Crest Synth and Crest Tracker. It imports no code
from either project. There is no separate FluidSynth backend. Upstream Zynthian's
own FluidSynth engine remains available normally, alongside its other engines.

## Current implementation

Menus are read from live Zynthian screens, rather than copied into a fixed engine
catalog. Selection invokes the original screen's selection callback with its
original arguments. Native controllers receive `nudge()` / `toggle()` calls,
including logarithmic, enumerated and fine adjustment behavior.

| Surface | Adapter implementation |
| --- | --- |
| Main menu / Add Chain / grid menus | Live titles, availability and original callbacks |
| Engine / bank / preset selectors | Original list data, selection and bold actions |
| Chain Manager | Flattened graph nodes, original node selection and actions |
| Parameters | Current page's native controllers plus page selection |
| Mixer | Chain options, level, balance, mute and solo from native controllers |
| Snapshots / ZS3 / Admin / routing selectors | Existing selector callbacks and confirmation flow |
| Confirmation / keyboard | Cancel-first confirmation; controller-accessible character grid |
| Composite Chain Control | Active embedded controls/selector, processors and routing tabs |
| Clip launcher | Native chain/phrase grid, launch/stop, edit clips, status and repeats |
| Phrase arrangement | Native repeat/follow/tempo menus, insert/clone/move/delete and clipboard |
| Piano roll | Native keymap, sustained notes, cursor/playhead, velocity lane, note edits and block operations |
| CC automation | Native events, value editing, CC selection and interpolation options |
| Sequencer transport | Existing playback, stop-all, MIDI record, tempo, undo and redo |
| Engine-specific graphics / XY / range editors | Not ported; explicit message with navigation available |

The Python/Tk application still runs underneath this frontend. This is a
presentation and controller-navigation port, **not a C++ rewrite of Zynthian's
application logic**, nor a standalone replacement for its runtime. Tk is not
hidden or disabled. A later phase can decouple individual screens from Tk.

## Build on Debian / Ubuntu

Required: CMake 3.22+, C++20 compiler, Qt 6.4+ (Core, Gui, Network, Widgets,
WebEngineWidgets, WebChannel), SDL2. Qt Test and Python 3 are needed for tests.

```sh
sudo apt install build-essential cmake pkg-config qt6-base-dev qt6-webengine-dev qt6-webchannel-dev libsdl2-dev
cmake -S controller-webview -B controller-webview/build -DCMAKE_BUILD_TYPE=Release
cmake --build controller-webview/build -j4
ctest --test-dir controller-webview/build --output-on-failure
```

Run the frontend as your normal user. Chromium sandboxing is left enabled.
The build does not fetch dependencies or change the system's audio setup.

## Connect to a working Zynthian installation

Use the **same operating-system user** for Zynthian and this frontend. From the
environment in which this fork's `zynthian_main.py` already runs successfully:

```sh
install -d -m 700 "$XDG_RUNTIME_DIR/zynthian-webview"
export ZYNTHIAN_WEBVIEW_SOCKET="$XDG_RUNTIME_DIR/zynthian-webview/control.sock"
python3 zynthian_main.py
```

In a second terminal, with the same `ZYNTHIAN_WEBVIEW_SOCKET` value:

```sh
controller-webview/build/zynthian-controller --socket "$ZYNTHIAN_WEBVIEW_SOCKET" --fullscreen
```

If `XDG_RUNTIME_DIR` is unset, choose an absolute private directory owned by the
same user with mode 0700 and use its socket path in both commands. If using a
service to start Zynthian, set the variable in that service's environment and run
this fork's `zynthian_main.py`; do not launch a second Zynthian instance on top of
the service. The optional bridge does nothing unless the variable is set.

The socket is mode 0600, accepts one client, and exposes a small allowlist of UI
actions. It opens no TCP listener. Commands include the current screen revision;
stale selections are rejected. The frontend reconnects after disconnection and
does not replay commands. Existing socket paths are never replaced automatically;
after a crash, remove a stale socket only after confirming the old process ended.

This assumes a working Zynthian installation. It does not install Zynthian's
native libraries, JACK, plugins or SteamOS dependencies. Root-run Zynthian and a
normal-user frontend are not currently connected by this same-user transport.

## Controls

| Intent | Gamepad (SDL standard layout) | Keyboard |
| --- | --- | --- |
| Navigate | D-pad | Arrows |
| Select / activate | A | Enter |
| Back | B | Esc / Backspace |
| Existing bold action / options | Y | F4 |
| Adjust selected parameter | D-pad left / right | Left / right |
| Fine adjustment | Hold LB while adjusting | Hold Shift while adjusting |
| Main Menu | Start | Home |
| Mixer | View / Back | F2 |
| Snapshots | RB | F3 |
| All sounds off | Touch/click sidebar | F12 |
| Page through long lists | — | Page Up / Page Down |

Touch / mouse selection and parameter +/- buttons are also available. Up/down
move through list items or grid rows. Only directional actions repeat while held;
activation does not. Input is cleared on loss of focus and controller removal.
Note entry and audition use Zynthian’s existing piano-roll methods and engine.
External MIDI performance remains in Zynthian’s input path.

## Sequencer operation

The piano roll takes interaction inspiration from Korg Gadget for Nintendo Switch:
left-stick cursor movement, direct right-stick note edits, a readable note grid
and a velocity lane. Button mappings are this port’s own SDL mappings.
Reference: https://www.detune.co.jp/KORG_Gadget_User_Manual_en.html

The piano roll, CC editor and clip launcher fill the workspace beneath a single
44-pixel bar. Menu opens an overlay with actions for the current editor and mode,
including navigation. It never resizes the grid. Back/Esc or a tap outside closes
it; choosing an action returns focus to the grid. Native options remain available
through Options inside this menu. Inline numeric controls keep the menu open.

| Intent | Gamepad | Keyboard / touch |
| --- | --- | --- |
| Open launcher | Sidebar | F6 |
| Move clip / note cursor | D-pad or left stick | Arrows / touch a cell |
| Toggle clip / note | A | Enter / Launch / ± Note |
| Edit clip / full note parameters | Y | F4 / Menu → Edit |
| Play selected sequence | X | Space |
| MIDI record (pattern editors) | LB + X | R |
| Context menu | LB + Y | F5 / Menu |
| Note length | Right stick left/right | [ / ] or Menu → Shorten / Lengthen |
| Note velocity | Right stick up/down | − / = or Menu → Lower / Raise velocity |
| Fine note duration | Hold LB | Hold Shift |
| Open / close context menu | Left-stick click | Tab; Back closes menu |
| Start range selection | Right-stick click | Menu → Select / copy block |
| Page steps / phrases | — | Page Up / Page Down |

The launcher shows eight phrases and eight chains at a time, following native
selection. Touch selects a pad; A/Launch launches it. Y opens its native note or
audio-clip editor. Phrase arrangement selects the main phrase column and opens
Zynthian’s options for repeats, follow actions, tempo, cloning, moving and deletion.
In move mode, up/down invokes the original phrase mover; A finishes. The legacy
timeline arranger is disabled in this upstream baseline; song structure uses phrases.

The note view shows 16 steps and 12 rows from the native scale/drum keymap. Note
bars include duration/offset and notes that start before the visible window.
The velocity lane shows the selected pitch. Y enters native note editing:
left/right selects duration, velocity, offset, stutter or probability parameters;
up/down changes the value, A finishes, B exits. Range selection uses native block
copy/paste and multi-note edits. MIDI record, pattern history, file loading/saving,
SMF import/export, swing, scale, chord entry and quantization stay in Zynthian.

Edit CC switches to the native CC editor. Left/right selects a step; up/down
changes its value, A toggles an event. Previous/Next CC chooses the controller;
Options includes interpolation. Native CC multi-edit modes remain unavailable.

`zynwebview/sequencer.py` serializes bounded view windows and delegates editing;
it does not implement a new sequencer or maintain a second song model. Cursor,
pattern, phrase, keymap and edit-mode changes invalidate stale commands. Each
successful command returns its resulting state and revision with its acknowledgment.

## Validation and remaining work

The C++ executable builds against Qt 6.4.2 and SDL2 2.30.0 in the provided Ubuntu
environment. Python adapter tests exercise actual upstream menu/grid, note-entry and clip-launch
methods, callback arguments, sequencer cursor/revision guards, native editing,
transport, CC events, composite controls and confirmation behavior. C++ tests
cover navigation, focus, transport framing, disconnect behavior and key repeat.

The managed environment denies local sockets. Socket-dependent tests report
explicit skips there; they remain required on an ordinary Linux test host.
**No live Zynthian session, audio output, Steam Deck install, physical gamepad
has been validated. The actual HTML/CSS/JS has been rendered with labeled documentation fixtures.** No claim of working audio
or complete Zynthian feature parity is made by this patch.

Next verification on a configured target:

1. Run the full tests with no skips and launch both applications as the same user.
2. Add an instrument through Zynthian; browse banks and presets; play external MIDI.
3. Edit native controls, then change them by MIDI and check the reflected values.
4. Save / restore a snapshot and ZS3; verify state and routing through Zynthian.
5. Test controller hotplug, focus loss, held buttons and reconnection during loading.
6. Verify note/chord entry, duration/velocity, undo/redo, MIDI recording, CC edits,
   phrase launch/follow/move/clone and snapshot restore of sequences.
7. Complete remaining custom screens, then package the verified runtime for Steam Deck.

Source baseline: upstream `zynthian/zynthian-ui` commit
`f46b0189b6163472db39aa607369f397ed23b65a`.
New files use the upstream GPL-2.0-or-later license; see `LICENSE.txt`.

## Additional sequencer mockups

`mockups/` contains an offline, interactive prototype of tracker, Euclidean and
randomizer sequencing, a sequencer-type chooser, and pattern/step settings.
It reuses this frontend's existing style and full-workspace layout. Edits,
parameter changes, generator previews, locks, undo and visual transport operate
in memory. This prototype is not loaded by the native application and has no
Zynthian, audio or MIDI connection. See `mockups/README.md` to build and exercise it.
