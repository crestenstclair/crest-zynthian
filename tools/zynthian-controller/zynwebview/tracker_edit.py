# SPDX-License-Identifier: GPL-2.0-or-later
"""Single-track edits stored entirely as native ZynSeq note events.

An explicit OFF is a zero-velocity MIDI note-on (a standard MIDI release).
Durations carry sustain through empty rows. No parallel event store is used.
"""
import math


class TrackerEdit:
    def __init__(self, view):
        self.view = view
        self.screen = view.screen
        self.lib = self.screen.zynseq.libseq

    def apply(self, request):
        step, row = request['first'], request['second']
        action, field, delta = request['action'], request.get('field'), request.get('delta')
        if action == 'editCell' and (field not in ('pitch', 'velocity', 'event', 'offset', 'probability', 'stutter') or type(delta) is not int or delta not in (-1, 1)):
            raise ValueError('Invalid tracker adjustment')
        events = self.view.tracker_events(self.screen, [])
        current = next((event for event in events if event['step'] == step and event['row'] == row), None)
        large = request.get('large') is True
        kind = 'note' if current and current['velocity'] else 'off' if current else 'empty'
        target = 'note' if action == 'insert' else 'empty' if action == 'remove' else None
        if field == 'event':
            kinds = ['empty', 'note', 'off']
            target = kinds[(kinds.index(kind) + delta) % len(kinds)]
        if target == kind:
            return
        if target is None and kind == 'note':
            self.adjust_existing(step, row, field, delta, large)
            return
        if target is None:
            target = 'note'
        self.screen.save_pattern_snapshot(now=True, force=False)
        if current:
            self.lib.removeNote(step, current['note'])
        if target == 'empty':
            self.restore_sustain(events, step)
        else:
            self.end_held_notes(events, step)
            self.insert(events, step, row, target, field, delta, large)
        self.screen.save_pattern_snapshot(now=True, force=True)
        self.screen.draw_grid()

    def adjust_existing(self, step, row, field, delta, large):
        if field == 'pitch':
            self.view.move_note(self.screen, step, row, delta * (12 if large else 1))
            return
        params = {'velocity': 1, 'offset': 2, 'stutter': 3, 'probability': 7}
        self.screen.select_cell(step, row)
        self.view.note_parameter(self.screen, params[field], delta * (10 if large else 1))

    def next_step(self, events, step):
        return min((event['step'] for event in events if event['step'] > step), default=self.screen.n_steps)

    def rewrite_duration(self, event, end):
        data = self.screen.zynseq.get_note_data(event['step'], event['note'])
        duration = end - event['step'] - data.offset
        if duration <= 0:
            return
        if not self.lib.addNote(event['step'], event['note'], data.val2_start, duration, data.offset):
            raise ValueError('Native sustain update failed')
        self.lib.setNoteData(event['step'], event['note'], data)

    def end_held_notes(self, events, step):
        for event in events:
            if event['velocity'] and event['step'] < step < event['step'] + event['offset'] + event['duration']:
                self.rewrite_duration(event, step)

    def restore_sustain(self, events, step):
        end = self.next_step(events, step)
        for event in events:
            if event['velocity'] and event['step'] < step and math.isclose(event['step'] + event['offset'] + event['duration'], step, abs_tol=.002):
                self.rewrite_duration(event, end)

    def insert(self, events, step, row, kind, field, delta, large):
        data = self.screen.get_default_note_evdata()
        if kind == 'off':
            data.val2_start = 0
            data.stut_speed = 0
            data.play_chance = 1
            data.play_freq = 1
            offset, duration = 0, .01
        else:
            if field == 'pitch':
                row = max(0, min(len(self.screen.keymap) - 1, row + delta * (12 if large else 1)))
            if field == 'velocity':
                data.val2_start = max(1, min(127, data.val2_start + delta * (10 if large else 1)))
            elif field == 'offset':
                data.offset = max(0, min(.99, data.offset + delta * (.1 if large else .01)))
            elif field == 'probability':
                data.play_chance = max(0, min(1, data.play_chance + delta * (.1 if large else .01)))
            elif field == 'stutter':
                data.stut_speed = max(0, min(127, data.stut_speed + delta * (10 if large else 1)))
            offset = data.offset
            duration = max(.01, self.next_step(events, step) - step - offset)
        note = self.screen.keymap[row]['note']
        if not self.lib.addNote(step, note, data.val2_start, duration, offset):
            raise ValueError('Native tracker insertion failed')
        self.lib.setNoteData(step, note, data)
        self.screen.select_cell(step, row)
