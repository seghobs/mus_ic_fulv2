import os
import json
from google import genai
from google.genai import types

def _load_api_key():
    key = os.environ.get("GEMINI_API_KEY", "")
    if key:
        return key
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "gemini.local.json")
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle).get("api_key", "")
    except (OSError, ValueError):
        return ""

API_KEY = _load_api_key()

def _load_models():
    config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models.json")
    try:
        with open(config_path, "r") as f:
            cfg = json.load(f)
        return cfg.get("text_model", "gemini-3.1-pro-preview"), cfg.get("image_model", "gemini-3.1-flash-image-preview")
    except:
        return "gemini-3.1-pro-preview", "gemini-3.1-flash-image-preview"

TEXT_MODEL, IMAGE_MODEL = _load_models()

def _text_config():
    """Google Search destekli text config oluşturur."""
    return types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(thinking_level="HIGH"),
        tools=[types.Tool(googleSearch=types.GoogleSearch())],
    )

class TimeoutError(Exception):
    pass

def call_with_timeout(func, timeout=60):
    import threading
    result = [None]
    error = [None]
    completed = [False]

    def worker():
        try:
            result[0] = func()
            completed[0] = True
        except Exception as e:
            error[0] = e

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    t.join(timeout)

    if not completed[0]:
        if error[0]:
            raise error[0]
        raise TimeoutError(f"İşlem {timeout} saniye içinde tamamlanamadı.")

    return result[0]

def save_binary_file(file_name, data):
    with open(file_name, "wb") as f:
        f.write(data)
    return file_name
