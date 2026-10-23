# Zynthian in a Mac or Linux browser

This runs the repository's pinned stock Zynthian Oram touchscreen, engines,
MIDI router, sequencer and mixer in Docker. noVNC displays the real touchscreen;
a small JACK/WebSocket bridge carries stereo audio to Web Audio and browser
MIDI back through ZynMidiRouter. It is a playable runtime, separate from the
HTML control-map proposal.

## Start

Install and start Docker Desktop on macOS, or Docker Engine on Linux. The
launcher also needs Bash, Python 3 and curl. Apple Silicon uses native ARM64
Linux; Intel hosts use x86-64. Allow several GB for images and build cache.
The first start builds the images from the pinned source commits and needs
network access. Later starts reuse the existing container.

From the repository root:

```sh
bash tools/zynthian-web/zynthian-web start
```

Open the printed URL, including its access token. Click **Enable audio**.
Use the stock touchscreen to add an instrument chain, choose FluidSynth,
select FluidR3 GM and a preset. Click the piano below the touchscreen to play,
or focus it and use **A W S E D F T G Y H U J K**. The channel selector applies
to the browser piano. Click **Connect MIDI keyboard** in Chrome to grant
Web MIDI access to attached keyboards; hardware messages retain their channels.
Use Zynthian's normal chain/MIDI input settings for routing.

The stock interface also provides effects, sequencer, mixer and snapshots.
Only the engines listed in the [base runtime](../zynthian-steamdeck/README.md)
are installed. Save work using **Snapshot** before stopping the container.
Saved snapshots, presets, recordings and settings persist on the host.

```sh
bash tools/zynthian-web/zynthian-web stop
bash tools/zynthian-web/zynthian-web start
bash tools/zynthian-web/zynthian-web status
bash tools/zynthian-web/zynthian-web url
bash tools/zynthian-web/zynthian-web logs
```

One tab can own audio/MIDI at a time. **Disable audio** before transferring
playback to another tab. **All notes off**, losing piano focus, and disconnecting
the stream release held notes. A disconnected display can be reloaded.

## Data and access

On macOS, data lives in `~/Library/Application Support/crest-zynthian/`:

- `config/`: user configuration
- `user-data/`: snapshots, presets and recordings
- `logs/`: UI, JACK, display and browser server logs
- `access-token`: local browser access credential

Linux defaults to `${XDG_DATA_HOME:-~/.local/share}/crest-zynthian/`.
Set `ZYNTHIAN_WEB_DATA` to an absolute path before first start to use another
location. The launcher refuses to reuse a container mounted to a different
data directory, and never silently replaces an existing container.

Docker publishes only `127.0.0.1:8765`. WebSocket connections require the
generated access token and a matching localhost Origin. Host validation rejects
DNS rebinding. VNC has no published port. The browser removes the token from
the address bar after loading and retains it for that tab's session. Treat the
printed URL as a credential. This is a local runtime, not a public hosting setup.

To update, save work, stop the application and build the new image with
`bash tools/zynthian-web/zynthian-web build`. Explicitly remove the stopped
container with `docker rm crest-zynthian-web`, then run `start` again.
Removing the container does not remove host data. To roll back, retain/tag the
old Docker image before rebuilding and restore that tag before recreating the
container. Back up host data before changing runtime versions.

## Limits

Audio uses 48 kHz stereo with bounded buffering over a local WebSocket. JACK's
dummy backend supplies the container's clock; the browser plays through the
Mac's selected audio output. This adds VM and browser buffering and is not a
measured real-time latency guarantee. Browser audio permission requires the
**Enable audio** click. Chrome supports Web MIDI; Safari can use the on-screen
piano without Web MIDI.

Microphone/audio input, USB passthrough, webconf and Pi appliance administration
are not supplied. Engine algorithms and stock internal audio routing remain
unchanged. ARM64 VM tests do not validate a physical Raspberry Pi, Steam Deck,
USB device, thermal behavior or live performance latency.

## Reproduce checks

Build with `bash tools/zynthian-web/zynthian-web build`. Run the existing JACK
and PipeWire smoke commands from the base runtime README first, using the
result directory below. They create and recall a snapshot in fresh processes,
and test FluidSynth, Calf Reverb, MIDI routing, stereo audio and default outputs.

```sh
mkdir -p results/mac-web
docker run --rm --user 1000:1000 -e USER=ubuntu -e HOME=/tmp/zynthian-home \
  --shm-size=256m -v "$PWD/results/mac-web:/results" \
  localhost/zynthian-steamdeck:oram bash /opt/zynthian-steamdeck/tests/run-smoke.sh
docker run --rm --user 1000:1000 -e USER=ubuntu -e HOME=/tmp/zynthian-home \
  --shm-size=256m -v "$PWD/results/mac-web:/results" \
  localhost/zynthian-steamdeck:oram bash /opt/zynthian-steamdeck/tests/run-smoke.sh pipewire
docker run --rm --user 1000:1000 --shm-size=256m --tmpfs /data:mode=1777 \
  -v "$PWD/results/mac-web:/results" localhost/zynthian-web:oram \
  bash /opt/zynthian-web/tests/run-smoke.sh /results/jack/smoke.zss
```

The web test uses disposable data, restores that snapshot, checks authenticated
RFB negotiation, rejects invalid Host/Origin/token values and malformed MIDI,
sends notes through browser transport, captures real synth audio, and verifies
disconnect panic. It writes `web.json` and `web.wav`. Record the repository
commit, working-tree changes, image IDs and run timestamp alongside results.
The existing x86-64 Steam Deck CI and rootless installer checks remain separate.

noVNC and x11vnc come from Ubuntu packages; their source/license notices remain
in the image. Pinned Zynthian source commits and licenses remain unchanged.
