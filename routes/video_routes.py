from flask import Blueprint, jsonify, request, send_file
import os
import uuid
import shutil
import requests
import subprocess
from core.config import VIDEO_TEMP, VIDEO_OUTPUT, COVERS_OUTPUT, FILES_URL
from core.tasks import submit_task, task_queue

video_bp = Blueprint('video_bp', __name__)

@video_bp.route("/api/create-video", methods=["POST"])
def api_create_video():
    audio_id = request.form.get("audio_id")
    image_file = request.files.get("image")
    image_path_form = request.form.get("image_path")
    if not audio_id or (not image_file and not image_path_form):
        return jsonify({"error": "Eksik veri"}), 400

    video_id = str(uuid.uuid4())[:8]
    task_dir = os.path.join(VIDEO_TEMP, video_id)
    os.makedirs(task_dir, exist_ok=True)

    if image_file:
        img_path = os.path.join(task_dir, "cover" + os.path.splitext(image_file.filename or ".png")[1])
        image_file.save(img_path)
    else:
        ext = os.path.splitext(image_path_form)[1]
        img_path = os.path.join(task_dir, "cover" + ext)
        source_path = os.path.join(COVERS_OUTPUT, image_path_form)
        if os.path.exists(source_path):
            shutil.copyfile(source_path, img_path)
        else:
            return jsonify({"error": "Sistemde kapak resmi bulunamadı"}), 400

    audio_path = os.path.join(task_dir, "audio.mp3")
    output_path = os.path.join(VIDEO_OUTPUT, f"{video_id}.mp4")

    from routes.musicful_routes import get_song_url
    mp3_url = get_song_url(audio_id)
    resp = requests.get(mp3_url, timeout=120, verify=False)
    if resp.status_code != 200:
        shutil.rmtree(task_dir, ignore_errors=True)
        return jsonify({"error": "Şarkı indirilemedi"}), 400
    with open(audio_path, "wb") as f:
        f.write(resp.content)

    def do_video():
        try:
            cmd = [
                "ffmpeg", "-y",
                "-loop", "1",
                "-i", img_path,
                "-i", audio_path,
                "-c:v", "libx264",
                "-tune", "stillimage",
                "-crf", "18",
                "-preset", "slow",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "192k",
                "-shortest",
                output_path
            ]
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            stdout, stderr = proc.communicate()
            if proc.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                return {"video_id": video_id, "download": f"/api/download-video/{video_id}"}
            else:
                return {"error": stderr.decode("utf-8", errors="replace")}
        finally:
            shutil.rmtree(task_dir, ignore_errors=True)

    task_id = submit_task("video", do_video)
    task_queue[task_id]["video_id"] = video_id
    return jsonify({"task_id": task_id, "video_id": video_id})

@video_bp.route("/api/video-status/<video_id>")
def api_video_status(video_id):
    for tid, t in task_queue.items():
        if t.get("video_id") == video_id:
            if t["status"] == "done" and t.get("result"):
                r = t["result"]
                if "error" in r:
                    return jsonify({"status": "error", "error": r["error"]})
                return jsonify({"status": "done", "download": r.get("download")})
            elif t["status"] == "error":
                return jsonify({"status": "error", "error": t.get("error", "")})
            else:
                return jsonify({"status": "processing"})
    return jsonify({"status": "not_found"}), 404

@video_bp.route("/api/download-video/<video_id>")
def api_download_video(video_id):
    path = os.path.join(VIDEO_OUTPUT, f"{video_id}.mp4")
    if os.path.exists(path):
        return send_file(path, mimetype="video/mp4", as_attachment=True, download_name=f"{video_id}.mp4")
    return jsonify({"error": "Video bulunamadı"}), 404

# ── DEBUG ONLY – remove before production ──────────────────────
@video_bp.route("/api/debug/video-done/<id_param>")
def api_debug_video_done(id_param):
    """Force-mark done by task_id OR video_id – whichever is passed."""
    # Try by task_id first (matches Python log output)
    if id_param in task_queue:
        t = task_queue[id_param]
        vid = t.get("video_id", id_param)
        t["status"] = "done"
        t["result"] = {"video_id": vid, "download": f"/api/download-video/{vid}"}
        return jsonify({"ok": True, "task_id": id_param, "video_id": vid})

    # Fallback: search by video_id
    for tid, t in task_queue.items():
        if t.get("video_id") == id_param:
            t["status"] = "done"
            t["result"] = {"video_id": id_param, "download": f"/api/download-video/{id_param}"}
            return jsonify({"ok": True, "task_id": tid, "video_id": id_param})

    return jsonify({"error": f"'{id_param}' bulunamadı – /api/queue ile kontrol edin", "queue_ids": list(task_queue.keys())}), 404
