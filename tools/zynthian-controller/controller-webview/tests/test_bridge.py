# SPDX-License-Identifier: GPL-2.0-or-later
"""Boundary tests. No synth or alternate audio backend is used by these fixtures."""
import ast
import json
from pathlib import Path
import socket
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from zynwebview.bridge import LocalBridge, ScreenAdapter


def upstream_method(filename, class_name, method_name):
    """Load actual UI methods without initializing Pi hardware / the Tk application."""
    tree = ast.parse((ROOT / "zyngui" / filename).read_text())
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == class_name)
    method = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == method_name)
    namespace = {}
    exec(compile(ast.Module(body=[method], type_ignores=[]), filename, "exec"), namespace)
    return namespace[method_name]


class Grid:
    select = upstream_method("zynthian_gui_selector_grid.py", "zynthian_gui_selector_grid", "select")
    switch_select = upstream_method("zynthian_gui_selector_grid.py", "zynthian_gui_selector_grid", "switch_select")
    _draw_selection = lambda self: None
    columns = 4
    selected_node = 0
    title = "Main Menu"


class MainMenu(Grid):
    _get_config = upstream_method("zynthian_gui_main_menu.py", "zynthian_gui_main_menu", "_get_config")
    get_playrec_options = upstream_method("zynthian_gui_main_menu.py", "zynthian_gui_main_menu", "get_playrec_options")
    get_node_toggle_audio_rec = upstream_method("zynthian_gui_main_menu.py", "zynthian_gui_main_menu", "get_node_toggle_audio_rec")
    get_node_toggle_midi_rec = upstream_method("zynthian_gui_main_menu.py", "zynthian_gui_main_menu", "get_node_toggle_midi_rec")


