"""Portable LV2 state bundles embedded in Zynthian snapshots.

Lilv owns state serialization and resource mapping. This module only transports
the resulting directory, including files referenced by the state document.
"""
import base64
import io
from pathlib import Path, PurePosixPath
import stat
import zipfile


MAX_STATE_BYTES = 512 * 1024 * 1024
MAX_STATE_FILES = 4096


def pack_state(directory):
    root = Path(directory)
    if not (root / 'state.ttl').is_file():
        raise ValueError('LV2 state document is missing')
    files = sorted(path for path in root.rglob('*') if path.is_file())
    if len(files) > MAX_STATE_FILES or sum(p.stat().st_size for p in files) > MAX_STATE_BYTES:
        raise ValueError('LV2 snapshot state exceeds the bundle limit')
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            # Lilv may link sample resources. Store their contents, not links.
            archive.write(path, path.relative_to(root).as_posix())
    if stream.tell() > MAX_STATE_BYTES + 1024 * 1024:
        raise ValueError('LV2 snapshot archive exceeds the bundle limit')
    return {'format': 'lv2-bundle-zip-v1',
            'data': base64.b64encode(stream.getvalue()).decode('ascii')}


def unpack_state(state, directory):
    if state.get('format') != 'lv2-bundle-zip-v1':
        raise ValueError('Unsupported LV2 snapshot state format')
    encoded = state['data']
    if not isinstance(encoded, str) or len(encoded) > (MAX_STATE_BYTES + 1024 * 1024) * 4 // 3:
        raise ValueError('LV2 snapshot state exceeds the bundle limit')
    payload = base64.b64decode(encoded, validate=True)
    root = Path(directory)
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_STATE_FILES or sum(p.file_size for p in entries) > MAX_STATE_BYTES:
            raise ValueError('LV2 snapshot state exceeds the bundle limit')
        names = set()
        for entry in entries:
            path = PurePosixPath(entry.filename)
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if (path.is_absolute() or '..' in path.parts or not path.parts
                    or '\\' in entry.filename or '\x00' in entry.filename
                    or entry.filename != path.as_posix()
                    or entry.filename in names or kind not in (0, stat.S_IFREG)):
                raise ValueError('Invalid LV2 snapshot resource path')
            names.add(entry.filename)
        if 'state.ttl' not in names:
            raise ValueError('LV2 state document is missing')
        # Fresh private directory only. Never extract archive paths directly.
        for entry in entries:
            target = root / entry.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                with archive.open(entry) as source:
                    remaining = entry.file_size
                    while remaining:
                        block = source.read(min(remaining, 1024 * 1024))
                        if not block:
                            raise ValueError('Truncated LV2 state resource')
                        output.write(block)
                        remaining -= len(block)
                    if source.read(1):
                        raise ValueError('Invalid LV2 state resource size')
    return root / 'state.ttl'
