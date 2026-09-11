from flask import Flask, render_template, jsonify, Response, request
import time
import os

from core.tasks import task_queue, sse_clients, sse_notify
from routes.auth_routes import auth_bp
from routes.musicful_routes import musicful_bp
from routes.youtube_routes import youtube_bp
from routes.video_routes import video_bp
from routes.seo_routes import seo_bp
from routes.style_routes import data_bp
from routes.musicful_features import features_bp

app = Flask(__name__)

@app.route('/api/health')
def health():
    return jsonify(status='ready', instance=os.environ.get('MUSICFUL_INSTANCE', ''))

# Disable browser cache for hot reload
@app.after_request
def add_no_cache_headers(response):
    # Only for HTML files (templates)
    if request.endpoint == 'index' or request.path.endswith('.html'):
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        response.headers['Last-Modified'] = time.strftime('%a, %d %b %Y %H:%M:%S GMT')
    return response

app.register_blueprint(auth_bp)
app.register_blueprint(musicful_bp)
app.register_blueprint(youtube_bp)
app.register_blueprint(video_bp)
app.register_blueprint(seo_bp)
app.register_blueprint(data_bp)
app.register_blueprint(features_bp)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/queue")
def api_queue():
    tasks = []
    for tid, t in task_queue.items():
        tasks.append({"id": tid, "type": t["type"], "status": t["status"], "error": t.get("error")})
    return jsonify({"tasks": tasks, "active": sum(1 for t in tasks if t["status"] == "running"), "pending": sum(1 for t in tasks if t["status"] == "pending")})

@app.route("/api/queue/<task_id>")
def api_queue_status(task_id):
    t = task_queue.get(task_id)
    if not t:
        return jsonify({"error": "Görev bulunamadı"}), 404
    return jsonify({
        "id": task_id, 
        "type": t["type"], 
        "status": t["status"], 
        "result": t.get("result"), 
        "error": t.get("error")
    })

@app.route("/api/queue/cancel/<task_id>", methods=["POST"])
def api_cancel_task(task_id):
    if task_id in task_queue:
        task_queue[task_id]["status"] = "cancelled"
        sse_notify("task_update", {"id": task_id, "status": "cancelled"})
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": "Görev bulunamadı"}), 404

@app.route("/api/events")
def api_events():
    from core.musicful_events import musicful_events
    musicful_events.start()
    def generate():
        import json
        q = []
        sse_clients.append(q)
        try:
            yield "event: connected\ndata: {}\n\n"
            for tid, t in task_queue.items():
                if t["status"] in ["running", "pending"]:
                    q.append(f"event: task_update\ndata: {json.dumps({'id': tid, 'type': t['type'], 'status': t['status']}, ensure_ascii=False)}\n\n")
            while True:
                if q:
                    while q:
                        yield q.pop(0)
                else:
                    yield ": heartbeat\n\n"
                time.sleep(1)
        except GeneratorExit:
            if q in sse_clients:
                sse_clients.remove(q)
    return Response(generate(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

if __name__ == "__main__":
    app.run(host='127.0.0.1', debug=False, port=5000, use_reloader=False)
