# SPDX-License-Identifier: GPL-2.0-or-later
"""Sequencer boundary fixtures. These are synthetic, not an audio engine."""
from types import SimpleNamespace as NS
from unittest.mock import Mock
import unittest
from test_bridge import ScreenAdapter, upstream_method


def event(velocity=100, duration=1, offset=0):
    return NS(val2_start=velocity, duration=duration, offset=offset, stut_speed=0,
              stut_velfx=0, stut_ramp=0, play_freq=1, play_chance=1.0,
              stut_freq=1, stut_chance=1.0)


def pattern_fixture(cc=False):
    events = {(0, 60): event(96, 3), (4, 64): event(112, 2), (8, 67): event(88, 2),
              (12, 64): event(104, 3), (0, 48): event(80, 8), (8, 55): event(80, 8)}
    lib = Mock()
    lib.getPatternPlayhead.return_value = 6
    lib.getPlayState.return_value = 1
    lib.getNoteStart.side_effect = lambda step, note: next((s for (s,n),e in events.items() if n == note and s <= step < s+e.duration), -1)
    seq = NS(scene=0, libseq=lib, get_tempo=lambda: 120.0,
             get_note_data=lambda step,note: events.get((step,note)))
    screen = NS(zynseq=seq, pattern=5, phrase=1, sequence=0, channel=0,
                n_steps=32, n_steps_beat=4, selected_cell=[4,64], edit_mode=0, edit_param=0,
                midi_record=False, keymap=[dict(note=n) for n in range(128)],
                duration=1., velocity=100, offset=0., stut_speed=0, stut_velfx=0, stut_ramp=0,
                play_freq=1, play_chance=1., stut_freq=1, stut_chance=1.,
                block_cell_start=[0,60], block_cell_end=[8,67], cc_num=74, interpolateCC=True,
                get_title=lambda: 'Phrase 2 / Pattern 5: CC74' if cc else 'Phrase 2 / Pattern 5: Notes',
                get_playback_status=lambda: 1, ctrl_order=[0,1,2,3],
                get_cc_value=lambda step: {0:32,4:64,8:90,12:110}.get(step))
    for name in ('switch_select','toggle_playback','show_menu','toggle_midi_record','undo_pattern',
                 'redo_pattern','select_block_all','start_select_block','zynpot_cb','save_pattern_snapshot'):
        setattr(screen,name,Mock())
    def select(step=None,row=None):
        screen.selected_cell = [max(0,min(screen.n_steps-1,screen.selected_cell[0] if step is None else step)),
                                max(0,min(127,screen.selected_cell[1] if row is None else row))]
    screen.select_cell=Mock(side_effect=select)
    screen.set_edit_mode=Mock(side_effect=lambda mode: setattr(screen,'edit_mode',mode))
    for action in ('up','down','left','right'): setattr(screen,'arrow_'+action,Mock())
    gui = NS(current_screen='pated_cc' if cc else 'pattern_editor', screens={},toggle_pated=Mock(),
             show_screen=Mock(),cuia_back=Mock(),cuia_screen_mixer=Mock(),cuia_screen_snapshot=Mock(),cuia_all_sounds_off=Mock())
    gui.screens[gui.current_screen]=screen
    return gui,screen,events


def launcher_fixture():
    seq=NS(scene=0,phrase=1,phrases=4,libseq=Mock(),get_tempo=lambda:120.)
    seq.libseq.getPlayState.side_effect=lambda scene,phrase,chan: 1 if phrase==1 else 0
    def info(name,events=8):
        return dict(name=name,repeat=255,nEvents=events,nBeats=4,followAction=1,followParam=1)
    seq.state={'scenes':[{'phrases':[dict(info(name),sequences=[info('') for _ in range(32)])
                                   for name in ('Intro','Verse','Chorus','Outro')]}]}
    chains=[NS(chain_id=i,midi_chan=ch,get_name=lambda name=name:name) for i,ch,name in
            ((1,0,'Keys'),(2,1,'Bass'),(3,16,'Audio clip'),(0,None,'All chains'))]
    strips=[NS(chain=chain) for chain in chains]
    screen=NS(title='Clip launcher',launcher_mode=True,zynseq=seq,chain_strips=strips,
              highlighted_strip=strips[0],moving_phrase=False)
    screen.update_active_chain=Mock(side_effect=lambda chain_id,send: setattr(screen,'highlighted_strip',next(s for s in strips if s.chain.chain_id==chain_id)))
    screen.select_launcher=Mock(side_effect=lambda phrase:setattr(seq,'phrase',max(0,min(seq.phrases-1,phrase))))
    for name in ('switch_select','item_menu','phrase_menu','edit_pad','phrase_menu_cb','copy_to_clipboard','paste_from_clipboard','arrow_up','arrow_down','arrow_left','arrow_right'):
        setattr(screen,name,Mock())
    gui=NS(current_screen='launcher',screens={'launcher':screen},show_screen=Mock())
    return gui,screen


