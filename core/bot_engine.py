import asyncio
import json
import random
import time
import os
import re
import base64
import string
import hashlib
from datetime import datetime
from curl_cffi import requests as crequests
from Crypto.Cipher import AES, PKCS1_v1_5
from Crypto.PublicKey import RSA
from Crypto.Util.Padding import pad

from .config import ACCOUNTS_FILE, RSA_PUB_KEY_B64, LYRICS_POOL
from .tor_manager import tor_m, get_active_proxy
from .mail_engine import AsyncMailTM

class BotState:
    def __init__(self):
        self.is_running = False
        self.progress = 0
        self.success_count = 0
        self.total = 0
        self.logs = []
        self.abort_requested = False
        self.current_parent = ""

state = BotState()

def add_log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    log_line = f"[{ts}] {msg}"
    print(log_line)
    state.logs.append(log_line)
    if len(state.logs) > 50:
        state.logs = state.logs[-50:]

async def load_db():
    if not os.path.exists(ACCOUNTS_FILE):
        return {}
    with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except:
            return {}

async def save_db(db_data):
    with open(ACCOUNTS_FILE, "w", encoding="utf-8") as f:
        json.dump(db_data, f, indent=4)

async def add_account_to_db(invite_code, email, password, new_invite_code, token):
    db = await load_db()
    if invite_code not in db:
        db[invite_code] = []
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db[invite_code].append({
        "email": email,
        "password": password,
        "token": token,
        "new_invite_code": new_invite_code,
        "timestamp": timestamp,
        "credits": 0,
        "total_invites": 0
    })
    await save_db(db)


