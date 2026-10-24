#!/usr/bin/env python3
"""Capture the native sequencer's real engine output through Zynthian's main mixbus."""
import json
import queue
import sys
import time
import wave
import jack
import numpy as np

frames = queue.Queue()
client = jack.Client('controller_audio_test', no_start_server=True)
ports = [client.inports.register(name) for name in ('left', 'right')]
@client.set_process_callback
def capture(count):
    frames.put(np.column_stack([port.get_array().copy() for port in ports]))
client.activate()
for name, target in zip(('a', 'b'), ports):
    client.connect(f'zynmixer_bus:output_00{name}', target)
time.sleep(4)
client.deactivate()
client.close()
blocks = []
while not frames.empty():
    blocks.append(frames.get_nowait())
audio = np.concatenate(blocks)
assert np.isfinite(audio).all(), 'Non-finite audio samples'
rms = float(np.sqrt(np.mean(audio ** 2)))
peak = float(np.max(np.abs(audio)))
with wave.open(sys.argv[1], 'wb') as output:
    output.setnchannels(2)
    output.setsampwidth(2)
    output.setframerate(48000)
    output.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
print(json.dumps({'rms': rms, 'peak': peak, 'frames': len(audio)}))
assert rms > 0.0001, 'Sequencer produced silence'
assert peak < 1, 'Audio clipped'
