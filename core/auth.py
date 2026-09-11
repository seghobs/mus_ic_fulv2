import os
import json
import uuid
import threading
import time
from .config import TOKENS_FILE, TOKEN_LEGACY, safe_read_json, safe_write_json, _file_lock
from .account_manager import switch_to_next_account

_refresh_lock = threading.Lock()
_last_refresh = None


def save_account_login(email, token, credits=None, tok_id=None):
    from .config import ACCOUNTS_FILE
    with _file_lock:
        tokens = _read_tokens()
        selected = next((t for t in tokens if
                         (t.get("id") == tok_id if tok_id else t.get("name") == email)), None)
        if selected is None:
            if tok_id:
                return False
            selected = {"id": str(uuid.uuid4())[:8], "name": email}
            tokens.append(selected)
        for entry in tokens:
            entry["active"] = entry is selected
        selected["token"] = token
        _write_tokens(tokens)
        accounts = safe_read_json(ACCOUNTS_FILE) or {}
        for group in accounts.values():
            for account in group:
                if account.get("email") == email:
                    account["token"] = token
                    if credits is not None:
                        account["credits"] = credits
        safe_write_json(ACCOUNTS_FILE, accounts)
        return True


def refresh_active_session():
    """Renew only the selected account; coalesce simultaneous page opens."""
    from .account_manager import MusicfulBot
    from .config import ACCOUNTS_FILE
    global _last_refresh

    with _refresh_lock:
        active = next((t for t in _read_tokens() if t.get("active", True)), None)
        if not active:
            return {"ok": False, "error": "Aktif hesap seçin."}
        key = (active.get("id"), active.get("token"))
        if _last_refresh and _last_refresh[0] == key and time.monotonic() - _last_refresh[1] < 30:
            return {"ok": True, "refreshed": True}

        accounts = safe_read_json(ACCOUNTS_FILE) or {}
        account = next((a for group in accounts.values() for a in group
                        if a.get("email") == active.get("name") or
                        (active.get("token") and a.get("token") == active["token"])), None)
        if not account or not account.get("password"):
            if MusicfulBot().get_credits(active.get("token")) is not None:
                return {"ok": True, "refreshed": False}
            return {"ok": False, "error": "Oturum geçersiz. Ayarlardan bu hesabın şifresiyle yeniden giriş yapın."}

        result = MusicfulBot().login_api(account["email"], account["password"])
        token = (result.get("data") or {}).get("token")
        if result.get("code") != 200 or not token:
            return {"ok": False, "error": "Son hesabın oturumu yenilenemedi. Bağlantınızı veya kayıtlı hesap şifresini kontrol edin."}

        # Read again after the network request: do not reactivate an account
        # that the user changed or removed while login was in progress.
        with _file_lock:
            tokens = _read_tokens()
            selected = next((t for t in tokens if t.get("active", True)), None)
            if not selected or (selected.get("id"), selected.get("token")) != key:
                return {"ok": True, "refreshed": False, "reason": "account_changed"}
            selected["token"] = token
            _write_tokens(tokens)
            accounts = safe_read_json(ACCOUNTS_FILE) or {}
            for group in accounts.values():
                for saved in group:
                    if saved.get("email") == account["email"]:
                        saved["token"] = token
            safe_write_json(ACCOUNTS_FILE, accounts)
            _last_refresh = ((selected.get("id"), token), time.monotonic())
            return {"ok": True, "refreshed": True}

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
    with _file_lock:
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
                
        if len(deduplicated) != len(tokens) or sum(t.get("active", True) for t in deduplicated) > 1:
            _write_tokens(deduplicated)
        
        return deduplicated

def _write_tokens(tokens):
    with _file_lock:
        active = [t for t in tokens if t.get("active", True)]
        selected = active[-1] if active else None
        for token in tokens:
            token["active"] = token is selected
        safe_write_json(TOKENS_FILE, tokens)

def load_token():
    tokens = _read_tokens()
    active = [t for t in tokens if t.get("active", True)]
    if not active:
        raise FileNotFoundError("Aktif hesap yok. Ayarlardan bir hesap seçin.")
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
