#!/bin/bash
# Run from Steam Deck Desktop Mode as the normal deck user.
set -euo pipefail
export DBX_CONTAINER_MANAGER=podman
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
name=zynthian-steamdeck
image=localhost/zynthian-steamdeck:oram
[[ $(uname -m) == x86_64 ]] || { echo 'This build requires x86-64 Linux.' >&2; exit 1; }
[[ $EUID != 0 ]] || { echo 'Run as your normal Steam Deck user, without sudo.' >&2; exit 1; }
for cmd in podman distrobox; do
    command -v "$cmd" >/dev/null || { echo "Missing $cmd. See README.md for the supported Distrobox setup." >&2; exit 1; }
done
if [[ -f $here/zynthian-steamdeck-image.tar.gz ]]; then
    (cd "$here" && sha256sum --check zynthian-steamdeck-image.tar.gz.sha256)
    podman load --input "$here/zynthian-steamdeck-image.tar.gz"
else
    podman build --tag "$image" --file "$here/Containerfile" "$here"
fi
if podman container exists "$name"; then
    echo "Container $name already exists. Remove it explicitly to switch builds; user data lives outside the container." >&2
    exit 1
fi
distrobox create --yes --name "$name" --image "$image"
distrobox enter --name "$name" -- /bin/true
install -d "$HOME/.local/bin" "$HOME/.local/share/applications"
install -m 755 "$here/zynthian-steamdeck" "$HOME/.local/bin/zynthian-steamdeck"
# Quote the home path using Desktop Entry syntax.
python3 - "$HOME" <<'PY'
from pathlib import Path
import sys
home=Path(sys.argv[1]); exe=str(home/'.local/bin/zynthian-steamdeck')
exe=exe.replace('\\','\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$').replace('%','%%')
(home/'.local/share/applications/zynthian-steamdeck.desktop').write_text(
 '[Desktop Entry]\nType=Application\nName=Zynthian\nComment=Zynthian Oram synthesizer\n'
 f'Exec="{exe}"\nIcon=multimedia-volume-control\nTerminal=false\nCategories=AudioVideo;Audio;Midi;\n')
PY
echo 'Installed. Launch Zynthian from the application menu.'
echo 'For Gaming Mode, add ~/.local/bin/zynthian-steamdeck as a non-Steam game.'
