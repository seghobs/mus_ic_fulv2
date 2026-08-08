from flask import Blueprint, jsonify, request
import uuid
import threading
import time
from playwright.sync_api import sync_playwright

from core.auth import _read_tokens, _write_tokens

auth_bp = Blueprint('auth_bp', __name__)

browser_token_state = {"status": "idle", "token": None, "error": None}
browser_instance = {"pw": None, "browser": None}

def _browser_token_worker():
    browser_token_state["status"] = "waiting"
    browser_token_state["token"] = None
    browser_token_state["error"] = None
    pw = None
    browser = None
    try:
        pw = sync_playwright().start()
        browser = pw.chromium.launch(headless=False)
        browser_instance["pw"] = pw
        browser_instance["browser"] = browser
        context = browser.new_context()
        page = context.new_page()

        captured = {"auth": None}

        def on_request(req):
            auth = req.headers.get("authorization", "")
            if auth.startswith("Bearer ") and len(auth) > 20 and not captured["auth"]:
                captured["auth"] = auth.replace("Bearer ", "")

        page.on("request", on_request)
        page.goto("https://www.musicful.ai", wait_until="domcontentloaded")

        while captured["auth"] is None:
            time.sleep(1)
            if browser_token_state.get("_cancel"):
                break

        if captured["auth"]:
            tokens = _read_tokens()
            existing_count = len(tokens)
            name = f"Token {existing_count + 1}"
            new = {"id": str(uuid.uuid4())[:8], "name": name, "token": captured["auth"], "active": True}
            tokens.append(new)
            _write_tokens(tokens)
            browser_token_state["token"] = new
            browser_token_state["status"] = "done"
        else:
            browser_token_state["status"] = "cancelled"
    except Exception as e:
            browser_token_state["status"] = "error"
            browser_token_state["error"] = str(e)
    finally:
        try:
            if browser: browser.close()
            if pw: pw.stop()
        except: pass
        browser_instance["pw"] = None
        browser_instance["browser"] = None


@auth_bp.route("/api/tokens", methods=["GET"])
def api_tokens_list():
    return jsonify({"tokens": _read_tokens()})

@auth_bp.route("/api/tokens", methods=["POST"])
def api_tokens_add():
    data = request.json
    name = data.get("name", "").strip() or f"Token {_read_tokens().__len__()+1}"
    token = data.get("token", "").strip()
    if not token:
        return jsonify({"error": "Token boş olamaz"}), 400
    tokens = _read_tokens()
    new = {"id": str(uuid.uuid4())[:8], "name": name, "token": token, "active": True}
    tokens.append(new)
    _write_tokens(tokens)
    return jsonify({"ok": True, "token": new})

@auth_bp.route("/api/tokens/<tok_id>", methods=["PUT"])
def api_tokens_update(tok_id):
    data = request.json
    tokens = _read_tokens()
    for t in tokens:
        if t["id"] == tok_id:
            if "name" in data: t["name"] = data["name"]
            if "token" in data: t["token"] = data["token"]
            _write_tokens(tokens)
            return jsonify({"ok": True, "token": t})
    return jsonify({"error": "Token bulunamadı"}), 404

@auth_bp.route("/api/tokens/<tok_id>", methods=["DELETE"])
def api_tokens_delete(tok_id):
    tokens = _read_tokens()
    tokens = [t for t in tokens if t["id"] != tok_id]
    _write_tokens(tokens)
    return jsonify({"ok": True})

@auth_bp.route("/api/tokens/toggle/<tok_id>", methods=["POST"])
def api_tokens_toggle(tok_id):
    tokens = _read_tokens()
    for t in tokens:
        if t["id"] == tok_id:
            t["active"] = not t.get("active", True)
            _write_tokens(tokens)
            return jsonify({"ok": True, "token": t})
    return jsonify({"error": "Token bulunamadı"}), 404


