#!/bin/bash
# Run only on a disposable CI host, as its normal user.
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
bundle=$(realpath "$1")
output=$(realpath "$2")
mkdir -p "$output"
for tool in podman distrobox pipewire; do command -v "$tool"; done
export DBX_CONTAINER_MANAGER=podman
export XDG_RUNTIME_DIR=/run/user/$(id -u)
if [[ ! -d $XDG_RUNTIME_DIR ]]; then
    sudo install -d -m 700 -o "$(id -u)" -g "$(id -g)" "$XDG_RUNTIME_DIR"
fi
[[ ! -S $XDG_RUNTIME_DIR/pipewire-0 ]] || { echo 'CI requires a private audio session.' >&2; exit 1; }
pw_config=$(mktemp -d)
cp /usr/share/pipewire/pipewire.conf "$pw_config/pipewire.conf"
mkdir "$pw_config/pipewire.conf.d"
cp "$here/tests/pipewire.conf" "$pw_config/pipewire.conf.d/90-test.conf"
PIPEWIRE_CONFIG_DIR="$pw_config" pipewire >"$output/pipewire.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
for _ in {1..50}; do
    [[ -S $XDG_RUNTIME_DIR/pipewire-0 ]] && break
    sleep 0.1
done
[[ -S $XDG_RUNTIME_DIR/pipewire-0 ]]
bash "$bundle/install.sh" >"$output/install.log" 2>&1 || { tail -100 "$output/install.log"; exit 1; }
"$HOME/.local/bin/zynthian-steamdeck" --check >"$output/preflight.log" 2>&1 || {
    cat "$output/preflight.log"; exit 1;
}
cat "$output/preflight.log"
test -s "$HOME/.local/share/applications/zynthian-steamdeck.desktop"
echo 'Rootless Podman / Distrobox installation and host PipeWire connection passed.'
