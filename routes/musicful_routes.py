from flask import Blueprint, jsonify, request, send_file, redirect, Response, stream_with_context
import requests as streaming_requests
import threading
import io
import time
import json
from core.auth import load_token, api_headers, get_headers
from core.config import BASE_URL, COMMUNITY_URL, FILES_URL
from core.tasks import sse_notify
import base64
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad
import urllib3
from core.aiohttp_client import AiohttpSyncClient as requests

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

_song_urls = {}
_song_urls_lock = threading.Lock()


def remember_song_urls(token, songs):
    with _song_urls_lock:
        now = time.monotonic()
        for key, (_, expires) in list(_song_urls.items()):
            if expires <= now:
                del _song_urls[key]
        for song in songs:
            song_id = song.get("song_id") or song.get("id")
            url = decrypt_audio_url(song.get("audio_url", ""))
            if song_id and url:
                if len(_song_urls) >= 1000:
                    _song_urls.pop(next(iter(_song_urls)))
                _song_urls[(token, str(song_id))] = (url, now + 60)

def decrypt_audio_url(encrypted_url):
    if not encrypted_url:
        return ""
    if encrypted_url.startswith("http://") or encrypted_url.startswith("https://"):
        return encrypted_url
    try:
        key = b"147258369topmeidia96385topmeidia"
        iv = b"1597531topmeidia"
        raw = base64.b64decode(encrypted_url)
        cipher = AES.new(key, AES.MODE_CBC, iv)
        decrypted = unpad(cipher.decrypt(raw), AES.block_size)
        return decrypted.decode('utf-8').strip()
    except Exception as e:
        print(f"[Decryption Error] {e}")
        return ""

def get_song_url(song_uuid, token=None):
    token = token or load_token()
    with _song_urls_lock:
        cached = _song_urls.get((token, str(song_uuid)))
        if cached and cached[1] > time.monotonic():
            return cached[0]
    
    # 1. Try task results endpoint
    try:
        resp = requests.get(f"{BASE_URL}/v2/task/results?ids={song_uuid}", headers=api_headers(token), verify=False)
        if resp.status_code == 200:
            results = resp.json().get("data", {}).get("result", [])
            if results:
                enc_url = results[0].get("audio_url", "")
                dec_url = decrypt_audio_url(enc_url)
                if dec_url:
                    remember_song_urls(token, [{"song_id": song_uuid, "audio_url": dec_url}])
                    return dec_url
    except Exception as e:
        print(f"[get_song_url task error] {e}")
        
    # 2. Try songs list endpoint
    try:
        resp = requests.get(f"{BASE_URL}/v1/songs?page=1&limit=100", headers=api_headers(token), verify=False)
        if resp.status_code == 200:
            song_list = resp.json().get("data", {}).get("list", [])
            for s in song_list:
                if s.get("song_id") == song_uuid or s.get("id") == song_uuid:
                    enc_url = s.get("audio_url", "")
                    dec_url = decrypt_audio_url(enc_url)
                    if dec_url:
                        remember_song_urls(token, [{"song_id": song_uuid, "audio_url": dec_url}])
                        return dec_url
    except Exception as e:
        print(f"[get_song_url songs list error] {e}")
        
    # 3. Fallback
    return f"{FILES_URL}/{song_uuid}/{song_uuid}.mp3"

musicful_bp = Blueprint('musicful_bp', __name__)

@musicful_bp.route("/api/rights")
def api_rights():
    from core.config import ACCOUNTS_FILE, update_json
    from core.auth import _read_tokens
    try:
        token = load_token()
        resp = requests.get(f"{BASE_URL}/v1/user/rights", headers=api_headers(token))
        data = resp.json()
        result = (data.get("data") or {}).get("result")
        if resp.status_code != 200 or not isinstance(result, dict) or "left" not in result:
            return jsonify({"error": "Hak bilgisi alınamadı. Oturumunuzu yenileyin."}), 502
        def save_credits(accounts):
            for group in accounts.values():
                for account in group:
                    if account.get("token") == token:
                        account["credits"] = result["left"]
        update_json(ACCOUNTS_FILE, save_credits, {})
        if not any(t.get("active", True) and t.get("token") == token for t in _read_tokens()):
            return jsonify({"error": "Hesap değişti. Bilgileri yeniden yükleyin."}), 409
        return jsonify(data)
    except Exception:
        return jsonify({"error": "Hak bilgisi alınamadı."}), 502


