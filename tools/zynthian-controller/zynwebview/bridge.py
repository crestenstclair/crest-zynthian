# SPDX-License-Identifier: GPL-2.0-or-later
"""Expose existing Zynthian screens, callbacks and controllers over a local socket.

No engines, presets or audio are implemented here. The adapter runs on Tk's
event loop; socket I/O is nonblocking and all payloads are bounded. The feature
is opt-in and accepts one client with the same OS user's socket permissions.
"""
import hashlib
import json
import logging
import os
from pathlib import Path
import socket
import stat
from .sequencer import SequencerView

MAX_FRAME = 1024 * 1024


class ScreenAdapter:
    def __init__(self, gui):
        self.gui = gui
        self.targets = {}
        self.revision = ""
        self.identities = []
        self.sequencer = SequencerView(self)

    def _add(self, items, key, label, activate=None, control=None, identity=None):
        row = {"id": key, "label": str(label).replace("\n", " "),
               "enabled": activate is not None or control is not None}
        self.targets[key] = (activate, control)
        self.identities.append((key, identity))
        if control is not None:
            row.update(kind="control", value=control.value,
                       minimum=control.value_min, maximum=control.value_max,
                       display=str(control.get_value2label() if control.labels else control.value),
                       path=bool(control.is_path))
        items.append(row)

    def snapshot(self):
        self.targets = {}
        self.identities = []
        name = self.gui.current_screen
        screen = self.gui.screens.get(name)
        state = {"screen": name or "starting", "title": "Starting Zynthian",
                 "items": [], "columns": 1, "kind": "list", "message": ""}
        items = state["items"]
        self.sequencer.actions = {}
        self.sequencer.cells = {}
        if name == "chain_control" and screen is not None:
            parent = screen
            self.identities.append(("subscreen", parent.subscreen_name, id(parent.subscreen)))
            for key, label in (("chain_options", "Chain options"), ("midi_input", "MIDI input"),
                               ("midi_output", "MIDI output"), ("audio_in", "Audio input"), ("audio_out", "Audio output")):
                self._add(items, "sub:" + key, label,
                          lambda t, key=key: parent.select_subscreen(key))
            if parent.chain:
                for processor in parent.chain.get_processors():
                    self._add(items, f"processor:{processor.id}", processor.get_name(),
                              lambda t, p=processor: parent.select_subscreen("control", p), identity=id(processor))
            screen = parent.subscreen
        if screen is not None:
            state["title"] = str(getattr(screen, "title", None) or name.replace("_", " ").title())
            if name in ("pattern_editor", "pated_cc") or (name in ("root", "mixer", "launcher") and getattr(screen, "launcher_mode", False)):
                if name in ("root", "mixer"):
                    state["screen"] = "launcher"
                self.sequencer.snapshot(screen, state)
            elif name == "confirm":
                state.update(kind="confirm", message=screen.text.get())
                # Default focus is Cancel, including with a held controller button.
                self._add(items, "cancel", "Cancel", lambda t: self.gui.cuia_back())
                self._add(items, "confirm", "Confirm", lambda t: screen.switch_select("S"),
                          identity=(id(screen.callback), repr(screen.callback_params)))
            elif name == "keyboard":
                state.update(kind="keyboard", columns=10, message=screen.text)
                for i, key in enumerate(screen.keys):
                    self._add(items, f"key:{i}", key,
                              lambda t, i=i: screen.execute_key_press(i))
                for attr, label in (("btn_space", "Space"), ("btn_delete", "Delete"),
                                    ("btn_shift", "Shift"), ("btn_alt", "Symbols"),
                                    ("btn_cancel", "Cancel"), ("btn_enter", "Save")):
                    i = getattr(screen, attr, None)
                    if i is not None:
                        self._add(items, f"special:{i}", label,
                                  lambda t, i=i: screen.execute_key_press(i, t == "B"))
                self.identities.append(("keyboard-callback", id(screen.function)))
            elif name == "chain_manager":
                for ci, chain in enumerate(screen.nodes):
                    for ri, row in enumerate(chain):
                        for ni, node in enumerate(row):
                            pos = [ci, ri, ni]
                            def activate(t, pos=pos):
                                screen.select_node(node_pos=pos)
                                screen.switch_select(t)
                            self._add(items, f"node:{ci}:{ri}:{ni}",
                                      f'{node["chain_id"]} · {node["title"]}', activate,
                                      identity=(node["chain_id"], str(node.get("proc"))))
            elif name in ("root", "mixer", "launcher"):
                if getattr(screen, "launcher_mode", False):
                    self.sequencer.snapshot(screen, state)
                else:
                    for chain_id, chain in self.gui.chain_manager.chains.items():
                        def open_chain(t, chain=chain):
                            self.gui.chain_manager.set_active_chain_by_id(chain.chain_id)
                            self.gui.screens["chain_options"].set_chain(chain)
                            self.gui.show_screen("chain_options")
                        self._add(items, f"chain:{chain_id}", chain.get_name(), open_chain,
                                  identity=id(chain))
                        processor = getattr(chain, "zynmixer_proc", None)
                        if processor:
                            for symbol in ("level", "balance", "mute", "solo"):
                                ctrl = processor.controllers_dict.get(symbol)
                                if ctrl is not None:
                                    self._add(items, f"mix:{chain_id}:{symbol}",
                                              f'{chain.get_name()} · {symbol}', control=ctrl,
                                              identity=id(ctrl))
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
                # Controls are native zynthian_controller objects from the current page.
                for i, ctrl in enumerate(getattr(screen, "zcontrollers", [])):
                    if ctrl is not None:
                        self._add(items, f"control:{i}", ctrl.name, control=ctrl, identity=id(ctrl))
                for i, row in enumerate(screen.list_data):
                    def activate(t, i=i):
                        screen.select(i)
                        screen.switch_select(t)
                    self._add(items, f"list:{i}", row[2], activate if row[0] is not None else None,
                              identity=repr(row[:2]))
            else:
                state["message"] = "This screen has not been ported to the webview yet."
            # Inline editors (e.g. admin settings) belong to the existing screen base.
            editor = getattr(screen, "param_editor_zctrl", None)
            if editor is not None:
                self._add(items, "inline-editor", editor.name,
                          activate=lambda t: screen.switch_select("S"), control=editor, identity=id(editor))
                state["inlineEditor"] = True
        # Values may change externally without invalidating held parameter editing.
        identity = [name, state["title"], state["message"] if name == "confirm" else "",
                    [(x["id"], x["label"], x["enabled"]) for x in items], self.identities]
        self.revision = hashlib.sha256(json.dumps(identity, default=str).encode()).hexdigest()[:20]
        state["revision"] = self.revision
        state["protocol"] = 1
        return state

    def dispatch(self, request):
        if not isinstance(request, dict):
            raise ValueError("Expected a JSON object")
        method = request.get("method")
        if method == "state":
            return
        # Refresh targets before every command, including when another controller acted.
        self.snapshot()
        if request.get("revision") != self.revision:
            raise ValueError("Screen changed; command discarded")
        if method == "action":
            actions = {"back": self.gui.cuia_back,
                       "home": lambda: self.gui.show_screen("main_menu"),
                       "mixer": self.gui.cuia_screen_mixer,
                       "snapshots": self.gui.cuia_screen_snapshot,
                       "launcher": lambda: self.gui.show_screen("launcher"),
                       "panic": self.gui.cuia_all_sounds_off}
            if request.get("action") not in actions:
                raise ValueError("Unknown action")
            actions[request["action"]]()
        elif method == "sequence":
            self.sequencer.dispatch(request)
        elif method in ("activate", "adjust"):
            activate, control = self.targets.get(request.get("target"), (None, None))
            if method == "adjust":
                if control is None or control.is_path:
                    raise ValueError("Not an adjustable parameter")
                delta = request.get("delta")
                if type(delta) is not int or not -10 <= delta <= 10:
                    raise ValueError("Invalid parameter delta")
                control.nudge(delta, fine=bool(request.get("fine", False)))
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

    def tick(self):
        try:
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
                    request = {}
                    try:
                        request = json.loads(line)
                        if not isinstance(request, dict):
                            raise ValueError("Expected a JSON object")
                        self.adapter.dispatch(request)
                        # Publish the resulting cursor/revision with the ack, before accepting more input.
                        state = self.adapter.snapshot()
                        self.emit({"id": request.get("id"), "ok": True, "state": state})
                        self.last_state = state
                    except Exception as error:
                        self.emit({"id": request.get("id") if isinstance(request, dict) else None,
                                   "ok": False, "error": str(error)})
                if self.client:
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