class AsyncMusicfulBot:
    def __init__(self, proxy=None):
        self.session = crequests.AsyncSession(impersonate="chrome")
        if proxy:
            self.session.proxies = {"http": proxy, "https": proxy}
        self.rsa_pub_key_b64 = RSA_PUB_KEY_B64
        self.headers = {
            "origin": "https://www.musicful.ai",
            "referer": "https://www.musicful.ai/",
            "user-agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
            ),
        }

    def md5_hash(self, text):
        return hashlib.md5(text.encode()).hexdigest()

    def rsa_encrypt(self, data):
        key = RSA.importKey(base64.b64decode(self.rsa_pub_key_b64))
        cipher = PKCS1_v1_5.new(key)
        return base64.b64encode(cipher.encrypt(data)).decode()

    def aes_encrypt(self, d, k, i):
        c = AES.new(k, AES.MODE_CBC, i)
        return base64.b64encode(c.encrypt(pad(d.encode(), AES.block_size))).decode()

    def _build_encrypted_payload(self, payload_dict):
        p = json.dumps(payload_dict)
        ak, iv = os.urandom(32), os.urandom(16)
        ed = self.aes_encrypt(p, ak, iv)
        ek = self.rsa_encrypt(base64.b64encode(ak).decode().encode())
        return {
            "encrypted_key": ek,
            "encrypted_data": ed,
            "iv": base64.b64encode(iv).decode(),
        }

    async def get_anti_spam_token(self):
        try:
            r = await self.session.post(
                "https://account-api.musicful.ai/account/anti-spam/token",
                data={"information_sources": "https://account.musicful.ai"},
                headers=self.headers,
                timeout=30,
            )
            return r.json().get("data", {}).get("token")
        except Exception as e:
            add_log(f"Anti-spam token error: {e}")
            return None

    async def send_code(self, email):
        try:
            r = await self.session.post(
                "https://aimusic-api.topmediai.com/musicful/v1/user/send_email_code",
                json={"email": email},
                headers={**self.headers, "terminal": "web"},
                timeout=30,
            )
            return r.json()
        except Exception as e:
            add_log(f"Send code error: {e}")
            return {"status": 500}

    async def verify_code(self, email, code):
        try:
            await asyncio.sleep(random.uniform(1, 2))
            r = await self.session.post(
                "https://aimusic-api.topmediai.com/musicful/v1/user/verify_email_code",
                json={"email": email, "code": code},
                headers={**self.headers, "terminal": "web"},
                timeout=30,
            )
            return r.json()
        except Exception as e:
            add_log(f"Verify code error: {e}")
            return {"status": 500}

    async def register(self, email, password, anti_token, invite_code=None):
        await asyncio.sleep(1)
        payload = {
            "email": email,
            "password": self.md5_hash(password),
            "lang": "en",
            "information_sources": "https://account.musicful.ai",
            "source_site": "www.musicful.ai",
            "anti-token": anti_token,
        }
        d = self._build_encrypted_payload(payload)
        r = await self.session.post(
            "https://account-api.musicful.ai/account/register-encrypted",
            data=d,
            headers=self.headers,
            timeout=45,
        )
        return r.json()

    async def login_api(self, email, password):
        try:
            params = {
                "email": email,
                "password": self.md5_hash(password),
                "lang": "en",
                "information_sources": "https://account.musicful.ai"
            }
            login_headers = {
                "accept": "application/json, text/plain, */*",
                "origin": "https://www.musicful.ai",
                "referer": "https://www.musicful.ai/",
                "terminal": "web"
            }
            r = await self.session.get(
                "https://account-api.musicful.ai/account/login",
                params=params,
                headers=login_headers,
                timeout=45,
            )
            return r.json()
        except Exception as e:
            add_log(f"Login API error: {e}")
            return {"code": 500, "msg": str(e)}

    async def join_invite(self, token, invite_code):
        r = await self.session.post(
            "https://aimusic-api.topmediai.com/musicful/activity/invite/join",
            data={"invite_code": invite_code},
            headers={
                **self.headers,
                "terminal": "web",
                "authorization": f"Bearer {token}",
                "Content-Type": "application/x-www-form-urlencoded"
            },
            timeout=30,
        )
        res = r.json()
        add_log(f"🤝 Join Invite Result for {invite_code}: {res}")
        return res

    async def initialize_account(self, token, email=""):
        h = {**self.headers, "terminal": "web", "authorization": f"Bearer {token}"}
        try:
            r_author = await self.session.post("https://aimusic-api.topmediai.com/musicful/v1/user/author-page", headers=h, timeout=30)
            member_id = r_author.json().get("data", {}).get("member_id", "")
            
            await self.session.post("https://aimusic-api.topmediai.com/musicful/activity/user/front-report", headers=h, json={"type": 100}, timeout=30)
            await self.session.get("https://aimusic-api.topmediai.com/musicful/app/v1/user/check_sku", headers=h, timeout=30)
            await self.session.get("https://aimusic-api.topmediai.com/musicful/v1/user/rights", headers=h, timeout=30)
            return True
        except Exception as e:
            add_log(f"Initialize error: {e}")
            return False

    async def generate_invite_code(self, token):
        r = await self.session.post(
            "https://aimusic-api.topmediai.com/musicful/activity/invite/gen-code",
            headers={
                **self.headers,
                "terminal": "web",
                "authorization": f"Bearer {token}",
            },
            timeout=30,
        )
        return r.json().get("data", {}).get("invite_code", {}).get("invite_code", "N/A")

    async def request_song_creation(self, token, lyrics, style):
        title = " ".join(re.sub(r'\[.*?\]', '', lyrics).strip().split()[:3]).title()
        p = {
            "mv": "v4.0",
            "grade": 2,
            "area": "TR",
            "lyrics": lyrics,
            "isAiLyrics": False,
            "gender": random.choice(["male", "female"]),
            "style": style,
            "title": title,
            "instrumental": 0,
            "weirdness": 0.50,
            "style_influence": 0.50,
            "billing_cycle": 3,
            "MP3T": "D"
        }
        r = await self.session.post(
            "https://aimusic-api.topmediai.com/musicful/v2/advanced/text-to-song",
            json=p,
            headers={
                **self.headers,
                "terminal": "web",
                "authorization": f"Bearer {token}",
            },
            timeout=40,
        )
        return r.json()

    async def get_song_list(self, token):
        r = await self.session.get(
            "https://aimusic-api.topmediai.com/musicful/v1/user/author-page?page=1&size=10",
            headers={
                **self.headers,
                "terminal": "web",
                "authorization": f"Bearer {token}",
            },
            timeout=30,
        )
        return r.json().get("data", {}).get("list", [])

    async def play_song(self, token, sid):
        r = await self.session.post(
            "https://aimusic-api.topmediai.com/musicful/v1/community/song/play-records",
            json={"records": [{"id": str(sid)}]},
            headers={
                **self.headers,
                "terminal": "web",
                "authorization": f"Bearer {token}",
            },
            timeout=40,
        )
        return r.json()

    async def get_credits(self, token):
        try:
            r = await self.session.get(
                "https://aimusic-api.topmediai.com/musicful/v1/user/rights",
                headers={
                    **self.headers,
                    "terminal": "web",
                    "authorization": f"Bearer {token}",
                },
                timeout=30,
            )
            res = r.json()
            if res.get("status") == 200:
                return res.get("data", {}).get("result", {}).get("left", 0)
            return None
        except Exception as e:
            return None

