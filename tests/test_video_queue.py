import io
import tempfile
import unittest
from unittest.mock import patch
from flask import Flask
from routes import video_routes


class VideoQueueTests(unittest.TestCase):
    def test_video_request_queues_before_downloading(self):
        app = Flask(__name__)
        app.register_blueprint(video_routes.video_bp)
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(video_routes, 'VIDEO_TEMP', directory), \
                patch.object(video_routes, 'task_queue', {'task': {}}), \
                patch.object(video_routes, 'submit_task', return_value='task') as submit, \
                patch('core.auth.load_token', return_value='test'), \
                patch('routes.musicful_routes.get_song_url') as resolve:
            response = app.test_client().post('/api/create-video', data={
                'audio_id': 'song', 'image': (io.BytesIO(b'image'), 'cover.png')})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['task_id'], 'task')
            submit.assert_called_once()
            resolve.assert_not_called()