@musicful_bp.route("/api/songs")
def api_songs():
    import os
    import hashlib
    from core.config import BASE_DIR, safe_read_json, safe_write_json
    from core.auth import _read_tokens
    try:
        token = load_token()
        page = request.args.get("page", 1, type=int)
        limit = request.args.get("limit", 20, type=int)
        keyword = request.args.get("q", "").strip()[:200]
        # Separate each session and page. Never use the legacy shared cache.
        key = hashlib.sha256(f"{token}:{page}:{limit}:{keyword}".encode()).hexdigest()
        cache_dir = os.path.join(BASE_DIR, "data", "library_cache")
        cache_file = os.path.join(cache_dir, key + ".json")
        cached = safe_read_json(cache_file)
        if request.args.get('fresh') != '1' and cached and time.time() - cached.get("saved_at", 0) < 3:
            remember_song_urls(token, cached["response"]["data"]["list"])
            return jsonify(cached["response"])
        if keyword:
            resp = requests.get(f"{BASE_URL}/song/search", headers=api_headers(token), params={
                'page': page, 'limit': limit, 'keyword': keyword, 'is_self': 1, 'search_type': 1})
        else:
            resp = requests.get(f"{BASE_URL}/v1/songs?page={page}&limit={limit}", headers=api_headers(token))
        data = resp.json()
        song_list = (data.get("data") or {}).get("list")
        if resp.status_code != 200 or not isinstance(song_list, list):
            return jsonify({"error": "Şarkılar alınamadı. Oturumunuzu yenileyin."}), 502
        for song in song_list:
            for field in ("audio_url", "cover_url"):
                if song.get(field):
                    song[field] = decrypt_audio_url(song[field])
        if not any(t.get("active", True) and t.get("token") == token for t in _read_tokens()):
            return jsonify({"error": "Hesap değişti. Şarkıları yeniden yükleyin."}), 409
        os.makedirs(cache_dir, exist_ok=True)
        remember_song_urls(token, song_list)
        safe_write_json(cache_file, {"saved_at": time.time(), "response": data})
        return jsonify(data)
    except Exception:
        return jsonify({"error": "Şarkılar alınamadı."}), 502


@musicful_bp.route("/api/upload", methods=["POST"])
def api_upload():
    token = load_token()
    file = request.files.get("audio")
    if not file:
        return jsonify({"error": "Dosya seçilmedi"}), 400

    filename = file.filename

    url = f"{BASE_URL}/v2/upload-to-song"
    headers = get_headers(token)
    del headers["accept"]

    file_bytes = file.read()
    files = {"audio": (filename, file_bytes, "audio/mpeg")}
    resp = requests.post(url, headers=headers, files=files)
    resp_data = resp.json()

    if resp_data.get("code") != 200 and resp_data.get("status") != 200:
        from core.account_manager import switch_to_next_account
        new_token = switch_to_next_account()
        if new_token:
            headers = get_headers(new_token)
            del headers["accept"]
            files2 = {"audio": (filename, file_bytes, "audio/mpeg")}
            resp = requests.post(url, headers=headers, files=files2)
            resp_data = resp.json()

    return jsonify(resp_data)

@musicful_bp.route("/api/content-check", methods=["POST"])
def api_content_check():
    token = load_token()
    data = request.json
    headers = get_headers(token)
    headers["content-type"] = "application/json"
    resp = requests.post(f"{COMMUNITY_URL}/content_check", headers=headers, json={
        "check_type": 1,
        "content": {"image": [], "text": f"{data.get('lyrics','')},{data.get('title','')}"}
    })
    return jsonify(resp.json())

def is_auth_or_credit_error(resp_data):
    if not isinstance(resp_data, dict):
        return False
    code = resp_data.get("code") or resp_data.get("status")
    msg = str(resp_data.get("message") or resp_data.get("msg") or "").lower()
    if code in [401, 403, 401000, 401001, 403000, 403001]:
        return True
    if any(k in msg for k in ["token", "unauthorized", "login", "auth", "credit", "insufficient", "kredi", "rights"]):
        return True
    return False

def validate_song_input(data):
    if not isinstance(data, dict):
        return "Geçerli bir şarkı bilgisi nesnesi gönderin."
    for field, label, limit in [("title", "Şarkı adı", 150),
                                ("lyrics", "Şarkı sözleri", 3500),
                                ("style", "Stil", 800)]:
        value = str(data.get(field, "") or "")
        if len(value) > limit:
            return f"{label} en fazla {limit} karakter olabilir ({len(value)} karakter girdiniz). Metni kısaltıp tekrar deneyin."
    return None


