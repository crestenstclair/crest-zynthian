"""Native callbacks may wait for Tk; transport must keep its event loop free."""
from concurrent.futures import Future
from threading import Event, current_thread
from types import SimpleNamespace as NS
from unittest import TestCase
from unittest.mock import Mock, patch
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from zynwebview.bridge import LocalBridge


class AsyncBridgeTests(TestCase):
    def bridge(self, dispatch):
        bridge=object.__new__(LocalBridge)
        bridge.client=object()
        bridge.pending=None
        bridge.last_state={'backendBusy':False}
        bridge.adapter=NS(dispatch=dispatch,snapshot=lambda:{'backendBusy':False})
        bridge.emit=Mock()
        return bridge

    def test_native_wait_does_not_block_event_loop_or_allow_second_command(self):
        entered,release=Event(),Event()
        caller=current_thread()
        def dispatch(request):
            self.assertIsNot(current_thread(),caller)
            entered.set()
            if not release.wait(2):
                raise TimeoutError('Test event loop failed to release native callback')
        bridge=self.bridge(dispatch)
        bridge.start_command({'id':7,'method':'activate'})
        self.assertTrue(entered.wait(1))
        try:
            bridge.receive_request('{"id":8,"method":"activate"}')
            self.assertFalse(bridge.emit.call_args.args[0]['ok'])
            bridge.receive_request('{"id":9,"method":"state"}')
            self.assertTrue(bridge.emit.call_args.args[0]['state']['backendBusy'])
        finally:
            release.set()
        bridge.pending[2].result(timeout=1)
        bridge.finish_command()
        self.assertEqual(bridge.emit.call_args.args[0]['id'],7)
        self.assertTrue(bridge.emit.call_args.args[0]['ok'])

    def test_reconnect_does_not_receive_old_ack(self):
        bridge=self.bridge(Mock())
        old_client=bridge.client
        future=Future();future.set_result(None)
        bridge.pending=(old_client,7,future)
        bridge.client=object()
        bridge.finish_command()
        self.assertNotIn('id',bridge.emit.call_args.args[0])

    def test_disconnected_command_is_discarded_before_execution(self):
        dispatch=Mock();bridge=self.bridge(dispatch)
        with patch('zynwebview.bridge.Thread') as thread:
            bridge.start_command({'id':7,'method':'activate'})
            bridge.client=None
            thread.call_args.kwargs['target']()
        self.assertIsInstance(bridge.pending[2].exception(),ValueError)
        dispatch.assert_not_called()
