# Raspberry Pi controller trial — 2026-10-24

The Node/HTML controller and upstream engines ran natively on a physical
Raspberry Pi 5 (8 GB) with Pisound. The existing Debian 13.7 installation was
preserved. Host kernel: `6.18.50+rpt-rpi-2712`, AArch64. Docker:
`26.1.5+dfsg1`. This is the controller container, not the official appliance image.

## Provenance

- Repository at deployment: `a8619a8e0787d483c0649b42340f261daae2d9d3`, with
  existing unrelated work left intact and the new ALSA session change uncommitted.
- Base: the previously validated controller image
  `sha256:75f35b26ab00471c9b775c4b6d544115558b7162a086d5d5dfc5336871ee60c4`.
  Its source manifest and upstream pins are recorded in `VALIDATION.md`.
- The only application source replaced in the deployed image was `session.sh`.
  Its SHA-256 is
  `4dd0b8429222826048862d233c58ba587800d9128b1f59ff29e7cc7b209901ca`.
- Pi image: `localhost/zynthian-controller:pisound-20261024`, image/config ID
  `sha256:b1abf76c6c7bfc418349454e65f7c48501d071144ce9f95ba87af0d47090649e`.
- JACK 1.9.21: realtime priority 70, ALSA `hw:pisound`, 48 kHz, 256 frames,
  three periods, 32-bit little-endian duplex audio and sequencer MIDI.
- The container receives `/dev/snd`, the audio group, `SYS_NICE`, realtime and
  memlock limits. Host service exclusion owns the device; desktop D-Bus audio
  reservation is disabled only in the ALSA session branch.

## Results

- Browser connected through an SSH localhost tunnel on port 8770. Existing
  token, Host, Origin and single-controller checks were retained.
- Physical stereo playback ports were connected to `zynmixer_bus:output_00a/b`.
  Pisound MIDI input/output were connected to `ZynMidiRouter`.
- Created a FluidSynth chain, browsed FluidR3 GM, selected Yamaha Grand Piano,
  changed volume, added a sequencer note and controlled playback from HTML.
- Captured 30.017 seconds through the browser PCM transport from the actual
  Pi sequencer/mixer: 2,881,536 float samples, stereo 48 kHz, RMS 0.005891585,
  peak 0.092518777. All samples finite; no clipping. JACK's xrun count stayed
  at six throughout this capture; those six occurred during initial startup.
- Saved `001-New Snapshot.zss`, stopped the container cleanly (exit 0), restarted
  the service, and passed the existing Playwright **snapshot recall after process
  restart** test (8.2 seconds). It loaded the saved session, played its sequence,
  received non-silent browser audio and stopped playback.
- Zynthian is enabled at boot. PiPedal is stopped and disabled, with its files
  preserved. The host service declares their audio ownership conflict.
- Observed temperature during the audio trial: 49.9 °C; `get_throttled=0x0`.
- Default dummy-clock startup/shutdown and rejection of a missing ALSA device
  passed locally. Ten current Node unit tests passed. These local results are
  separate from the Pi runtime measurements above.

The broad existing HTML workflow test stopped after chain creation because it
expected automatic bank navigation and the Pi returned to the mixer. The normal
chain **Banks / presets** route worked and was exercised manually; the broad
workflow is not recorded as passing. The focused restart/audio test passed.

Evidence is retained locally in `~/Library/Application Support/crest-zynthian-pi-trial/`:
audio metrics, browser state/screenshots, workflow and recall logs, and JACK/backend
logs. The access token in that local directory is private and must not be committed.

## Limits

This establishes a working physical Pi trial with digital audio production and
Pisound routing. Analog listening, external MIDI messages over the hardware
connector, analog input, USB hotplug, long sessions, load limits and measured
round-trip latency were not verified. Startup xruns remain visible; the
30-second clean interval is not a sustained performance guarantee. Appliance
administration screens require services outside this container. Private pedal
plugins were neither moved nor validated by this host trial.

Use `RASPBERRY-PI.md` for deployment, browser access and PiPedal rollback.
