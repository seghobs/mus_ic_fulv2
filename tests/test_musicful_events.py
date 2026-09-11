import unittest
from unittest.mock import patch, Mock
from core.musicful_events import MusicfulEvents, parse_events, ready_song_id


class EventTests(unittest.TestCase):
    def test_named_and_multiline_frames(self):
        frames = list(parse_events([b': heartbeat', b'', b'event: listen', b'data: {',
                                   b'data: "song_id":"song-1"}', b'', b'data: {}', b'']))
        self.assertEqual(ready_song_id(*frames[0]), 'song-1')
        self.assertEqual(frames[1][0], 'message')

    def test_enveloped_listen_only(self):
        self.assertEqual(ready_song_id('listen', '{"song_id":123}'), '123')
        self.assertEqual(ready_song_id('message', '{"type":"listen","payload":{"song_id":"s"}}'), 's')
        for event, raw in [('listen', 'broken'), ('comment_like_create', '{"song_id":"s"}'),
                           ('listen', '{"song_id":"../s"}'), ('listen', '[]')]:
            self.assertIsNone(ready_song_id(event, raw))

    def test_oversized_frame_is_bounded(self):
        with self.assertRaises(ValueError):
            list(parse_events(['data: ' + 'x' * 65537]))

    def response(self, rows):
        response = Mock()
        response.json.return_value = {'data': {'result': rows}}
        context = Mock()
        context.__enter__ = Mock(return_value=response)
        context.__exit__ = Mock(return_value=False)
        return context

    def test_verified_completion_is_deduplicated(self):
        bridge = MusicfulEvents()
        with patch('core.musicful_events.load_token', return_value='token'), patch(
                'core.musicful_events.requests.get', return_value=self.response([
                    {'song_id':'s', 'status':2, 'audio_url':'url'}])) as get, patch(
                'core.musicful_events.sse_notify') as notify:
            bridge.deliver('token', 's')
            bridge.deliver('token', 's')
            self.assertEqual(get.call_count, 1)
            self.assertEqual(notify.call_count, 1)
            self.assertEqual(notify.call_args.args[0], 'musicful_song_ready')
            self.assertNotIn('token', notify.call_args.args[1])

    def test_incomplete_and_wrong_song_never_announce(self):
        bridge = MusicfulEvents()
        with patch('core.musicful_events.load_token', return_value='token'), patch(
                'core.musicful_events.requests.get', return_value=self.response([
                    {'song_id':'s', 'status':1}, {'song_id':'other', 'status':2, 'audio_url':'url'}])), patch(
                'core.musicful_events.sse_notify') as notify:
            bridge.deliver('token', 's')
            notify.assert_not_called()

    def test_account_change_during_verification_discards_event(self):
        bridge = MusicfulEvents()
        with patch('core.musicful_events.load_token', side_effect=['token', 'new-token']), patch(
                'core.musicful_events.requests.get', return_value=self.response([
                    {'song_id':'s', 'status':2, 'audio_url':'url'}])), patch(
                'core.musicful_events.sse_notify') as notify:
            bridge.deliver('token', 's')
            notify.assert_not_called()

    def test_numeric_notification_is_verified_and_emits_both_identifiers(self):
        bridge = MusicfulEvents()
        with patch('core.musicful_events.load_token', return_value='token'), patch(
                'core.musicful_events.requests.get', return_value=self.response([
                    {'id':'123', 'song_id':'uuid-a', 'status':0, 'audio_url':'url'}])), patch(
                'core.musicful_events.sse_notify') as notify:
            bridge.deliver('token', '123')
            self.assertEqual(notify.call_args.args[1]['song_id'], 'uuid-a')
            self.assertEqual(set(notify.call_args.args[1]['ids']), {'123', 'uuid-a'})