@musicful_bp.route("/api/make-song", methods=["POST"])
def api_make_song():
    data = request.get_json(silent=True)
    error = validate_song_input(data)
    if error:
        return jsonify({"error": error}), 400
    token = load_token()
    audio_id = data.get("audio_id", "")
    title = str(data.get("title", "") or "")
    lyrics = str(data.get("lyrics", "") or "")
    style = str(data.get("style", "Guitar,Piano") or "")
    mv = data.get("mv", "v5.5")
    weirdness = data.get("weirdness", 0.50)
    style_influence = data.get("style_influence", 0.50)
    mp3t = data.get("MP3T", "D")


    url = f"{BASE_URL}/v2/async/song_cover"
    headers = get_headers(token)
    headers["terminal"] = "web"

    form = {
        "mv": (None, mv),
        "grade": (None, "2"),
        "area": (None, "TR"),
        "lyrics": (None, lyrics),
        "isAiLyrics": (None, "false"),
        "persona_id": (None, ""),
        "style": (None, style),
        "title": (None, title),
        "instrumental": (None, "0"),
        "model": (None, mv),
        "audio_id": (None, audio_id),
        "song_id": (None, audio_id),
        "action": (None, "cover"),
        "is_pro": (None, "true"),
        "weirdness": (None, str(weirdness)),
        "style_influence": (None, str(style_influence)),
        "billing_cycle": (None, "3"),
        "MP3T": (None, mp3t),
    }
    resp = requests.post(url, headers=headers, files=form)
    resp_data = resp.json()

    if resp_data.get("code") != 200 and resp_data.get("status") != 200 and is_auth_or_credit_error(resp_data):
        from core.account_manager import switch_to_next_account
        new_token = switch_to_next_account()
        if new_token:
            headers = get_headers(new_token)
            headers["terminal"] = "web"
            form2 = {
                "mv": (None, mv),
                "grade": (None, "2"),
                "area": (None, "TR"),
                "lyrics": (None, lyrics),
                "isAiLyrics": (None, "false"),
                "persona_id": (None, ""),
                "style": (None, style),
                "title": (None, title),
                "instrumental": (None, "0"),
                "model": (None, mv),
                "audio_id": (None, audio_id),
                "song_id": (None, audio_id),
                "action": (None, "cover"),
                "is_pro": (None, "true"),
                "weirdness": (None, str(weirdness)),
                "style_influence": (None, str(style_influence)),
                "billing_cycle": (None, "3"),
                "MP3T": (None, mp3t),
            }
            resp = requests.post(url, headers=headers, files=form2)
            resp_data = resp.json()

    return jsonify(resp_data)

@musicful_bp.route("/api/text-to-song", methods=["POST"])
def api_text_to_song():
    data = request.get_json(silent=True)
    error = validate_song_input(data)
    if error:
        return jsonify({"error": error}), 400
    token = load_token()
    title = str(data.get("title", "") or "")
    lyrics = str(data.get("lyrics", "") or "")
    style = str(data.get("style", "") or "")
    mv = data.get("mv", "v5.5")
    weirdness = data.get("weirdness", 0.50)
    style_influence = data.get("style_influence", 0.50)
    mp3t = data.get("MP3T", "D")


    url = f"{BASE_URL}/v2/advanced/text-to-song"
    headers = get_headers(token)
    headers["terminal"] = "web"

    payload = {
        "mv": mv,
        "grade": 2,
        "area": "TR",
        "lyrics": lyrics,
        "isAiLyrics": False,
        "gender": "",
        "persona_id": "",
        "style": style,
        "title": title,
        "instrumental": 0,
        "weirdness": weirdness,
        "style_influence": style_influence,
        "billing_cycle": 3,
        "MP3T": mp3t
    }

    resp = requests.post(url, headers=headers, json=payload)
    resp_data = resp.json()
    print(f"[Text-to-Song] İlk Yanıt: {resp_data.get('status') or resp_data.get('code')} - {resp_data.get('message') or resp_data.get('msg')}")

    if resp_data.get("code") != 200 and resp_data.get("status") != 200 and is_auth_or_credit_error(resp_data):
        print(f"[Text-to-Song] Yetki/Kredi hatası ({resp_data}), hesap değiştirme tetikleniyor...")
        from core.account_manager import switch_to_next_account
        new_token = switch_to_next_account()
        if new_token:
            headers = get_headers(new_token)
            headers["terminal"] = "web"
            resp = requests.post(url, headers=headers, json=payload)
            resp_data = resp.json()
            print(f"[Text-to-Song] Yeni Hesap Yanıtı: {resp_data.get('status') or resp_data.get('code')} - {resp_data.get('message') or resp_data.get('msg')}")

    return jsonify(resp_data)