async def _playwright_refresh_fallback(parent_email: str, parent_token: str):
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        add_log("⚠️ Playwright not installed. Skipping browser fallback.")
        return False

    add_log(f"🎭 Playwright: Tarayici aciliyor → {parent_email}...")
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                context = await browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
                    viewport={"width": 1920, "height": 1080},
                )

                cookies_to_set = [
                    {"name": "token", "value": parent_token, "domain": ".musicful.ai", "path": "/"},
                    {"name": "username", "value": parent_email, "domain": ".musicful.ai", "path": "/"},
                    {"name": "account_sourced", "value": "www.musicful.ai", "domain": ".musicful.ai", "path": "/"},
                    {"name": "site_initializing", "value": "www.musicful.ai", "domain": ".musicful.ai", "path": "/"},
                    {"name": "pg_initializing", "value": "www.musicful.ai/", "domain": ".musicful.ai", "path": "/"},
                    {"name": "upload-agree", "value": "1", "domain": ".musicful.ai", "path": "/"},
                    {"name": "ab_test_group", "value": "B", "domain": ".musicful.ai", "path": "/"},
                    {"name": "site_initializing_time", "value": str(int(time.time())), "domain": ".musicful.ai", "path": "/"},
                ]
                await context.add_cookies(cookies_to_set)

                page = await context.new_page()
                page.set_default_navigation_timeout(30000)
                page.set_default_timeout(15000)

                add_log(f"💉 Cookie + localStorage enjekte ediliyor...")
                await page.goto("https://www.musicful.ai/", wait_until="domcontentloaded")
                await page.evaluate(f"""
                    () => {{
                        localStorage.setItem('token', '{parent_token}');
                        localStorage.setItem('username', '{parent_email}');
                        localStorage.setItem('account_sourced', 'www.musicful.ai');
                        localStorage.setItem('isLogin', 'true');
                    }}
                """)

                add_log(f"🌐 Playwright: Sayfa yukleniyor (ai-music-generator)...")
                await page.goto("https://www.musicful.ai/ai-music-generator/", wait_until="domcontentloaded")
                await asyncio.sleep(random.uniform(3, 5))

                is_logged_in = await page.evaluate("""
                    () => {
                        const token = localStorage.getItem('token');
                        return !!(token && token.length > 10);
                    }
                """)

                if is_logged_in:
                    add_log(f"🔄 Playwright: Sayfa refresh ediliyor (kredi senkron)...")
                    await page.reload(wait_until="domcontentloaded")
                    await asyncio.sleep(random.uniform(3, 5))
                    add_log(f"✅ Playwright: Refresh tamamlandi → {parent_email}")
                    return True
                else:
                    add_log(f"❌ Playwright: Login durumu algilanamadi → {parent_email}")
                    return False
            finally:
                await browser.close()
    except Exception as e:
        add_log(f"❌ Playwright refresh error: {e}")
        return False

