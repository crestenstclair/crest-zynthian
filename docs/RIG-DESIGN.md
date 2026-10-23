# Zynthian rig and control design

The [interactive control map](../design/firmware-control-map.html) proposes a
shared control order for Zynthian instruments and effects, with optional Push,
OXI and Tracker mappings. It is a design reference, not a plugin implementation
or evidence that the listed instruments are available in this runtime.

## Host and physical connections

For a Raspberry Pi rig, the design assumes a Pi 5 with Pisound, subject to image
and hardware validation. Standard Pisound supplies one stereo input pair, one
stereo output pair and DIN MIDI in/out. All engines on that Pi share those
connections. Additional independent stereo sends/returns need more audio I/O
or another Pi. The Steam Deck runtime is a separate x86-64 host using PipeWire.

Instruments receive MIDI and generate audio. Effects receive audio from a
previous processor or physical input. External send/return effects should use
a wet-only chain and let the source mixer blend the result. Multiple external
sources need a mixer or explicit input selection before the shared input pair.

Choose one clock leader and configure MIDI destinations explicitly. A MIDI
output socket does not establish that an engine emits usable MIDI or that a
receiving chain is connected. Verify each route in the actual host.

## Controls and recall

Prefer Zynthian's native parameter pages and named presets. The optional
16-control surface groups controls into four rows of four. Push can present a
section as two banks of eight; OXI and Tracker mappings remain proposals.

Keep sound, rig and scene recall distinct:

- An engine preset stores a sound.
- A snapshot stores the complete rig and routing.
- ZS3 selects a scene within the rig.

Test Program Change routing so scene selection does not consume an instrument's
intended program messages. Validate opaque engine state as well as visible
controls across save, restart and fresh-process restore. Existing presets from
another host need explicit conversion; changing a filename is not conversion.

## Validation before calling a rig ready

Verify engine discovery, required LV2 features, control readback, named presets,
MIDI routing, stereo input/output and complete state recall in the exact target
image. Record OS/architecture, engine versions, bundle identities, sample rate,
block size and test output. Test headless controls independently of any desktop
plugin editor. Physical I/O, CPU/xruns and thermal performance need hardware
testing; desktop or VM checks do not establish those properties.

Private plugin inventories and recovery evidence are maintained separately.
This public design does not distribute pedal firmware or native plugin sources.

## References

- [Zynthian chains, routing, snapshots and ZS3](https://wiki.zynthian.org/index.php/Zynthian_UI_User%27s_Guide_-_Oram)
- [Zynthian engine types](https://wiki.zynthian.org/index.php/Engines)
- [Pisound connections](https://blokas.io/pisound/docs/general-specifications/)
- [Steam Deck runtime and its validation scope](../tools/zynthian-steamdeck/README.md)
