#!/usr/bin/env python3
"""Reuse the repository's browser display/audio transport on the controller port."""
import importlib.util
import os
from pathlib import Path

spec = importlib.util.spec_from_file_location("browser_transport", "/opt/zynthian-web/server.py")
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
port = int(os.environ.get('CONTROLLER_PORT', '8766'))
transport.ALLOWED_HOSTS = {f"localhost:{port}", f"127.0.0.1:{port}"}
class ControllerAudio(transport.BrowserAudio):
    def connect_mixer(self):
        # This supplied backend has separate channel and bus mixers.
        outputs = self.client.get_ports(r'^zynmixer_bus:output_00[ab]$', is_audio=True, is_output=True)
        for source, destination in zip(sorted(outputs, key=lambda p: p.name), self.inputs):
            if source not in self.client.get_all_connections(destination):
                self.client.connect(source, destination)
        return len(outputs) == 2

secret = Path('/data/access-token').read_text().strip()
if len(secret) < 32:
    raise SystemExit('Missing local access token')
transport.web.run_app(transport.make_app(ControllerAudio(), secret),
                      host='127.0.0.1', port=8767, access_log=None, shutdown_timeout=3)