async def refresh_parent_via_api(parent_invite_code: str):
    db = await load_db()
    parent_acc = None
    for code, accs in db.items():
        for acc in accs:
            if acc.get("new_invite_code") == parent_invite_code:
                parent_acc = acc
                break
        if parent_acc:
            break

    if not parent_acc:
        add_log(f"⚠️ Parent account not found for code: {parent_invite_code}")
        return False

    parent_token = parent_acc.get("token")
    parent_email = parent_acc.get("email", "")
    parent_password = parent_acc.get("password", "")
    old_credits = parent_acc.get("credits", 0) or 0
    old_invites = parent_acc.get("total_invites", 0) or 0

    if not parent_token or parent_token == "N/A":
        return False

    add_log(f"🔄 API Refresh: Triggering credit sync for parent {parent_email}...")
    p = await get_active_proxy()
    bot = AsyncMusicfulBot(proxy=p)

    try:
        pre_credits = await bot.get_credits(parent_token)
        if pre_credits is None and parent_password:
            add_log(f"🔐 Parent token expired, re-login for {parent_email}...")
            login_res = await bot.login_api(parent_email, parent_password)
            if login_res.get("code") == 200:
                parent_token = login_res["data"]["token"]
                parent_acc["token"] = parent_token
                pre_credits = await bot.get_credits(parent_token)
            else:
                return False

        credits_before = pre_credits if pre_credits is not None else old_credits

        await bot.initialize_account(parent_token, parent_email)
        h = {**bot.headers, "terminal": "web", "authorization": f"Bearer {parent_token}"}
        invite_res = await bot.session.get("https://aimusic-api.topmediai.com/musicful/activity/invite/list", headers=h, timeout=30)
        total_invites = invite_res.json().get("data", {}).get("size", 0)

        try:
            await bot.session.get("https://aimusic-api.topmediai.com/musicful/activity/invite/award-info", headers=h, timeout=30)
        except: pass

        add_log("⏳ Bekleniyor... Musicful backend kredisini yatirmasi srebilir.")
        await asyncio.sleep(8)

        new_credits = await bot.get_credits(parent_token)

        if new_credits is not None:
            credit_delta = new_credits - credits_before
            parent_acc["credits"] = new_credits
            parent_acc["total_invites"] = total_invites
            parent_acc["token"] = parent_token
            await save_db(db)

            if credit_delta == 0:
                add_log(f"🎭 Kredi yansimadi, Playwright ile tarayici refresh deneniyor...")
                pw_result = await _playwright_refresh_fallback(parent_email, parent_token)
                if pw_result:
                    await asyncio.sleep(3)
                    post_pw_credits = await bot.get_credits(parent_token)
                    if post_pw_credits is not None:
                        parent_acc["credits"] = post_pw_credits
                        await save_db(db)
                        add_log(f"🎉 Playwright sonrasi kredi guncellendi: {post_pw_credits}")
            else:
                add_log(f"🎉 Kredi guncellendi: {new_credits}")
            return True
        return False
    except Exception as e:
        add_log(f"⚠️ API Refresh failed: {e}")
        return await _playwright_refresh_fallback(parent_email, parent_token)

async def get_next_valid_invite_code():
    db = await load_db()
    if not db:
        return "UNKNOWN"
        
    for code_key in db:
        for acc in db[code_key]:
            inv_count = acc.get("total_invites") or 0
            m_code = acc.get("new_invite_code")
            if inv_count < 10 and m_code and m_code != "N/A" and m_code != "UNKNOWN":
                return m_code
                
    # Eger musait code bulunamazsa en sonuncuyu dondur
    all_codes = list(db.keys())
    if all_codes:
        last_group = db[all_codes[-1]]
        if last_group:
            last_acc = last_group[-1]
            l_code = last_acc.get("new_invite_code")
            if l_code and l_code != "N/A":
                return l_code
                
    return "UNKNOWN"

