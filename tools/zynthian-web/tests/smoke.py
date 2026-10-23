"""Exercise HTTP/RFB, browser MIDI through ZynMidiRouter, stereo audio and panic."""
import asyncio
import json
from pathlib import Path
import sys
import time

import aiohttp
import numpy as np
import soundfile as sf

sys.path.insert(0, '/opt/zynthian-web')
from server import MidiMessage

BASE = 'http://localhost:8765'
ORIGIN = {'Origin': BASE}
TOKEN = Path('/data/access-token').read_text().strip()


async def capture(socket, seconds):
    chunks = []
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        message = await asyncio.wait_for(socket.receive(), 3)
        assert message.type == aiohttp.WSMsgType.BINARY, message
        chunks.append(np.frombuffer(message.data, dtype='<f4').reshape(-1, 2))
    return np.concatenate(chunks)


async def wait_ready(client):
    for _ in range(120):
        try:
            async with client.get(BASE + '/health') as response:
                if (await response.json())['ready']:
                    await asyncio.sleep(6)  # Snapshot engines load after mixer publication.
                    return
        except (aiohttp.ClientError, KeyError):
            pass
        await asyncio.sleep(1)
    raise RuntimeError('Web runtime did not become ready')


async def check_access(client):
    for headers, token in [(ORIGIN, ''), ({'Origin': 'https://example.com'}, TOKEN), ({}, TOKEN)]:
        async with client.get(BASE + '/stream?token=' + token, headers=headers) as response:
            assert response.status == 403, response.status
    async with client.get(BASE + '/health', headers={'Host': 'attacker.example:8765'}) as response:
        assert response.status == 403
    async with client.ws_connect(BASE + '/vnc?token=' + TOKEN, headers=ORIGIN, protocols=['binary']) as socket:
        version = await socket.receive_bytes(timeout=3)
        assert version.startswith(b'RFB 003.'), version
        await socket.send_bytes(b'RFB 003.008\n')
        security = await socket.receive_bytes(timeout=3)
        assert 1 in security[1:], security
        await socket.send_bytes(b'\x01')
        assert await socket.receive_bytes(timeout=3) == b'\x00\x00\x00\x00'
        await socket.send_bytes(b'\x01')
        screen = await socket.receive_bytes(timeout=3)
        assert int.from_bytes(screen[:2], 'big') == 1280
        assert int.from_bytes(screen[2:4], 'big') == 800


async def check_audio(client):
    address = BASE + '/stream?token=' + TOKEN
    async with client.ws_connect(address, headers=ORIGIN) as socket:
        assert await socket.receive_json() == {'sampleRate': 48000, 'channels': 2}
        async with client.get(address, headers=ORIGIN) as response:
            assert response.status == 409
        await capture(socket, 0.3)
        await socket.send_json([0x90, 60, 100])
        audio = await capture(socket, 1.5)
        await socket.send_json([0x80, 60, 0])
        audio = np.concatenate([audio, await capture(socket, 1.5)])
        assert np.isfinite(audio).all()
        rms = float(np.sqrt(np.mean(audio ** 2)))
        peak = float(np.max(np.abs(audio)))
        assert 0.0001 < rms and peak < 1.0, (rms, peak)
        sf.write('/results/web.wav', audio, 48000)
        await socket.send_json([0x90, 64, 100])
        await capture(socket, 0.2)  # Disconnect with a held note; server must release it.
    await asyncio.sleep(4)
    async with client.ws_connect(address, headers=ORIGIN) as socket:
        await socket.receive_json()
        silence = await capture(socket, 0.5)
        panic_rms = float(np.sqrt(np.mean(silence ** 2)))
        assert panic_rms < 0.0001, panic_rms
        await socket.send_json([0x90, 128, 100])
        # Audio may already be queued before the invalid message is processed.
        while (message := await socket.receive(timeout=3)).type == aiohttp.WSMsgType.BINARY:
            pass
        assert socket.close_code == 1008, socket.close_code
    return {'rms': rms, 'peak': peak, 'disconnect_panic_rms': panic_rms}


async def check_concurrent_ownership(client):
    results = await asyncio.gather(
        client.ws_connect(BASE + '/stream?token=' + TOKEN, headers=ORIGIN),
        client.ws_connect(BASE + '/stream?token=' + TOKEN, headers=ORIGIN),
        return_exceptions=True)
    winners = [result for result in results if isinstance(result, aiohttp.ClientWebSocketResponse)]
    rejected = [result for result in results if isinstance(result, aiohttp.WSServerHandshakeError)]
    assert len(winners) == 1 and len(rejected) == 1 and rejected[0].status == 409, results
    await winners[0].close()
    await asyncio.sleep(0.1)


def check_midi_validation():
    for values in ([0x90, 60, 100], [0xC0, 0], [0xF8]):
        assert MidiMessage(values) == bytes(values)
    for values in ([], [0x90, -1, 0], [0x90, True, 0], [0xF0, 1, 0xF7], [0x90, 60], 'panic', [0x90, 60, 128]):
        try:
            MidiMessage(values)
        except ValueError:
            continue
        raise AssertionError(f'Accepted invalid MIDI: {values}')


async def main():
    check_midi_validation()
    async with aiohttp.ClientSession() as client:
        await wait_ready(client)
        await check_access(client)
        await check_concurrent_ownership(client)
        result = await check_audio(client)
    result.update(passed=True, sample_rate=48000, display='1280x800',
                  checks=['RFB handshake', 'origin/host/token rejection', 'MIDI validation',
                          'single audio owner', 'MIDI synth audio', 'disconnect panic'])
    Path('/results/web.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)


asyncio.run(main())
