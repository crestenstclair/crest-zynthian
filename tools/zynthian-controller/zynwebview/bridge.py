# SPDX-License-Identifier: GPL-2.0-or-later
"""Expose existing Zynthian screens, callbacks and controllers over a local socket.

No engines, presets or audio are implemented here. Socket I/O runs on Tk's
event loop; native actions run serially off-thread like Zynthian's CUIA input,
so callbacks can wait for the loading screen without blocking Tk. The feature
is opt-in and accepts one client with the same OS user's socket permissions.
"""
import hashlib
import json
import logging
import os
from pathlib import Path
import socket
import stat
import math
from concurrent.futures import Future
from threading import Thread
from .sequencer import SequencerView
from .pattern_properties import PatternProperties
from .screen_views import add_controls, special_screen, navigation_actions, contextual_actions, widget_readouts

MAX_FRAME = 1024 * 1024


class ScreenAdapter:
    def __init__(self, gui):
        self.gui = gui
        self.targets = {}
        self.revision = ""
        self.identities = []
        self.sequencer = SequencerView(self)
        self.actions = {}
        self.selections = {}
        self.detail_workspace = None
        self.pattern_properties = PatternProperties(self)

    def _add(self, items, key, label, activate=None, control=None, identity=None, options=None):
        row = {"id": key, "label": str(label).replace("\n", " "),
               "enabled": activate is not None or control is not None}
        self.targets[key] = (activate, control, options)
        row["options"] = options is not None
        self.identities.append((key, identity))
        if control is not None:
            row.update(kind="control", value=control.value,
                       minimum=control.value_min, maximum=control.value_max,
                       display=str(control.get_value2label() if control.labels else control.value),
                       path=bool(control.is_path), toggle=bool(getattr(control, "is_toggle", False)),
                       integer=bool(getattr(control, "is_integer", True)))
            if control.labels:
                row['choices'] = [{'value': value, 'label': label} for value, label in zip(control.ticks, control.labels)]
        items.append(row)

    def snapshot(self):
        self.targets = {}
        self.selections = {}
        self.identities = []
        name = self.gui.current_screen
        screen = self.gui.screens.get(name)
        state = {"screen": name or "starting", "title": "Starting Zynthian",
                 "items": [], "columns": 1, "kind": "list", "message": ""}
        state["detailWorkspace"] = self.detail_workspace
        manager = getattr(self.gui, "state_manager", None)
        state["transport"] = {
            "audioRecording": bool(getattr(getattr(manager, "audio_recorder", None), "status", False)),
            "midiRecording": bool(getattr(manager, "status_midi_recorder", False)),
            "midiPlaying": bool(getattr(manager, "status_midi_player", False))}
        busy = getattr(manager, "is_busy", None)
        startup = getattr(self.gui, "start_thread", None)
        # The native busy thread closes loading after end_busy(). Until then,
        # navigation can race its return to the previous screen.
        screen_lock = getattr(self.gui, "screen_lock", None)
        state["backendBusy"] = bool(name == "loading" or
                                    (screen_lock is not None and screen_lock.locked()) or
                                    (callable(busy) and busy()) or
                                    (startup is not None and startup.is_alive()))
        items = state["items"]
        self.sequencer.actions = {}
        self.sequencer.cells = {}
        self.sequencer.tracker_cells = {}
        if name == "chain_control" and screen is not None:
            parent = screen
            self.identities.append(("subscreen", parent.subscreen_name, id(parent.subscreen)))
            for key, label in (("chain_options", "Chain options"), ("midi_input", "MIDI input"),
                               ("midi_output", "MIDI output"), ("audio_in", "Audio input"), ("audio_out", "Audio output")):
                self._add(items, "sub:" + key, label,
                          lambda t, key=key: parent.select_subscreen(key))
            if parent.chain:
                chain = parent.chain
                state["instrument"] = {"id": chain.chain_id, "name": chain.get_name(),
                                       "channel": chain.midi_chan, "section": parent.subscreen_name,
                                       "processors": []}
                for processor in parent.chain.get_processors():
                    state["instrument"]["processors"].append({
                        "id": processor.id, "name": processor.get_name(),
                        "type": str(getattr(processor, "type", "")),
                        "bank": str(getattr(processor, "bank_name", "") or ""),
                        "preset": str(getattr(processor, "preset_name", "") or "")})
                    def processor_options(p=processor):
                        # The hidden side canvas may not have rebuilt after an
                        # insert. Select the actual processor, then use its menu.
                        self.gui.set_current_processor(p)
                        self.gui.show_screen("processor_options")
                    self._add(items, f"processor:{processor.id}", processor.get_name(),
                              lambda t, p=processor: parent.select_subscreen("control", p), identity=id(processor),
                              options=processor_options)
                    if getattr(processor, "type", None) != "Global":
                        self._add(items, f"presets:{processor.id}", f"Banks / presets · {processor.get_name()}",
                                  lambda t, p=processor: self.gui.cuia_bank_preset(p), identity=id(processor))
            screen = parent.subscreen
        navigation = navigation_actions(self.gui)
        contextual = contextual_actions(self.gui, screen, name) if screen is not None else {}
        self.actions = {key: callback for key, (_, callback) in {**navigation, **contextual}.items()}
        state["navigation"] = {key: label for key, (label, _) in navigation.items()}
        state["screenActions"] = {key: label for key, (label, _) in contextual.items()}
        if screen is not None:
            state["title"] = str(getattr(screen, "title", None) or name.replace("_", " ").title())
            if name in ("pattern_editor", "pated_cc") or (name in ("root", "mixer", "launcher") and getattr(screen, "launcher_mode", False)):
                if name in ("root", "mixer"):
                    state["screen"] = "launcher"
                self.sequencer.snapshot(screen, state)
                if self.detail_workspace == name and name in ('pattern_editor', 'pated_cc'):
                    self.pattern_properties.populate(screen, state)
                    items = state['items']
            elif name == "loading":
                state.update(kind="status", title=screen.canvas.itemcget(screen.title_text, "text"),
                             message=screen.canvas.itemcget(screen.details_text, "text"))
            elif name == "confirm":
                state.update(kind="confirm", message=screen.text.get())
                # Default focus is Cancel, including with a held controller button.
                self._add(items, "cancel", "Cancel", lambda t: self.gui.cuia_back())
                self._add(items, "confirm", "Confirm", lambda t: screen.switch_select("S"),
                          identity=(id(screen.callback), repr(screen.callback_params)))
            elif name == "keyboard":
                state.update(kind="keyboard", columns=getattr(screen, "columns", 10), message=screen.text)
                state["textEntry"] = {"value": screen.text, "numeric": getattr(screen, "mode", 1) == 0}
                for i, key in enumerate(screen.keys):
                    self._add(items, f"key:{i}", key,
                              lambda t, i=i: screen.execute_key_press(i))
                numeric = getattr(screen, "mode", 1) == 0
                special_keys = [("btn_space", "0" if numeric else "Space"), ("btn_delete", "Delete")]
                if not numeric:
                    special_keys += [("btn_shift", "Shift"), ("btn_alt", "Symbols")]
                special_keys += [("btn_cancel", "Cancel"), ("btn_enter", "Save")]
                for attr, label in special_keys:
                    i = getattr(screen, attr, None)
                    if i is not None:
                        self._add(items, f"special:{i}", label,
                                  lambda t, i=i: screen.execute_key_press(i, t == "B"))
                self.identities.append(("keyboard-callback", id(screen.function)))
                self._add(items, "keyboard:clear", "Clear text",
                          lambda t: screen.execute_key_press(screen.btn_delete, True))
            elif name == "chain_manager":
                state["instruments"] = []
                for chain_id, chain in self.gui.chain_manager.chains.items():
                    if chain_id == 0:
                        continue
                    target = f"instrument:{chain_id}"
                    def open_instrument(t, chain_id=chain_id):
                        self.gui.chain_manager.set_active_chain_by_id(chain_id)
                        self.gui.chain_control(chain_id)
                    self._add(items, target, chain.get_name(), open_instrument, identity=id(chain))
                    state["instruments"].append({"id": chain_id, "target": target,
                        "name": chain.get_name(), "channel": chain.midi_chan,
                        "processors": [{"name": p.get_name(), "type": str(getattr(p, "type", "")),
                                        "preset": str(getattr(p, "preset_name", "") or "")}
                                       for p in chain.get_processors()]})
                self._add(items, "instrument:add", "+ Add instrument", lambda t: self.add_instrument())
                state["routingTargets"] = []
                for ci, chain in enumerate(screen.nodes):
                    for ri, row in enumerate(chain):
                        for ni, node in enumerate(row):
                            pos = [ci, ri, ni]
                            def activate(t, pos=pos):
                                screen.select_node(node_pos=pos)
                                screen.switch_select(t)
                            self._add(items, f"node:{ci}:{ri}:{ni}",
                                      f'{node["chain_id"]} · {node["title"]}', activate,
                                      identity=(node["chain_id"], str(node.get("proc"))),
                                      options=lambda activate=activate: activate("B"))
                            state["routingTargets"].append(f"node:{ci}:{ri}:{ni}")
            elif name in ("root", "mixer", "launcher"):
                if getattr(screen, "launcher_mode", False):
                    self.sequencer.snapshot(screen, state)
                else:
                    state["mixer"] = []
                    for chain_id, chain in self.gui.chain_manager.chains.items():
                        strip = {"id": chain_id, "name": chain.get_name(),
                                 "channel": chain.midi_chan, "controls": []}
                        state["mixer"].append(strip)
                        def open_chain(t, chain=chain):
                            self.gui.chain_manager.set_active_chain_by_id(chain.chain_id)
                            self.gui.chain_control(chain.chain_id)
                        def chain_options(chain=chain):
                            self.gui.screens["chain_options"].set_chain(chain)
                            self.gui.show_screen("chain_options")
                        self._add(items, f"chain:{chain_id}", chain.get_name(), open_chain,
                                  identity=id(chain), options=chain_options)
                        processor = getattr(chain, "zynmixer_proc", None)
                        if processor:
                            for symbol, ctrl in processor.controllers_dict.items():
                                if ctrl is not None:
                                    self._add(items, f"mix:{chain_id}:{symbol}",
                                              f'{chain.get_name()} · {symbol}', control=ctrl,
                                              identity=id(ctrl))
                                    strip["controls"].append({"symbol": symbol, "target": f"mix:{chain_id}:{symbol}"})
            elif isinstance(getattr(screen, "config", None), list):
                state.update(kind="grid", columns=min(4, max(1, screen.columns)))
                for i, node in enumerate(screen.config):
                    if not node:
                        continue
                    def activate(t, i=i):
                        screen.select(i)
                        screen.switch_select(t)
                    action = node.get("action")
                    # Bound method objects may be recreated, so use their instance/function.
                    identity = (id(getattr(action, "__self__", None)),
                                id(getattr(action, "__func__", action)), repr(node.get("action_params")))
                    self._add(items, f"grid:{i}", node["title"], activate if action else None,
                              identity=identity)
            elif hasattr(screen, "list_data"):
                if name == "engine":
                    state['engineCategoryName'] = screen.engine_cats[screen.cat_index] if screen.engine_cats else ''
                    # The native engine selector has a second list for categories.
                    # Without it the controller can only reach the initial category.
                    for i, category in enumerate(getattr(screen, "engine_cats", []) or []):
                        self._add(items, f"category:{i}", f"Category · {category}",
                                  lambda t, i=i: screen.set_cat(i), identity=(category, screen.cat_index))
                # Controls are native zynthian_controller objects from the current page.
                add_controls(self, screen, items)
                readouts = widget_readouts(screen)
                if readouts:
                    state["content"] = {"readouts": readouts}
                for i, row in enumerate(screen.list_data):
                    def activate(t, i=i):
                        screen.select(i)
                        screen.switch_select(t)
                    self._add(items, f"list:{i}", row[2], activate if row[0] is not None else None,
                              identity=repr(row[:2]), options=(lambda activate=activate: activate("B")) if row[0] is not None else None)
                    if row[0] is not None:
                        self.selections[f"list:{i}"] = lambda i=i: screen.select(i)
                    if len(row) > 3 and isinstance(row[3], (list, tuple)) and row[3] and isinstance(row[3][0], str):
                        items[-1]["description"] = row[3][0]
                    if name == "midi_recorder" and state["transport"]["midiPlaying"] and row[0] == getattr(manager, "last_midi_file", None):
                        items[-1]["label"] = "▶ " + items[-1]["label"]
                state["selectedTarget"] = f"list:{getattr(screen, 'index', 0)}"
                state["selectionFollowsBackend"] = bool(getattr(screen, "moving_zs3", None))
            elif not special_screen(self, name, screen, state):
                add_controls(self, screen, items)
                state["message"] = "No controls are available in this view." if not items else ""
            # Inline editors (e.g. admin settings) belong to the existing screen base.
            editor = getattr(screen, "param_editor_zctrl", None)
            if editor is not None:
                self._add(items, "inline-editor", editor.name,
                          activate=lambda t: screen.switch_select("S"), control=editor, identity=id(editor))
                state["inlineEditor"] = True
        # Values may change externally without invalidating held parameter editing.
        if name == "chain_control":
            # Put the sound and its preset first; keep native routing and parameter targets.
            items.sort(key=lambda item: 0 if item["id"].startswith(("processor:", "presets:"))
                       else 1 if item["id"].startswith("sub:") else 2)
        identity = [name, state["title"], state["message"] if name == "confirm" else "",
                    [(x["id"], x["label"], x["enabled"]) for x in items], self.identities,
                    list(self.actions)]
        self.revision = hashlib.sha256(json.dumps(identity, default=str).encode()).hexdigest()[:20]
        state["revision"] = self.revision
        state["protocol"] = 1
        return state

    def add_instrument(self):
        self.gui.cuia_add_chain()
        screen = self.gui.screens["add_chain"]
        index = next(i for i, entry in enumerate(screen.config) if entry.get("title") == "Instrument")
        screen.select(index)
        screen.switch_select("S")
        self.gui.prune_screen_history("add_chain", soft=False)

    def show_details(self):
        name = self.gui.current_screen
        if self.detail_workspace:
            return self.return_workspace()
        screen = self.gui.screens[name]
        if name in ('pattern_editor', 'pated_cc'):
            self.detail_workspace = name
            return
        callback = self.sequencer.actions.get("menu") if name in ("launcher", "pattern_editor", "pated_cc") else self.actions.get("screenMenu")
        if name == "chain_control":
            callback = lambda: screen.select_subscreen("chain_options")
        if not callback:
            raise ValueError("This page has no detail view")
        self.detail_workspace = name
        callback()

    def return_workspace(self):
        if not self.detail_workspace:
            return
        name = self.detail_workspace
        if self.gui.current_screen == name and name in ('pattern_editor', 'pated_cc'):
            self.detail_workspace = None
            return
        screen = self.gui.screens[self.gui.current_screen]
        if self.gui.current_screen in ("confirm", "keyboard"):
            self.gui.cuia_back()
            return
        if getattr(screen, "param_editor_zctrl", None) is not None:
            screen.switch_select("S")
            if self.gui.current_screen == "confirm":
                return
        if name == "chain_control":
            self.gui.screens[name].select_subscreen("control")
        self.gui.show_screen(name)
        self.detail_workspace = None

    def dispatch(self, request):
        if not isinstance(request, dict):
            raise ValueError("Expected a JSON object")
        method = request.get("method")
        if method == "state":
            return
        # Refresh targets before every command, including when another controller acted.
        current = self.snapshot()
        if current["backendBusy"]:
            raise ValueError("Zynthian is busy; command discarded")
        if request.get("revision") != self.revision:
            raise ValueError("Screen changed; command discarded")
        if method == "action":
            actions = {"back": self.gui.cuia_back,
                       "home": lambda: self.gui.show_screen("main_menu"),
                       "mixer": self.gui.cuia_screen_mixer,
                       "snapshots": self.gui.cuia_screen_snapshot,
                       "launcher": lambda: self.gui.show_screen("launcher"),
                       "panic": self.gui.cuia_all_sounds_off,
                       "addInstrument": self.add_instrument,
                       "details": self.show_details, "workspace": self.return_workspace}
            actions.update(self.actions)
            if request.get("action") not in actions:
                raise ValueError("Unknown action")
            # Browser focus is local. Synchronize it only for menus that depend
            # on native selection, without activating or loading the focused row.
            if request["action"] == "screenMenu" and request.get("target") in self.selections:
                self.selections[request["target"]]()
            if request["action"] not in ("details", "workspace", "back", "screenMenu"):
                self.detail_workspace = None
            actions[request["action"]]()
        elif method == "text":
            text = request.get("text")
            if current["screen"] != "keyboard" or not isinstance(text, str) or len(text) > 256 or any(ord(c) < 32 for c in text):
                raise ValueError("Invalid name entry")
            screen = self.gui.screens["keyboard"]
            if getattr(screen, "mode", 1) == 0 and text and not text.isdecimal():
                raise ValueError("This field accepts digits only")
            screen.text = text
            screen.execute_key_press(screen.btn_enter)
        elif method == "sequence":
            self.sequencer.dispatch(request)
        elif method in ("activate", "adjust", "set"):
            activate, control, options = self.targets.get(request.get("target"), (None, None, None))
            if method in ("adjust", "set"):
                if control is None or control.is_path:
                    raise ValueError("Not an adjustable parameter")
                if method == "adjust":
                    delta = request.get("delta")
                    if type(delta) is not int or not -10 <= delta <= 10:
                        raise ValueError("Invalid parameter delta")
                    control.nudge(delta, fine=bool(request.get("fine", False)))
                else:
                    value = request.get("value")
                    if type(value) not in (int, float) or not math.isfinite(value) or not control.value_min <= value <= control.value_max:
                        raise ValueError("Invalid parameter value")
                    control.set_value(value)
            elif request.get("bold") and options:
                options()
            elif activate:
                activate("B" if request.get("bold") else "S")
            elif control is not None:
                if control.is_path:
                    control.nudge(0)
                elif control.is_toggle:
                    control.toggle()
            else:
                raise ValueError("Item is unavailable")
        else:
            raise ValueError("Unknown method")


