# SPDX-License-Identifier: GPL-2.0-or-later
"""Presentation adapter for the running ZynSeq editors. No sequencer state is owned here.

All edits go through the existing screen methods, preserving the native undo,
chord, quantization, recording and phrase behavior. Reads use the same libseq
and state cache as the Tk screens. View windows bound both rendering and IPC.
"""

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

    def button(self, state, key, label, callback):
        self.actions[key] = callback
        self.adapter._add(state["items"], "seq:" + key, label, lambda t: callback())

    def snapshot(self, screen, state):
        self.actions = {}
        self.cells = {}
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
            grid["columns"].append({"id": chain.chain_id, "label": chain.get_name()})
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
        self.button(state, "edit", "Edit selected clip / phrase", screen.edit_pad)
        self.button(state, "phrase", "Phrase arrangement", lambda: self.phrase_menu(screen))
        self.button(state, "append", "Append phrase", lambda: screen.phrase_menu_cb("Append phrase", seq.phrases))
        self.button(state, "copy", "Copy clip #1", lambda: screen.copy_to_clipboard(0))
        self.button(state, "paste", "Paste clip #1", lambda: screen.paste_from_clipboard(0))
        self.actions["pageUp"] = lambda: screen.select_launcher(seq.phrase - 8)
        self.actions["pageDown"] = lambda: screen.select_launcher(seq.phrase + 8)
        state["title"] = "Clip launcher"
        state["message"] = ("Moving phrase · ↑ ↓ reorder · A finishes · B exits move mode" if screen.moving_phrase else
                            "A launch / stop · Y edit · X play · Menu: LB + Y / L-stick click / F5")
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
            detail = f"CC {screen.cc_num} · step {step + 1} · value {row} · ↑ ↓ value · A add / remove"
        else:
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
                detail = f"{EDIT_PARAMS[screen.edit_param]}: {values[screen.edit_param]:g} · ← → parameter · ↑ ↓ value · A finish"
            elif screen.edit_mode == 1:
                detail = "Block · arrows select / move · A copy / paste · Y edit selection · B finish"
            else:
                detail = f"Step {step + 1} · A add / remove · Y edit · X play · LB + X record"
        state["sequence"] = grid
        state["title"] = screen.get_title()
        state["message"] = detail
        self.adapter.identities.append(("pattern", seq.scene, screen.phrase, screen.sequence,
            screen.pattern, screen.n_steps, tuple(screen.selected_cell), screen.edit_mode,
            screen.cc_num if cc else (screen.edit_param, [k["note"] for k in screen.keymap])))

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
        screen.save_pattern_snapshot(now=True, force=False)
        try:
            screen.edit_param = param
            screen.set_edit_mode(2)
            screen.zynpot_cb(screen.ctrl_order[1 if param == 0 and fine else 2], delta)
        finally:
            screen.edit_param = previous
            screen.set_edit_mode(mode)
        screen.save_pattern_snapshot(now=True, force=True)

    def dispatch(self, request):
        action = request.get("action")
        if action == "cell":
            first, second = request.get("first"), request.get("second")
            if type(first) is not int or type(second) is not int or (first, second) not in self.cells:
                raise ValueError("Cell is outside the current view")
            # Touch selects only. A/Toggle is explicit, avoiding accidental note/clip changes.
            self.cells[(first, second)]()
        elif action in self.actions:
            if action in ("lengthLess", "lengthMore"):
                self.note_parameter(self.screen, 0, -1 if action == "lengthLess" else 1, bool(request.get("fine")))
            # Native duration's fine encoder is distinct from its whole-step encoder.
            elif request.get("fine") and action in ("up", "down") and getattr(self.screen, "edit_mode", 0) == 2 and getattr(self.screen, "edit_param", -1) == 0:
                self.screen.zynpot_cb(self.screen.ctrl_order[1], 1 if action == "up" else -1)
            else:
                self.actions[action]()
        else:
            raise ValueError("Sequencer action is unavailable")
