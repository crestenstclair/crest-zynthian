#!/bin/bash
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export USER=${USER:-root}
export ZYNTHIAN_CONFIG_DIR=/tmp/zynthian-test-config
export ZYNTHIAN_MY_DATA_DIR=/tmp/zynthian-test-data
export TEST_OUTPUT=${TEST_OUTPUT:-/results}
backend=${1:-jack}
export ZYNTHIAN_TEST_BACKEND=$backend
export TEST_OUTPUT="$TEST_OUTPUT/$backend"
source "$here/environment.sh"
export ZYNTHIAN_UI_RESTORE_LAST_STATE=0
mkdir -p "$TEST_OUTPUT" "$HOME"
python3 "$here/prepare-user.py"
runner=()
case "$backend" in
jack)
    jackd --no-realtime -d dummy -r 48000 -p 256 >"$TEST_OUTPUT/jack.log" 2>&1 &
    server_pid=$!
    ;;
pipewire)
    export XDG_RUNTIME_DIR=$(mktemp -d)
    export PIPEWIRE_RUNTIME_DIR=$XDG_RUNTIME_DIR
    export PIPEWIRE_REMOTE=pipewire-0
    export PIPEWIRE_LATENCY=256/48000
    pw_config=$(mktemp -d)
    cp /usr/share/pipewire/pipewire.conf "$pw_config/pipewire.conf"
    mkdir "$pw_config/pipewire.conf.d"
    cp "$here/tests/pipewire.conf" "$pw_config/pipewire.conf.d/90-test.conf"
    PIPEWIRE_CONFIG_DIR="$pw_config" pipewire >"$TEST_OUTPUT/pipewire.log" 2>&1 &
    server_pid=$!
    runner=(pw-jack)
    ;;
*) echo "Unknown backend: $backend" >&2; exit 1 ;;
esac
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
ready=0
for _ in {1..50}; do
    if "${runner[@]}" jack_lsp >/dev/null 2>&1; then ready=1; break; fi
    sleep 0.1
done
[[ $ready == 1 ]] || { cat "$TEST_OUTPUT/$backend.log"; exit 1; }
if [[ $backend == pipewire ]]; then
    bash "$here/launch.sh" --check >"$TEST_OUTPUT/preflight.log" 2>"$TEST_OUTPUT/preflight-errors.log"
fi
if [[ ${ZYNTHIAN_TEST_GDB:-0} == 1 ]]; then
    runner+=(gdb --batch --return-child-result -ex 'set pagination off' -ex run -ex 'thread apply all bt' --args)
fi
for phase in create restore; do
    timeout 120 xvfb-run -a -s '-screen 0 1280x800x24' \
      "${runner[@]}" python3 "$here/tests/smoke.py" "$phase" >"$TEST_OUTPUT/$phase.log" 2>&1 || {
        tail -150 "$TEST_OUTPUT/$phase.log"; exit 1;
      }
    cat "$TEST_OUTPUT/$phase.json"
done
