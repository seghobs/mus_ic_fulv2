from flask import Blueprint, jsonify, request, send_file
import tempfile
import yt_dlp
import os
import shutil
from core.aiohttp_client import AiohttpSyncClient as requests
from core.auth import load_token, get_headers
from core.config import BASE_URL
from core.tasks import submit_task, task_queue

try:
    import youtube_upload
except ImportError:
    youtube_upload = None
    
youtube_bp = Blueprint('youtube_bp', __name__)

@youtube_bp.route("/api/yt-info")
def api_yt_info():
    url = request.args.get("url", "").strip()
    if not url:
        return jsonify({"error": "URL boş"}), 400
    try:
        ydl_opts = {"quiet": True, "no_warnings": True, "extract_flat": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
        return jsonify({
            "title": info.get("title", "Bilinmeyen Video"),
            "thumbnail": info.get("thumbnail", ""),
            "id": info.get("id", "")
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@youtube_bp.route("/api/yt-search")
def api_yt_search():
    query = request.args.get("q", "").strip()
    page = request.args.get("page", 1, type=int)
    if not query:
        return jsonify({"results": []})
    try:
        count = 10
        start = (page - 1) * count + 1
        ydl_opts = {"quiet": True, "no_warnings": True, "extract_flat": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch{start + count - 1}:{query}", download=False)
        entries = info.get("entries", [])
        entries = entries[start - 1:]
        results = []
        for entry in entries:
            if not entry:
                continue
            vid = entry.get("id", "")
            dur = entry.get("duration") or 0
            mins, secs = divmod(int(dur), 60)
            results.append({
                "id": vid,
                "title": entry.get("title", ""),
                "duration": f"{mins}:{secs:02d}" if dur else "",
                "channel": entry.get("channel", "") or entry.get("uploader", ""),
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                "url": f"https://www.youtube.com/watch?v={vid}"
            })
        return jsonify({"results": results, "has_more": len(results) >= count})
    except Exception as e:
        return jsonify({"error": str(e), "results": []}), 500


@youtube_bp.route("/api/yt-play/<video_id>")
def api_yt_play(video_id):
    from flask import Response, stream_with_context
    from core.youtube_media import resolve_audio
    import requests as media_requests
    import re
    if not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
        return jsonify(error="Geçersiz video kimliği"), 400
    requested_range = request.headers.get('Range')
    if requested_range and not re.fullmatch(r'bytes=(?:\d+-\d*|-\d+)', requested_range):
        return jsonify(error="Geçersiz ses aralığı"), 416
    upstream = None
    try:
        for attempt in range(2):
            url, source_headers = resolve_audio(video_id, refresh=bool(attempt))
            headers = {**source_headers, 'Accept-Encoding': 'identity'}
            if requested_range:
                headers['Range'] = requested_range
            upstream = media_requests.get(url, headers=headers, stream=True, timeout=(5, 20))
            if upstream.status_code not in (401, 403) or attempt:
                break
            upstream.close()
        if upstream.status_code not in (200, 206):
            status = upstream.status_code
            content_range = upstream.headers.get('Content-Range')
            upstream.close()
            response = jsonify(error="YouTube ses akışına erişilemedi. Yeniden oynatmayı deneyin.")
            response.status_code = 416 if status == 416 else 502
            if status == 416 and content_range:
                response.headers['Content-Range'] = content_range
            return response
        headers = {'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'}
        for name in ('Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges'):
            if name in upstream.headers:
                headers[name] = upstream.headers[name]
        def chunks():
            try:
                yield from upstream.iter_content(chunk_size=16384)
            finally:
                upstream.close()
        response = Response(stream_with_context(chunks()), status=upstream.status_code, headers=headers)
        response.call_on_close(upstream.close)
        return response
    except Exception:
        if upstream is not None:
            upstream.close()
        return jsonify(error="YouTube sesi hazırlanamadı. Lütfen tekrar deneyin."), 502


@youtube_bp.route("/api/youtube", methods=["POST"])
def api_youtube():
    data = request.json
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "URL boş"}), 400

    def do_youtube_download(url):
        tmp_dir = tempfile.mkdtemp()
        try:
            out_tmpl = os.path.join(tmp_dir, "%(id)s.%(ext)s")
            ydl_opts = {
                "format": "bestaudio/best",
                "outtmpl": out_tmpl,
                "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
                "quiet": True,
                "no_warnings": True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                title = info.get("title", "YouTube Audio")

            mp3_files = [f for f in os.listdir(tmp_dir) if f.endswith(".mp3")]
            if not mp3_files:
                return {"error": "MP3 dönüştürülemedi"}

            mp3_path = os.path.join(tmp_dir, mp3_files[0])
            file_size = os.path.getsize(mp3_path)
            if file_size > 50 * 1024 * 1024:
                return {"error": "Dosya 50MB'dan büyük"}


            token = load_token()
            upload_url = f"{BASE_URL}/v2/upload-to-song"
            headers = get_headers(token)
            del headers["accept"]

            with open(mp3_path, "rb") as f:
                audio_data = f.read()

            filename = mp3_files[0]

            files = {"audio": (filename, audio_data, "audio/mpeg")}
            resp = requests.post(upload_url, headers=headers, files=files)
            result = resp.json()
            result["_yt_title"] = title
            return result
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    task_id = submit_task("youtube", do_youtube_download, url)
    return jsonify({"task_id": task_id})

@youtube_bp.route("/api/youtube/status/<task_id>")
def api_youtube_status(task_id):
    t = task_queue.get(task_id)
    if not t:
        return jsonify({"error": "Görev bulunamadı"}), 404
    resp = {"status": t["status"]}
    if t["status"] == "done" and t.get("result"):
        for k, v in t["result"].items():
            if k != "status":
                resp[k] = v
    elif t["status"] == "error":
        resp["error"] = t.get("error", "Bilinmeyen hata")
    return jsonify(resp)

@youtube_bp.route("/api/yt-videos")
def api_yt_videos():
    try:
        videos = youtube_upload.list_channel_videos(max_results=50) if youtube_upload else []
        return jsonify({"ok": True, "videos": videos})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
