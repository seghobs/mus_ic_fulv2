import unittest
from unittest.mock import patch, Mock

from flask import Flask
from routes import musicful_routes as routes
import calistir


class SongValidationTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(routes.musicful_bp)
        self.client = app.test_client()

    def test_oversized_fields_never_start_generation(self):
        for endpoint in ('make-song', 'text-to-song'):
            for field, limit in [('title', 150), ('lyrics', 3500), ('style', 800)]:
                with self.subTest(endpoint=endpoint, field=field), \
                        patch.object(routes, 'load_token') as token, \
                        patch.object(routes.requests, 'post') as post:
                    response = self.client.post('/api/' + endpoint, json={field: 'x' * (limit + 1)})
                    self.assertEqual(response.status_code, 400)
                    self.assertIn(str(limit), response.json['error'])
                    token.assert_not_called()
                    post.assert_not_called()

    def test_exact_limits_are_forwarded_unchanged(self):
        payload = {'title': 't' * 150, 'lyrics': 'ş' * 3500, 'style': 's' * 800}
        for endpoint in ('make-song', 'text-to-song'):
            with self.subTest(endpoint=endpoint), \
                    patch.object(routes, 'load_token', return_value='test'), \
                    patch.object(routes.requests, 'post', return_value=Mock(
                        json=lambda: {'status': 200, 'data': {'song_ids': ['a', 'b']}})) as post:
                response = self.client.post('/api/' + endpoint, json=payload)
                self.assertEqual(response.status_code, 200)
                sent = post.call_args.kwargs
                for field, value in payload.items():
                    self.assertEqual(sent['json'][field] if 'json' in sent else sent['files'][field][1], value)

    def test_invalid_json_shape(self):
        for endpoint in ('make-song', 'text-to-song'):
            response = self.client.post('/api/' + endpoint, json=[])
            self.assertEqual(response.status_code, 400)

    def test_removed_filter_option_cannot_modify_text(self):
        payload = {'title': 'A Peaceful Song', 'lyrics': '[Verse]\nCome home', 'bypass_filter': True}
        for endpoint in ('make-song', 'text-to-song'):
            with self.subTest(endpoint=endpoint), patch.object(routes, 'load_token', return_value='test'), patch.object(routes.requests, 'post', return_value=Mock(json=lambda: {'status': 200, 'data': {'song_ids': ['a']}})) as post:
                self.assertEqual(self.client.post('/api/' + endpoint, json=payload).status_code, 200)
                sent = post.call_args.kwargs
                body = sent.get('json', sent.get('files'))
                self.assertNotIn('bypass_filter', body)
                for field in ('title', 'lyrics'):
                    self.assertEqual(body[field] if 'json' in sent else body[field][1], payload[field])

    def test_launcher_checks_aiohttp(self):
        self.assertIn('aiohttp', calistir.LIBS)
        with patch.object(calistir, 'version', return_value='9999.0') as version:
            calistir.check_and_install()
            version.assert_any_call('aiohttp')


if __name__ == '__main__':
    unittest.main()