class TestSequencer(unittest.TestCase):
    def setUp(self):
        self.gui,self.screen,self.events=pattern_fixture()
        self.adapter=ScreenAdapter(self.gui)
    def command(self,action,**kwargs):
        self.adapter.dispatch(dict(method='sequence',action=action,revision=self.adapter.snapshot()['revision'],**kwargs))
    def test_native_notes_and_overlap_render_without_mutation(self):
        state=self.adapter.snapshot()
        self.assertEqual(state['kind'],'sequencer')
        grid=state['sequence']
        self.assertLessEqual(len(grid['cells']),16*12)
        continuation=next(c for c in grid['cells'] if c['row']==60 and c['step']==2)
        self.assertEqual((continuation['start'],continuation['duration'],continuation['velocity']),(0,3,96))
        self.screen.zynseq.libseq.addNote.assert_not_called()
    def test_touch_only_selects_and_validates_visible_bounds(self):
        self.command('cell',first=4,second=64)
        self.screen.select_cell.assert_called_once_with(4,64)
        self.screen.switch_select.assert_not_called()
        for a,b in ((-1,64),(800,64),(4,100),(True,64)):
            with self.assertRaises(ValueError):self.command('cell',first=a,second=b)
    def test_native_actions_transport_record_undo_and_editor_switch(self):
        for action,callback in [('select',self.screen.switch_select),('play',self.screen.toggle_playback),
                                ('record',self.screen.toggle_midi_record),('undo',self.screen.undo_pattern),
                                ('editor',self.gui.toggle_pated),('stop',self.screen.zynseq.libseq.stop)]:
            self.command(action)
            callback.assert_called_once()
        self.screen.switch_select.assert_called_with('S')
        self.command('bold');self.screen.switch_select.assert_called_with('B')
    def test_external_cursor_pattern_and_scale_changes_reject_old_commands(self):
        for change in (lambda:setattr(self.screen,'pattern',7),lambda:self.screen.selected_cell.__setitem__(0,8),
                       lambda:self.screen.keymap[64].update(note=65),lambda:setattr(self.screen,'edit_mode',2)):
            revision=self.adapter.snapshot()['revision'];change()
            with self.assertRaisesRegex(ValueError,'Screen changed'):
                self.adapter.dispatch(dict(method='sequence',action='select',revision=revision))
        self.screen.switch_select.assert_not_called()
    def test_playhead_and_velocity_updates_do_not_invalidate_cursor(self):
        before=self.adapter.snapshot()['revision']
        self.screen.zynseq.libseq.getPatternPlayhead.return_value=9
        self.events[(4,64)].val2_start=60
        state=self.adapter.snapshot()
        self.assertEqual(state['revision'],before)
        self.assertEqual(state['sequence']['noteValues']['Velocity'],60)
    def test_length_shortcut_native_encoder_restores_mode_and_history(self):
        self.command('lengthMore',fine=True)
        self.screen.zynpot_cb.assert_called_once_with(1,1)
        self.assertEqual((self.screen.edit_mode,self.screen.edit_param),(0,0))
        self.assertEqual(self.screen.save_pattern_snapshot.call_count,2)
        self.screen.edit_mode=1
        with self.assertRaises(ValueError):self.command('lengthLess')
    def test_paging_and_fine_native_edit(self):
        self.command('pageDown');self.assertEqual(self.screen.selected_cell[0],20)
        self.command('pageDown');self.assertEqual(self.screen.selected_cell[0],31)
        self.screen.edit_mode=2
        self.command('up',fine=True);self.screen.zynpot_cb.assert_called_with(1,1)
    def test_cc_selection_and_native_value_input(self):
        self.gui,self.screen,_=pattern_fixture(True);self.adapter=ScreenAdapter(self.gui)
        self.assertEqual(self.adapter.snapshot()['sequence']['cells'][0]['value'],32)
        self.command('ccUp');self.screen.zynpot_cb.assert_called_once_with(0,1)
        self.command('up');self.screen.arrow_up.assert_called_once()
        self.command('velocityMore');self.assertEqual(self.screen.arrow_up.call_count,2)
        with self.assertRaises(ValueError):self.command('lengthMore')
    def test_touch_extends_or_moves_native_block(self):
        self.screen.edit_mode=1
        self.screen.block_copied=None
        self.screen.select_block=Mock();self.screen.move_block=Mock()
        self.command('cell',first=8,second=67)
        self.screen.select_block.assert_called_once_with(4,3)
        self.screen.block_copied=[1]
        self.command('cell',first=8,second=67)
        self.screen.move_block.assert_called_once_with(4,3)
    def test_actions_not_available_after_leaving_editor(self):
        self.adapter.snapshot();self.gui.current_screen='unknown'
        with self.assertRaises(ValueError):self.command('play')
        self.screen.toggle_playback.assert_not_called()
    def test_context_menu_matches_editor_and_keeps_navigation_available(self):
        before=self.adapter.snapshot()
        self.assertEqual(before['columns'],2)
        self.assertIn('seq:lengthMore',[i['id'] for i in before['items']])
        self.screen.edit_mode=2
        edited=self.adapter.snapshot()
        ids=[i['id'] for i in edited['items']]
        self.assertIn('seq:up',ids)
        self.assertIn('seq:select',ids)
        self.assertNotIn('seq:lengthMore',ids)
        self.adapter.dispatch(dict(method='activate',target='nav:home',revision=edited['revision']))
        self.gui.show_screen.assert_called_once_with('main_menu')
    def test_launcher_chain_phrase_selection_and_arrangement(self):
        self.gui,self.screen=launcher_fixture();self.adapter=ScreenAdapter(self.gui)
        grid=self.adapter.snapshot()['sequence']
        self.assertEqual(len(grid['cells']),16)
        self.assertEqual(grid['rows'][1]['follow'],1)
        self.command('cell',first=2,second=2)
        self.screen.update_active_chain.assert_called_once_with(2,True)
        self.screen.select_launcher.assert_called_once_with(2)
        self.command('select');self.screen.switch_select.assert_called_with('S')
        self.command('phrase');self.screen.update_active_chain.assert_called_with(0,True)
        self.screen.phrase_menu.assert_called_once()
        self.command('append');self.screen.phrase_menu_cb.assert_called_with('Append phrase',4)
    def test_moving_phrase_uses_upstream_arrows_and_finish(self):
        self.gui,self.screen=launcher_fixture();self.adapter=ScreenAdapter(self.gui)
        self.screen.moving_phrase=True
        self.assertTrue(self.adapter.snapshot()['sequence']['moving'])
        self.command('up');self.screen.arrow_up.assert_called_once()
        self.command('select');self.screen.switch_select.assert_called_with('S')
    def test_real_upstream_toggle_uses_existing_note_and_chord_callbacks(self):
        toggle=upstream_method('zynthian_gui_pated_notes.py','zynthian_gui_pated_notes','toggle_event')
        self.screen.add_chord=Mock();self.screen.remove_chord=Mock()
        toggle(self.screen,2,60)
        self.screen.remove_chord.assert_called_once_with(0,60)
        toggle(self.screen,6,60)
        self.screen.add_chord.assert_called_once_with(6,60,100,1.,0.)
    def test_real_upstream_note_write_preserves_undo_and_native_data(self):
        add=upstream_method('zynthian_gui_pated_notes.py','zynthian_gui_pated_notes','add_note_event')
        self.screen.get_default_note_evdata=lambda:event()
        self.screen.draw_row=Mock()
        self.assertTrue(add(self.screen,4,64,96,2.5,.1))
        self.screen.zynseq.libseq.addNote.assert_called_once_with(4,64,96,2.5,.1)
        self.screen.zynseq.libseq.setNoteData.assert_called_once()
        self.assertEqual(self.screen.save_pattern_snapshot.call_count,2)
    def test_real_upstream_clip_launch_addresses_native_scene_phrase_channel(self):
        short=upstream_method('zynthian_gui_mixer.py','zynthian_gui_launcher_pad','on_clip_short_press')
        gui,mixer=launcher_fixture()
        short(NS(chain=mixer.chain_strips[0].chain,gui_mixer=mixer,phrase=3))
        mixer.zynseq.libseq.togglePlayState.assert_called_once_with(0,3,0)
        short(NS(chain=mixer.chain_strips[-1].chain,gui_mixer=mixer,phrase=1))
        mixer.zynseq.libseq.togglePlayState.assert_called_with(0,1,32)
    def test_composite_chain_controls_delegate_and_reject_subscreen_change(self):
        control=NS(name='Gain',value=50,value_min=0,value_max=127,labels=None,is_path=False,nudge=Mock())
        sub=NS(title='Processor',zcontrollers=[control],list_data=[],param_editor_zctrl=None)
        parent=NS(subscreen=sub,subscreen_name='control',chain=None,select_subscreen=Mock())
        self.gui.current_screen='chain_control';self.gui.screens['chain_control']=parent
        revision=self.adapter.snapshot()['revision']
        self.adapter.dispatch(dict(method='adjust',target='control:0',delta=1,revision=revision))
        control.nudge.assert_called_once_with(1,fine=False)
        parent.subscreen_name='audio_out'
        with self.assertRaises(ValueError):self.adapter.dispatch(dict(method='adjust',target='control:0',delta=1,revision=revision))

if __name__=='__main__':unittest.main()