@auth_bp.route("/api/tokens/drision-sync", methods=["POST"])
def api_tokens_drision_sync():
    from core.account_manager import switch_to_next_account
    new_token = switch_to_next_account()
    if new_token:
        return jsonify({"ok": True, "token": new_token})
    return jsonify({"error": "Kredisi olan hesap bulunamadı veya bağlantı hatası."}), 400


@auth_bp.route("/api/browser-token/start", methods=["POST"])
def api_browser_token_start():
    if browser_token_state["status"] == "waiting":
        return jsonify({"error": "Zaten açık bir oturum var"}), 400
    browser_token_state["_cancel"] = False
    threading.Thread(target=_browser_token_worker, daemon=True).start()
    return jsonify({"ok": True, "status": "waiting"})

@auth_bp.route("/api/browser-token/status")
def api_browser_token_status():
    return jsonify({
        "status": browser_token_state["status"],
        "token": browser_token_state.get("token"),
        "error": browser_token_state.get("error")
    })

@auth_bp.route("/api/browser-token/cancel", methods=["POST"])
def api_browser_token_cancel():
    browser_token_state["_cancel"] = True
    browser_token_state["status"] = "idle"
    try:
        if browser_instance.get("browser"): browser_instance["browser"].close()
        if browser_instance.get("pw"): browser_instance["pw"].stop()
    except: pass
    return jsonify({"ok": True})

# --- Bot Generation Endpoints ---

import asyncio
from core.bot_engine import state as bot_state, start_bot_task
from core.config import ACCOUNTS_FILE
import json
import os

def _bot_thread(count, pwd):
    asyncio.run(start_bot_task(count, pwd))

@auth_bp.route("/api/bot/start", methods=["POST"])
def api_bot_start():
    data = request.json
    count = int(data.get("count", 1))
    password = data.get("password", "Pass123!@")
    
    if bot_state.is_running:
        return jsonify({"error": "Bot zaten calisiyor."}), 400
        
    threading.Thread(target=_bot_thread, args=(count, password), daemon=True).start()
    return jsonify({"ok": True})

@auth_bp.route("/api/bot/stop", methods=["POST"])
def api_bot_stop():
    bot_state.abort_requested = True
    return jsonify({"ok": True})

@auth_bp.route("/api/bot/status", methods=["GET"])
def api_bot_status():
    return jsonify({
        "is_running": bot_state.is_running,
        "progress": bot_state.progress,
        "success": bot_state.success_count,
        "total": bot_state.total,
        "logs": bot_state.logs,
        "current_parent": getattr(bot_state, "current_parent", "")
    })

