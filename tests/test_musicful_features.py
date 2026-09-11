import unittest
from unittest.mock import Mock, patch
from flask import Flask
from routes.musicful_features import features_bp


class FeatureTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(features_bp)
        self.client = app.test_client()

    def test_invalid_style_does_not_contact_service(self):
        with patch('routes.musicful_features.call_service') as call:
            for value in ['', 'x' * 801, None, 1]:
                self.assertEqual(self.client.post('/api/features/style-optimize', json={'prompt': value}).status_code, 400)
            call.assert_not_called()

    def test_style_uses_multipart_and_returns_suggestion(self):
        with patch('routes.musicful_features.call_service', return_value={'enhancement_style': 'Acoustic piano'}) as call:
            response = self.client.post('/api/features/style-optimize', json={'prompt': 'Piano'})
            self.assertEqual(response.json, {'style': 'Acoustic piano'})
            self.assertEqual(call.call_args.kwargs['files'], {'prompt': (None, 'Piano')})

    def test_wav_only_returns_https_link(self):
        with patch('routes.musicful_features.call_service', return_value={'result': 'javascript:alert(1)'}):
            self.assertEqual(self.client.post('/api/features/wav/song-1').status_code, 502)
        with patch('routes.musicful_features.call_service', return_value={'result': 'https%3A%2F%2Fexample.com%2Fa.wav'}):
            self.assertEqual(self.client.post('/api/features/wav/song-1').json['url'], 'https://example.com/a.wav')

    def test_ledger_filters_account_fields_and_respects_pagination(self):
        data = {'list': [{'amount': -2, 'scene_description': 'Music', 'user_id': 42, 'token': 'secret'}],
                'page': {'page_size': 10, 'total': 11}}
        with patch('routes.musicful_features.call_service', return_value=data) as call:
            response = self.client.get('/api/features/lists/credits?page=2')
            self.assertEqual(response.json['items'], [{'amount': -2, 'scene_description': 'Music'}])
            self.assertFalse(response.json['has_more'])
            self.assertEqual(call.call_args.kwargs['params']['page_num'], 2)

    def test_switched_account_cannot_receive_previous_result(self):
        with patch('routes.musicful_features.load_token', side_effect=['old', 'new']), patch(
                'routes.musicful_features.requests.request', return_value=Mock(ok=True, json=lambda: {'status': 200, 'data': {'list': []}})):
            self.assertEqual(self.client.get('/api/features/lists/credits').status_code, 400)

    def test_failed_service_is_not_retried(self):
        with patch('routes.musicful_features.load_token', return_value='test'), patch(
                'routes.musicful_features.requests.request', return_value=Mock(ok=True, json=lambda: {'status': 401})) as call:
            self.assertEqual(self.client.post('/api/features/wav/song-1').status_code, 400)
            self.assertEqual(call.call_count, 1)