class TestBridge(unittest.TestCase):
    def setUp(self):
        self.gui = SimpleNamespace(current_screen="main_menu", screens={},
            cuia_back=Mock(), cuia_screen_mixer=Mock(), cuia_screen_snapshot=Mock(),
            cuia_all_sounds_off=Mock(), show_screen=Mock())
        self.screen = Grid()
        self.callback = Mock()
        self.screen.config = [{"title": "Instrument", "action": self.callback,
                               "action_params": [{"type": "MIDI Synth"}]},
                              None, {"title": "Unavailable", "action": None}]
        self.gui.screens["main_menu"] = self.screen
        self.adapter = ScreenAdapter(self.gui)

    def command(self, method, **kwargs):
        self.adapter.dispatch(dict(method=method, revision=self.adapter.snapshot()["revision"], **kwargs))

    def test_grid_uses_upstream_callback_and_parameters(self):
        state = self.adapter.snapshot()
        self.assertEqual(len(state["items"]), 2)
        self.assertFalse(state["items"][1]["enabled"])
        self.command("activate", target="grid:0")
        self.callback.assert_called_once_with({"type": "MIDI Synth"})

    def test_real_main_menu_and_add_chain_types(self):
        menu = MainMenu()
        menu.zyngui = Mock(capture_log_fname=False)
        menu.state_manager = SimpleNamespace(audio_recorder=SimpleNamespace(status=False), status_midi_recorder=False)
        menu.clean_menu = Mock()
        menu.toggle_capture_log = Mock()
        menu.config = menu._get_config()
        self.gui.screens["main_menu"] = menu
        state = self.adapter.snapshot()
        self.assertEqual([r["label"] for r in state["items"]][:4],
                         ["Add Chain", "Chain Manager", "Snapshots", "Clean"])
        self.command("activate", target="grid:0")
        menu.zyngui.cuia_add_chain.assert_called_once_with()
        reset = upstream_method("zynthian_gui_add_chain.py", "zynthian_gui_add_chain", "reset_config")
        add = Grid()
        add.zyngui = Mock()
        add.zyngui.chain_manager.get_processor_count.return_value = 0
        add.pos = 0
        reset(add)
        self.gui.screens["main_menu"] = add
        self.command("activate", target="grid:0")
        add.zyngui.modify_chain.assert_called_once_with(
            {"type": "MIDI Synth", "midi_thru": False, "audio_thru": False, "pos": 0})
        self.assertEqual(len(self.adapter.snapshot()["items"]), 8)

    def test_stale_callback_rejected_even_when_label_unchanged(self):
        revision = self.adapter.snapshot()["revision"]
        replacement = Mock()
        self.screen.config[0]["action"] = replacement
        with self.assertRaisesRegex(ValueError, "Screen changed"):
            self.adapter.dispatch(dict(method="activate", target="grid:0", revision=revision))
        replacement.assert_not_called()

    def test_disabled_and_unknown_actions_rejected(self):
        for method, kwargs in (("activate", {"target": "grid:2"}),
                               ("action", {"action": "exec"}), ("shell", {})):
            with self.assertRaises(ValueError):
                self.command(method, **kwargs)

    def test_controller_edits_delegate_and_reflect_external_updates(self):
        control = SimpleNamespace(name="Cutoff", value=40, value_min=0, value_max=127,
                                  labels=None, is_path=False, is_toggle=False, nudge=Mock())
        screen = SimpleNamespace(title="Controls", list_data=[], zcontrollers=[control])
        self.gui.screens["main_menu"] = screen
        before = self.adapter.snapshot()
        control.value = 80  # e.g. external MIDI CC
        after = self.adapter.snapshot()
        self.assertEqual(before["revision"], after["revision"])
        self.assertEqual(after["items"][0]["value"], 80)
        self.command("adjust", target="control:0", delta=-1, fine=True)
        control.nudge.assert_called_once_with(-1, fine=True)
        with self.assertRaises(ValueError):
            self.command("adjust", target="control:0", delta=500)

    def test_selector_uses_selected_bank_index_and_bold_action(self):
        screen = SimpleNamespace(title="Bank", list_data=[("a", 0, "Factory"), ("b", 1, "User")],
                                 select=Mock(), switch_select=Mock())
        self.gui.screens["main_menu"] = screen
        self.command("activate", target="list:1", bold=True)
        screen.select.assert_called_once_with(1)
        screen.switch_select.assert_called_once_with("B")

    def test_confirmation_is_explicit_and_defaults_to_cancel(self):
        self.gui.current_screen = "confirm"
        screen = SimpleNamespace(title="Confirm", text=SimpleNamespace(get=lambda: "Delete snapshot?"),
                                 callback=Mock(), callback_params="snapshot.zss", switch_select=Mock())
        self.gui.screens["confirm"] = screen
        state = self.adapter.snapshot()
        self.assertEqual(state["items"][0]["id"], "cancel")
        self.command("activate", target="cancel")
        screen.switch_select.assert_not_called()
        self.command("activate", target="confirm")
        screen.switch_select.assert_called_once_with("S")

    def test_socket_framing_permissions_and_bad_messages(self):
        with tempfile.TemporaryDirectory() as directory:
            root = SimpleNamespace(after=lambda *args: 1, after_cancel=Mock())
            path = str(Path(directory) / "bridge.sock")
            try:
                bridge = LocalBridge(self.gui, root, path)
            except PermissionError as error:
                self.skipTest(f"Local sockets are denied by this environment: {error}")
            self.addCleanup(bridge.close)
            self.assertEqual(Path(path).stat().st_mode & 0o777, 0o600)
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(0.2)
                client.connect(path)
                client.sendall(b'{"method":')
                bridge.tick()
                initial = client.recv(65536)
                self.assertIn(b'"state"', initial)
                client.sendall(b'"state","id":1}\n[]\n')
                bridge.tick()
                frames = [json.loads(s) for s in client.recv(65536).splitlines()]
                self.assertTrue(frames[0]["ok"])
                self.assertFalse(frames[1]["ok"])
            # Close before the private directory is removed by TemporaryDirectory.
            bridge.close()
            self._cleanups.pop()

    def test_socket_does_not_replace_existing_path(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bridge.sock"
            path.write_text("keep")
            with self.assertRaises(FileExistsError):
                LocalBridge(self.gui, SimpleNamespace(), str(path))
            self.assertEqual(path.read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
