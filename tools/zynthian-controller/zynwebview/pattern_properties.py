# SPDX-License-Identifier: GPL-2.0-or-later
"""Direct controls over the existing pattern and sequence properties."""


class PatternProperties:
    def __init__(self, adapter):
        self.adapter = adapter
        self.setters = {}

    def add(self, state, symbol, name, value, setter, minimum=0, maximum=100, choices=None):
        from zyngine.zynthian_controller import zynthian_controller
        options = dict(name=name, value=value, value_min=minimum, value_max=maximum)
        if choices:
            options.update(ticks=[value for value, label in choices], labels=[label for value, label in choices])
        control = zynthian_controller(self, symbol, options)
        self.setters[symbol] = setter
        self.adapter._add(state['items'], 'property:' + symbol, name, control=control,
                          identity=(self.screen.pattern, symbol))

    def send_controller_value(self, control):
        self.setters[control.symbol](control.value)

    def populate(self, screen, state):
        self.screen = screen
        self.setters = {}
        seq, lib = screen.zynseq, screen.zynseq.libseq
        state.update(kind='properties', title='Pattern options', items=[],
                     message='Hold × + directions to edit · ○ + ↓ returns to the phrase', properties=True)
        add = lambda symbol, name, value, setter, **options: self.add(state, symbol, name, value, setter, **options)
        if screen.seq_info:
            repeat = screen.seq_info['repeat']
            value = 1 if repeat == 255 else 0 if repeat == 0 else repeat + 1
            choices = [(0, 'Disabled'), (1, 'Loop'), (2, 'One shot')] + [(i + 1, f'Play {i} times') for i in range(2, 25)]
            add('playmode', 'Play mode', value, self.set_playmode, choices=choices)
            program = lib.getProgramChange(0)
            add('program', 'Program change', program + 1 if program < 128 else 0, screen.add_program_change,
                choices=[(0, 'None')] + [(i + 1, str(i)) for i in range(128)])
        add('length', 'Length (beats)', lib.getBeatsInPattern(screen.pattern), screen.assert_beats_in_pattern, minimum=1, maximum=64)
        steps = [1, 2, 3, 4, 6, 8, 12, 24]
        add('resolution', 'Steps per beat', screen.n_steps_beat, screen.assert_steps_per_beat, choices=[(i, str(i)) for i in steps])
        add('tempo', 'Tempo (BPM)', round(seq.get_tempo()), seq.set_tempo, minimum=10, maximum=400)
        add('quantization', 'Quantization', lib.getQuantizeNotes(), lib.setQuantizeNotes,
            choices=[(0, 'Disabled'), (1, '1 step')] + [(i, f'1/{i} step') for i in [2, 3, 4, 6, 8]])
        add('swing', 'Swing (%)', round(100 * lib.getSwingAmount()), lambda value: lib.setSwingAmount(value / 100))
        add('swing_divisor', 'Swing divisor', lib.getSwingDiv(), lib.setSwingDiv, minimum=1, maximum=screen.n_steps_beat)
        add('human_time', 'Timing humanization (%)', round(100 * lib.getHumanTime()), lambda value: lib.setHumanTime(value / 100))
        if state['sequence']['type'] == 'notes':
            self.add_note_properties(state)
        self.adapter._add(state['items'], 'property:rename', 'Rename clip',
                          lambda t: screen.menu_cb('Rename', 'Rename sequence'))
        self.adapter._add(state['items'], 'property:done', 'Return to phrase', lambda t: self.adapter.return_workspace())

    def add_note_properties(self, state):
        from .sequencer import NOTE_NAMES
        from zyngui.zynthian_gui_pated_notes import CHORD_MODES, CHORDS
        screen, lib = self.screen, self.screen.zynseq.libseq
        add = lambda symbol, name, value, setter, **options: self.add(state, symbol, name, value, setter, **options)
        add('human_velocity', 'Velocity humanization', round(lib.getHumanVelo()), lib.setHumanVelo)
        add('chance', 'Note probability (%)', round(100 * lib.getPlayChance()), lambda value: lib.setPlayChance(value / 100))
        add('scale', 'Scale', lib.getScale(), screen.set_scale, choices=list(enumerate(screen.get_scales())))
        add('tonic', 'Root', lib.getTonic(), screen.set_tonic, choices=list(enumerate(NOTE_NAMES)))
        rest = lib.getInputRest()
        add('rest', 'Rest-step input note', rest + 1 if rest < 128 else 0,
            lambda value: lib.setInputRest(value - 1 if value else 128),
            choices=[(0, 'None')] + [(i + 1, f'{NOTE_NAMES[i % 12]}{i // 12 - 1}') for i in range(128)])
        add('chord_mode', 'Chord mode', screen.chord_mode, lambda value: setattr(screen, 'chord_mode', value), choices=list(enumerate(CHORD_MODES)))
        if screen.chord_mode == 1:
            add('chord_type', 'Chord type', screen.chord_type, lambda value: setattr(screen, 'chord_type', value),
                choices=[(i, chord[0]) for i, chord in enumerate(CHORDS)])
        elif screen.chord_mode >= 2:
            add('chord_key', 'Diatonic key', screen.diatonic_scale_tonic, lambda value: setattr(screen, 'diatonic_scale_tonic', value), choices=list(enumerate(NOTE_NAMES)))

    def set_playmode(self, value):
        self.screen.assert_playmode(value)
        self.screen.update_sequence_params(['repeat'])
