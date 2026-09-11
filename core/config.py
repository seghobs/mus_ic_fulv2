import os
import json
import threading
import time
import random

_file_lock = threading.RLock()


def update_json(filepath, updater, default=None):
    """Keep read/modify/write together within this application process."""
    with _file_lock:
        data = safe_read_json(filepath)
        if data is None:
            data = default
        result = updater(data)
        safe_write_json(filepath, data)
        return result

def safe_read_json(filepath):
    for i in range(15):
        try:
            with _file_lock:
                if not os.path.exists(filepath):
                    return None
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read().strip()
                    if not content:
                        return None
                    return json.loads(content)
        except (PermissionError, json.JSONDecodeError):
            time.sleep(random.uniform(0.05, 0.2))
    raise RuntimeError(f"Could not safely read JSON file: {filepath}")

def safe_write_json(filepath, data, indent=2):
    for i in range(15):
        try:
            with _file_lock:
                temp_filepath = filepath + ".tmp"
                with open(temp_filepath, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=indent, ensure_ascii=False)
                os.replace(temp_filepath, filepath)
                return
        except PermissionError:
            time.sleep(random.uniform(0.05, 0.2))
    raise RuntimeError(f"Could not safely write JSON file: {filepath}")

BASE_DIR = os.path.dirname(os.path.dirname(__file__))

BASE_URL = "https://aimusic-api.topmediai.com/musicful"
COMMUNITY_URL = "https://community-api.musicful.ai/common"
FILES_URL = "https://files.musicful.ai/musicful/web"

TOKENS_FILE = os.path.join(BASE_DIR, "tokens.json")
TOKEN_LEGACY = os.path.join(BASE_DIR, "bearer.json")
VIDEO_TEMP = os.path.join(BASE_DIR, "temp")
VIDEO_OUTPUT = os.path.join(BASE_DIR, "static", "videos")
COVERS_OUTPUT = os.path.join(BASE_DIR, "static", "covers")

os.makedirs(VIDEO_TEMP, exist_ok=True)
os.makedirs(VIDEO_OUTPUT, exist_ok=True)
os.makedirs(COVERS_OUTPUT, exist_ok=True)

ACCOUNTS_FILE = os.path.join(BASE_DIR, "accounts.json")

RSA_PUB_KEY_B64 = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCuFn+Lbhc66BwGyaTXJYg3IEquu3nFViVPGeIMfamvtrWcJhA9A12tL04BmczMGQArb2pGn4N9AyOHXdypfVixZP2CHPlhoyD/TQ56OwcXBn9BoFT3dzocURHhIcv80aaHRmnRdIxIruE6aiUJIxgjar+KDppLNgXH0pi4jiabdwIDAQAB"

LYRICS_POOL = [
    {"lyrics": "Moonlight dances on the silent waves, secrets kept in ocean graves. A melody of lost and found, where only echoes make a sound.", "style": "Dreamy Pop"},
    {"lyrics": "Neon lights in the rain, washing away the pain. A city that never sleeps, secrets that it keeps.", "style": "Cyberpunk Synthwave"},
    {"lyrics": "Walking through the midnight streets, heartbeat syncing to the beats. Every shadow tells a story, fading into morning glory.", "style": "Lo-fi Hip Hop"},
    {"lyrics": "Stars collide in the velvet sky, whispers of a lullaby. Time stands still when you are around, love is the only sound.", "style": "Indie Folk"},
    {"lyrics": "Thunder rolls across the plains, washing clean these dusty lanes. Freedom rides on every breeze, dancing through the autumn trees.", "style": "Country Rock"},
    {"lyrics": "Digital dreams in binary code, traveling down the data road. Circuits fire and signals fly, reaching for the digital sky.", "style": "Electronic"},
    {"lyrics": "Sunrise paints the mountain gold, stories that have never been told. Rivers carry ancient songs, where the wild heart belongs.", "style": "Ambient"},
    {"lyrics": "Broken glass on the dance floor, can not pretend anymore. The rhythm takes control tonight, burning brighter than the light.", "style": "Dance Pop"},
    {"lyrics": "Underneath the cherry bloom, silence fills the empty room. Paper cranes and origami dreams, nothing is quite what it seems.", "style": "J-Pop"},
    {"lyrics": "Concrete jungle steel and stone, making this city my own. Hustling through the endless grind, leaving yesterday behind.", "style": "Trap"},
    {"lyrics": "Waves crash upon the shore, I do not need anything more. Salt and sand between my toes, where the ocean river flows.", "style": "Surf Rock"},
    {"lyrics": "Fireflies in the summer night, everything is gonna be alright. Lazy days and starlit skies, catching dreams as time flies by.", "style": "Acoustic Pop"},
    {"lyrics": "Velvet shadows cross the stage, turning back another page. Spotlight fades but music stays, echoing through endless days.", "style": "Jazz"},
    {"lyrics": "Crystal towers touch the clouds, whispers lost among the crowds. Every heartbeat tells the time, rhythm flowing like a rhyme.", "style": "Future Bass"},
    {"lyrics": "Autumn leaves fall one by one, memories of summer sun. Golden light through windowpanes, dancing softly in the rain.", "style": "Chill Pop"}
]
