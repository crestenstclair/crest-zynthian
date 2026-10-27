# Raspberry Pi / Pisound trial

The controller can run on a 64-bit Raspberry Pi host without replacing its OS.
The existing ARM64 container runs Zynthian's engines and Node/HTML interface.
`ZYNTHIAN_ALSA_DEVICE=hw:pisound` switches the session from the browser-only
dummy clock to Pisound duplex audio and ALSA sequencer MIDI. The fixed trial
settings are 48 kHz, 256 frames, three periods, and JACK realtime priority 70.
The browser can also monitor the mix, with additional network/browser latency.

This is a container deployment, not the complete official Zynthian appliance
image. Webconf, Pi administration and native display integration are not included.
It does not establish compatibility of separately supplied pedal plugins.

## Prepare

Back up the existing host application's configuration, presets and binaries
before switching audio ownership. Keep the existing application installed.
Do not run two audio servers against the same ALSA device.

On Debian 13, install both `docker.io` and `docker-cli`. Verify `aplay -l` and
`amidi -l` show the intended interface. Build the base web image and controller
image using their existing launchers on an ARM64 machine, or transfer an already
validated ARM64 image with `docker save`, SSH and `docker load`. An x86-64 image
is not the Pi artifact. Record the image/config digest and source revision.

The initial trial image was derived from the existing tested controller image
by copying only the updated `session.sh`, preserving unrelated working-tree
changes outside the deployment:

```sh
docker build --pull=false -t localhost/zynthian-controller:pisound-20261024 \
  -f - tools/zynthian-controller/runtime <<'EOF'
FROM localhost/zynthian-controller:overlay
COPY session.sh /opt/controller/runtime/session.sh
EOF
```

## Create the Pi session

Run as the normal Pi user with sudo access. Choose a new data directory and
container name; inspect any existing instance instead of replacing it. Generate
a random, mode-0600 `access-token` file in the data directory before starting.
The service's user must own the directory and token.

```sh
trial_data="$HOME/.local/share/crest-zynthian-controller-pi"
sudo docker create --init --name crest-zynthian-pi \
  --user "$(id -u):$(id -g)" --group-add "$(getent group audio | cut -d: -f3)" \
  --device /dev/snd --cap-add SYS_NICE \
  --ulimit rtprio=95 --ulimit memlock=-1 --shm-size=256m --stop-timeout=30 \
  -p 127.0.0.1:8770:8770 -e CONTROLLER_PORT=8770 \
  -e ZYNTHIAN_ALSA_DEVICE=hw:pisound -e ZYNTHIAN_HOST_NAME='Raspberry Pi 5 / Pisound' \
  --mount "type=bind,source=$trial_data,target=/data" \
  --mount type=bind,source=/run/udev,target=/run/udev,readonly \
  localhost/zynthian-controller:pisound-20261024
```

Use a systemd service to run `docker start --attach crest-zynthian-pi` and stop
it with `docker stop --time 30 crest-zynthian-pi`. Order it after Docker and
sound, and declare `Conflicts=pipedald.service` when switching from PiPedal.
Enable only the desired audio application's service at boot. Keep session data
outside the container, including snapshots and recordings.

## Open from a computer

Forward the same port through SSH; the interface deliberately accepts only
localhost Host/Origin values. This preserves existing authentication and gives
Web Audio a secure browser context without exposing a new LAN service.

```sh
ssh -N -L 127.0.0.1:8770:127.0.0.1:8770 user@pi-host
```

Open `http://localhost:8770/#token=VALUE`, replacing `VALUE` with the Pi session's
access token. Do not publish that URL. One tab owns controller access. Use
**Enable audio** to monitor on the computer; Pisound output works independently.
Add a FluidSynth instrument. If creation returns to the mixer, select its chain
and **Banks / presets · FluidSynth**, then FluidR3 GM and a preset. Use the native
sequencer or a MIDI keyboard. Save with **Snapshots** before stopping.

## Verification and rollback

Check JACK's log for ALSA duplex startup and realtime errors; inspect `jack_lsp -c`
inside the container for mixer-to-Pisound and physical MIDI connections. Test
browser control changes, audible synthesis, saved snapshot recall after a service
restart, and clean shutdown. Digital capture proves signal production and routing;
it does not replace listening to the analog output or testing external MIDI gear.
Report observed xruns and thermal/power status with the workload and duration.

For the installed trial service, return to PiPedal with:

```sh
sudo systemctl disable --now crest-zynthian.service
sudo systemctl enable --now pipedald.service
```

Return to Zynthian by disabling/stopping PiPedal, then enabling/starting
`crest-zynthian.service`. Neither operation deletes either application's data.
