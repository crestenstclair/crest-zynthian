#!/bin/bash
set -euo pipefail
source /opt/zynthian-steamdeck/environment.sh
export DISPLAY=:0 JACK_NO_START_SERVER=1
mkdir -p /data/logs "$ZYNTHIAN_CONFIG_DIR" "$ZYNTHIAN_MY_DATA_DIR"
exec 9>"$ZYNTHIAN_MY_DATA_DIR/session.lock"
flock -n 9 || { echo 'Zynthian data is already in use.' >&2; exit 1; }
python3 /opt/zynthian-steamdeck/prepare-user.py

children=()
ui_pid=
cleanup() {
    trap - EXIT TERM INT
    if [[ -n $ui_pid ]]; then
        kill -TERM "$ui_pid" 2>/dev/null || true
        wait "$ui_pid" || true
    fi
    kill "${children[@]}" 2>/dev/null || true
    wait || true
}
trap cleanup EXIT
trap 'exit 0' TERM INT

Xvfb :0 -screen 0 1280x800x24 -nolisten tcp > /data/logs/display.log 2>&1 &
children+=("$!")
jackd --no-realtime -d dummy -r 48000 -p 256 > /data/logs/jack.log 2>&1 &
children+=("$!")
ready=0
for _ in {1..100}; do
    if xdpyinfo >/dev/null 2>&1 && jack_lsp >/dev/null 2>&1; then ready=1; break; fi
    sleep 0.1
done
[[ $ready == 1 ]] || { echo 'Display or JACK startup failed; see /data/logs.' >&2; exit 1; }
x11vnc -display :0 -localhost -rfbport 5900 -forever -shared -nopw -noxdamage \
    > /data/logs/vnc.log 2>&1 &
children+=("$!")
python3 /opt/zynthian-web/server.py > /data/logs/web.log 2>&1 &
children+=("$!")

cd "$ZYNTHIAN_UI_DIR"
while true; do
    source "$ZYNTHIAN_CONFIG_DIR/zynthian_envars.sh"
    python3 ./zynthian_main.py >> /data/logs/session.log 2>&1 &
    ui_pid=$!
    # Any failed infrastructure process ends the session instead of leaving a dead UI.
    set +e
    wait -n "$ui_pid" "${children[@]}"
    result=$?
    set -e
    if kill -0 "$ui_pid" 2>/dev/null; then
        echo 'Web session infrastructure exited; see /data/logs.' >&2
        exit 1
    fi
    ui_pid=
    case "$result" in
        102) continue ;;
        0|100|101) exit 0 ;;
        *) exit "$result" ;;
    esac
done
