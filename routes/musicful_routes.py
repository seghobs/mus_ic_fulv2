from flask import Blueprint, jsonify, request, send_file
from curl_cffi import requests as crequests
import io
import time
import re
import json
from core.auth import load_token, api_headers, get_headers
from core.config import BASE_URL, COMMUNITY_URL, FILES_URL
from core.tasks import sse_notify
import base64
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad
import urllib3

class MockTimeoutResponse:
    def __init__(self, error_msg):
        self.status_code = 504
        self._msg = error_msg
        self.content = json.dumps({"error": error_msg, "status": 504, "code": 504, "data": {}}, ensure_ascii=False).encode("utf-8")
        self.text = json.dumps({"error": error_msg, "status": 504, "code": 504, "data": {}}, ensure_ascii=False)
        
    def json(self):
        return {"error": self._msg, "status": 504, "code": 504, "data": {}}

class CurlCffiWrapper:
    @staticmethod
    def get(url, *args, **kwargs):
        if "topmediai.com" in url or "musicful.ai" in url:
            kwargs.setdefault("impersonate", "chrome")
        kwargs.setdefault("timeout", 25)
        try:
            return crequests.get(url, *args, **kwargs)
        except Exception as e:
            print(f"[CurlCffiWrapper GET Error] {url}: {e}")
            return MockTimeoutResponse(f"Bağlantı hatası: {e}")

    @staticmethod
    def post(url, *args, **kwargs):
        if "topmediai.com" in url or "musicful.ai" in url:
            kwargs.setdefault("impersonate", "chrome")
        kwargs.setdefault("timeout", 25)
        try:
            return crequests.post(url, *args, **kwargs)
        except Exception as e:
            print(f"[CurlCffiWrapper POST Error] {url}: {e}")
            return MockTimeoutResponse(f"Bağlantı hatası: {e}")

    @staticmethod
    def head(url, *args, **kwargs):
        if "topmediai.com" in url or "musicful.ai" in url:
            kwargs.setdefault("impersonate", "chrome")
        kwargs.setdefault("timeout", 25)
        try:
            return crequests.head(url, *args, **kwargs)
        except Exception as e:
            print(f"[CurlCffiWrapper HEAD Error] {url}: {e}")
            return MockTimeoutResponse(f"Bağlantı hatası: {e}")

requests = CurlCffiWrapper

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

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

def get_song_url(song_uuid):
    token = load_token()
    
    # 1. Try task results endpoint
    try:
        resp = requests.get(f"{BASE_URL}/v2/task/results?ids={song_uuid}", headers=api_headers(token), verify=False)
        if resp.status_code == 200:
            results = resp.json().get("data", {}).get("result", [])
            if results:
                enc_url = results[0].get("audio_url", "")
                dec_url = decrypt_audio_url(enc_url)
                if dec_url:
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
                        return dec_url
    except Exception as e:
        print(f"[get_song_url songs list error] {e}")
        
    # 3. Fallback
    return f"{FILES_URL}/{song_uuid}/{song_uuid}.mp3"

HOMOGLYPHS = {
    'a': 'а',  # Cyrillic a
    'e': 'е',  # Cyrillic ie
    'o': 'о',  # Cyrillic o
    'p': 'р',  # Cyrillic er
    'c': 'с',  # Cyrillic es
    'y': 'у',  # Cyrillic u
    'x': 'х',  # Cyrillic ha
    'A': 'А',
    'E': 'Е',
    'O': 'О',
    'P': 'Р',
    'C': 'С',
    'Y': 'У',
    'X': 'Х',
}

def obfuscate_text_filter(text):
    if not text:
        return ""
    # Keep tags like [Chorus] or [Verse] intact to avoid confusing the AI voice generator
    parts = re.split(r'(\[.*?\])', text)
    result = []
    for part in parts:
        if part.startswith('[') and part.endswith(']'):
            result.append(part)
        else:
            obfuscated = "".join(HOMOGLYPHS.get(char, char) for char in part)
            result.append(obfuscated)
    return "".join(result)

musicful_bp = Blueprint('musicful_bp', __name__)

