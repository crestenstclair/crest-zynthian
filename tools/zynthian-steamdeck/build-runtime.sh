#!/bin/bash
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
root=${ZYNTHIAN_DIR:-/opt/zynthian}
jobs=${BUILD_JOBS:-4}
mkdir -p "$root" "$root/sw" "$root/bin"
python3 - "$here/sources.lock.json" "$root" <<'PY'
import json, pathlib, subprocess, sys
lock=json.load(open(sys.argv[1])); root=pathlib.Path(sys.argv[2])
for name, source in lock.items():
    dest=root/name if name.startswith('zynthian-') or name=='zyncoder' else root/'sw'/name
    if not dest.exists():
        subprocess.run(['git','init',str(dest)],check=True)
        subprocess.run(['git','-C',str(dest),'remote','add','origin',source['url']],check=True)
        subprocess.run(['git','-C',str(dest),'fetch','--depth=1','origin',source['commit']],check=True)
        subprocess.run(['git','-C',str(dest),'checkout','--detach',source['commit']],check=True)
    head=subprocess.check_output(['git','-C',str(dest),'rev-parse','HEAD'],text=True).strip()
    if head!=source['commit']: raise SystemExit(f'{name}: wrong checkout {head}')
PY
for patch in desktop-compat.patch lv2-state-recall.patch lv2-control-precision.patch lv2-snapshot-state.patch; do
    if git -C "$root/zynthian-ui" apply --check "$here/$patch"; then
        git -C "$root/zynthian-ui" apply "$here/$patch"
    else
        git -C "$root/zynthian-ui" apply --reverse --check "$here/$patch"
    fi
done
for patch in jalv-state-pause.patch jalv-control-precision.patch jalv-snapshot-state.patch jalv-latency-metadata.patch; do
    if git -C "$root/sw/jalv" apply --check "$here/$patch"; then
        git -C "$root/sw/jalv" apply "$here/$patch"
    else
        git -C "$root/sw/jalv" apply --reverse --check "$here/$patch"
    fi
done
cmake -S "$root/sw/libsndfile" -B "$root/sw/libsndfile/build" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$root" \
  -DBUILD_SHARED_LIBS=ON -DBUILD_TESTING=OFF -DBUILD_PROGRAMS=OFF -DBUILD_EXAMPLES=OFF
cmake --build "$root/sw/libsndfile/build" -j "$jobs"
cmake --install "$root/sw/libsndfile/build"
export CPATH="$root/include${CPATH:+:$CPATH}"
export LIBRARY_PATH="$root/lib${LIBRARY_PATH:+:$LIBRARY_PATH}"
export LD_LIBRARY_PATH="$root/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export ZYNTHIAN_WIRING_LAYOUT=TOUCH_ONLY
for src in "$root/zyncoder" "$root/zynthian-ui/zynlibs/"{zynsmf,zynseq,zynaudioplayer,zynmixer}; do
    cmake -S "$src" -B "$src/build" -DCMAKE_BUILD_TYPE=Release -DENABLE_OSC=0 \
      -DCMAKE_CXX_FLAGS=-Wno-error=unused-result -DCMAKE_C_FLAGS=-Wno-error=unused-result \
      -DCMAKE_SHARED_LINKER_FLAGS="-L$root/lib -Wl,-rpath,$root/lib"
    cmake --build "$src/build" -j "$jobs"
done
meson setup "$root/sw/jalv/build" "$root/sw/jalv" --prefix="$root" --buildtype=release \
  -Dgtk3=disabled -Dqt5=disabled -Djack=enabled -Dportaudio=disabled -Dtests=disabled
meson compile -C "$root/sw/jalv/build" -j "$jobs"
meson install -C "$root/sw/jalv/build"
python3 -m venv --system-site-packages "$root/venv"
"$root/venv/bin/pip" install -r "$here/requirements.txt"
mkdir -p "$root/zynthian-data/soundfonts/sf2" /usr/share/fonts/truetype/zynthian
ln -sf /usr/share/sounds/sf2/FluidR3_GM.sf2 "$root/zynthian-data/soundfonts/sf2/FluidR3_GM.sf2"
cp -a "$root/zynthian-ui/fonts/." /usr/share/fonts/truetype/zynthian/
fc-cache -f /usr/share/fonts/truetype/zynthian
cp "$here/sources.lock.json" "$root/sources.lock.json"
