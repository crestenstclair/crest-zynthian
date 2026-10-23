#!/bin/bash
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$here/environment.sh"
mkdir -p "$ZYNTHIAN_MY_DATA_DIR" "$ZYNTHIAN_CONFIG_DIR"
exec 9>"$ZYNTHIAN_MY_DATA_DIR/session.lock"
flock -n 9 || { echo 'Zynthian is already running.' >&2; exit 1; }
python3 "$here/prepare-user.py"
if [[ ${1:-} == --check ]]; then
    exec pw-jack python3 "$here/check-runtime.py"
fi
if [[ -z ${DISPLAY:-} ]]; then
    echo 'Start Zynthian from Steam Deck Desktop Mode or a graphical Steam session.' >&2
    exit 1
fi
# Explicit PipeWire socket propagated by the outer launcher. Do not start JACK
# or stop/reconfigure the host audio services.
if [[ -z ${PIPEWIRE_RUNTIME_DIR:-} || ! -S ${PIPEWIRE_RUNTIME_DIR}/pipewire-0 ]]; then
    echo 'The SteamOS PipeWire socket is unavailable. Run the supplied host launcher.' >&2
    exit 1
fi
export JACK_NO_START_SERVER=1
export PIPEWIRE_LATENCY="${PIPEWIRE_LATENCY:-256/48000}"
cd "$ZYNTHIAN_UI_DIR"
child_pid=
stop_app() {
    if [[ -n $child_pid ]]; then
        kill -TERM "$child_pid" 2>/dev/null || true
        wait "$child_pid" || true
    fi
    exit 0
}
trap stop_app TERM INT
# Execute the upstream application, not the appliance power/reboot wrapper.
while true; do
    # Reload settings saved by the stock UI, including after a UI restart.
    source "$ZYNTHIAN_CONFIG_DIR/zynthian_envars.sh"
    set +e
    pw-jack python3 ./zynthian_main.py "$@" &
    child_pid=$!
    wait "$child_pid"
    result=$?
    child_pid=
    set -e
    case "$result" in
        102) continue ;;
        0|100|101) exit 0 ;;
        *) exit "$result" ;;
    esac
done
