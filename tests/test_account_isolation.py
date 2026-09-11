import tempfile
import os
import unittest
from unittest.mock import patch, Mock
from concurrent.futures import ThreadPoolExecutor
from flask import Flask
from core import auth, config
from routes.musicful_routes import musicful_bp
from routes.auth_routes import auth_bp


class AccountIsolationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.accounts = os.path.join(self.tmp.name, 'accounts.json')
        self.tokens = os.path.join(self.tmp.name, 'tokens.json')
        for target, name, value in [(config, 'BASE_DIR', self.tmp.name),
                                    (config, 'ACCOUNTS_FILE', self.accounts),
                                    (auth, 'TOKENS_FILE', self.tokens)]:
            p = patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.select('a')
        app = Flask(__name__)
        app.register_blueprint(musicful_bp)
        app.register_blueprint(auth_bp)
        self.client = app.test_client()

    def select(self, token):
        auth._write_tokens([{'id': token, 'name': token, 'token': token, 'active': True}])

    def test_add_and_toggle_keep_exactly_one_selected(self):
        response = self.client.post('/api/tokens', json={'name': 'b', 'token': 'b'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(auth.load_token(), 'b')
        self.client.post('/api/tokens/toggle/a')
        self.assertEqual(auth.load_token(), 'a')
        self.assertEqual(sum(t['active'] for t in auth._read_tokens()), 1)

    def test_cached_library_never_crosses_accounts(self):
        def response(*args, **kwargs):
            token = kwargs['headers']['authorization'].split()[-1]
            return Mock(status_code=200, json=lambda: {'data': {'list': [{'song_id': token}]}})
        with patch('routes.musicful_routes.requests.get', side_effect=response) as get:
            self.assertEqual(self.client.get('/api/songs?limit=5').json['data']['list'][0]['song_id'], 'a')
            self.select('b')
            self.assertEqual(self.client.get('/api/songs?limit=5').json['data']['list'][0]['song_id'], 'b')
            self.assertEqual(get.call_count, 2)

    def test_delayed_rights_cannot_restore_old_token(self):
        config.safe_write_json(self.accounts, {'g': [{'email': 'a', 'token': 'fresh', 'credits': 20}]})
        with patch('routes.musicful_routes.requests.get', return_value=Mock(
                status_code=200, json=lambda: {'data': {'result': {'left': 1}}})):
            self.client.get('/api/rights')
        saved = config.safe_read_json(self.accounts)['g'][0]
        self.assertEqual(saved['token'], 'fresh')
        self.assertEqual(saved['credits'], 20)

    def test_atomic_updates_do_not_lose_changes(self):
        config.safe_write_json(self.accounts, {'count': 0})
        def increment(_):
            config.update_json(self.accounts, lambda data: data.update(count=data['count'] + 1))
        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(increment, range(80)))
        self.assertEqual(config.safe_read_json(self.accounts)['count'], 80)
