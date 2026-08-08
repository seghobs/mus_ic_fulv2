import os
import json
from flask import Blueprint, jsonify, request

data_bp = Blueprint('data', __name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
STYLES_FILE = os.path.join(DATA_DIR, 'styles.json')
DRAFTS_FILE = os.path.join(DATA_DIR, 'drafts.json')
TASKS_FILE = os.path.join(DATA_DIR, 'tasks.json')

def ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)

def read_json(path, default=[]):
    if not os.path.exists(path):
        return default
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return default

def write_json(path, data):
    ensure_data_dir()
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

# --- STYLES ---
@data_bp.route('/api/styles', methods=['GET'])
def get_styles():
    if not os.path.exists(STYLES_FILE):
        default_styles = [
            {
                "title": "Duygusal Akustik (Gitar)",
                "prompt": "60 BPM, Emotional Acoustic Ballad, Intimate Studio Hall Ambience, Slow Melancholic Turkish Vocals, Deep Melismatic Performance, Raw Soulful Soul, Solo Classical Guitar Only, No Other Instruments, No Crowd, No Applause, 432Hz Tuning, Very Slow Tempo"
            },
            {
                "title": "Modern Pop (Enerjik)",
                "prompt": "124 BPM, Modern Dance Pop, Groovy Bassline, Bright Synthesisers, Clear Pop Vocals, Energetic Rhythm, Professional Studio Mixing, Catchy Hook, Uplifting Vibe"
            },
            {
                "title": "Anadolu Rock",
                "prompt": "90 BPM, Anatolian Rock Style, Overdriven Electric Guitar, Traditional Psychedelic Rock, Groovy Drum Kit, Turkish Male Rock Vocals, Vintage 70s Warmth, Wah-Wah Effects"
            },
            {
                "title": "Lo-Fi Beats (Sakin)",
                "prompt": "80 BPM, Lo-Fi Hip Hop, Chill Lullaby Vibe, Soft Muted Piano, Dusty Vinyl Crackle, Relaxed Atmospheric Vocals, Urban Night Mood, Jazzy Chords"
            },
            {
                "title": "Sinematik Yaylılar",
                "prompt": "Cinematic Orchestral Strings, Grand Piano, Emotional Cello Solo, Epic Dramatic Atmosphere, Intense Melancholy, High Production Value, Large Reverb, Slow Build-up"
            }
        ]
        write_json(STYLES_FILE, default_styles)
    return jsonify(read_json(STYLES_FILE))

@data_bp.route('/api/styles', methods=['POST'])
def save_styles():
    write_json(STYLES_FILE, request.json)
    return jsonify({"ok": True})

# --- DRAFTS ---
@data_bp.route('/api/drafts', methods=['GET'])
def get_drafts():
    return jsonify(read_json(DRAFTS_FILE, {}))

@data_bp.route('/api/drafts', methods=['POST'])
def save_drafts():
    write_json(DRAFTS_FILE, request.json)
    return jsonify({"ok": True})

# --- SETTINGS ---
SETTINGS_FILE = os.path.join(DATA_DIR, 'settings.json')

@data_bp.route('/api/settings', methods=['GET'])
def get_settings():
    return jsonify(read_json(SETTINGS_FILE, {"weirdness": 0.50, "style_influence": 0.50}))

@data_bp.route('/api/settings', methods=['POST'])
def save_settings():
    write_json(SETTINGS_FILE, request.json)
    return jsonify({"ok": True})

# --- TASKS (QUEUE) ---
@data_bp.route('/api/active-tasks', methods=['GET'])
def get_active_tasks():
    return jsonify(read_json(TASKS_FILE, {}))

@data_bp.route('/api/active-tasks', methods=['POST'])
def save_active_tasks():
    write_json(TASKS_FILE, request.json)
    return jsonify({"ok": True})
