from urllib.parse import unquote, urlparse
import hashlib
import math
import re
import requests
from flask import Blueprint, jsonify, request
from core.auth import load_token, api_headers

features_bp = Blueprint('musicful_features', __name__)
MAIN = 'https://aimusic-api.topmediai.com/musicful'
LISTS = {
    'credits': MAIN + '/v1/user/credits-consume-ledger',
    'personas': MAIN + '/v1/personas',
    'playlists': MAIN + '/v1/playlists',
    'trash': MAIN + '/trash/list',
    'notifications': 'https://community-api.musicful.ai/musicful/notifications/history',
    'covers': 'https://aicover-api.topmediai.com/musicful/v1/cover/histories',
}


def call_service(method, url, expected_scope=None, **kwargs):
    token = load_token()
    if expected_scope and hashlib.sha256(token.encode()).hexdigest() != expected_scope:
        raise ValueError('Hesap değişti. İşlem gönderilmedi.')
    headers = {**api_headers(token), 'terminal': 'web'}
    response = requests.request(method, url, headers=headers, timeout=(10, 45), **kwargs)
    body = response.json()
    if not response.ok or not isinstance(body, dict) or not (
            body.get('status') == 200 or body.get('code') in (0, 200)):
        raise ValueError('Musicful işlemi tamamlayamadı. Oturumu ve hesap yetkilerini kontrol edin.')
    if load_token() != token:
        raise ValueError('İşlem sırasında hesap değişti. Sonucu görmek için tekrar yükleyin.')
    return body.get('data')


@features_bp.errorhandler(ValueError)
@features_bp.errorhandler(FileNotFoundError)
def invalid_request(error):
    return jsonify(error=str(error)), 400


@features_bp.errorhandler(requests.RequestException)
def service_error(error):
    return jsonify(error='Servise ulaşılamadı. İşlem otomatik tekrarlanmadı; tekrar denemeden önce hesabınızı kontrol edin.'), 502


@features_bp.post('/api/features/style-optimize')
def optimize_style():
    data = request.get_json(silent=True)
    prompt = data.get('prompt') if isinstance(data, dict) else None
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 800:
        return jsonify(error='İyileştirmek için 1–800 karakterlik bir stil yazın.'), 400
    result = call_service('POST', MAIN + '/app/v1/song/styles/optimize', files={'prompt': (None, prompt)})
    text = result.get('enhancement_style') if isinstance(result, dict) else None
    if not isinstance(text, str) or not text.strip():
        return jsonify(error='Servis kullanılabilir bir stil döndürmedi.'), 502
    return jsonify(style=text)


@features_bp.post('/api/features/wav/<song_id>')
def wav(song_id):
    if not all(c.isalnum() or c in '-_' for c in song_id):
        return jsonify(error='Geçersiz şarkı kimliği.'), 400
    result = call_service('POST', MAIN + f'/v1/{song_id}/generate-wav')
    value = result.get('result') if isinstance(result, dict) else None
    url = unquote(value) if isinstance(value, str) else ''
    if urlparse(url).scheme != 'https' or not urlparse(url).hostname:
        return jsonify(error='WAV indirme adresi alınamadı.'), 502
    return jsonify(url=url)


@features_bp.get('/api/features/lists/<kind>')
def list_feature(kind):
    if kind not in LISTS:
        return jsonify(error='Liste bulunamadı.'), 404
    page = max(1, request.args.get('page', 1, type=int))
    params = {'page': page, 'limit': 10, 'page_num': page, 'page_size': 10}
    if kind == 'trash':
        params['trash_type'] = 1
    data = call_service('GET', LISTS[kind], params=params)
    if not isinstance(data, dict):
        return jsonify(error='Liste yanıtı okunamadı.'), 502
    rows = data.get('notifications', []) if kind == 'notifications' else data.get('list', [])
    if not isinstance(rows, list):
        return jsonify(error='Liste yanıtı okunamadı.'), 502
    # Only forward display fields, never tokens or opaque account objects.
    allowed = {'id', 'name', 'title', 'description', 'content', 'message', 'created_at', 'create_time',
               'updated_at', 'date', 'credits', 'credit', 'amount', 'consume', 'cost', 'balance',
               'scene', 'scene_type', 'type', 'status', 'song_count', 'count', 'song_title',
               'remark', 'reason', 'change', 'points', 'used', 'time',
               'created_at_unix', 'scene_description'}
    items = [{k: v for k, v in row.items() if k in allowed and isinstance(v, (str, int, float, bool))}
             for row in rows if isinstance(row, dict)]
    more = data.get('has_more')
    if more is None:
        pagination = data.get('page')
        if isinstance(pagination, dict) and isinstance(pagination.get('total'), (int, float)):
            more = page * pagination.get('page_size', 10) < pagination['total']
        else:
            total_pages = data.get('total_pages')
            more = page < int(total_pages) if total_pages is not None else len(rows) >= 10
    return jsonify(items=items, page=page, has_more=bool(more))


def account_scope():
    return hashlib.sha256(load_token().encode()).hexdigest()


def text_field(data, name, limit, required=True):
    value = data.get(name, '')
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise ValueError(f'{name}: geçerli bir metin girin (en fazla {limit} karakter).')
    return value


def song_identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', value):
        raise ValueError('Geçersiz şarkı kimliği.')
    return value


@features_bp.get('/api/features/production/account')
def production_account():
    return jsonify(account=account_scope())


