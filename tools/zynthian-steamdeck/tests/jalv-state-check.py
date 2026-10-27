#!/usr/bin/env python3
"""Prove JACK run/restore exclusion with real Jalv and a test-only LV2.

Source the runtime environment and start a JACK server first. The fixture deliberately yields inside callbacks
to expose overlap; this is a synchronization check, not a latency benchmark.
"""
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import time
from rdflib import Graph, URIRef

URI = 'urn:crest-zynthian:test:state-guard'
jalv, output = sys.argv[1], Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=False)
bundle = output / 'lv2' / 'StateGuard.lv2'
bundle.mkdir(parents=True)
(bundle / 'resource.bin').write_bytes(struct.pack('<i', 0x12345678))
subprocess.run(['cc', '-std=c11', '-shared', '-fPIC', '-O2',
                str(Path(__file__).with_name('state-guard.c')),
                '-o', str(bundle / 'guard.so')], check=True)
(bundle / 'manifest.ttl').write_text(f'''
@prefix lv2: <http://lv2plug.in/ns/lv2core#> .
@prefix state: <http://lv2plug.in/ns/ext/state#> .
@prefix urid: <http://lv2plug.in/ns/ext/urid#> .
@prefix doap: <http://usefulinc.com/ns/doap#> .
@prefix pset: <http://lv2plug.in/ns/ext/presets#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<{URI}> a lv2:Plugin ; doap:name "State Guard" ; lv2:binary <guard.so> ;
  lv2:requiredFeature urid:map ; lv2:extensionData state:interface ;
  lv2:port [ a lv2:OutputPort, lv2:AudioPort ; lv2:index 0 ;
             lv2:symbol "out" ; lv2:name "Output" ],
           [ a lv2:InputPort, lv2:ControlPort ; lv2:index 1 ;
             lv2:symbol "value" ; lv2:name "Value" ;
             lv2:default 0.0 ; lv2:minimum -1000.0 ; lv2:maximum 1000.0 ] .
<{URI}:preset> a pset:Preset ; lv2:appliesTo <{URI}> ;
  rdfs:label "Guard preset" ; state:state [ <{URI}#token> 1 ] .
''')
env = dict(os.environ, LV2_PATH=str(bundle.parent), PWD=str(output))
log = output / 'jalv.log'


def wait_for(process, marker, offset=0):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if marker in log.read_text()[offset:]:
            return
        if process.poll() is not None:
            raise RuntimeError('Jalv exited: ' + log.read_text()[-2000:])
        time.sleep(.01)
    raise RuntimeError('Jalv timed out waiting for ' + marker)


with log.open('w') as stream:
    process = subprocess.Popen([jalv, '-n', 'state-guard', URI], stdin=subprocess.PIPE,
                               stdout=stream, stderr=subprocess.STDOUT,
                               text=True, env=env, cwd=output)
    try:
        wait_for(process, 'CLI thread created')
        for value in (1e-9, 3060 / 4095, 123.456789, -1e-7):
            offset = log.stat().st_size
            process.stdin.write(f'set value {value:.9g}\ncontrols\n')
            process.stdin.flush()
            wait_for(process, '#value=', offset)
            received = float(re.findall(r'#value=([^\s]+)', log.read_text()[offset:])[-1])
            if struct.pack('f', received) != struct.pack('f', value):
                raise RuntimeError(f'Numeric readback lost float precision: {received} != {value}')
        for cycle in range(16):
            offset = log.stat().st_size
            name = f'Guard{cycle}'
            process.stdin.write(f'preset {URI}:preset\nsave preset {name}\n')
            process.stdin.flush()
            wait_for(process, f'({name})', offset)
        state = Graph().parse(next(output.glob('*.presets.lv2/Guard15.ttl')))
        overlaps = int(next(state.objects(None, URIRef(URI + '#overlaps'))))
        restores = int(next(state.objects(None, URIRef(URI + '#restores'))))
        def state_command(action, path, token, status=0):
            offset = log.stat().st_size
            process.stdin.write(f'state {action} {token} {path}\n')
            process.stdin.flush()
            wait_for(process, f'#STA> {token} {status}', offset)

        saved = output / 'unsaved-state'
        saved.mkdir()
        state_command('save', saved, 'a1')
        saved_graph = Graph().parse(saved / 'state.ttl')
        memory_key = URIRef(URI + '#memory')
        memory = int(next(saved_graph.objects(None, memory_key)))
        # Move the complete bundle and remove its original asset. Restore must
        # use the embedded copy, not an absolute source path or dangling link.
        sys.path.insert(0, str(Path(os.environ['ZYNTHIAN_UI_DIR']) / 'zyngine'))
        from zynthian_lv2_state import pack_state, unpack_state
        packed = pack_state(saved)
        relocated = output / 'relocated-state'
        relocated.mkdir()
        relocated_state = unpack_state(packed, relocated)
        (bundle / 'resource.bin').unlink()
        process.stdin.write(f'preset {URI}:preset\n')
        process.stdin.flush()
        state_command('load', relocated_state, 'a2')
        recalled = output / 'recalled-state'
        recalled.mkdir()
        state_command('save', recalled, 'a3')
        recalled_graph = Graph().parse(recalled / 'state.ttl')
        if int(next(recalled_graph.objects(None, memory_key))) != memory:
            raise RuntimeError('Unsaved opaque state did not survive restore')
        if int(next(recalled_graph.objects(None, URIRef(URI + '#asset_value')))) != 0x12345678:
            raise RuntimeError('Embedded resource did not survive source removal')
        if int(next(recalled_graph.objects(None, URIRef(URI + '#overlaps')))) != 0:
            raise RuntimeError('Snapshot state restore overlapped audio')
        wrong = output / 'wrong-plugin.ttl'
        wrong.write_text((saved / 'state.ttl').read_text().replace(URI, 'urn:wrong-plugin'))
        state_command('load', wrong, 'a4', 1)
        result = dict(passed=overlaps == 0 and restores >= 16,
                      overlapping_callbacks=overlaps, restores=restores,
                      numeric_float_readback=True, unsaved_opaque_recall=True,
                      embedded_resource_relocated=True,
                      wrong_plugin_rejected=True)
        (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
        if not result['passed']:
            raise RuntimeError('Jalv ran audio concurrently with unsafe state restore')
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
