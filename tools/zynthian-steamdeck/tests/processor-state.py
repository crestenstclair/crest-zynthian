#!/usr/bin/env python3
"""Check preset recall policy without loading native audio libraries.

The runtime smoke test separately exercises real engines, routing and audio.
Pass the processor module from either the pinned runtime or controller source.
"""
import importlib.util
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import patch


def load_processor(path):
    zyncore = ModuleType('zyncoder.zyncore')
    zyncore.lib_zyncore = None
    signals = ModuleType('zyngine.zynthian_signal_manager')
    spec = importlib.util.spec_from_file_location('processor_under_test', path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {
        'zyncoder.zyncore': zyncore,
        'zyngine.zynthian_signal_manager': signals,
    }):
        spec.loader.exec_module(module)
    return module.zynthian_processor


class PresetEngine:
    """A preset contains state that is absent from numeric controllers."""
    preset_favs = {}

    def __init__(self):
        self.opaque_state = b'edited state'
        self.restores = 0

    def cmp_presets(self, first, second):
        return first == second

    def set_preset(self, processor, preset):
        self.opaque_state = b'saved state'
        self.restores += 1
        return True

    def get_snapshot_state(self):
        return self.opaque_state

    def restore_snapshot_state(self, state):
        self.opaque_state = state


class RecallTests(unittest.TestCase):
    def processor(self, engine_code, preloaded=False):
        processor = Processor(engine_code, {'TYPE': 'Audio Effect', 'NAME': 'Test'})
        processor.engine = PresetEngine()
        preset = ['urn:test:preset', None, 'Saved preset', '']
        processor.preset_list = [preset]
        processor.preset_info = preset.copy()
        processor.preload_info = preset.copy() if preloaded else None
        processor.get_bank_list = lambda: []
        processor.load_preset_list = lambda: None
        return processor, {'preset_info': preset, 'controllers': {}}

    def test_current_lv2_preset_restores_opaque_state(self):
        processor, state = self.processor('JV/Test')
        processor.set_state(state)
        self.assertEqual(processor.engine.opaque_state, b'saved state')
        self.assertEqual(processor.engine.restores, 1)

    def test_preloaded_lv2_preset_restores_opaque_state(self):
        processor, state = self.processor('JV/Test', preloaded=True)
        processor.set_state(state)
        self.assertEqual(processor.engine.opaque_state, b'saved state')
        self.assertEqual(processor.engine.restores, 1)

    def test_other_preloaded_engines_keep_existing_policy(self):
        processor, state = self.processor('FS', preloaded=True)
        processor.set_state(state)
        self.assertEqual(processor.engine.restores, 0)
        self.assertEqual(processor.engine.opaque_state, b'edited state')

    def test_unsaved_state_overrides_selected_preset(self):
        processor, state = self.processor('JV/Test')
        state['lv2_state'] = b'unsaved editor change'
        processor.set_state(state)
        self.assertEqual(processor.engine.opaque_state, b'unsaved editor change')
        self.assertEqual(processor.preset_info, state['preset_info'])


if __name__ == '__main__':
    source = Path(sys.argv.pop(1))
    Processor = load_processor(source)
    unittest.main()
