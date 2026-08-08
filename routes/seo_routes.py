from flask import Blueprint, jsonify, request
import uuid
import services.gemini_cover as gemini_cover
import services.gemini_seo as gemini_seo
from core.config import COVERS_OUTPUT, VIDEO_OUTPUT

try:
    import youtube_upload
except ImportError:
    youtube_upload = None

seo_bp = Blueprint('seo_bp', __name__)

@seo_bp.route("/api/generate-cover", methods=["POST"])
def api_generate_cover():
    import traceback
    try:
        data = request.get_json(silent=True) or {}
        title = data.get("title") or f"Sarki {uuid.uuid4().hex[:4]}"
        lyrics = data.get("lyrics", "")
        
        filename = gemini_cover.generate_cover_image(title, COVERS_OUTPUT, lyrics)
        if filename:
            return jsonify({"ok": True, "url": f"/static/covers/{filename}", "filename": filename})
        return jsonify({"error": "Görsel üretilemedi."}), 500
    except Exception as e:
        traceback.print_exc()
        err_msg = str(e)
        if "503" in err_msg or "UNAVAILABLE" in err_msg or "high demand" in err_msg:
            err_msg = "Google Gemini sunucuları şu anda çok yoğun. Lütfen 1 dakika sonra tekrar deneyin."
        return jsonify({"error": err_msg}), 500

@seo_bp.route("/api/youtube-seo", methods=["POST"])
def api_youtube_seo():
    try:
        data = request.get_json(silent=True) or {}
        title = data.get("title", "")
        lyrics = data.get("lyrics", "")
        seo_text = gemini_seo.generate_youtube_metadata(title, lyrics)
        return jsonify({"ok": True, "seo": seo_text})
    except Exception as e:
        err = str(e)
        if "503" in err or "UNAVAILABLE" in err or "high demand" in err:
            err = "Google Gemini sunucuları şu anda çok yoğun. 1 dk sonra tekrar deneyin."
        return jsonify({"error": err}), 500

@seo_bp.route("/api/seo-title", methods=["POST"])
def api_seo_title():
    try:
        data = request.get_json(silent=True) or {}
        title = data.get("title", "")
        lyrics = data.get("lyrics", "")
        result = gemini_seo.generate_seo_title(title, lyrics)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        err = str(e)
        if "503" in err or "UNAVAILABLE" in err or "high demand" in err:
            err = "Google sunucuları yoğun. Yaratıcı başlıklar için 1 dk bekleyin."
        return jsonify({"ok": False, "error": err}), 500

@seo_bp.route("/api/seo-description", methods=["POST"])
def api_seo_description():
    try:
        data = request.get_json(silent=True) or {}
        title = data.get("title", "")
        lyrics = data.get("lyrics", "")
        result = gemini_seo.generate_seo_description(title, lyrics)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        err = str(e)
        if "503" in err or "UNAVAILABLE" in err or "high demand" in err:
            err = "Google sunucuları yoğun. 1 dk sonra tekrar deneyin."
        return jsonify({"ok": False, "error": err}), 500

@seo_bp.route("/api/seo-tags", methods=["POST"])
def api_seo_tags():
    try:
        data = request.get_json(silent=True) or {}
        title = data.get("title", "")
        lyrics = data.get("lyrics", "")
        result = gemini_seo.generate_seo_tags(title, lyrics)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        err = str(e)
        if "503" in err or "UNAVAILABLE" in err or "high demand" in err:
            err = "Google sunucuları yoğun. Etiketler üretilemedi."
        return jsonify({"ok": False, "error": err}), 500

@seo_bp.route("/api/optimize-video-seo", methods=["POST"])
def api_optimize_video_seo():
    try:
        data = request.get_json(silent=True) or {}
        title = data.get("title", "")
        if not title:
            return jsonify({"ok": False, "error": "Başlık gerekli"}), 400
        result = gemini_seo.optimize_existing_video(title)
        return jsonify({"ok": True, **result})
    except Exception as e:
        err = str(e)
        if "503" in err or "UNAVAILABLE" in err or "high demand" in err:
            err = "Google sunucuları yoğun. Daha sonra tekrar deneyin."
        return jsonify({"ok": False, "error": err}), 500

@seo_bp.route("/api/update-video-seo", methods=["POST"])
def api_update_video_seo():
    data = request.json
    video_id = data.get("video_id", "")
    title = data.get("title", "")
    description = data.get("description", "")
    tags = data.get("tags", "")
    if not video_id or not title:
        return jsonify({"ok": False, "error": "Video ID ve başlık gerekli"}), 400
    try:
        if youtube_upload:
            youtube_upload.update_video_metadata(video_id, title, description, tags)
            return jsonify({"ok": True})
        return jsonify({"ok": False, "error": "youtube_upload modülü bulunamadı"}), 500
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@seo_bp.route("/api/youtube-upload", methods=["POST"])
def api_youtube_upload():
    """Upload local video file to YouTube and return the YouTube video_id."""
    import os
    from core.config import VIDEO_OUTPUT
    data = request.json
    local_video_id = data.get("video_id", "")   # our short ffmpeg UUID
    title       = data.get("title", "")
    description = data.get("description", "")
    tags        = data.get("tags", "")

    if not local_video_id or not title:
        return jsonify({"ok": False, "error": "Video ID ve başlık gerekli"}), 400

    video_path = os.path.join(VIDEO_OUTPUT, f"{local_video_id}.mp4")
    if not os.path.exists(video_path):
        return jsonify({"ok": False, "error": f"Video dosyası bulunamadı: {local_video_id}.mp4"}), 404

    try:
        if not youtube_upload:
            return jsonify({"ok": False, "error": "youtube_upload modülü bulunamadı"}), 500

        # Upload to YouTube — returns the real YouTube video ID
        yt_video_id = youtube_upload.upload_video(video_path, title, description, tags)
        return jsonify({"ok": True, "yt_video_id": yt_video_id,
                        "yt_url": f"https://www.youtube.com/watch?v={yt_video_id}"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@seo_bp.route("/api/generate-lyrics", methods=["POST"])
def api_generate_lyrics():
    import services.gemini_lyrics as gemini_lyrics
    try:
        data = request.get_json(silent=True) or {}
        topic = data.get("topic", "")
        style_input = data.get("style", "")
        if not topic:
            return jsonify({"error": "Konu alanı zorunludur."}), 400
        
        result = gemini_lyrics.generate_lyrics(topic, style_input)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        err = str(e)
        if "503" in err or "UNAVAILABLE" in err or "high demand" in err:
            err = "Google Gemini sunucuları şu anda çok yoğun. Lütfen 1 dakika sonra tekrar deneyin."
        return jsonify({"error": err}), 500