@features_bp.post('/api/features/production/<kind>')
def production_create(kind):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValueError('Form okunamadı.')
    scope = account_scope()
    if data.get('account') != scope:
        raise ValueError('Hesap değişti. Üretim penceresini yeniden açın.')
    encoding = 'json'
    if kind == 'basic':
        payload = {'description': text_field(data, 'description', 500),
                   'instrumental': 1 if data.get('instrumental') is True else 0,
                   'mv': text_field(data, 'mv', 30), 'area': 'TR', 'grade': 2}
        path = '/v2/basic/text-to-song'
    elif kind == 'sounds':
        sound_type = data.get('sound_type', 'one_shot')
        bpm = data.get('bpm', 0)
        if sound_type not in ('one_shot', 'loop') or type(bpm) is not int or not 0 <= bpm <= 300:
            raise ValueError('Ses türünü ve tempoyu kontrol edin (0: otomatik, 1–300 BPM).')
        payload = {'action': 'sounds', 'sound': {'description': text_field(data, 'description', 500),
                   'type': sound_type, 'bpm': bpm, 'key': ''}}
        path = '/v2/sounds'
    elif kind == 'mashup':
        payload = {k: text_field(data, k, 3500) for k in ('lyrics_a', 'lyrics_b')}
        path = '/v2/lyric-mashup'
    elif kind in ('merge', 'replace'):
        payload = {'continue_clip_id': song_identifier(data.get('song_id')),
                   'mv': text_field(data, 'mv', 30)}
        encoding = 'data'
        if kind == 'merge':
            payload['action'] = 'concat'
            path = '/v2/async/merge-song-continuations'
        else:
            start, end = data.get('start'), data.get('end')
            if any(type(n) not in (int, float) or not math.isfinite(n) for n in (start, end)) or not 0 <= start < end:
                raise ValueError('Başlangıç ve bitiş saniyelerini kontrol edin.')
            payload.update(action='replace_section', replace_section_start=start, replace_section_end=end,
                           replace_lyric=text_field(data, 'lyrics', 3500),
                           replace_full_lyric=text_field(data, 'full_lyrics', 3500),
                           title=text_field(data, 'title', 150, False))
            path = '/v2/async/replace-song-clips'
    elif kind == 'soundtrack':
        video = text_field(data, 'video_url', 2048)
        parsed = urlparse(video)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('Herkese açık bir HTTPS video dosyası bağlantısı girin.')
        description = text_field(data, 'description', 500, False)
        compressed = call_service('POST', MAIN + '/v2/soundtrack/compress-video', expected_scope=scope, json={'video_url': video})
        if not isinstance(compressed, dict) or not compressed.get('compressed_video_url'):
            raise ValueError('Video hazırlanamadı. Müzik üretimi başlatılmadı.')
        if account_scope() != scope:
            raise ValueError('Hesap değişti. Müzik üretimi başlatılmadı.')
        payload = {'video_url': video, 'compressed_video_url': compressed['compressed_video_url'], 'description': description}
        path = '/v2/soundtrack'
    else:
        return jsonify(error='Üretim türü bulunamadı.'), 404
    result = call_service('POST', MAIN + path, expected_scope=scope, **{encoding: payload})
    if account_scope() != scope:
        raise ValueError('Hesap değişti. Sonucu ilgili hesabın kütüphanesinden kontrol edin.')
    if kind == 'mashup':
        lyrics = result.get('mashup_lyrics') if isinstance(result, dict) else None
        if not isinstance(lyrics, str) or not lyrics.strip():
            return jsonify(error='Servis söz döndürmedi.'), 502
        return jsonify(lyrics=lyrics, account=scope)
    ids = result.get('song_ids') if isinstance(result, dict) else None
    if kind == 'soundtrack':
        nested = result
        for _ in range(4):
            if not isinstance(nested, dict):
                break
            if isinstance(nested.get('song_ids'), list):
                ids = nested['song_ids']
                break
            single = nested.get('song_id', nested.get('id'))
            if isinstance(single, (str, int)):
                ids = [str(single)]
                break
            nested = nested.get('data')
    if not isinstance(ids, list) or not ids:
        return jsonify(error='İstek gönderildi ancak takip kimliği alınamadı. Yeniden üretmeden önce kütüphaneyi kontrol edin.'), 502
    return jsonify(song_ids=[song_identifier(x) for x in ids], account=scope)


@features_bp.get('/api/features/production/results')
def production_results():
    if request.args.get('account') != account_scope():
        raise ValueError('Görev başka bir hesaba ait. İlgili hesaba geçin.')
    ids = request.args.get('ids', '').split(',')
    if not 1 <= len(ids) <= 20:
        raise ValueError('Geçersiz görev sayısı.')
    ids = [song_identifier(x) for x in ids]
    data = call_service('GET', MAIN + '/v2/task/results', expected_scope=request.args.get('account'), params={'ids': ','.join(ids)})
    rows = data.get('result') if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return jsonify(error='Görev sonucu okunamadı.'), 502
    return jsonify(results=[{'song_id': str(r.get('song_id') or r.get('id')), 'id': str(r.get('id') or r.get('song_id')), 'status': r.get('status'),
                             'ready': r.get('status') in (0, 2) and bool(r.get('audio_url')),
                             'title': r.get('title', '')}
                            for r in rows if isinstance(r, dict) and
                            (str(r.get('song_id')) in ids or str(r.get('id')) in ids)])
