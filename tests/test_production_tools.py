import unittest
from unittest.mock import patch
from flask import Flask
from routes.musicful_features import features_bp


class ProductionTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(features_bp)
        self.client = app.test_client()
        p = patch('routes.musicful_features.account_scope', return_value='account-a')
        p.start()
        self.addCleanup(p.stop)

    def post(self, kind, **data):
        return self.client.post('/api/features/production/' + kind, json={'account': 'account-a', **data})

    def test_account_mismatch_never_submits(self):
        with patch('routes.musicful_features.call_service') as call:
            self.assertEqual(self.post('basic', account='account-b').status_code, 400)
            call.assert_not_called()

    def test_basic_payload_and_task_ids(self):
        with patch('routes.musicful_features.call_service', return_value={'song_ids': ['s-1', 's-2']}) as call:
            r = self.post('basic', description='Soft piano', mv='v5.5', instrumental=True)
            self.assertEqual(r.json['song_ids'], ['s-1', 's-2'])
            self.assertEqual(call.call_args.kwargs['json']['instrumental'], 1)
            self.assertEqual(call.call_args.kwargs['expected_scope'], 'account-a')

    def test_sounds_are_nested_and_limits_reject_before_call(self):
        with patch('routes.musicful_features.call_service', return_value={'song_ids': ['s']}) as call:
            self.assertEqual(self.post('sounds', description='Rain', sound_type='loop', bpm=90).status_code, 200)
            self.assertEqual(call.call_args.kwargs['json']['sound']['bpm'], 90)
            call.reset_mock()
            for bpm in [-1, 301, '80', True]:
                self.assertEqual(self.post('sounds', description='Rain', bpm=bpm).status_code, 400)
            call.assert_not_called()

    def test_mashup_returns_text_without_creating_song(self):
        with patch('routes.musicful_features.call_service', return_value={'mashup_lyrics': 'Combined'}) as call:
            self.assertEqual(self.post('mashup', lyrics_a='A', lyrics_b='B').json['lyrics'], 'Combined')
            self.assertEqual(call.call_count, 1)

    def test_replace_uses_form_encoding_and_validates_range(self):
        fields = dict(song_id='s', mv='v5.5', lyrics='New verse', full_lyrics='Full song', start=2, end=20)
        with patch('routes.musicful_features.call_service', return_value={'song_ids': ['r']}) as call:
            self.assertEqual(self.post('replace', **fields).status_code, 200)
            self.assertEqual(call.call_args.kwargs['data']['action'], 'replace_section')
            call.reset_mock()
            for start, end in [(20, 2), (-1, 20), (2, 2), (True, 20), (0, float('inf'))]:
                self.assertEqual(self.post('replace', **{**fields, 'start': start, 'end': end}).status_code, 400)
            call.assert_not_called()

    def test_merge_has_source_clip_and_concat_action(self):
        with patch('routes.musicful_features.call_service', return_value={'song_ids': ['r']}) as call:
            self.assertEqual(self.post('merge', song_id='extended-song', mv='v5.5').status_code, 200)
            self.assertEqual(call.call_args.kwargs['data']['continue_clip_id'], 'extended-song')
            self.assertEqual(call.call_args.kwargs['data']['action'], 'concat')

    def test_soundtrack_compresses_before_generation(self):
        with patch('routes.musicful_features.call_service', side_effect=[{'compressed_video_url': 'https://cdn.example/small.mp4'}, {'song_ids': ['r']}]) as call:
            self.assertEqual(self.post('soundtrack', video_url='https://cdn.example/video.mp4').status_code, 200)
            self.assertIn('compress-video', call.call_args_list[0].args[1])
            self.assertEqual(call.call_args_list[1].kwargs['json']['compressed_video_url'], 'https://cdn.example/small.mp4')

    def test_failed_compression_does_not_generate(self):
        with patch('routes.musicful_features.call_service', return_value={}) as call:
            self.assertEqual(self.post('soundtrack', video_url='https://cdn.example/video.mp4').status_code, 400)
            self.assertEqual(call.call_count, 1)

    def test_missing_ids_does_not_retry(self):
        with patch('routes.musicful_features.call_service', return_value={}) as call:
            self.assertEqual(self.post('basic', description='Piano', mv='v5.5').status_code, 502)
            self.assertEqual(call.call_count, 1)

    def test_results_are_filtered_and_require_audio_before_ready(self):
        with patch('routes.musicful_features.call_service', return_value={'result': [
                {'song_id': 'a', 'status': 2}, {'song_id': 'b', 'status': 2, 'audio_url': 'encoded'},
                {'song_id': 'unrelated', 'status': 2, 'audio_url': 'encoded'}]}):
            r = self.client.get('/api/features/production/results?account=account-a&ids=a,b')
            self.assertEqual(len(r.json['results']), 2)
            self.assertFalse(r.json['results'][0]['ready'])
            self.assertTrue(r.json['results'][1]['ready'])

    def test_results_accept_numeric_task_id_and_keep_song_uuid(self):
        with patch('routes.musicful_features.call_service', return_value={'result': [
                {'id': '123', 'song_id': 'uuid-a', 'status': 0, 'audio_url': 'encoded'},
                {'id': '999', 'song_id': 'uuid-other', 'status': 0, 'audio_url': 'encoded'}]}):
            r = self.client.get('/api/features/production/results?account=account-a&ids=123')
            self.assertEqual(len(r.json['results']), 1)
            self.assertEqual(r.json['results'][0]['id'], '123')
            self.assertEqual(r.json['results'][0]['song_id'], 'uuid-a')
            self.assertTrue(r.json['results'][0]['ready'])