def _update_rights_async(token, email):
    import requests
    import json
    import os
    from core.config import BASE_URL, ACCOUNTS_FILE
    from core.auth import api_headers
    from core.tasks import sse_notify
    
    try:
        resp = requests.get(f"{BASE_URL}/v1/user/rights", headers=api_headers(token), timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            result = data.get("data", {}).get("result", {})
            left_credits = result.get("left", 0)
            
            # Update accounts.json
            if os.path.exists(ACCOUNTS_FILE):
                try:
                    with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
                        acc_data = json.load(f)
                    updated = False
                    for c, accs in acc_data.items():
                        for a in accs:
                            if a.get("email") == email:
                                a["credits"] = left_credits
                                a["token"] = token
                                updated = True
                    if updated:
                        with open(ACCOUNTS_FILE, "w", encoding="utf-8") as f:
                            json.dump(acc_data, f, indent=4)
                except Exception as e:
                    print(f"Error updating accounts.json in async rights update: {e}")
            
            # Notify frontend via SSE
            sse_notify("rights_update", data)
    except Exception as e:
        print(f"Error fetching async rights: {e}")


@musicful_bp.route("/api/rights")
def api_rights():
    import os
    import json
    import threading
    from core.config import ACCOUNTS_FILE
    from core.auth import load_token
    
    try:
        # Get active token name
        from core.auth import _read_tokens
        tokens = _read_tokens()
        active = [t for t in tokens if t.get("active", True)]
        
        if active:
            token_obj = active[0]
            token = token_obj["token"]
            email = token_obj["name"]
            
            # Try to get cached credits from accounts.json
            cached_credits = None
            if os.path.exists(ACCOUNTS_FILE):
                with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
                    try:
                        acc_data = json.load(f)
                        for c, accs in acc_data.items():
                            for a in accs:
                                if a.get("email") == email:
                                    cached_credits = a.get("credits")
                                    break
                            if cached_credits is not None:
                                break
                    except:
                        pass
            
            # Trigger background refresh
            threading.Thread(target=_update_rights_async, args=(token, email), daemon=True).start()
            
            if cached_credits is not None:
                cached_data = {
                    "data": {
                        "result": {
                            "all": 2500,
                            "left": cached_credits,
                            "used": max(0.0, 2500 - cached_credits),
                            "is_vip": 1
                        }
                    },
                    "status": 200,
                    "message": "Success"
                }
                return jsonify(cached_data)
                
        # If no active token or no cached credits, do it synchronously as fallback
        token = load_token()
        resp = requests.get(f"{BASE_URL}/v1/user/rights", headers=api_headers(token))
        return jsonify(resp.json())
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@musicful_bp.route("/api/songs")
def api_songs():
    token = load_token()
    page = request.args.get("page", 1, type=int)
    limit = request.args.get("limit", 20, type=int)
    resp = requests.get(f"{BASE_URL}/v1/songs?page={page}&limit={limit}", headers=api_headers(token))
    try:
        data = resp.json()
        song_list = data.get("data", {}).get("list", [])
        for song in song_list:
            if song.get("audio_url"):
                song["audio_url"] = decrypt_audio_url(song["audio_url"])
            if song.get("cover_url"):
                song["cover_url"] = decrypt_audio_url(song["cover_url"])
        return jsonify(data)
    except Exception as e:
        print(f"[api_songs Error] {e}")
        return jsonify(resp.json())

@musicful_bp.route("/api/upload", methods=["POST"])
def api_upload():
    token = load_token()
    file = request.files.get("audio")
    if not file:
        return jsonify({"error": "Dosya seçilmedi"}), 400

    bypass_filter = request.form.get("bypass_filter") == "true"
    filename = file.filename
    if bypass_filter:
        filename = obfuscate_text_filter(filename)

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

@musicful_bp.route("/api/make-song", methods=["POST"])
def api_make_song():
    token = load_token()
    data = request.json
    audio_id = data.get("audio_id", "")
    title = data.get("title", "")
    lyrics = data.get("lyrics", "")
    style = data.get("style", "Guitar,Piano")
    mv = data.get("mv", "v5.5")
    bypass_filter = data.get("bypass_filter", False)
    weirdness = data.get("weirdness", 0.50)
    style_influence = data.get("style_influence", 0.50)
    mp3t = data.get("MP3T", "D")

    if bypass_filter:
        title = obfuscate_text_filter(title)
        lyrics = obfuscate_text_filter(lyrics)

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

    if resp_data.get("code") != 200 and resp_data.get("status") != 200:
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
    token = load_token()
    data = request.json
    title = data.get("title", "")
    lyrics = data.get("lyrics", "")
    style = data.get("style", "")
    mv = data.get("mv", "v5.5")
    bypass_filter = data.get("bypass_filter", False)
    weirdness = data.get("weirdness", 0.50)
    style_influence = data.get("style_influence", 0.50)
    mp3t = data.get("MP3T", "D")

    if bypass_filter:
        title = obfuscate_text_filter(title)
        lyrics = obfuscate_text_filter(lyrics)

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

    if resp_data.get("code") != 200 and resp_data.get("status") != 200:
        from core.account_manager import switch_to_next_account
        new_token = switch_to_next_account()
        if new_token:
            headers = get_headers(new_token)
            headers["terminal"] = "web"
            resp = requests.post(url, headers=headers, json=payload)
            resp_data = resp.json()

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
    return jsonify(data)

@musicful_bp.route("/api/download/<song_uuid>")
def api_download(song_uuid):
    url = get_song_url(song_uuid)
    resp = requests.get(url, verify=False)
    if resp.status_code == 200:
        return send_file(
            io.BytesIO(resp.content),
            mimetype="audio/mpeg",
            as_attachment=True,
            download_name=f"{song_uuid}.mp3"
        )
    return jsonify({"error": "Dosya henüz hazır değil", "ready": False}), 202

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
    return jsonify(data)
