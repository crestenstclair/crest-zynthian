#!/usr/bin/env python3
import ctypes
import json
import os
from pathlib import Path
import platform
import shutil
import sys

if platform.machine() != 'x86_64': raise SystemExit('Requires x86_64')
root = Path(os.environ['ZYNTHIAN_DIR'])
for path in [root/'zyncoder/build/libzyncore.so'] + [root/f'zynthian-ui/zynlibs/{name}/build/lib{name}.so' for name in ('zynsmf', 'zynseq', 'zynmixer', 'zynaudioplayer')]:
    ctypes.CDLL(str(path))
for binary in ('fluidsynth', 'jalv', 'setBfree', 'zynaddsubfx'):
    if not shutil.which(binary): raise SystemExit(f'Missing {binary}')
import tkinter, PIL, liblo, lilv, jack, alsaaudio, usb, evdev, scipy, oyaml, ffmpeg
with jack.Client('zynthian_preflight', no_start_server=True) as client:
    out = client.get_ports(is_audio=True, is_physical=True, is_input=True)
    midi = client.get_ports(is_midi=True, is_output=True)
    if not out: raise SystemExit('PipeWire has no physical audio output ports')
    print(json.dumps({'architecture': platform.machine(), 'sample_rate': client.samplerate,
                      'buffer_frames': client.blocksize, 'outputs': [p.name for p in out],
                      'midi_sources': [p.name for p in midi]}, indent=2))
