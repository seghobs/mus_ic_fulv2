import os
import json
import uuid
from .config import TOKENS_FILE, TOKEN_LEGACY, safe_read_json, safe_write_json
from .account_manager import switch_to_next_account

def _init_tokens():
    if os.path.exists(TOKENS_FILE):
        return
    if os.path.exists(TOKEN_LEGACY):
        legacy = safe_read_json(TOKEN_LEGACY) or {}
        tok = legacy.get("token", "")
        if tok:
            safe_write_json(TOKENS_FILE, [{"id": "1", "name": "Token 1", "token": tok, "active": True}])
    else:
        safe_write_json(TOKENS_FILE, [])

def _read_tokens():
    _init_tokens()
    tokens = safe_read_json(TOKENS_FILE) or []
    
    seen = {}
    deduplicated = []
    
    for t in tokens:
        name = t.get("name")
        if not name:
            deduplicated.append(t)
            continue
            
        if name not in seen:
            seen[name] = len(deduplicated)
            deduplicated.append(t)
        else:
            idx = seen[name]
            if t.get("active"):
                deduplicated[idx] = t
                
    if len(deduplicated) != len(tokens):
        safe_write_json(TOKENS_FILE, deduplicated)
        
    return deduplicated

def _write_tokens(tokens):
    safe_write_json(TOKENS_FILE, tokens)

def load_token():
    tokens = _read_tokens()
    active = [t for t in tokens if t.get("active", True)]
    if not active:
        new_t = switch_to_next_account()
        if new_t:
            return new_t
        raise FileNotFoundError("Aktif token yok ve yeni hesaba gecilemedi.")
    return active[0]["token"]

def get_headers(token):
    return {
        "authorization": f"Bearer {token}",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "accept": "application/json, text/plain, */*",
        "origin": "https://www.musicful.ai",
        "referer": "https://www.musicful.ai/",
    }

def api_headers(token):
    return get_headers(token)
