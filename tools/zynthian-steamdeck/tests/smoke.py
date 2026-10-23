#!/usr/bin/env python3
"""Exercise real Oram GUI + MIDI router + FluidSynth + LV2 + mixer + snapshot.

Run in a disposable user directory with JACK dummy or PipeWire test devices.
Does not substitute fake native libraries or engine implementations.
"""
import json
import os
from pathlib import Path
import sys
import threading
import time
import traceback

mode = sys.argv[1]
output = Path(os.environ.get('TEST_OUTPUT', '/results'))
output.mkdir(parents=True, exist_ok=True)
sys.argv[0] = os.path.join(os.environ['ZYNTHIAN_UI_DIR'], 'zynthian_main.py')
os.chdir(os.environ['ZYNTHIAN_UI_DIR'])
from zyngui import zynthian_gui_config as config
from zyngui.zynthian_gui import zynthian_gui
from zyncoder.zyncore import lib_zyncore
import zynautoconnect
import jack
import numpy as np
import soundfile as sf
from PIL import ImageGrab

config.zyngui = app = zynthian_gui()
app.create_screens()
app.run_start_thread()
result = {'mode': mode, 'backend': os.environ.get('ZYNTHIAN_TEST_BACKEND'), 'passed': False}

def require(ok, message):
    if not ok:
        raise RuntimeError(message)

def exercise():
    try:
        state = app.state_manager
        manager = state.chain_manager
        snapshot = str(output/'smoke.zss')
        if mode == 'create':
            manager.add_chain(1, midi_chan=0)
            processor = manager.add_processor(1, 'FS')
            require(processor is not None, 'FluidSynth failed to start')
            banks = processor.get_bank_list()
            bank = next(i for i, b in enumerate(banks) if b[0] and 'FluidR3_GM.sf2' in b[0])
            require(processor.set_bank(bank), 'Cannot load FluidR3')
            processor.load_preset_list()
            require(processor.set_preset(0), 'Cannot select piano')
            effect = manager.add_processor(1, 'JV/Calf Reverb')
            require(effect is not None, 'Zynthian Jalv/Calf Reverb failed to load')
        else:
            require(state.load_snapshot(snapshot), 'Fresh-process snapshot restore failed')
            processor = next(p for p in manager.chains[1].get_processors() if p.eng_code == 'FS')
            require(any(p.eng_code == 'JV/Calf Reverb' for p in manager.chains[1].get_processors()),
                    'Snapshot lost LV2 effect')
            effect = next(p for p in manager.chains[1].get_processors() if p.eng_code == 'JV/Calf Reverb')
        manager.set_active_chain_by_id(1)
        state.zynmixer.set_level(manager.chains[1].mixer_chan, 0.7)
        state.zynmixer.set_level(state.zynmixer.MAX_NUM_CHANNELS-1, 0.7)
        zynautoconnect.request_audio_connect(True)
        zynautoconnect.request_midi_connect(True)
        time.sleep(2)
        client = jack.Client('zynthian_test_capture', no_start_server=True)
        graph = {p.name: [s.name for s in client.get_all_connections(p)]
                 for p in client.get_ports(is_input=True)}
        (output/f'{mode}-graph.json').write_text(json.dumps(graph, indent=2)+'\n')
        effect_inputs = client.get_ports(effect.get_jackname(), is_audio=True, is_input=True)
        require(len(effect_inputs) >= 2 and all(graph[p.name] for p in effect_inputs),
                'LV2 effect has unconnected audio inputs')
        effect_outputs = {p.name for p in client.get_ports(effect.get_jackname(), is_audio=True, is_output=True)}
        require(any(effect_outputs.intersection(sources) for name, sources in graph.items()
                    if name.startswith('zynmixer:input_')), 'LV2 output is not routed into the mixer')
        channels = [client.inports.register('left'), client.inports.register('right')]
        audio = np.zeros((client.samplerate * 4, 2), dtype=np.float32)
        position = 0
        complete = threading.Event()
        @client.set_process_callback
        def process(frames):
            nonlocal position
            count = min(frames, len(audio)-position)
            for i, port in enumerate(channels):
                audio[position:position+count, i] = port.get_array()[:count]
            position += count
            if position == len(audio): complete.set()
        client.activate()
        master = state.zynmixer.MAX_NUM_CHANNELS
        outputs = client.get_ports('system:playback_', is_audio=True, is_input=True)
        require(len(outputs) >= 2, 'Default output is not exposed as system:playback_N')
        for channel, suffix in enumerate(('a', 'b')):
            connections = client.get_all_connections(f'zynmixer:output_{master:02d}{suffix}')
            require(outputs[channel].name in [p.name for p in connections],
                    f'Stock autoconnect did not route master output {suffix} to the default device')
        client.connect(f'zynmixer:output_{master:02d}a', channels[0])
        client.connect(f'zynmixer:output_{master:02d}b', channels[1])
        time.sleep(0.25)
        lib_zyncore.ui_send_note_on(0, 60, 100)
        time.sleep(1)
        lib_zyncore.ui_send_note_off(0, 60, 0)
        require(complete.wait(8), 'Audio callback stalled')
        client.deactivate()
        sample_rate = client.samplerate
        client.close()
        require(np.isfinite(audio).all(), 'Non-finite audio')
        rms = float(np.sqrt(np.mean(audio**2)))
        peak = float(np.max(np.abs(audio)))
        require(rms > 0.0001, f'Silent output: RMS={rms}')
        require(peak < 1.0, f'Clipped output: peak={peak}')
        sf.write(str(output/f'{mode}.wav'), audio, sample_rate)
        if mode == 'create': require(state.save_snapshot(snapshot), 'Snapshot save failed')
        app.show_screen('audio_mixer')
        time.sleep(1)
        ImageGrab.grab().save(output/f'{mode}.png')
        result.update(passed=True, rms=rms, peak=peak, sample_rate=sample_rate,
                      preset=processor.preset_name, screens=len(app.screens),
                      default_outputs=[p.name for p in outputs],
                      engines=[p.eng_code for p in manager.chains[1].get_processors()])
    except Exception:
        result['error'] = traceback.format_exc()
        print(result['error'], flush=True)
    finally:
        (output/f'{mode}.json').write_text(json.dumps(result, indent=2)+'\n')
        config.top.after(0, lambda: app.exit(101))

started = time.monotonic()
def ready():
    if time.monotonic()-started > 60:
        result['error'] = 'UI startup timed out'
        (output/f'{mode}.json').write_text(json.dumps(result)+'\n')
        app.exit(101)
    elif app.current_screen != 'loading' and not app.state_manager.is_busy():
        threading.Thread(target=exercise, daemon=True).start()
    else:
        config.top.after(100, ready)
config.top.after(100, ready)
config.top.mainloop()
print(json.dumps(result), flush=True)
sys.exit(0 if result['passed'] else 1)