@auth_bp.route("/api/accounts/list", methods=["GET"])
def api_accounts_list():
    if not os.path.exists(ACCOUNTS_FILE):
        return jsonify({"accounts": []})
    with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
        try:
            data = json.load(f)
            flat = []
            for g, accs in data.items():
                for a in accs:
                    credits = float(a.get("credits", 0) or 0)
                    invites = int(a.get("total_invites", 0) or 0)
                    signup_bonus = 250 if g != "UNKNOWN" else 0
                    invite_bonus = invites * 250
                    base_credits = 10
                    if g == "UNKNOWN" and credits > 10 and invites == 0:
                        base_credits = credits
                    
                    earned = base_credits + signup_bonus + invite_bonus
                    spent = max(0.0, earned - credits)
                    songs_count = int(spent // 10)
                    
                    a_copy = dict(a)
                    a_copy["spent"] = spent
                    a_copy["songs_count"] = songs_count
                    a_copy["parent_group"] = g
                    flat.append(a_copy)
            flat.sort(key=lambda x: float(x.get("credits", 0) or 0), reverse=True)
            return jsonify({"accounts": flat})
        except:
            return jsonify({"accounts": []})

@auth_bp.route("/api/accounts/switch-manual", methods=["POST"])
def api_accounts_switch_manual():
    data = request.json
    email = data.get("email")
    password = data.get("password")
    
    if not email or not password:
        return jsonify({"error": "Eksik bilgi"}), 400
        
    from core.account_manager import MusicfulBot
    bot = MusicfulBot()
    
    login_res = bot.login_api(email, password)
    if login_res.get("code") == 200:
        token = login_res.get("data", {}).get("token")
        actual_credits = bot.get_credits(token)
        
        from core.config import TOKENS_FILE
        import uuid
        
        tokens = []
        if os.path.exists(TOKENS_FILE):
            with open(TOKENS_FILE, "r", encoding="utf-8") as f:
                tokens = json.load(f)
                
        for t in tokens:
            t["active"] = False
            
        tokens.append({
            "id": str(uuid.uuid4())[:8],
            "name": email,
            "token": token,
            "active": True
        })
        
        with open(TOKENS_FILE, "w", encoding="utf-8") as f:
            json.dump(tokens, f, indent=2, ensure_ascii=False)
            
        if os.path.exists(ACCOUNTS_FILE):
            with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
                acc_data = json.load(f)
            updated = False
            for c, accs in acc_data.items():
                for a in accs:
                    if a.get("email") == email:
                        a["token"] = token
                        if actual_credits is not None:
                            a["credits"] = actual_credits
                        updated = True
            if updated:
                with open(ACCOUNTS_FILE, "w", encoding="utf-8") as f:
                    json.dump(acc_data, f, indent=4)
                    
        return jsonify({"ok": True, "credits": actual_credits})
    
    return jsonify({"error": "Login basarisiz."}), 400

bulk_refresh_status = {
    "is_running": False,
    "current": 0,
    "total": 0,
    "error": None
}

@auth_bp.route("/api/accounts/refresh-bulk", methods=["POST"])
def api_accounts_refresh_bulk():
    global bulk_refresh_status
    if bulk_refresh_status["is_running"]:
        return jsonify({"ok": False, "error": "Toplu güncelleme zaten çalışıyor."}), 400
        
    import threading
    def run_bulk_refresh():
        global bulk_refresh_status
        bulk_refresh_status["is_running"] = True
        bulk_refresh_status["error"] = None
        
        try:
            from core.account_manager import MusicfulBot
            from core.config import ACCOUNTS_FILE, safe_read_json, safe_write_json
            import os
            
            if not os.path.exists(ACCOUNTS_FILE):
                bulk_refresh_status["is_running"] = False
                return
                
            db = safe_read_json(ACCOUNTS_FILE)
            if not db:
                bulk_refresh_status["is_running"] = False
                return
                
            accounts_to_check = []
            for g, accs in db.items():
                for a in accs:
                    accounts_to_check.append((g, a))
                    
            bulk_refresh_status["total"] = len(accounts_to_check)
            bulk_refresh_status["current"] = 0
            
            bot = MusicfulBot()
            
            for g, a in accounts_to_check:
                if not bulk_refresh_status["is_running"]:
                    break
                    
                email = a.get("email")
                password = a.get("password")
                
                if password:
                    try:
                        login_res = bot.login_api(email, password)
                        if login_res.get("code") == 200:
                            token = login_res.get("data", {}).get("token")
                            actual_credits = bot.get_credits(token)
                            if actual_credits is not None:
                                a["credits"] = actual_credits
                                a["token"] = token
                    except Exception as e:
                        print(f"Bulk refresh error for {email}: {e}")
                        
                bulk_refresh_status["current"] += 1
                safe_write_json(ACCOUNTS_FILE, db)
                
        except Exception as e:
            bulk_refresh_status["error"] = str(e)
        finally:
            bulk_refresh_status["is_running"] = False

    t = threading.Thread(target=run_bulk_refresh, daemon=True)
    t.start()
    return jsonify({"ok": True})

@auth_bp.route("/api/accounts/refresh-status", methods=["GET"])
def api_accounts_refresh_status():
    global bulk_refresh_status
    return jsonify(bulk_refresh_status)