@musicful_bp.route("/api/poll/<task_ids>")
def api_poll(task_ids):
    token = load_token()
    resp = requests.get(f"{BASE_URL}/v2/task/results?ids={task_ids}", headers=api_headers(token))
    data = resp.json()
    results = data.get("data", {}).get("result", [])
    for song in results:
        if song.get("status") == 2:
            song["status"] = 0
        if song.get("status") == 3:
            song["_failed"] = True
        else:
            song["_failed"] = False
        if song.get("audio_url"):
            song["audio_url"] = decrypt_audio_url(song["audio_url"])
        if song.get("cover_url"):
            song["cover_url"] = decrypt_audio_url(song["cover_url"])
        if song.get("audio_url") and song.get("duration"):
            sse_notify("song_ready", song)
    remember_song_urls(token, results)
    return jsonify(data)

@musicful_bp.route("/api/stream/<song_uuid>")
def api_stream(song_uuid):
    # Let the browser stream and seek against the CDN directly.
    # This fallback is only needed when the song URL is not already in the UI.
    return redirect(get_song_url(song_uuid), code=302)


@musicful_bp.route("/api/download/<song_uuid>")
def api_download(song_uuid):
    url = get_song_url(song_uuid)
    headers = {"Accept-Encoding": "identity"}
    if request.headers.get("Range"):
        headers["Range"] = request.headers["Range"]
    try:
        upstream = streaming_requests.get(url, headers=headers, stream=True, timeout=(10, 30))
    except streaming_requests.RequestException:
        return jsonify({"error": "Dosyaya ulaşılamadı"}), 502
    if upstream.status_code not in (200, 206):
        status = upstream.status_code
        upstream.close()
        return jsonify({"error": "Dosya hazır değil", "ready": False}), 416 if status == 416 else 502

    def chunks():
        try:
            yield from upstream.iter_content(chunk_size=64 * 1024)
        finally:
            upstream.close()

    response = Response(stream_with_context(chunks()), status=upstream.status_code, mimetype="audio/mpeg")
    response.headers.set("Content-Disposition", "attachment", filename=f"{song_uuid}.mp3")
    for name in ("Content-Length", "Content-Range", "Accept-Ranges"):
        if name in upstream.headers:
            response.headers[name] = upstream.headers[name]
    response.call_on_close(upstream.close)
    return response

@musicful_bp.route("/api/check-download/<song_uuid>")
def api_check_download(song_uuid):
    url = get_song_url(song_uuid)
    resp = requests.head(url, verify=False)
    return jsonify({"ready": resp.status_code == 200})

@musicful_bp.route("/api/task/<task_id>")
def api_task(task_id):
    token = load_token()
    resp = requests.get(f"{BASE_URL}/v2/task/results?ids={task_id}", headers=api_headers(token))
    data = resp.json()
    results = data.get("data", {}).get("result", [])

    # If task endpoint returns nothing (happens for uploaded songs), fall back to songs list
    if not results:
        songs_resp = requests.get(f"{BASE_URL}/v1/songs?page=1&limit=50", headers=api_headers(token))
        songs_data = songs_resp.json()
        song_list = songs_data.get("data", {}).get("list", [])
        matched = [s for s in song_list if s.get("song_id") == task_id or s.get("id") == task_id]
        if matched:
            s = matched[0]
            # Normalize field: ensure 'lyrics' key is present for JS
            s.setdefault("lyrics", s.get("lyric", ""))
            s.setdefault("audio_url", s.get("audio_url", ""))
            s.setdefault("status", 0)  # present in list = ready
            results = [s]
            data["data"] = {"result": results}

    for s in results:
        if s.get("status") == 2:
            s["status"] = 0
        if s.get("audio_url"):
            s["audio_url"] = decrypt_audio_url(s["audio_url"])
        if s.get("cover_url"):
            s["cover_url"] = decrypt_audio_url(s["cover_url"])
        if s.get("audio_url") and s.get("duration"):
            sse_notify("song_ready", s)
    remember_song_urls(token, results)
    return jsonify(data)
