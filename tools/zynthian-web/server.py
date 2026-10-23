#!/usr/bin/env python3
"""Local browser transport for the unchanged Zynthian display and JACK graph."""
import asyncio
from contextlib import suppress
import hmac
import json
from pathlib import Path
import queue

from aiohttp import web, WSMsgType
import jack
import numpy as np

STATIC = Path(__file__).parent / 'static'
ALLOWED_HOSTS = {'localhost:8765', '127.0.0.1:8765'}


class MidiMessage(bytes):
    """A complete channel message or supported transport byte; never SysEx."""

    def __new__(cls, values):
        if not isinstance(values, list) or not values or any(type(v) is not int for v in values):
            raise ValueError('Expected MIDI byte array')
        status = values[0]
        if status in (0xF8, 0xFA, 0xFB, 0xFC) and len(values) == 1:
            return super().__new__(cls, values)
        length = 2 if 0xC0 <= status <= 0xDF else 3
        if not 0x80 <= status <= 0xEF or len(values) != length:
            raise ValueError('Unsupported MIDI message')
        if any(not 0 <= value <= 127 for value in values[1:]):
            raise ValueError('MIDI data byte outside 0..127')
        return super().__new__(cls, values)


class BrowserAudio:
    """One browser owns playback/MIDI; bounded queues discard stale audio."""

    def __init__(self):
        self.client = jack.Client('zynthian_browser', no_start_server=True)
        self.inputs = [self.client.inports.register(name) for name in ('left', 'right')]
        self.midi = self.client.midi_outports.register('midi', is_physical=True)
        self.audio = queue.Queue(maxsize=8)
        self.messages = queue.Queue(maxsize=1024)
        self.listening = False
        self.panic_pending = False
        self.client.set_process_callback(self.process)
        self.client.activate()

    def process(self, frames):
        self.midi.clear_buffer()
        if self.panic_pending:
            self.write_panic()
            self.panic_pending = False
        for _ in range(64):
            try:
                self.midi.write_midi_event(0, self.messages.get_nowait())
            except queue.Empty:
                break
        if not self.listening:
            return
        samples = np.column_stack([port.get_array() for port in self.inputs]).astype('<f4').tobytes()
        with suppress(queue.Full):
            self.audio.put_nowait(samples)

    def write_panic(self):
        for channel in range(16):
            self.midi.write_midi_event(0, bytes((0xB0 + channel, 64, 0)))
            self.midi.write_midi_event(0, bytes((0xB0 + channel, 120, 0)))
            self.midi.write_midi_event(0, bytes((0xB0 + channel, 123, 0)))

    def panic(self):
        while not self.messages.empty():
            with suppress(queue.Empty):
                self.messages.get_nowait()
        self.panic_pending = True

    def connect_mixer(self):
        """Follow the existing main mixer outputs, including after a UI restart."""
        outputs = self.client.get_ports(r'^zynmixer:output_17[ab]$', is_audio=True, is_output=True)
        for source, destination in zip(sorted(outputs, key=lambda p: p.name), self.inputs):
            if source not in self.client.get_all_connections(destination):
                self.client.connect(source, destination)
        return len(outputs) == 2

    async def send_audio(self, socket):
        while not socket.closed:
            if not self.connect_mixer():
                await asyncio.sleep(0.1)
                continue
            packets = []
            for _ in range(4):
                with suppress(queue.Empty):
                    packets.append(self.audio.get_nowait())
            if packets:
                await asyncio.wait_for(socket.send_bytes(b''.join(packets)), timeout=2)
            await asyncio.sleep(0.01)

    async def stream(self, request):
        if self.listening:
            raise web.HTTPConflict(text='Audio is already open in another tab. Disable it there first.')
        socket = web.WebSocketResponse(heartbeat=10, max_msg_size=256)
        # Reserve ownership before the handshake yields to a competing request.
        self.listening = True
        sender = None
        try:
            await socket.prepare(request)
            sender = asyncio.create_task(self.send_audio(socket))
            sender.add_done_callback(lambda task: asyncio.create_task(socket.close()))
            await socket.send_json({'sampleRate': self.client.samplerate, 'channels': 2})
            async for message in socket:
                if message.type != WSMsgType.TEXT:
                    continue
                data = json.loads(message.data)
                if data == 'panic':
                    self.panic()
                else:
                    self.messages.put_nowait(MidiMessage(data))
        except (ValueError, queue.Full):
            await socket.close(code=1008, message=b'Invalid MIDI message or input overflow')
        finally:
            self.panic()
            if sender:
                sender.cancel()
                with suppress(asyncio.CancelledError, ConnectionError, asyncio.TimeoutError):
                    await sender
            while not self.audio.empty():
                with suppress(queue.Empty):
                    self.audio.get_nowait()
            self.listening = False
        return socket

    def close(self):
        self.client.deactivate()
        self.client.close()


async def display(request):
    """Proxy authenticated binary RFB to loopback-only x11vnc."""
    reader, writer = await asyncio.open_connection('127.0.0.1', 5900)
    socket = web.WebSocketResponse(protocols=('binary',), heartbeat=10, max_msg_size=1024 * 1024)
    await socket.prepare(request)

    async def from_display():
        while data := await reader.read(65536):
            await socket.send_bytes(data)
        await socket.close()

    sender = asyncio.create_task(from_display())
    try:
        async for message in socket:
            if message.type == WSMsgType.BINARY:
                writer.write(message.data)
                await writer.drain()
    finally:
        sender.cancel()
        with suppress(asyncio.CancelledError, ConnectionError):
            await sender
        writer.close()
        await writer.wait_closed()
    return socket


def make_app(audio, token):
    @web.middleware
    async def local_access(request, handler):
        if request.host not in ALLOWED_HOSTS:
            raise web.HTTPForbidden(text='Localhost access only')
        origin = request.headers.get('Origin')
        if origin and origin != f'http://{request.host}':
            raise web.HTTPForbidden(text='Cross-origin access denied')
        if request.path in ('/vnc', '/stream'):
            if origin is None or not hmac.compare_digest(request.query.get('token', ''), token):
                raise web.HTTPForbidden(text='Open the URL printed by zynthian-web start')
        response = await handler(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['X-Frame-Options'] = 'DENY'
        return response

    async def index(request):
        return web.FileResponse(STATIC / 'index.html')

    async def health(request):
        return web.json_response({'ready': audio.connect_mixer()})

    async def shutdown(app):
        audio.close()

    app = web.Application(middlewares=[local_access])
    app.router.add_get('/', index)
    app.router.add_get('/health', health)
    app.router.add_get('/vnc', display)
    app.router.add_get('/stream', audio.stream)
    app.router.add_static('/static/', STATIC)
    app.router.add_static('/novnc/', '/usr/share/novnc')
    app.on_cleanup.append(shutdown)
    return app


if __name__ == '__main__':
    secret = Path('/data/access-token').read_text().strip()
    if len(secret) < 32:
        raise SystemExit('Missing local access token')
    # Access logs would expose WebSocket query tokens.
    web.run_app(make_app(BrowserAudio(), secret), host='0.0.0.0', port=8765,
                access_log=None, shutdown_timeout=3)
