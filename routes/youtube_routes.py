from flask import Blueprint, jsonify, request, send_file
import tempfile
import yt_dlp
import os
import shutil
import requests
from core.auth import load_token, get_headers
from core.config import BASE_URL
from core.tasks import submit_task, task_queue
from routes.musicful_routes import obfuscate_text_filter

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
    tmp_dir = tempfile.mkdtemp()
    try:
        out_tmpl = os.path.join(tmp_dir, "audio.%(ext)s")
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": out_tmpl,
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "128"}],
            "quiet": True,
            "no_warnings": True,
        }
        url = f"https://www.youtube.com/watch?v={video_id}"
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        mp3_files = [f for f in os.listdir(tmp_dir) if f.endswith(".mp3")]
        if not mp3_files:
            return jsonify({"error": "Dönüştürülemedi"}), 500

        mp3_path = os.path.join(tmp_dir, mp3_files[0])
        resp = send_file(mp3_path, mimetype="audio/mpeg", as_attachment=False, download_name=f"{video_id}.mp3")
        resp.call_on_close(lambda: shutil.rmtree(tmp_dir, ignore_errors=True))
        return resp
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return jsonify({"error": str(e)}), 500


@youtube_bp.route("/api/youtube", methods=["POST"])
def api_youtube():
    data = request.json
    url = data.get("url", "").strip()
    bypass_filter = data.get("bypass_filter", False)
    if not url:
        return jsonify({"error": "URL boş"}), 400

    def do_youtube_download(url, bypass_filter=False):
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

            if bypass_filter:
                title = obfuscate_text_filter(title)

            token = load_token()
            upload_url = f"{BASE_URL}/v2/upload-to-song"
            headers = get_headers(token)
            del headers["accept"]

            with open(mp3_path, "rb") as f:
                audio_data = f.read()

            filename = mp3_files[0]
            if bypass_filter:
                filename = obfuscate_text_filter(filename)

            files = {"audio": (filename, audio_data, "audio/mpeg")}
            resp = requests.post(upload_url, headers=headers, files=files)
            result = resp.json()
            result["_yt_title"] = title
            return result
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    task_id = submit_task("youtube", do_youtube_download, url, bypass_filter)
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
