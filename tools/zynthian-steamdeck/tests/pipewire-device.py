#!/usr/bin/env python3
"""CI-only JACK sink on a real PipeWire server, with hardware port flags.

This replaces physical speakers in headless CI. Synthesizers, routing, mixer,
and audio capture run normally. Never used by the application launcher.
"""
import signal
import threading

import jack

stop = threading.Event()
signal.signal(signal.SIGTERM, lambda *_: stop.set())
signal.signal(signal.SIGINT, lambda *_: stop.set())
with jack.Client('zynthian-test-output', no_start_server=True) as device:
    device.inports.register('playback_FL', is_physical=True, is_terminal=True)
    device.inports.register('playback_FR', is_physical=True, is_terminal=True)
    print('Test output ready', flush=True)
    stop.wait()
