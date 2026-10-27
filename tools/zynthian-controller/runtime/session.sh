#!/bin/bash
set -euo pipefail
source /opt/zynthian-steamdeck/environment.sh
export ZYNTHIAN_UI_DIR=/opt/controller
export PYTHONPATH="/opt/controller/runtime/compat:/opt/controller:/opt/zynthian${PYTHONPATH:+:$PYTHONPATH}"
export JACK_NO_START_SERVER=1
export ZYNTHIAN_HELP_DIR=/opt/controller/runtime/help
mkdir -p /data/logs "$ZYNTHIAN_CONFIG_DIR" "$ZYNTHIAN_MY_DATA_DIR"
exec 9>"$ZYNTHIAN_MY_DATA_DIR/session.lock"
flock -n 9 || { echo 'Controller session data is already in use.' >&2; exit 1; }
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d /tmp/zynthian-controller.XXXXXX)
export ZYNTHIAN_WEBVIEW_SOCKET="$XDG_RUNTIME_DIR/control.sock"
python3 /opt/zynthian-steamdeck/prepare-user.py
# The supplied backend uses the current file-browser layout; create missing
# directories only, preserving older recordings and every existing user file.
mkdir -p "$ZYNTHIAN_MY_DATA_DIR"/files/{Audio,Samples,Midi/patterns,Patterns,IRs/deconvolved}
source "$ZYNTHIAN_CONFIG_DIR/zynthian_envars.sh"
children=()
backend_pid=
audio_pid=
frontend_pid=
cleanup() {
    trap - EXIT TERM INT
    # Close every JACK client before stopping JACK. Killing the server alongside
    # its clients can strand their deactivation calls during container shutdown.
    for pid in "$frontend_pid" "$audio_pid" "$backend_pid"; do
        if [[ -n $pid ]]; then
            kill -TERM "$pid" 2>/dev/null || true
            wait "$pid" || true
        fi
    done
    kill "${children[@]}" 2>/dev/null || true
    wait || true
    rm -rf -- "$XDG_RUNTIME_DIR"
}
trap cleanup EXIT
trap 'exit 0' TERM INT
# Existing backend screens supply callbacks/state; the user interface is Node/HTML.
# Let Xvfb reserve an available display. Abrupt container shutdown can leave
# locks behind, so a fixed display number can prevent the next launch.
display_file="$XDG_RUNTIME_DIR/display"
Xvfb -displayfd 3 -screen 0 1280x800x24 -nolisten tcp \
    3>"$display_file" > /data/logs/backend-display.log 2>&1 &
children+=("$!")
if [[ -n ${ZYNTHIAN_ALSA_DEVICE:-} ]]; then
    # Physical hosts use the same JACK graph, clocked by their audio interface.
    # The container must receive /dev/snd, audio group and realtime limits.
    # Host service ownership replaces desktop D-Bus audio reservation.
    export JACK_NO_AUDIO_RESERVATION=1
    jackd --realtime -P 70 -d alsa -d "$ZYNTHIAN_ALSA_DEVICE" \
        -r 48000 -p 256 -n 3 -X seq > /data/logs/jack.log 2>&1 &
else
    jackd --no-realtime -d dummy -r 48000 -p 256 > /data/logs/jack.log 2>&1 &
fi
children+=("$!")
ready=0
for _ in {1..100}; do
    if [[ -s $display_file ]]; then
        export DISPLAY=":$(cat "$display_file")"
        if xdpyinfo >/dev/null 2>&1 && jack_lsp >/dev/null 2>&1; then ready=1; break; fi
    fi
    sleep 0.1
done
[[ $ready == 1 ]] || { echo 'Display or JACK startup failed; see /data/logs.' >&2; exit 1; }
cd /opt/controller
python3 ./zynthian_main.py > /data/logs/backend.log 2>&1 &
backend_pid=$!
python3 /opt/controller/runtime/browser.py > /data/logs/web.log 2>&1 &
audio_pid=$!
node /opt/controller/controller-node/server.mjs > /data/logs/frontend.log 2>&1 &
frontend_pid=$!
wait -n "${children[@]}" "$backend_pid" "$audio_pid" "$frontend_pid"
