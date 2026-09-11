import unittest
from unittest.mock import Mock, patch
from flask import Flask
from routes.youtube_routes import youtube_bp
from core.youtube_media import _resolve

class YoutubePlaybackTests(unittest.TestCase):
    def setUp(self):
        _resolve.cache_clear()
        app=Flask(__name__);app.register_blueprint(youtube_bp);self.client=app.test_client()

    def test_stream_preserves_seek_and_closes(self):
        upstream=Mock(status_code=206,headers={'Content-Type':'audio/webm','Content-Range':'bytes 100-103/500','Content-Length':'4'})
        upstream.iter_content.return_value=iter([b'ab',b'cd'])
        with patch('core.youtube_media.resolve_audio',return_value=('https://cdn.test/a',{'User-Agent':'extractor'})),patch('requests.get',return_value=upstream) as get:
            response=self.client.get('/api/yt-play/abcdefghijk',headers={'Range':'bytes=100-103'})
            self.assertEqual(response.status_code,206)
            self.assertEqual(response.data,b'abcd')
            self.assertEqual(response.headers['Content-Range'],'bytes 100-103/500')
            self.assertEqual(get.call_args.kwargs['headers']['Range'],'bytes=100-103')
            self.assertEqual(get.call_args.kwargs['headers']['User-Agent'],'extractor')
            self.assertTrue(get.call_args.kwargs['stream'])
            upstream.close.assert_called()

    def test_expired_url_is_resolved_once_more(self):
        rejected=Mock(status_code=403)
        ready=Mock(status_code=200,headers={'Content-Type':'audio/webm'})
        ready.iter_content.return_value=iter([b'audio'])
        with patch('core.youtube_media.resolve_audio',return_value=('https://cdn.test/a',{})) as resolve,patch('requests.get',side_effect=[rejected,ready]):
            response=self.client.get('/api/yt-play/abcdefghijk')
            self.assertEqual(response.data,b'audio')
            self.assertTrue(resolve.call_args.kwargs['refresh'])
            rejected.close.assert_called_once()

    def test_invalid_input_never_resolves(self):
        with patch('core.youtube_media.resolve_audio') as resolve:
            self.assertEqual(self.client.get('/api/yt-play/bad').status_code,400)
            self.assertEqual(self.client.get('/api/yt-play/abcdefghijk',headers={'Range':'bytes=1-2,4-5'}).status_code,416)
            resolve.assert_not_called()

    def test_resolution_is_cached_for_seeking(self):
        with patch('core.youtube_media.yt_dlp.YoutubeDL') as ydl:
            extract=ydl.return_value.__enter__.return_value.extract_info
            extract.return_value={'url':'https://cdn.test/a','http_headers':{}}
            _resolve('abcdefghijk',1);_resolve('abcdefghijk',1)
            self.assertEqual(extract.call_count,1)
            self.assertFalse(extract.call_args.kwargs['download'])
