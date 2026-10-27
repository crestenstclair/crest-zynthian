#!/usr/bin/env python3
"""Verify cached port metadata preserves dynamic JACK latency reporting.

Start a JACK server first. No plugin firmware or private product is required.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

jalv, output = sys.argv[1], Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=False)
bundle = output / 'lv2' / 'LatencyProbe.lv2'
bundle.mkdir(parents=True)
subprocess.run(['cc', '-std=c11', '-shared', '-fPIC', '-O2',
                str(Path(__file__).with_name('latency-probe.c')),
                '-o', str(bundle / 'probe.so')], check=True)
uri = 'urn:crest-zynthian:test:latency-probe'
(bundle / 'manifest.ttl').write_text(f'''
@prefix lv2: <http://lv2plug.in/ns/lv2core#> .
@prefix doap: <http://usefulinc.com/ns/doap#> .
<{uri}> a lv2:Plugin ; doap:name "Latency Probe" ; lv2:binary <probe.so> ;
  lv2:port [ a lv2:OutputPort, lv2:AudioPort ; lv2:index 0 ;
    lv2:symbol "out" ; lv2:name "Output" ],
  [ a lv2:InputPort, lv2:ControlPort ; lv2:index 1 ;
    lv2:symbol "delay" ; lv2:name "Reported delay" ;
    lv2:default 0 ; lv2:minimum 0 ; lv2:maximum 4096 ],
  [ a lv2:OutputPort, lv2:ControlPort ; lv2:index 2 ;
    lv2:symbol "latency" ; lv2:name "Latency" ;
    lv2:designation lv2:latency ; lv2:portProperty lv2:reportsLatency, lv2:integer ;
    lv2:minimum 0 ; lv2:maximum 4096 ],
  [ a lv2:OutputPort, lv2:ControlPort ; lv2:index 3 ;
    lv2:symbol "meter" ; lv2:name "Unrelated output" ;
    lv2:minimum 0 ; lv2:maximum 4096 ] .
''')
env = dict(os.environ, LV2_PATH=str(bundle.parent), PWD=str(output))
log = output / 'jalv.log'
records = []
with log.open('w') as stream:
    process = subprocess.Popen([jalv, '-n', 'latency-probe', uri],
                               stdin=subprocess.PIPE, stdout=stream,
                               stderr=subprocess.STDOUT, text=True, env=env, cwd=output)
    try:
        deadline = time.monotonic() + 15
        while 'CLI thread created' not in log.read_text():
            if process.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError('Jalv did not start: ' + log.read_text()[-2000:])
            time.sleep(.02)
        for value in (0, 37, 257, 0):
            process.stdin.write(f'set delay {value}\n')
            process.stdin.flush()
            deadline = time.monotonic() + 5
            while True:
                listing = subprocess.run(['jack_lsp', '-l'], env=env, check=True,
                                         text=True, capture_output=True, timeout=5).stdout
                match = re.search(r'^latency-probe:out\n\s*port playback latency = \[ (\d+) (\d+) \] frames',
                                  listing, re.MULTILINE)
                if match and tuple(map(int, match.groups())) == (value, value):
                    records.append(dict(requested=value, reported=list(map(int, match.groups()))))
                    break
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError(f'Latency did not become {value}: {listing}')
                time.sleep(.02)
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
result = dict(passed=True, latency_changes=records, unrelated_output_control=999)
(output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
