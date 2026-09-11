import unittest
from unittest.mock import patch, Mock
from flask import Flask
from routes.musicful_routes import musicful_bp


class StreamingTests(unittest.TestCase):
    def test_download_yields_before_entire_file_is_read(self):
        app = Flask(__name__)
        app.register_blueprint(musicful_bp)
        consumed = []
        def chunks(**kwargs):
            consumed.append('first')
            yield b'first'
            consumed.append('last')
            yield b'last'
        upstream = Mock(status_code=206, headers={'Content-Range': 'bytes 0-8/9'})
        upstream.iter_content.side_effect = chunks
        with patch('routes.musicful_routes.get_song_url', return_value='https://cdn.example.test/song.mp3'), \
                patch('routes.musicful_routes.streaming_requests.get', return_value=upstream) as get:
            response = app.test_client().get('/api/download/song', buffered=False, headers={'Range': 'bytes=0-8'})
            self.assertEqual(consumed, ['first'])
            self.assertEqual(response.status_code, 206)
            self.assertEqual(get.call_args.kwargs['headers']['Range'], 'bytes=0-8')
            self.assertTrue(get.call_args.kwargs['stream'])
            self.assertEqual(response.get_data(), b'firstlast')
            response.close()
            upstream.close.assert_called()

    def test_known_song_url_skips_metadata_requests_and_is_account_scoped(self):
        from routes import musicful_routes as routes
        with patch.object(routes, '_song_urls', {}), patch.object(routes.requests, 'get') as get:
            routes.remember_song_urls('account-a', [{'song_id': 'song', 'audio_url': 'https://cdn.example.test/a.mp3'}])
            routes.remember_song_urls('account-b', [{'song_id': 'song', 'audio_url': 'https://cdn.example.test/b.mp3'}])
            self.assertEqual(routes.get_song_url('song', token='account-a'), 'https://cdn.example.test/a.mp3')
            self.assertEqual(routes.get_song_url('song', token='account-b'), 'https://cdn.example.test/b.mp3')
            get.assert_not_called()

    def test_fallback_redirects_without_downloading_audio(self):
        app = Flask(__name__)
        app.register_blueprint(musicful_bp)
        with patch('routes.musicful_routes.get_song_url', return_value='https://cdn.example.test/song.mp3'), \
                patch('routes.musicful_routes.requests.get') as download:
            response = app.test_client().get('/api/stream/song', headers={'Range': 'bytes=0-1023'})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers['Location'], 'https://cdn.example.test/song.mp3')
        download.assert_not_called()
