# SPDX-License-Identifier: GPL-2.0-or-later
"""Regression checks for missing native navigation found by live workflows."""
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock
from threading import Lock
from test_bridge import MainMenu, upstream_method
from functools import partial
from zynwebview.bridge import ScreenAdapter
from zynwebview.screen_views import contextual_actions

class ControllerWorkflowTests(TestCase):
    def test_engine_categories_keep_native_callback_and_revision(self):
        engine = SimpleNamespace(title='Engine', list_data=[('ZY', 0, 'ZynAddSubFX')],
                                 engine_cats=['Synth', 'Sampler'], cat_index=0, set_cat=Mock())
        gui = SimpleNamespace(current_screen='engine', screens={'engine': engine})
        adapter = ScreenAdapter(gui)
        state = adapter.snapshot()
        adapter.dispatch({'method':'activate', 'revision':state['revision'], 'target':'category:1'})
        engine.set_cat.assert_called_once_with(1)
        engine.cat_index = 1
        self.assertNotEqual(state['revision'], adapter.snapshot()['revision'])

    def test_four_column_midi_output_uses_output_callback(self):
        menu = MainMenu()
        menu.zyngui = Mock(capture_log_fname=False)
        menu.state_manager = SimpleNamespace(audio_recorder=SimpleNamespace(status=False), status_midi_recorder=False)
        menu.clean_menu = Mock()
        menu.toggle_capture_log = Mock()
        output = next(item for item in menu._get_config() if item and item['title']=='MIDI\nOutput')
        output['action']()
        menu.zyngui.midi_out_config.assert_called_once_with()
        menu.zyngui.midi_in_config.assert_not_called()

    def test_processor_presets_delegate_to_zynthian(self):
        processor = SimpleNamespace(id=4, type='MIDI Synth', get_name=lambda:'FluidSynth')
        parent = SimpleNamespace(subscreen_name='control', subscreen=SimpleNamespace(title='Controls',list_data=[]),
                                 chain=SimpleNamespace(get_processors=lambda:[processor]))
        gui = SimpleNamespace(current_screen='chain_control',screens={'chain_control':parent},cuia_bank_preset=Mock())
        adapter = ScreenAdapter(gui)
        state = adapter.snapshot()
        adapter.dispatch({'method':'activate','revision':state['revision'],'target':'presets:4'})
        gui.cuia_bank_preset.assert_called_once_with(processor)

    def test_startup_rejects_commands_until_native_thread_finishes(self):
        menu = SimpleNamespace(title='Menu', list_data=[])
        startup = Mock()
        startup.is_alive.return_value = True
        gui = SimpleNamespace(current_screen='main_menu', screens={'main_menu':menu}, start_thread=startup)
        adapter = ScreenAdapter(gui)
        state = adapter.snapshot()
        self.assertTrue(state['backendBusy'])
        with self.assertRaisesRegex(ValueError, 'busy'):
            adapter.dispatch({'method':'action','action':'home','revision':state['revision']})
        startup.is_alive.return_value = False
        self.assertFalse(adapter.snapshot()['backendBusy'])

    def test_loading_and_native_screen_transition_remain_busy(self):
        loading = SimpleNamespace(canvas=Mock(), title_text=1, details_text=2)
        loading.canvas.itemcget.return_value = 'Loading'
        gui = SimpleNamespace(current_screen='loading', screens={'loading':loading}, screen_lock=Lock())
        adapter = ScreenAdapter(gui)
        self.assertTrue(adapter.snapshot()['backendBusy'])
        gui.current_screen = 'main_menu'
        with gui.screen_lock:
            self.assertTrue(adapter.snapshot()['backendBusy'])
        self.assertFalse(adapter.snapshot()['backendBusy'])

    def test_screen_menu_selects_focused_row_without_activating_it(self):
        screen = SimpleNamespace(title='Presets', index=0,
            list_data=[('a',0,'First'),('b',1,'Second',['Preset details'])],
            select=Mock(), switch_select=Mock(), show_menu=Mock())
        gui = SimpleNamespace(current_screen='preset', screens={'preset':screen},
            cuia_back=Mock(), cuia_screen_mixer=Mock(), cuia_screen_snapshot=Mock(), cuia_all_sounds_off=Mock())
        screen.show_menu.side_effect = lambda: screen.select.assert_called_once_with(1)
        adapter = ScreenAdapter(gui)
        state = adapter.snapshot()
        self.assertEqual(state['selectedTarget'],'list:0')
        self.assertEqual(state['items'][1]['description'],'Preset details')
        adapter.dispatch({'method':'action','action':'screenMenu','target':'list:1','revision':state['revision']})
        screen.show_menu.assert_called_once_with()
        screen.switch_select.assert_not_called()

    def test_processor_menu_does_not_depend_on_hidden_chain_canvas(self):
        processor = SimpleNamespace(id=4,type='MIDI Synth',get_name=lambda:'FluidSynth')
        parent = SimpleNamespace(subscreen_name='control',subscreen=SimpleNamespace(title='Controls',list_data=[]),
            chain=SimpleNamespace(get_processors=lambda:[processor]))
        gui = SimpleNamespace(current_screen='chain_control',screens={'chain_control':parent},
            set_current_processor=Mock(),show_screen=Mock())
        adapter = ScreenAdapter(gui)
        state = adapter.snapshot()
        adapter.dispatch({'method':'activate','target':'processor:4','bold':True,'revision':state['revision']})
        gui.set_current_processor.assert_called_once_with(processor)
        gui.show_screen.assert_called_once_with('processor_options')

    def test_numeric_keyboard_has_zero_and_no_stale_qwerty_keys(self):
        screen = SimpleNamespace(title='Keyboard',columns=6,mode=0,text='123',keys=list('123456789'),
            btn_space=10,btn_delete=11,btn_cancel=9,btn_enter=12,btn_shift=41,btn_alt=42,
            function=Mock(),execute_key_press=Mock())
        gui = SimpleNamespace(current_screen='keyboard',screens={'keyboard':screen})
        adapter = ScreenAdapter(gui)
        state = adapter.snapshot()
        labels = [item['label'] for item in state['items']]
        self.assertIn('0',labels)
        self.assertNotIn('Shift',labels)
        self.assertNotIn('Symbols',labels)
        adapter.dispatch({'method':'activate','target':'special:10','revision':state['revision']})
        screen.execute_key_press.assert_called_once_with(10,False)

    def test_midi_rename_captures_file_before_keyboard_rebuilds_list(self):
        callback = upstream_method('zynthian_gui_midi_recorder.py','zynthian_gui_midi_recorder','smf_options_cb')
        callback.__globals__.update(os=__import__('os'),partial=partial)
        screen = SimpleNamespace(zyngui=Mock(),rename_smf=Mock(),list_data=[('old.mid',0,'old')],index=0)
        selected = screen.list_data[0]
        callback(screen,'Rename',selected)
        rename = screen.zyngui.show_keyboard.call_args.args[0]
        screen.list_data = [('START_RECORDING',None,'Start MIDI Recording')]
        rename('new')
        screen.rename_smf.assert_called_once_with(selected,'new')

    def test_audio_file_browser_remains_available_after_loading_a_recording(self):
        player = object()
        gui = SimpleNamespace(current_processor=player,state_manager=SimpleNamespace(audio_player=player),cuia_bank_preset=Mock())
        actions = contextual_actions(gui,SimpleNamespace(show_menu=Mock()),'control')
        self.assertNotIn('screenMenu',actions)
        actions['audioFiles'][1]()
        gui.cuia_bank_preset.assert_called_once_with()
