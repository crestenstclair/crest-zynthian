#!/bin/bash
# Node/HTML integration proof using a disposable session and a separate port.
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
image=localhost/zynthian-controller:overlay
result=${1:-"$PWD/results/controller-$(date -u +%Y%m%dT%H%M%SZ)"}
[[ ! -e $result ]] || { echo "Evidence directory already exists: $result" >&2; exit 2; }
[[ -d $here/controller-node/node_modules/@playwright/test ]] || {
    echo 'Run npm ci and npx playwright install chromium in tools/zynthian-controller/controller-node first.' >&2; exit 2;
}
mkdir -p "$result"
result=$(cd "$result" && pwd)
name="crest-controller-test-$(date -u +%Y%m%dT%H%M%SZ)-$$"
created=0
cleanup() {
    if [[ $created == 1 ]]; then docker stop -t 30 "$name" >/dev/null 2>&1 || true; docker rm "$name" >/dev/null; fi
}
trap cleanup EXIT
python3 - "$result/access-token" <<'PY'
from pathlib import Path
import secrets, sys
p=Path(sys.argv[1]); p.write_text(secrets.token_urlsafe(32)+'\n'); p.chmod(0o600)
PY
docker image inspect "$image" --format '{{json .}}' > "$result/image.json"
docker run --rm --user 0 "$image" bash -c \
    'cd /opt/controller/controller-node && npm test && python3 -m unittest discover -s ../controller-webview/tests -p "test_*.py"' \
    > "$result/unit-tests.log" 2>&1
docker create --init --name "$name" --user "$(id -u):$(id -g)" --shm-size=256m --stop-timeout=30 \
    -p 127.0.0.1:8768:8768 -e CONTROLLER_PORT=8768 --mount "type=bind,source=$result,target=/data" "$image" >/dev/null
created=1
for phase in workflows parity recall; do
    docker start "$name" >/dev/null
    for _ in {1..100}; do
        if curl -fsS http://127.0.0.1:8768/health 2>/dev/null | python3 -c 'import json,sys;sys.exit(not json.load(sys.stdin)["ready"])' 2>/dev/null; then break; fi
        [[ $(docker inspect -f '{{.State.Running}}' "$name") == true ]] || { echo "Test startup failed; see $result/logs" >&2; exit 1; }
        sleep 0.2
    done
    case $phase in
        workflows) pattern='HTML screen workflows' ;;
        parity) pattern='parity:' ;;
        recall) pattern='snapshot recall after process restart|fresh parity snapshot recall' ;;
    esac
    (cd "$here/controller-node" && CONTROLLER_DATA="$result" npx playwright test --grep "$pattern") > "$result/$phase.log" 2>&1
    docker stop -t 30 "$name" >/dev/null
    docker inspect -f '{{.State.ExitCode}}' "$name" > "$result/exit-$phase.txt"
    [[ $(cat "$result/exit-$phase.txt") == 0 ]] || { echo "Container did not stop cleanly; see $result/logs" >&2; exit 1; }
    cp "$result/logs/backend.log" "$result/backend-$phase.log"
    if grep -Eq 'corrupted|double free|Segmentation fault|Traceback' "$result/backend-$phase.log"; then
        echo "Backend error; inspect $result/backend-$phase.log" >&2; exit 1
    fi
done
printf 'Evidence: %s\n' "$result"
