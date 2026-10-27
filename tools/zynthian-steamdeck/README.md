# Stock Zynthian Oram on Steam Deck

Maintained in [crest-zynthian](https://github.com/crestenstclair/crest-zynthian).
Use this repository's [Actions builds](https://github.com/crestenstclair/crest-zynthian/actions/workflows/zynthian-steamdeck.yml)
for installer bundles and test evidence. Run the source build commands below
from `tools/zynthian-steamdeck/`.

Native Linux x86-64 packaging of the upstream Zynthian interface, MIDI router,
sequencer, mixer and sampler. Uses the existing touchscreen interface at
1280 × 800 in fullscreen. No controller mapping, webview or replacement UI.

For macOS, the [browser runtime](../zynthian-web/README.md) extends this image
with noVNC and a browser audio/MIDI bridge. Its ARM64 build uses a native
Tkhtml wheel with the same TkinterWeb 3.x API. The Steam Deck launcher remains
an x86-64 host integration using the host's PipeWire server.

## Status

Physical Steam Deck hardware validation remains outstanding. The CI workflow produces an
installer bundle only after the stock UI, FluidSynth audio through the Zynthian
MIDI router and mixer, Calf Reverb in Zynthian's Jalv, and a fresh-process
snapshot restore pass on both JACK and PipeWire. The tests also check the
default output connection, then install the bundle with rootless Podman and
Distrobox and check the connection to a host PipeWire server. See the workflow's evidence artifact for logs, WAVs,
screenshots and numeric results.

## Install on SteamOS

Use Desktop Mode. Requires `podman` and `distrobox`; check `command -v podman distrobox`. If unavailable, follow the upstream
[Distrobox Steam Deck setup](https://distrobox.it/posts/steamdeck_guide/).
Do not disable SteamOS read-only mode or install these Ubuntu packages on the host.

1. Download the `zynthian-steamdeck-x86_64` artifact from the successful
   **Zynthian Steam Deck** Actions run and extract it.
2. In that folder run `bash install.sh` as the normal `deck` user.
3. Open **Zynthian** in the application menu. Use the stock touchscreen controls.

The installer verifies and loads the compressed prebuilt image and creates a user
Distrobox container using Podman.
When run from source without the image archive, it builds the same Containerfile
locally first. Installation needs free space for the archive, image and container;
allow several GB. The first run of Distrobox may install its user integration.

To launch from Gaming Mode, add `~/.local/bin/zynthian-steamdeck` to Steam as a
non-Steam game. Physical Deck touchscreen, Gaming Mode, USB MIDI, latency and
suspend/resume still require device testing. Desktop Mode is the first target.

## Included

- Pinned Oram UI, zyncoder, system configuration and factory data.
- Native zyncore, zynseq, zynsmf, zynmixer and zynaudioplayer.
- Zynthian's patched libsndfile (loop metadata) and asynchronous Jalv host.
- FluidSynth + FluidR3 GM, ZynAddSubFX, setBfree, SooperLooper and Calf LV2 effects.
- Standard snapshot, ZS3, MIDI routing, sequencer and mixer UI.

This is a desktop runtime subset, not every engine/sample pack in a Pi SD image.
Pianoteq, LinuxSampler, Sfizz, MOD-UI, webconf, Raspberry Pi system administration
and optional network MIDI services are not supplied. The configured engine list
only enables the installed standalone engines and Calf effects. Existing user
engine configuration is preserved.

## Audio and persistence

The launcher uses `pw-jack` against the host's existing PipeWire socket and asks
for 256 frames at 48 kHz. The actual graph rate/quantum are selected by PipeWire;
this request is not a measured latency guarantee. It does not stop PipeWire,
start a competing JACK server or take exclusive control of the ALSA device.

The container's PipeWire JACK client configuration enables
[`jack.default-as-system`](https://docs.pipewire.org/page_man_pipewire-jack_conf_5.html)
to expose the default SteamOS devices with the port names that unmodified
Zynthian audio routing expects. Choose speakers, headphones or USB audio as the
default device in SteamOS. The source patch fixes native printf portability and
uses Pillow's current name for the same image resampling filter. Physical LED
drivers are imported only when physical LEDs are initialized, allowing stock
touchscreen mode to run without Pi SPI libraries. A fullscreen window flag fits
the standard UI to the Deck display. The title timeout runs on Tk's event loop
so it cannot keep Python waiting for a closed UI during shutdown. The autoconnect
JACK client is explicitly closed on shutdown. Mixer, sequencer and MIDI-file
callbacks stop before their buffers and objects are released. Autoconnect waits
for both audio-player ports to appear on PipeWire before connecting them.
Snapshots and ZS3 embed the current LV2 state bundle, including unsaved opaque
state and any resources copied by Lilv. Saving does not create a user preset or
change the selected preset's identity. Recall applies controller mappings first,
then restores the captured state after queued controls have completed. Older
snapshots without an embedded bundle keep the selected-preset/controller path.
New embedded state requires this patched runtime; older runtimes ignore it.
The host briefly pauses plugin processing while capturing or restoring a bundle.
Archives are limited to 512 MiB of decoded files and 4096 resources; invalid
paths, links and duplicate names are rejected. Capture failure preserves the
previous ZS3; state restore failure is reported instead of accepting partial
opaque recall. Restored resources remain available until the engine replaces
that state or stops. This captures only what the plugin's state interface saves;
volatile DSP history is not added by the host.
Jalv completes its current JACK callback and queued controls before acknowledging
a pause for non-thread-safe LV2 state restoration. The regression fixture checks
that audio processing and state restoration never overlap, including through
PipeWire's JACK interface.
Jalv caches each control port’s immutable latency designation during setup,
so its JACK callback does not query or allocate RDF metadata every cycle.
Reported plugin latency still updates when the output control value changes.
Jalv readback and controller commands preserve all significant digits of an
LV2 float. Snapshot replay therefore does not round small values to zero or
change saved parameters by truncating controls to six decimal places.
Native engine algorithms, audio routing decisions and menu
structure are unchanged.

- Config: `~/.config/zynthian`
- User presets, snapshots and recordings: `~/.local/share/zynthian`
- Log: `~/.local/state/zynthian/session.log`
- Diagnostic: `~/.local/bin/zynthian-steamdeck --check`

Stock appliance power/reboot exit codes close the application. The Pi boot,
network, service and shutdown wrapper is never run. Configure SteamOS audio,
Wi-Fi and Bluetooth using SteamOS settings.

Removing the `zynthian-steamdeck` Distrobox container and the two installed
launcher files removes the application. User data is retained. For an update,
close Zynthian and remove the old container explicitly before rerunning the
installer; it will not silently replace an existing container.

## Reproduce and validate

```
docker build -t localhost/zynthian-steamdeck:oram -f Containerfile .
mkdir -p results
docker run --rm --shm-size=256m -v "$PWD/results:/results" \
  localhost/zynthian-steamdeck:oram bash /opt/zynthian-steamdeck/tests/run-smoke.sh
docker run --rm --shm-size=256m -v "$PWD/results:/results" \
  localhost/zynthian-steamdeck:oram bash /opt/zynthian-steamdeck/tests/run-smoke.sh pipewire
```

`tests/run-smoke.sh` uses JACK's dummy hardware backend at 48 kHz / 256 frames
and Xvfb. Its `pipewire` mode uses a private PipeWire server and virtual output
to test the same JACK compatibility configuration used on SteamOS. Synthesizer DSP, MIDI routing, LV2 processing and captured audio are
real. It tests functional software integration; it cannot measure Deck speakers,
USB device compatibility, hardware latency or sustained thermal performance.

`sources.lock.json` pins every Zynthian source checkout. Ubuntu dependencies
come from the image's apt repositories; package versions are not yet frozen.
All upstream source and licenses remain inside the image, alongside the patch.
Zynthian components retain their upstream GPL licenses, Jalv its ISC license,
libsndfile its LGPL license, and bundled data/fonts their respective licenses.
