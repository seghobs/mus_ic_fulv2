"""One server-side Musicful notification connection for the active account."""
import hashlib
import json
import re
import threading
import time

import requests
from core.auth import load_token, api_headers
from core.tasks import sse_notify

MAIN = 'https://aimusic-api.topmediai.com/musicful'
SSE_URL = 'https://community-api.musicful.ai/notification/sse/get'


def parse_events(lines):
    event, data, size = 'message', [], 0
    for line in lines:
        if isinstance(line, bytes):
            line = line.decode('utf-8', errors='replace')
        if not line:
            if data:
                yield event, '\n'.join(data)
            event, data, size = 'message', [], 0
        elif line.startswith('event:'):
            event = line[6:].strip()
        elif line.startswith('data:'):
            size += len(line)
            if size > 65536:
                raise ValueError('Oversized SSE event')
            data.append(line[5:].lstrip(' '))


def ready_song_id(event, raw):
    try:
        body = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(body, dict):
        return None
    kind = body.get('type') or body.get('event_type') or body.get('topic') or body.get('event') or event
    if kind != 'listen':
        return None
    payload = body.get('payload', body)
    sid = payload.get('song_id') if isinstance(payload, dict) else None
    if type(sid) is int:
        sid = str(sid)
    return sid if isinstance(sid, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,160}', sid) else None


class MusicfulEvents:
    def __init__(self):
        self.lock = threading.Lock()
        self.thread = None
        self.stop = threading.Event()
        self.state = 'idle'
        self.seen = {}

    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive():
                return
            self.thread = threading.Thread(target=self.run, daemon=True, name='musicful-events')
            self.thread.start()

    def current(self, token):
        try:
            return not self.stop.is_set() and load_token() == token
        except (OSError, ValueError):
            return False

    def deliver(self, token, sid):
        if not self.current(token):
            return
        scope = hashlib.sha256(token.encode()).hexdigest()
        key = (scope, sid)
        now = time.monotonic()
        self.seen = {k: t for k, t in self.seen.items() if now - t < 3600}
        if key in self.seen:
            return
        # The notification is a hint; verify completion before announcing it.
        with requests.get(MAIN + '/v2/task/results', headers=api_headers(token),
                          params={'ids': sid}, timeout=(5, 10)) as response:
            response.raise_for_status()
            body = response.json()
        rows = (body.get('data') or {}).get('result', [])
        ready = next((r for r in rows if isinstance(r, dict) and
                      sid in (str(r.get('song_id')), str(r.get('id'))) and
                      r.get('status') in (0, 2) and r.get('audio_url')), None)
        if ready and self.current(token):
            self.seen[key] = now
            sse_notify('musicful_song_ready', {
                'song_id': str(ready.get('song_id') or sid), 'account': scope,
                'ids': list(dict.fromkeys(str(value) for value in
                            (sid, ready.get('id'), ready.get('song_id')) if value is not None))})

    def listen(self, token):
        headers = {**api_headers(token), 'terminal': 'web'}
        with requests.post(MAIN + '/v1/user/author-page', headers=headers, timeout=(5, 10)) as response:
            response.raise_for_status()
            member = (response.json().get('data') or {}).get('member_id')
        if not member or not self.current(token):
            return
        params = {'token': token, 'user_id': member, 'channels': f'user:{member}'}
        with requests.get(SSE_URL, headers={**headers, 'accept': 'text/event-stream'},
                          params=params, stream=True, timeout=(5, 20)) as response:
            response.raise_for_status()
            if 'text/event-stream' not in response.headers.get('Content-Type', ''):
                raise ValueError('Not an event stream')
            self.state = 'connected'
            def lines():
                for line in response.iter_lines(chunk_size=1):
                    if not self.current(token):
                        break
                    yield line
            for event, raw in parse_events(lines()):
                sid = ready_song_id(event, raw)
                if sid:
                    try:
                        self.deliver(token, sid)
                    except (requests.RequestException, ValueError, TypeError, AttributeError):
                        pass  # Existing polling remains the fallback.

    def run(self):
        delay = 1
        while not self.stop.is_set():
            self.state = 'connecting'
            try:
                self.listen(load_token())
                delay = 1
            except (requests.RequestException, OSError, ValueError, TypeError, AttributeError):
                # Never log exception URLs: the upstream requires a token query parameter.
                delay = min(delay * 2, 30)
            self.state = 'reconnecting'
            self.stop.wait(delay)


musicful_events = MusicfulEvents()
