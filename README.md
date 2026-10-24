# crest-zynthian

Public Zynthian host designs and native Linux runtime packaging.

- [Steam Deck / Linux x86-64 build and installation](tools/zynthian-steamdeck/README.md)
- [Controller interface: Node / HTML, separate runtime](tools/zynthian-controller/README.md)
- [Playable Mac / Linux browser runtime](tools/zynthian-web/README.md)
- [Interactive control-map design](design/firmware-control-map.html)
- [Rig, routing and control-surface design](docs/RIG-DESIGN.md)
- [Builds, installer bundles and test evidence](https://github.com/crestenstclair/crest-zynthian/actions/workflows/zynthian-steamdeck.yml)
- [Repository move and provenance](docs/REPOSITORY-MOVE.md)

## Mac browser runtime

Start Docker Desktop, then run `bash tools/zynthian-web/zynthian-web start`.
Open the printed local URL and click **Enable audio**. This runs the stock
Zynthian touchscreen and engines with browser audio, an on-screen piano and
optional Web MIDI keyboard input. Apple Silicon builds run natively as Linux
ARM64. Configuration, snapshots and recordings stay on the Mac. See the
[browser guide](tools/zynthian-web/README.md) for setup, controls and limits.

## Steam Deck runtime

The runtime packages the stock Zynthian Oram touchscreen UI, native MIDI router,
sequencer, mixer and sampler, with FluidSynth, ZynAddSubFX, setBfree,
SooperLooper and Calf effects. It uses Podman/Distrobox and the host's PipeWire
server. It does not replace SteamOS or install packages into its system image.

The workflow builds on `main`, tests JACK and PipeWire audio/MIDI, LV2 effects,
fresh-process snapshot recall and rootless installation, then publishes an
installer artifact. Download `zynthian-steamdeck-x86_64` from a successful run
and follow the installation guide. Physical Steam Deck touchscreen, Gaming Mode,
USB MIDI, latency, suspend/resume and thermal validation remain outstanding.

## Develop or preview

```sh
git clone https://github.com/crestenstclair/crest-zynthian.git
cd crest-zynthian
```

Open `design/firmware-control-map.html` directly in a browser; it works offline
and needs no build step. It proposes control pages and routing, not implemented
instrument support. On Windows, editing and viewing the HTML works normally;
runtime scripts require Linux. Use the x86-64 Actions runner or a suitable Linux
container environment for the runtime build, not PowerShell directly.

For a local Linux x86-64 runtime build:

```sh
cd tools/zynthian-steamdeck
docker build -t localhost/zynthian-steamdeck:oram -f Containerfile .
```

See the runtime README for smoke tests and install requirements. Preserve the
source pins in `sources.lock.json`; building requires network access. Git LFS,
pedal firmware, private plugin sources and a sibling repository are not required.

## Ownership and scope

This repository owns Zynthian host packaging, Steam Deck/Linux integration,
the public HTML design and general rig plans. Private Crest Pedal DSP, firmware,
plugin builds, validation records and the detailed pedal migration inventory
remain in their existing private repository. Do not import them here.

The Steam Deck package currently includes upstream engines, not private Crest
Pedal plugins. Raspberry Pi LV2 integration is a separate target: an x86-64
desktop CI pass does not establish Pi compatibility or real-time performance.
Upstream Zynthian components, dependencies and bundled data retain their
respective licenses; see the runtime README and sources retained in the image.
