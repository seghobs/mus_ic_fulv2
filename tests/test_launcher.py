import unittest
from unittest.mock import Mock, patch
import io
import calistir

class LauncherTests(unittest.TestCase):
    def test_outdated_ytdlp_is_not_treated_as_ready(self):
        with patch.object(calistir, 'version', return_value='2026.7.4'):
            self.assertFalse(calistir.requirement_installed('yt-dlp>=2026.8.19'))
        with patch.object(calistir, 'version', return_value='2026.8.19'):
            self.assertTrue(calistir.requirement_installed('yt-dlp>=2026.8.19'))

    def response(self, body):
        context = Mock()
        stream = io.BytesIO(body)
        stream.status = 200
        context.__enter__ = Mock(return_value=stream)
        context.__exit__ = Mock(return_value=False)
        return context

    def test_ready_requires_own_instance_and_page(self):
        process = Mock()
        process.poll.return_value = None
        with patch.object(calistir, 'urlopen', side_effect=[
            self.response(b'{"status":"ready","instance":"other"}'),
            self.response(b'{"status":"ready","instance":"ours"}'),
            self.response(b'<html></html>')
        ]) as request, patch.object(calistir.time, 'sleep'):
            calistir.wait_until_ready(process, 'ours')
            self.assertEqual(request.call_count, 3)
            self.assertEqual(request.call_args.args[0], calistir.URL)

    def test_exited_server_never_passes_readiness(self):
        process = Mock()
        process.poll.return_value = 1
        with patch.object(calistir, 'urlopen') as request:
            with self.assertRaises(RuntimeError):
                calistir.wait_until_ready(process, 'ours')
            request.assert_not_called()

    def test_timeout(self):
        process = Mock()
        process.poll.return_value = None
        with patch.object(calistir.time, 'monotonic', side_effect=[0, 121]):
            with self.assertRaises(RuntimeError):
                calistir.wait_until_ready(process, 'ours')

    def test_browser_only_opens_after_readiness(self):
        process = Mock()
        process.poll.return_value = 0
        process.returncode = 0
        process.wait.return_value = 0
        order = []
        with patch.object(calistir, 'check_and_install'), patch.object(calistir.subprocess, 'Popen', return_value=process), patch.object(calistir, 'wait_until_ready', side_effect=lambda *args: order.append('ready')), patch.object(calistir.webbrowser, 'open', side_effect=lambda *args: order.append('browser')), patch('pathlib.Path.open', unittest.mock.mock_open()):
            self.assertEqual(calistir.main(), 0)
        self.assertEqual(order, ['ready', 'browser'])

    def test_startup_failure_does_not_open_browser(self):
        process = Mock()
        process.poll.return_value = None
        with patch.object(calistir, 'check_and_install'), patch.object(calistir.subprocess, 'Popen', return_value=process), patch.object(calistir.subprocess, 'run'), patch.object(calistir, 'wait_until_ready', side_effect=RuntimeError('startup failed')), patch.object(calistir.webbrowser, 'open') as browser, patch('pathlib.Path.open', unittest.mock.mock_open()):
            self.assertEqual(calistir.main(), 1)
            browser.assert_not_called()
            process.terminate.assert_called_once()

    def test_ctrl_c_interrupts_wait_and_cleans_up(self):
        process = Mock()
        process.poll.return_value = None
        with patch.object(calistir, 'check_and_install'), patch.object(calistir.subprocess, 'Popen', return_value=process), patch.object(calistir, 'wait_until_ready'), patch.object(calistir.webbrowser, 'open'), patch('pathlib.Path.open', unittest.mock.mock_open()), patch.object(calistir.time, 'sleep', side_effect=KeyboardInterrupt), patch.object(calistir, 'stop_server') as stop:
            self.assertEqual(calistir.main(), 0)
            stop.assert_called_once_with(process)
            process.wait.assert_not_called()

    def test_wait_returns_server_exit_code_without_blocking_wait(self):
        process = Mock(returncode=7)
        process.poll.side_effect = [None, 7]
        with patch.object(calistir.time, 'sleep'):
            self.assertEqual(calistir.wait_for_server(process), 7)
            process.wait.assert_not_called()

    @unittest.skipUnless(calistir.os.name == 'nt', 'Windows process tree cleanup')
    def test_windows_shutdown_targets_only_owned_process_tree(self):
        process = Mock(pid=12345)
        process.poll.side_effect = [None, 0]
        with patch.object(calistir.subprocess, 'run') as run:
            calistir.stop_server(process)
            self.assertEqual(run.call_args.args[0], ['taskkill', '/PID', '12345', '/T', '/F'])
            process.terminate.assert_not_called()
            process.wait.assert_called_once_with(timeout=5)
