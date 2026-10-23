#!/usr/bin/env python3
"""Create missing user files; preserve all existing configuration and snapshots."""
import json
import os
from pathlib import Path
import shutil

config = Path(os.environ['ZYNTHIAN_CONFIG_DIR'])
data = Path(os.environ['ZYNTHIAN_MY_DATA_DIR'])
system = Path(os.environ['ZYNTHIAN_SYS_DIR'])
for sub in ('', 'jalv', 'img', 'keybinding', 'setbfree', 'wiring-profiles'):
    (config / sub).mkdir(parents=True, exist_ok=True)
for sub in ('snapshots/000', 'capture', 'presets', 'presets/lv2', 'presets/zynaddsubfx', 'soundfonts/sf2', 'soundfonts/sfz',
            'midi-profiles', 'sequencer', 'audio', 'scripts', 'favorites'):
    (data / sub).mkdir(parents=True, exist_ok=True)
for source, dest in ((system/'config/default_midi_profile.sh', data/'midi-profiles/default.sh'),
                     (system/'config/keybinding', config/'keybinding'),
                     (system/'config/wiring-profiles', config/'wiring-profiles')):
    if source.is_dir():
        for f in source.iterdir():
            if f.is_file() and not (dest/f.name).exists():
                shutil.copy2(f, dest/f.name)
    elif source.is_file() and not dest.exists():
        shutil.copy2(source, dest)
(config/'zynthian_envars.sh').touch(exist_ok=True)
# Ship the installed engines, not a menu full of unavailable Pi programs.
engine_config = config/'engine_config.json'
if not engine_config.exists():
    engines = json.loads((system/'config/engine_config.json').read_text())
    standalone = {'FS', 'ZY', 'BF', 'SL', 'AP', 'MC', 'SX'}
    for key, engine in engines.items():
        engine['ENABLED'] = key in standalone or key.startswith('JV/Calf ')
        engine['EDIT'] = 1
    engine_config.write_text(json.dumps(engines, indent=2) + '\n')
