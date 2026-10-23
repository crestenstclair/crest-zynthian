#!/bin/bash
# Run inside a disposable container with --tmpfs /data:mode=1777 and /results mounted.
set -euo pipefail
snapshot=${1:?Pass the snapshot from the existing JACK smoke test}
[[ ! -e /data/user-data ]] || { echo 'Requires an empty disposable /data.' >&2; exit 1; }
mkdir -p /data/user-data/snapshots
cp "$snapshot" /data/user-data/snapshots/last_state.zss
printf '%s\n' 'isolated-web-smoke-token-0000000000000000' > /data/access-token
bash /opt/zynthian-web/session.sh &
session_pid=$!
trap 'kill -TERM "$session_pid" 2>/dev/null || true; wait "$session_pid" || true' EXIT
python3 /opt/zynthian-web/tests/smoke.py
