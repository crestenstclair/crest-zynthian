# SPDX-License-Identifier: GPL-2.0-or-later
"""Presentation adapter for the running ZynSeq editors. No sequencer state is owned here.

All edits go through the existing screen methods, preserving the native undo,
chord, quantization, recording and phrase behavior. Reads use the same libseq
and state cache as the Tk screens. View windows bound both rendering and IPC.
"""

import math
from .tracker_edit import TrackerEdit

PLAY_STATES = {0: "Stopped", 1: "Playing", 2: "Queued", 3: "Stopping",
               4: "Stopping", 5: "Stopping at sync", 6: "Clips playing", 8: "Clips stopping"}
NOTE_NAMES = ("C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B")
EDIT_PARAMS = ("Duration", "Velocity", "Offset", "Stutter speed", "Stutter velocity",
               "Stutter ramp", "Play frequency", "Play chance", "Stutter frequency", "Stutter chance")


def window(selected, total, size):
    start = max(0, min(int(selected) - size // 2, max(0, total - size)))
    return range(start, min(total, start + size))


class SequencerView:
    def __init__(self, adapter):
        self.adapter = adapter
        self.actions = {}
        self.cells = {}
        self.tracker_cells = {}
        self.tracker_focus = None

    def button(self, state, key, label, callback):
        self.actions[key] = callback
        self.adapter._add(state["items"], "seq:" + key, label, lambda t: callback())

    def snapshot(self, screen, state):
        self.actions = {}
        self.cells = {}
        self.tracker_cells = {}
        self.screen = screen
        seq = screen.zynseq
        state["kind"] = "sequencer"
        self.button(state, "play", "Play / stop selected", lambda: screen.switch_select("S")
                    if state["screen"] == "launcher" else screen.toggle_playback())
        self.button(state, "stop", "Stop all sequences", seq.libseq.stop)
        self.button(state, "menu", "Options", screen.item_menu if state["screen"] == "launcher" else screen.show_menu)
        self.button(state, "tempo", "Tempo / clock", lambda: self.adapter.gui.show_screen("tempo"))
        if state["screen"] == "launcher":
            self.launcher(screen, state)
        else:
            self.pattern(screen, state)
        self.actions.update({"select": lambda: screen.switch_select("S"),
                             "bold": lambda: screen.switch_select("B")})
        if state["screen"] == "launcher":
            self.actions["open"] = lambda: self.open_selected_clip(screen)
            self.actions['details'] = lambda: self.open_clip_properties(screen)
        for direction in ("up", "down", "left", "right"):
            self.actions[direction] = getattr(screen, "arrow_" + direction)
        # These actions occupy a popover, not permanent space around the grid.
        if state["screen"] != "launcher":
            if screen.edit_mode in (2, 3):
                context = (("left", "Previous parameter"), ("right", "Next parameter"),
                           ("down", "Decrease value"), ("up", "Increase value"), ("select", "Finish editing"))
            elif state["screen"] == "pated_cc":
                context = (("velocityLess", "Decrease CC value"), ("velocityMore", "Increase CC value"))
            elif screen.edit_mode == 1:
                context = (("select", "Copy / paste selection"), ("bold", "Edit selected notes"))
            else:
                context = (("bold", "Edit note parameters"), ("lengthLess", "Shorten note"),
                           ("lengthMore", "Lengthen note"), ("velocityLess", "Lower velocity"),
                           ("velocityMore", "Raise velocity"))
            for action, label in context:
                self.button(state, action, label, self.actions[action])
        navigation = (("home", "Main menu", lambda: self.adapter.gui.show_screen("main_menu")),
                      ("mixer", "Mixer", lambda: self.adapter.gui.cuia_screen_mixer()),
                      ("launcher", "Clip launcher", lambda: self.adapter.gui.show_screen("launcher")),
                      ("snapshots", "Snapshots", lambda: self.adapter.gui.cuia_screen_snapshot()),
                      ("panic", "All sounds off", lambda: self.adapter.gui.cuia_all_sounds_off()))
        for action, label, callback in navigation:
            if action == "launcher" and state["screen"] == "launcher":
                continue
            self.adapter._add(state["items"], "nav:" + action, label,
                              lambda t, callback=callback: callback())
        state["columns"] = 2
        state["sequenceActions"] = list(self.actions)
        state["sequence"]["tempo"] = round(seq.get_tempo(), 2)
        state["sequence"]["scene"] = seq.scene

    def launcher(self, screen, state):
        seq = screen.zynseq
        phrases = seq.state.get("scenes", [])[seq.scene]["phrases"]
        strips = screen.chain_strips
        selected_chain = screen.highlighted_strip.chain.chain_id if screen.highlighted_strip else None
        selected_index = next((i for i, strip in enumerate(strips) if strip.chain.chain_id == selected_chain), 0)
        columns = list(window(selected_index, len(strips), 8))
        rows = list(window(seq.phrase, len(phrases), 8))
        grid = {"type": "launcher", "columns": [], "rows": [], "cells": [],
                "selected": [seq.phrase, selected_chain], "moving": bool(screen.moving_phrase),
                "phraseCount": len(phrases), "chainCount": len(strips)}
        for ci in columns:
            chain = strips[ci].chain
            grid["columns"].append({"id": chain.chain_id, "label": chain.get_name(),
                                    "channel": chain.midi_chan, "global": chain.chain_id == 0})
        for pi in rows:
            phrase = phrases[pi]
            grid["rows"].append({"id": pi, "label": phrase.get("name") or f"Phrase {pi + 1}",
                                 "follow": phrase.get("followParam", 0) if phrase.get("followAction") else None,
                                 "repeat": phrase.get("repeat", 0)})
            for ci in columns:
                chain = strips[ci].chain
                chan = 32 if chain.chain_id == 0 else chain.midi_chan
                valid = type(chan) is int and 0 <= chan <= 32
                info = phrase if chan == 32 else (phrase["sequences"][chan] if valid else {})
                status = int(seq.libseq.getPlayState(seq.scene, pi, chan)) if valid else 0
                cell = {"row": pi, "column": chain.chain_id, "enabled": valid,
                        "label": info.get("name") or ("Launch phrase" if chan == 32 else f"Clip {pi + 1}"),
                        "status": PLAY_STATES.get(status, "Unknown"), "playState": status,
                        "repeat": info.get("repeat", 0), "events": info.get("nEvents", 0),
                        "beats": info.get("nBeats", 0), "audio": valid and 16 <= chan < 32}
                grid["cells"].append(cell)
                if valid:
                    def select(pi=pi, chain=chain):
                        screen.update_active_chain(chain.chain_id, True)
                        screen.select_launcher(pi)
                    self.cells[(pi, chain.chain_id)] = select
        self.button(state, "edit", "Edit selected clip / phrase", lambda: self.open_selected_clip(screen))
        self.button(state, "phrase", "Phrase arrangement", lambda: self.phrase_menu(screen))
        self.button(state, "append", "Append phrase", lambda: screen.phrase_menu_cb("Append phrase", seq.phrases))
        self.button(state, "copy", "Copy clip #1", lambda: screen.copy_to_clipboard(0))
        self.button(state, "paste", "Paste clip #1", lambda: screen.paste_from_clipboard(0))
        self.actions["pageUp"] = lambda: screen.select_launcher(seq.phrase - 8)
        self.actions["pageDown"] = lambda: screen.select_launcher(seq.phrase + 8)
        state["title"] = "Clip launcher"
        state["message"] = ("Moving phrase · ↑ ↓ reorder · × finishes · ○ exits move mode" if screen.moving_phrase else
                            "× Open phrase · Start / Space play · ○↑ Details · △ Quick jump")
        state["sequence"] = grid
        self.adapter.identities.append(("launcher", seq.scene, seq.phrase, selected_chain,
            len(phrases), screen.moving_phrase, [(s.chain.chain_id, s.chain.midi_chan) for s in strips]))

    @staticmethod
    def phrase_menu(screen):
        screen.update_active_chain(0, True)
        screen.phrase_menu()

    def pattern(self, screen, state):
        seq = screen.zynseq
        cc = state["screen"] == "pated_cc"
        step, row = map(int, screen.selected_cell)
        step = max(0, min(step, max(0, int(screen.n_steps) - 1)))
        row = max(0, min(row, 127 if cc else max(0, len(screen.keymap) - 1)))
        steps = list(window(step, int(screen.n_steps), 16))
        grid = {"type": "cc" if cc else "notes", "pattern": screen.pattern,
                "phrase": screen.phrase, "channel": screen.channel,
                "steps": steps, "stepCount": screen.n_steps, "stepsPerBeat": screen.n_steps_beat,
                "selected": [step, row], "editMode": screen.edit_mode,
                "recording": bool(screen.midi_record), "playState": screen.get_playback_status(),
                "playhead": int(seq.libseq.getPatternPlayhead()), "cells": [], "rows": []}
        self.button(state, "record", "MIDI record on / off", screen.toggle_midi_record)
        self.button(state, "undo", "Undo", screen.undo_pattern)
        self.button(state, "redo", "Redo", screen.redo_pattern)
        self.button(state, "editor", "Edit notes" if cc else "Edit CC", self.adapter.gui.toggle_pated)
        self.actions["pageUp"] = lambda: screen.select_cell(step - 16, None)
        self.actions["pageDown"] = lambda: screen.select_cell(step + 16, None)
        if cc:
            grid.update(cc=screen.cc_num, value=row, interpolate=bool(screen.interpolateCC))
            for si in steps:
                value = screen.get_cc_value(si)
                grid["cells"].append({"step": si, "value": value})
                self.cells[(si, row)] = lambda si=si: screen.select_cell(si, None)
            self.button(state, "ccDown", "Previous CC", lambda: screen.zynpot_cb(screen.ctrl_order[0], -1))
            self.button(state, "ccUp", "Next CC", lambda: screen.zynpot_cb(screen.ctrl_order[0], 1))
            self.actions["velocityMore"] = screen.arrow_up
            self.actions["velocityLess"] = screen.arrow_down
            detail = f"CC {screen.cc_num} · step {step + 1} · value {row} · ↑ ↓ value · × add / remove"
        else:
            # A tracker must include polyphony outside the piano roll's pitch window.
            # This is a read-only projection of the same native events and keymap.
            grid["trackerSelected"] = self.tracker_selected(screen)
            grid["trackerSteps"] = list(window(grid["trackerSelected"][0], screen.n_steps, 16))
            grid["events"] = self.tracker_events(screen, grid["trackerSteps"])
            grid["keys"] = [{"id": row, "note": key["note"], "label": key.get("name") or
                f'{NOTE_NAMES[key["note"] % 12]}{key["note"] // 12 - 1}'} for row, key in enumerate(screen.keymap)]
            self.actions["insert"] = lambda: None
            self.actions["remove"] = lambda: None
            self.actions["editCell"] = lambda: None
            rows = list(reversed(window(row, len(screen.keymap), 12)))
            for ri in rows:
                key = screen.keymap[ri]
                note = key["note"]
                grid["rows"].append({"id": ri, "note": note,
                    "label": key.get("name") or f"{NOTE_NAMES[note % 12]}{note // 12 - 1}"})
                for si in steps:
                    # getNoteStart includes notes beginning before the visible window.
                    start = int(seq.libseq.getNoteStart(si, note))
                    event = seq.get_note_data(start, note) if start >= 0 else None
                    grid["cells"].append({"step": si, "row": ri, "start": start,
                        "velocity": event.val2_start if event else 0,
                        "duration": round(event.duration, 3) if event else 0,
                        "offset": round(event.offset, 3) if event else 0})
                    self.cells[(si, ri)] = lambda si=si, ri=ri: self.select_pattern_cell(screen, si, ri)
            self.button(state, "block", "Select / copy block", lambda: self.start_block(screen))
            self.button(state, "all", "Select all notes", screen.select_block_all)
            for action, param, delta in (("lengthLess", 0, -1), ("lengthMore", 0, 1),
                                         ("velocityLess", 1, -1), ("velocityMore", 1, 1)):
                self.actions[action] = lambda param=param, delta=delta: self.note_parameter(screen, param, delta)
            key = screen.keymap[row] if screen.keymap else {"note": 0}
            event = seq.get_note_data(step, key["note"])
            values = [event.duration if event else screen.duration, event.val2_start if event else screen.velocity,
                      event.offset if event else screen.offset]
            for field in ("stut_speed", "stut_velfx", "stut_ramp", "play_freq", "play_chance", "stut_freq", "stut_chance"):
                values.append(getattr(event or screen, field))
            grid["noteValues"] = dict(zip(EDIT_PARAMS, values))
            grid["editParam"] = screen.edit_param
            grid["block"] = [list(screen.block_cell_start), list(screen.block_cell_end)] if screen.edit_mode == 1 else None
            if screen.edit_mode in (2, 3):
                detail = f"{EDIT_PARAMS[screen.edit_param]}: {values[screen.edit_param]:g} · ← → parameter · ↑ ↓ value · × finish"
            elif screen.edit_mode == 1:
                detail = "Block · arrows select / move · × copy / paste · □ options · ○ finish"
            else:
                detail = "× Select / insert · Hold × + directions to adjust · ○↑ Details · △ Quick jump"
        state["sequence"] = grid
        state["title"] = screen.get_title()
        state["message"] = detail
        self.adapter.identities.append(("pattern", seq.scene, screen.phrase, screen.sequence,
            screen.pattern, screen.n_steps, tuple(screen.selected_cell), tuple(grid.get("trackerSelected", [])), screen.edit_mode,
            screen.cc_num if cc else (screen.edit_param, [k["note"] for k in screen.keymap])))

    def open_selected_clip(self, launcher):
        launcher.edit_pad()
        if self.adapter.gui.current_screen != "pattern_editor":
            return
        screen = self.adapter.gui.screens["pattern_editor"]
        if screen.edit_mode != 0:
            return
        step, row = screen.selected_cell
        lib = screen.zynseq.libseq
        if lib.getNoteStart(step, screen.keymap[row]["note"]) >= 0:
            return
        # A tracker must land on a visible cell. Keep an existing voice selected
        # instead of an empty piano pitch hidden beneath that step's notes.
        for row, key in enumerate(screen.keymap):
            if lib.getNoteStart(step, key["note"]) >= 0:
                screen.select_cell(step, row)
                return

    def tracker_events(self, screen, steps):
        keys = {}
        for row, key in enumerate(screen.keymap):
            keys[key["note"]] = (row, key)
            self.register_tracker_cells(screen, steps, row)
        # Native event enumeration is O(events), not O(steps × MIDI pitches).
        # Send the complete pattern so navigation never needs a backend round trip.
        event = screen.get_default_note_evdata()
        events, index = [], 0
        while screen.zynseq.libseq.getEventDataAt(index, event) >= 0:
            index += 1
            if event.command != 0x90 or event.val1_start not in keys:
                continue
            row, key = keys[event.val1_start]
            events.append({"step": event.position, "row": row, "note": key["note"],
                "label": key.get("name") or f'{NOTE_NAMES[key["note"] % 12]}{key["note"] // 12 - 1}',
                "velocity": event.val2_start, "duration": round(event.duration, 3),
                "offset": round(event.offset, 3), "probability": round(event.play_chance * 100),
                "stutter": event.stut_speed})
        return events

    def register_tracker_cells(self, screen, steps, row):
        for step in steps:
            self.tracker_cells[(step, row)] = lambda step=step, row=row: self.select_tracker_cell(screen, step, row)

    def select_tracker_cell(self, screen, step, row):
        # A continuation edits its original event. The presentation retains the
        # exact tracker row while the native piano cursor selects the onset.
        if screen.edit_mode == 0:
            start = int(screen.zynseq.libseq.getNoteStart(step, screen.keymap[row]["note"]))
            screen.select_cell(start if start >= 0 else step, row)
            self.remember_tracker_focus(screen, step)
        else:
            self.select_pattern_cell(screen, step, row)

    def remember_tracker_focus(self, screen, step):
        self.tracker_focus = (id(screen), screen.pattern, tuple(screen.selected_cell), step)

    def tracker_selected(self, screen):
        native = (id(screen), screen.pattern, tuple(screen.selected_cell))
        if self.tracker_focus and self.tracker_focus[:3] == native:
            return [min(self.tracker_focus[3], screen.n_steps - 1), screen.selected_cell[1]]
        return list(screen.selected_cell)

    def edit_cell(self, request):
        screen = self.screen
        step, row = request.get("first"), request.get("second")
        self.validate_note_target(screen, step, row)
        if request.get('tracker') is True:
            TrackerEdit(self).apply(request)
            return
        action = request["action"]
        note = screen.keymap[row]["note"]
        start = int(screen.zynseq.libseq.getNoteStart(step, note))
        if action == "insert":
            if start < 0:
                screen.add_note_event(step, row, screen.velocity, screen.duration, screen.offset)
            return
        if action == "remove":
            if start >= 0:
                screen.remove_event(start, row)
            return
        field, delta = request.get("field"), request.get("delta")
        params = {"duration": 0, "velocity": 1, "offset": 2, "stutter": 3, "probability": 7}
        if field not in ("pitch", *params) or type(delta) is not int or delta not in (-1, 1):
            raise ValueError("Invalid tracker adjustment")
        large = request.get("large") is True
        screen.select_cell(start if start >= 0 else step, row)
        if field == "pitch":
            self.move_note(screen, start, row, delta * (12 if large else 1))
        else:
            self.note_parameter(screen, params[field], delta * (10 if large and field != "duration" else 1), fine=field == "duration" and not large)

    @staticmethod
    def validate_note_target(screen, step, row):
        if type(step) is not int or type(row) is not int or not 0 <= step < screen.n_steps or not 0 <= row < len(screen.keymap) or screen.edit_mode != 0:
            raise ValueError("Note is outside the editable pattern")
        if not 0 <= screen.keymap[row]['note'] <= 127:
            raise ValueError('Invalid MIDI note')

    def open_clip_properties(self, screen):
        self.open_selected_clip(screen)
        self.adapter.show_details()

    def select_directed_target(self, request):
        step, row = request.get("first"), request.get("second")
        if self.adapter.gui.current_screen == "launcher":
            if type(step) is not int or type(row) is not int or (step, row) not in self.cells:
                raise ValueError("Clip is outside the current view")
            self.cells[(step, row)]()
        else:
            self.validate_note_target(self.screen, step, row)
            self.select_tracker_cell(self.screen, step, row)

    @staticmethod
    def move_note(screen, start, row, delta):
        target = max(0, min(len(screen.keymap) - 1, row + delta))
        if target == row:
            return
        seq = screen.zynseq
        old_note, new_note = screen.keymap[row]["note"], screen.keymap[target]["note"]
        if start < 0:
            screen.select_cell(None, target)
            return
        event = seq.get_note_data(start, old_note)
        # Never replace another voice when transposing an individual note.
        for step in range(start, min(screen.n_steps, start + math.ceil(event.duration + event.offset))):
            if seq.libseq.getNoteStart(step, new_note) >= 0:
                raise ValueError("Pitch change overlaps another note")
        screen.save_pattern_snapshot(now=True, force=False)
        if not seq.libseq.addNote(start, new_note, event.val2_start, event.duration, event.offset):
            raise ValueError("Native note move failed")
        seq.libseq.setNoteData(start, new_note, event)
        seq.libseq.removeNote(start, old_note)
        seq.libseq.playNote(old_note, 0, screen.channel)
        screen.save_pattern_snapshot(now=True, force=True)
        screen.draw_grid()
        screen.select_cell(start, target)

    @staticmethod
    def select_pattern_cell(screen, step, row):
        if screen.edit_mode == 1:
            delta_step, delta_row = step - screen.selected_cell[0], row - screen.selected_cell[1]
            if screen.block_copied:
                screen.move_block(delta_step, delta_row)
            else:
                screen.select_block(delta_step, delta_row)
        else:
            screen.select_cell(step, row)

    @staticmethod
    def start_block(screen):
        screen.set_edit_mode(1)  # Upstream EDIT_MODE_BLOCK

    @staticmethod
    def note_parameter(screen, param, delta, fine=False):
        if screen.edit_mode not in (0, 2):
            raise ValueError("Finish block editing before adjusting a single note")
        mode, previous = screen.edit_mode, screen.edit_param
        # Duration delegates to add_note_event(), which owns its undo snapshots.
        # The other native encoders write values directly and need this boundary.
        if param != 0:
            screen.save_pattern_snapshot(now=True, force=False)
        try:
            screen.edit_param = param
            screen.set_edit_mode(2)
            screen.zynpot_cb(screen.ctrl_order[1 if param == 0 and fine else 2], delta)
        finally:
            screen.edit_param = previous
            screen.set_edit_mode(mode)
        if param != 0:
            screen.save_pattern_snapshot(now=True, force=True)

    def dispatch(self, request):
        action = request.get("action")
        if action in ("editCell", "insert", "remove") and action in self.actions:
            self.edit_cell(request)
            self.remember_tracker_focus(self.screen, request["first"])
        elif action in ("cell", "open", "trackerCell"):
            first, second = request.get("first"), request.get("second")
            cells = self.tracker_cells if action == "trackerCell" else self.cells
            if action == "open" and "open" not in self.actions:
                raise ValueError("Clip opening is unavailable")
            if type(first) is not int or type(second) is not int or (first, second) not in cells:
                raise ValueError("Cell is outside the current view")
            # Touch selects only; note insertion and removal are explicit actions.
            cells[(first, second)]()
            if action == "open":
                self.actions["open"]()
        elif action in self.actions:
            if request.get("directed"):
                self.select_directed_target(request)
            if action in ("lengthLess", "lengthMore"):
                self.note_parameter(self.screen, 0, -1 if action == "lengthLess" else 1, bool(request.get("fine")))
            # Native duration's fine encoder is distinct from its whole-step encoder.
            elif request.get("fine") and action in ("up", "down") and getattr(self.screen, "edit_mode", 0) == 2 and getattr(self.screen, "edit_param", -1) == 0:
                self.screen.zynpot_cb(self.screen.ctrl_order[1], 1 if action == "up" else -1)
            else:
                self.actions[action]()
        else:
            raise ValueError("Sequencer action is unavailable")
