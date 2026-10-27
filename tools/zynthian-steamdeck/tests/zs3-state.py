#!/usr/bin/env python3
"""Check ZS3 capture ownership and preservation on engine capture failure."""
import ast
import copy
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

source = ast.parse(Path(sys.argv.pop(1)).read_text(encoding='utf-8-sig'))
method = next(n for n in ast.walk(source) if isinstance(n, ast.FunctionDef) and n.name == 'save_zs3')
namespace = dict(lib_zyncore=SimpleNamespace(get_global_transpose=lambda: 0),
                 zynautoconnect=SimpleNamespace(get_ext_clock_device_name=lambda: None,
                                               get_midi_clock_output_ports=lambda: [],
                                               get_zynseq_exclude_ports=lambda: []),
                 zynsigman=Mock())
exec(compile(ast.Module(body=[method], type_ignores=[]), '<save_zs3>', 'exec'), namespace)
save = namespace['save_zs3']


class CaptureTests(unittest.TestCase):
    def manager(self):
        captured = dict(bank_info=None, bank_subdir_info=None, preset_info=['original'],
                        preset_subdir_info=None, controllers={}, current_screen_index=0,
                        lv2_state={'format': 'test', 'data': 'unsaved'})
        processor = SimpleNamespace(get_state=Mock(return_value=captured))
        chain_manager = SimpleNamespace(active_chain_id=1, active_chain=SimpleNamespace(chain_id=1),
                                        chains={}, processors={1: processor})
        manager = SimpleNamespace(zs3={'zs3-1': {'title': 'Preserve', 'processors': {}}},
                                  get_next_zs3_index=lambda: 2, midi_learn_pc=None,
                                  chain_manager=chain_manager,
                                  get_midi_capture_state=lambda: {}, last_zs3_id='zs3-1',
                                  zynmixer=SimpleNamespace(get_state=lambda *_: {}), SS_SAVE_ZS3=1)
        return manager, processor

    def test_complete_processor_state_is_committed(self):
        manager, processor = self.manager()
        save(manager, 'zs3-1', 'Updated')
        saved = manager.zs3['zs3-1']
        self.assertEqual(saved['title'], 'Updated')
        self.assertEqual(saved['processors'][1]['lv2_state']['data'], 'unsaved')
        self.assertEqual(saved['processors'][1]['preset_info'], ['original'])
        processor.get_state.assert_called_once()

    def test_failed_capture_preserves_existing_and_new_ids(self):
        for identity in ('zs3-1', 'zs3-2'):
            manager, processor = self.manager()
            previous = copy.deepcopy(manager.zs3)
            processor.get_state.side_effect = RuntimeError('capture failed')
            with self.assertRaisesRegex(RuntimeError, 'capture failed'):
                save(manager, identity, 'Broken')
            self.assertEqual(manager.zs3, previous)
            self.assertEqual(manager.last_zs3_id, 'zs3-1')


if __name__ == '__main__':
    unittest.main()
