# SPDX-License-Identifier: GPL-2.0-or-later
from types import SimpleNamespace as NS
from unittest import TestCase
from unittest.mock import Mock
from zynwebview.bridge import ScreenAdapter


def control(name):
    return NS(name=name, value=64, value_min=0, value_max=127, labels=None,
              is_path=False, is_toggle=False, nudge=Mock(), set_value=Mock())


class ScreenViewTests(TestCase):
    def adapter(self, name, screen, **extra):
        return ScreenAdapter(NS(current_screen=name, screens={name:screen}, cuia_back=Mock(),
                                cuia_screen_mixer=Mock(),cuia_screen_snapshot=Mock(),cuia_all_sounds_off=Mock(), **extra))

    def dispatch(self, adapter, **command):
        adapter.dispatch(dict(revision=adapter.snapshot()['revision'], **command))

    def test_range_controllers_delegate_to_native_objects(self):
        controls=[control(name) for name in ['Octave','Semitone','Low','High']]
        screen=NS(title='Range',note_low=0,note_high=127,learn_mode=False,
                  zgui_ctrls=[NS(zctrl=c) for c in controls],toggle_midi_learn=Mock())
        adapter=self.adapter('midi_key_range',screen)
        self.assertEqual(adapter.snapshot()['content']['type'],'keyRange')
        self.dispatch(adapter,method='adjust',target='control:2',delta=1)
        controls[2].nudge.assert_called_once_with(1,fine=False)
        self.dispatch(adapter,method='activate',target='range:learn')
        screen.toggle_midi_learn.assert_called_once_with()

    def test_parameter_options_use_native_index(self):
        screen=NS(title='Control',list_data=[],zcontrollers=[control('Cutoff')],controller_options=Mock())
        adapter=self.adapter('control',screen)
        self.assertTrue(adapter.snapshot()['items'][0]['options'])
        self.dispatch(adapter,method='activate',target='control:0',bold=True)
        screen.controller_options.assert_called_once_with(0)

    def test_direct_values_reject_invalid_and_stale_commands(self):
        c=control('Cutoff');adapter=self.adapter('control',NS(list_data=[],zcontrollers=[c]))
        for value in [True,float('nan'),float('inf'),-1,128,'100']:
            with self.assertRaises(ValueError): self.dispatch(adapter,method='set',target='control:0',value=value)
        self.dispatch(adapter,method='set',target='control:0',value=42)
        c.set_value.assert_called_once_with(42)
        with self.assertRaisesRegex(ValueError,'Screen changed'):
            adapter.dispatch(dict(method='set',target='control:0',value=50,revision='old'))

    def test_settings_panels_and_xy_are_not_empty_placeholders(self):
        for name in ['brightness_config','cv_config','midi_cc_range']:
            adapter=self.adapter(name,NS(zgui_ctrls=[NS(zctrl=control('Value'))]))
            self.assertEqual(adapter.snapshot()['items'][0]['kind'],'control')
        adapter=self.adapter('control_xy',NS(),state_manager=NS(zctrl_x=control('X'),zctrl_y=control('Y')))
        self.assertEqual([x['id'] for x in adapter.snapshot()['items']],['axis:x','axis:y'])

    def test_info_reads_native_status_and_provides_exit(self):
        text=Mock();text.get.return_value='Operation complete'
        adapter=self.adapter('info',NS(textarea=text))
        self.assertEqual(adapter.snapshot()['content']['text'],'Operation complete')
        self.dispatch(adapter,method='activate',target='info:close')
        adapter.gui.cuia_back.assert_called_once_with()

    def test_screen_menu_uses_browser_selection_without_activating_it(self):
        screen=NS(list_data=[('a',0,'A'),('b',1,'B')],select=Mock(),switch_select=Mock(),show_menu=Mock())
        adapter=self.adapter('snapshot',screen)
        self.dispatch(adapter,method='action',action='screenMenu',target='list:1')
        screen.select.assert_called_once_with(1)
        screen.show_menu.assert_called_once_with()
        screen.switch_select.assert_not_called()

    def test_zs3_move_and_learn_delegate_without_recalling(self):
        screen=NS(list_data=[],moving_zs3='zs3-1',toggle_midi_learn=Mock(),
                  nudge_zs3=Mock(),end_moving_zs3=Mock())
        manager=NS(midi_learn_state=False,load_prev_zs3=Mock(),load_next_zs3=Mock())
        adapter=self.adapter('zs3',screen,state_manager=manager)
        self.dispatch(adapter,method='action',action='move:down')
        self.dispatch(adapter,method='action',action='zs3Learn')
        screen.nudge_zs3.assert_called_once_with(1)
        screen.toggle_midi_learn.assert_called_once_with()
        manager.load_next_zs3.assert_not_called()