class LocalBridge:
    def __init__(self, gui, root, path):
        self.adapter = ScreenAdapter(gui)
        self.root = root
        self.path = Path(path)
        # Require a private directory, so neither the path nor permissions can be raced.
        parent = self.path.parent.stat()
        if parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) & 0o077:
            raise ValueError("Socket directory must belong to this user with mode 0700")
        if self.path.exists() or self.path.is_symlink():
            raise FileExistsError(f"Socket path already exists: {self.path}")
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        # Do not unlink pre-existing paths or silently replace another active instance.
        try:
            self.listener.bind(str(self.path))
        except Exception:
            self.listener.close()
            raise
        os.chmod(self.path, 0o600)
        self.listener.listen(1)
        self.listener.setblocking(False)
        self.client = None
        self.incoming = b""
        self.outgoing = b""
        self.last_state = None
        self.pending = None
        self.after_id = root.after(50, self.tick)

    def disconnect(self):
        if self.client:
            self.client.close()
        self.client = None
        self.incoming = self.outgoing = b""
        self.last_state = None

    def emit(self, payload):
        frame = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode() + b"\n"
        if len(self.outgoing) + len(frame) > MAX_FRAME:
            self.disconnect()
        else:
            self.outgoing += frame

    def start_command(self, request):
        if self.pending:
            raise ValueError("Zynthian is busy; command discarded")
        client = self.client
        future = Future()
        self.pending = (client, request.get("id"), future)

        def execute():
            try:
                # A disconnected client's command must not start later.
                if self.client is not client:
                    raise ValueError("Client disconnected; command discarded")
                self.adapter.dispatch(request)
                future.set_result(None)
            except Exception as error:
                future.set_exception(error)

        Thread(target=execute, name="Controller command", daemon=True).start()

    def finish_command(self):
        if not self.pending or not self.pending[2].done():
            return
        client, request_id, future = self.pending
        self.pending = None
        state = self.adapter.snapshot()
        # A reconnect receives current state, never the previous client's ack.
        if self.client:
            response = {"state": state}
            if self.client is client:
                error = future.exception()
                response.update(id=request_id, ok=error is None)
                if error:
                    response["error"] = str(error)
            self.emit(response)
            self.last_state = state

    def receive_request(self, line):
        request = {}
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("Expected a JSON object")
            if request.get("method") == "state":
                state = self.last_state if self.pending else self.adapter.snapshot()
                if state is not None:
                    self.emit({"id": request.get("id"), "ok": True,
                               "state": dict(state, backendBusy=bool(self.pending) or state["backendBusy"])})
                return
            self.start_command(request)
        except Exception as error:
            self.emit({"id": request.get("id") if isinstance(request, dict) else None,
                       "ok": False, "error": str(error)})

    def tick(self):
        try:
            self.finish_command()
            try:
                client, _ = self.listener.accept()
                if self.client:
                    client.close()
                else:
                    client.setblocking(False)
                    self.client = client
            except BlockingIOError:
                pass
            if self.client:
                try:
                    data = self.client.recv(65536)
                    if not data:
                        self.disconnect()
                    else:
                        self.incoming += data
                except BlockingIOError:
                    pass
                if len(self.incoming) > MAX_FRAME:
                    self.disconnect()
                # Bounded work per Tk tick. No commands are queued across disconnects.
                for _ in range(16):
                    if not self.client or b"\n" not in self.incoming:
                        break
                    line, self.incoming = self.incoming.split(b"\n", 1)
                    self.receive_request(line)
                if self.client and not self.pending:
                    state = self.adapter.snapshot()
                    if state != self.last_state:
                        self.emit({"state": state})
                        self.last_state = state
                if self.client and self.outgoing:
                    try:
                        count = self.client.send(self.outgoing)
                        self.outgoing = self.outgoing[count:]
                    except BlockingIOError:
                        pass
        except Exception:
            logging.exception("Webview bridge disconnected")
            self.disconnect()
        self.after_id = self.root.after(50, self.tick)

    def close(self):
        self.root.after_cancel(self.after_id)
        self.disconnect()
        self.listener.close()
        self.path.unlink(missing_ok=True)
