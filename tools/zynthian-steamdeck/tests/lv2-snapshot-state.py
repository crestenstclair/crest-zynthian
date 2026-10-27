#!/usr/bin/env python3
"""Check portable state resources and reject unsafe snapshot archives."""
import base64
import importlib.util
import io
from pathlib import Path
import stat
import sys
from tempfile import TemporaryDirectory
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('state_bundle', sys.argv.pop(1))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class StateBundleTests(unittest.TestCase):
    def test_state_and_linked_resource_survive_source_removal(self):
        with TemporaryDirectory() as source, TemporaryDirectory() as restored:
            root = Path(source)
            (root/'state.ttl').write_text('<> <urn:key> "opaque bytes" .')
            (root/'sample.bin').write_bytes(bytes(range(256)))
            (root/'linked.bin').symlink_to(root/'sample.bin')
            packed = bundle.pack_state(source)
            (root/'sample.bin').unlink()
            bundle.unpack_state(packed, restored)
            self.assertEqual((Path(restored)/'sample.bin').read_bytes(), bytes(range(256)))
            self.assertEqual((Path(restored)/'linked.bin').read_bytes(), bytes(range(256)))
            self.assertFalse((Path(restored)/'linked.bin').is_symlink())

    def test_untrusted_archive_paths_and_links_rejected(self):
        for name in ('../escape', '/absolute', 'a/../escape', 'a\\escape', './state.ttl'):
            with self.subTest(name=name):
                self.reject_archive(name)
        self.reject_archive('link', stat.S_IFLNK)

    def reject_archive(self, name, kind=stat.S_IFREG):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr('state.ttl', 'state')
            entry = zipfile.ZipInfo(name)
            entry.external_attr = (kind | 0o600) << 16
            archive.writestr(entry, 'contents')
        packed = dict(format='lv2-bundle-zip-v1', data=base64.b64encode(stream.getvalue()).decode())
        with TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                bundle.unpack_state(packed, directory)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_existing_files_are_never_overwritten(self):
        with TemporaryDirectory() as directory:
            state = Path(directory)/'state.ttl'
            state.write_text('preserve')
            packed = bundle.pack_state(directory)
            with self.assertRaises(FileExistsError):
                bundle.unpack_state(packed, directory)
            self.assertEqual(state.read_text(), 'preserve')

    def test_unsupported_and_oversized_states_rejected(self):
        with TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                bundle.unpack_state({'format': 'unknown'}, directory)
            (Path(directory)/'state.ttl').write_bytes(b'large')
            original = bundle.MAX_STATE_BYTES
            try:
                bundle.MAX_STATE_BYTES = 1
                with self.assertRaises(ValueError):
                    bundle.pack_state(directory)
            finally:
                bundle.MAX_STATE_BYTES = original


if __name__ == '__main__':
    unittest.main()
