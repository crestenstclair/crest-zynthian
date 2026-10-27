#!/usr/bin/env python3
"""Check the real engine's command formatting without importing audio libraries."""
import ast
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest


def float32(value):
    return struct.unpack('f', struct.pack('f', value))[0]


class CommandValues(unittest.TestCase):
    def command(self, value, index=None, path=False):
        sent = []
        engine = SimpleNamespace(proc_cmd=sent.append)
        control = SimpleNamespace(midi_cc=None, graph_path=index, is_path=path,
                                  value=value, symbol='control')
        send(engine, control)
        self.assertEqual(len(sent), 1)
        return sent[0]

    def test_index_preserves_float(self):
        for value in (1e-9, 3060 / 4095, 123.456789, -1e-7):
            value = float32(value)
            self.assertEqual(float32(float(self.command(value, 2).split()[-1])), value)

    def test_symbol_preserves_float(self):
        for value in (1e-9, 3060 / 4095, 123.456789, -1e-7):
            value = float32(value)
            self.assertEqual(float32(float(self.command(value).split('=')[-1])), value)

    def test_path_format_unchanged(self):
        self.assertEqual(self.command('/tmp/file name.wav', 2, True),
                         'set 2 /tmp/file name.wav')
        self.assertEqual(self.command('/tmp/file name.wav', None, True),
                         'control=/tmp/file name.wav')


if __name__ == '__main__':
    source = ast.parse(Path(sys.argv.pop(1)).read_text())
    method = next(node for node in ast.walk(source)
                  if isinstance(node, ast.FunctionDef) and node.name == 'send_controller_value')
    namespace = {}
    exec(compile(ast.Module(body=[method], type_ignores=[]), '<engine method>', 'exec'), namespace)
    send = namespace['send_controller_value']
    unittest.main()
