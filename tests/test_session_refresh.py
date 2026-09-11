import copy
import unittest
from unittest.mock import patch
from core import auth


class SessionRefreshTests(unittest.TestCase):
    def setUp(self):
        auth._last_refresh = None
        self.tokens = [{'id': 'last', 'name': 'last@example.test', 'token': 'old', 'active': True},
                       {'id': 'other', 'name': 'other@example.test', 'token': 'other', 'active': False}]
        self.accounts = {'saved': [{'email': 'last@example.test', 'password': 'saved', 'token': 'old'}]}
        self.patches = [
            patch.object(auth, '_read_tokens', side_effect=lambda: copy.deepcopy(self.tokens)),
            patch.object(auth, '_write_tokens', side_effect=lambda value: setattr(self, 'tokens', value)),
            patch.object(auth, 'safe_read_json', side_effect=lambda _: copy.deepcopy(self.accounts)),
            patch.object(auth, 'safe_write_json', side_effect=lambda _, value: setattr(self, 'accounts', value)),
            patch('core.account_manager.MusicfulBot.login_api', return_value={'code': 200, 'data': {'token': 'fresh'}}),
            patch.object(auth, 'switch_to_next_account'),
        ]
        mocks = [p.start() for p in self.patches]
        self.login, self.switch = mocks[-2:]
        for p in self.patches:
            self.addCleanup(p.stop)
        self.addCleanup(setattr, auth, '_last_refresh', None)

    def test_refreshes_only_last_account_and_coalesces_repeats(self):
        self.assertTrue(auth.refresh_active_session()['refreshed'])
        self.assertTrue(auth.refresh_active_session()['refreshed'])
        self.login.assert_called_once_with('last@example.test', 'saved')
        self.assertEqual(self.tokens[0]['token'], 'fresh')
        self.assertEqual(self.accounts['saved'][0]['token'], 'fresh')
        self.assertFalse(self.tokens[1]['active'])
        self.switch.assert_not_called()

    def test_missing_password_keeps_existing_session(self):
        self.accounts['saved'][0].pop('password')
        with patch('core.account_manager.MusicfulBot.get_credits', return_value=10):
            self.assertFalse(auth.refresh_active_session()['refreshed'])
        self.login.assert_not_called()
        self.assertEqual(self.tokens[0]['token'], 'old')

    def test_missing_password_and_expired_token_stops_startup(self):
        self.accounts['saved'][0].pop('password')
        with patch('core.account_manager.MusicfulBot.get_credits', return_value=None):
            self.assertFalse(auth.refresh_active_session()['ok'])

    def test_failed_login_preserves_existing_token(self):
        self.login.return_value = {'code': 401}
        self.assertFalse(auth.refresh_active_session()['ok'])
        self.assertEqual(self.tokens[0]['token'], 'old')
        self.switch.assert_not_called()

    def test_selection_changed_during_login_is_preserved(self):
        def login(*args):
            self.tokens[0]['active'] = False
            self.tokens[1]['active'] = True
            return {'code': 200, 'data': {'token': 'fresh'}}
        self.login.side_effect = login
        self.assertEqual(auth.refresh_active_session()['reason'], 'account_changed')
        self.assertTrue(self.tokens[1]['active'])
        self.assertEqual(self.tokens[0]['token'], 'old')


if __name__ == '__main__':
    unittest.main()
