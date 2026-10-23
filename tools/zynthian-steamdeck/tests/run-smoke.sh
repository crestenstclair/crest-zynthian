#!/bin/bash
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export USER=${USER:-root}
export ZYNTHIAN_CONFIG_DIR=/tmp/zynthian-test-config
export ZYNTHIAN_MY_DATA_DIR=/tmp/zynthian-test-data
export TEST_OUTPUT=${TEST_OUTPUT:-/results}
source "$here/environment.sh"
export ZYNTHIAN_UI_RESTORE_LAST_STATE=0
mkdir -p "$TEST_OUTPUT"
python3 "$here/prepare-user.py"
jackd --no-realtime -d dummy -r 48000 -p 256 >"$TEST_OUTPUT/jack.log" 2>&1 &
jack_pid=$!
trap 'kill "$jack_pid" 2>/dev/null || true' EXIT
ready=0
for _ in {1..50}; do
    if jack_lsp >/dev/null 2>&1; then ready=1; break; fi
    sleep 0.1
done
[[ $ready == 1 ]] || { cat "$TEST_OUTPUT/jack.log"; exit 1; }
for phase in create restore; do
    timeout 120 xvfb-run -a -s '-screen 0 1280x800x24' \
      python3 "$here/tests/smoke.py" "$phase" >"$TEST_OUTPUT/$phase.log" 2>&1 || {
        tail -150 "$TEST_OUTPUT/$phase.log"; exit 1;
      }
    cat "$TEST_OUTPUT/$phase.json"
done