async def start_bot_task(target_count, password):
    if not await tor_m.is_alive():
        add_log("Starting Tor...")
        await tor_m.start()
        
    state.is_running = True
    state.abort_requested = False
    state.progress = 0
    state.success_count = 0
    state.total = target_count
    
    add_log(f"--- Bot Engine Started ---")

    while state.success_count < target_count:
        if state.abort_requested:
            add_log("🛑 Bot stopped by user.")
            break
            
        try:
            current_invite = await get_next_valid_invite_code()
            
            parent_email_log = "UNKNOWN"
            if current_invite != "UNKNOWN":
                db_log = await load_db()
                for c, accs in db_log.items():
                    for a in accs:
                        if a.get("new_invite_code") == current_invite:
                            parent_email_log = a.get("email", "UNKNOWN")
                            break
                    if parent_email_log != "UNKNOWN":
                        break
                        
            state.current_parent = parent_email_log
            add_log(f"🔗 Referans Kodu Kullaniliyor: {current_invite} (Sahibi: {parent_email_log})")
            
            await tor_m.renew_ip()
            p = await get_active_proxy()
            
            mail_bot = AsyncMailTM()
            add_log("Tempmail uretiliyor...")
            if not await mail_bot.create_account():
                add_log("Mail olusturulamadi, tekrar deneniyor...")
                continue
                
            email = mail_bot.email
            add_log(f"Hedef: {email}")

            bot = AsyncMusicfulBot(proxy=p)
            s_res = await bot.send_code(email)
            if s_res.get("status") != 200:
                add_log("Kod gonderilemedi.")
                continue

            add_log("Kod bekleniyor...")
            code = await mail_bot.wait_for_code()
            if not code:
                add_log("Kod gelmedi.")
                continue

            add_log(f"Kod onaylaniyor: {code}")
            v_res = await bot.verify_code(email, code)
            if v_res.get("status") == 200:
                s_token = await bot.get_anti_spam_token()
                if not s_token:
                    continue
                f = await bot.register(email, password, s_token, current_invite)
                if (f.get("code") or f.get("status")) == 200:
                    tk = f["data"]["token"]
                    await bot.initialize_account(tk, email)
                    
                    if current_invite != "UNKNOWN":
                        await bot.join_invite(tk, current_invite)
                        add_log(f"🤝 Referans kabul edildi ({current_invite})")
                        
                    m_c = await bot.generate_invite_code(tk)
                    await add_account_to_db(current_invite, email, password, m_c, tk)
                    
                    state.success_count += 1
                    state.progress = int((state.success_count / state.total) * 100)
                    add_log(f"✅ Hesap uretildi! [{state.success_count}/{state.total}]")
                    
                    parent_code_for_refresh = current_invite
                    
                    song_created = False
                    try:
                        await asyncio.sleep(3)
                        song_pick = random.choice(LYRICS_POOL)
                        add_log("Baslangic sarkisi uretiliyor...")
                        cr = await bot.request_song_creation(tk, song_pick["lyrics"], song_pick["style"])
                        if (cr.get("status") or cr.get("code")) == 200:
                            song_created = True
                            add_log("Sarki uretim istegi basarili.")
                            for poll_i in range(4):
                                await asyncio.sleep(10)
                                songs = await bot.get_song_list(tk)
                                ready = [s for s in songs if s.get("state") == 2]
                                if ready:
                                    await bot.play_song(tk, ready[0]["id"])
                                    add_log("Sarki dinlendi.")
                                    break
                    except Exception as e:
                        add_log(f"Uyari: {e}")
                        
                    # Drision ozel mantik: Sarki uretildikten sonra Parent Refresh tetikle
                    if song_created:
                        try:
                            await refresh_parent_via_api(parent_code_for_refresh)
                        except Exception as e:
                            add_log(f"⚠️ Parent refresh warning: {e}")
                else:
                    add_log(f"Kayit Hatasi: {f.get('msg') or f}")
            else:
                add_log(f"Dogrulama Hatasi: {v_res.get('msg')}")

            await asyncio.sleep(5)
            
        except Exception as e:
            add_log(f"HATA: {e}")
            await asyncio.sleep(5)

    state.is_running = False
    add_log("Tamamlandi.")
