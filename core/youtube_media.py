"""Resolve short-lived YouTube media URLs with yt-dlp, without downloading a file."""
from functools import lru_cache
import shutil
import time
import yt_dlp


def runtime_options():
    node = shutil.which('node')
    return {'js_runtimes': {'node': {'path': node}}} if node else {}


@lru_cache(maxsize=64)
def _resolve(video_id, bucket):
    options = {'format': 'bestaudio[protocol=https]/best[protocol=https]',
               'quiet': True, 'no_warnings': True, 'noplaylist': True,
               'socket_timeout': 15, 'retries': 1, 'extractor_retries': 1,
               **runtime_options()}
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(f'https://www.youtube.com/watch?v={video_id}', download=False)
    if not info or not info.get('url'):
        raise ValueError('Ses akışı bulunamadı')
    return info['url'], info.get('http_headers') or {}


def resolve_audio(video_id, refresh=False):
    if refresh:
        _resolve.cache_clear()
    return _resolve(video_id, int(time.monotonic() // 120))
