import os
import json
import hashlib
from .config import TOKENS_FILE, ACCOUNTS_FILE, safe_read_json, safe_write_json

DRISION_ACCOUNTS_FILE = ACCOUNTS_FILE

class AiohttpSyncSession:
    def get(self, url, **kwargs):
        from core.aiohttp_client import AiohttpSyncClient
        return AiohttpSyncClient.get(url, **kwargs)
    def post(self, url, **kwargs):
        from core.aiohttp_client import AiohttpSyncClient
        return AiohttpSyncClient.post(url, **kwargs)

class MusicfulBot:
    def __init__(self):
        self.session = AiohttpSyncSession()
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

    def login_api(self, email, password):
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
            r = self.session.get(
                "https://account-api.musicful.ai/account/login",
                params=params,
                headers=login_headers,
                timeout=45,
            )
            return r.json()
        except Exception as e:
            print(f"Login API error: {e}")
            return {"code": 500, "msg": str(e)}

    def get_credits(self, token):
        try:
            r = self.session.get(
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
            print(f"Get credits error: {e}")
            return None

def switch_to_next_account():
    print("[AccountManager] Hesap degistirme ve token yenileme islemi baslatildi...")
    if not os.path.exists(DRISION_ACCOUNTS_FILE):
        print(f"[AccountManager] Hata: {DRISION_ACCOUNTS_FILE} bulunamadi!")
        return None
        
    accounts_data = safe_read_json(DRISION_ACCOUNTS_FILE)
    if not accounts_data:
        accounts_data = {}
        
    bot = MusicfulBot()
    new_token = None
    account_updated = False
    
    # Tüm hesapları düz bir listeye al ve bilinen kredisine göre büyükten küçüğe (azalan) sırala
    all_accounts = []
    for group_code, accounts in accounts_data.items():
        for acc in accounts:
            all_accounts.append(acc)
            
    all_accounts.sort(key=lambda x: float(x.get("credits", 0) or 0), reverse=True)
    
    # Iterate through sorted accounts (high credits first)
    for acc in all_accounts:
        email = acc.get("email")
        password = acc.get("password")
        token = acc.get("token")
        
        # Kullanici istegi: Tokenlar cabuk expire oldugu icin once login olup taze token aliyoruz
        if password:
            print(f"[AccountManager] {email} icin taze token almak uzere login olunuyor...")
            login_res = bot.login_api(email, password)
            if login_res.get("code") == 200:
                token = login_res.get("data", {}).get("token")
                actual_credits = bot.get_credits(token)
                if actual_credits is not None:
                    acc["token"] = token
                    acc["credits"] = actual_credits
                    account_updated = True
                    if actual_credits >= 30:
                        new_token = token
                        print(f"[AccountManager] Yeni taze token alindi. Kredi: {actual_credits} - Email: {email}")
                        break
                    else:
                        print(f"[AccountManager] {email} kredisi yetersiz ({actual_credits}), atlaniliyor.")
                        continue
            else:
                print(f"[AccountManager] {email} login basarisiz, atlaniliyor.")
        else:
            # Eger sifre yoksa sadece eski tokeni deniyoruz
            if token and token != "N/A":
                actual_credits = bot.get_credits(token)
                if actual_credits is not None:
                    acc["credits"] = actual_credits
                    account_updated = True
                    if actual_credits >= 30:
                        new_token = token
                        print(f"[AccountManager] Gecerli eski token bulundu. Kredi: {actual_credits} - Email: {email}")
                        break
                    else:
                        print(f"[AccountManager] {email} kredisi yetersiz ({actual_credits}), atlaniliyor.")
                        continue
            
    if account_updated:
        safe_write_json(DRISION_ACCOUNTS_FILE, accounts_data, indent=4)
            
    if new_token:
        # Update local tokens.json
        tokens = safe_read_json(TOKENS_FILE) or []
                
        # Set all to inactive
        for t in tokens:
            t["active"] = False
            
        # Check if this token exists
        found = False
        for t in tokens:
            if t.get("token") == new_token:
                t["active"] = True
                found = True
                break
                
        if not found:
            import uuid
            tokens.append({
                "id": str(uuid.uuid4())[:8],
                "name": email if email else "auto_switched",
                "token": new_token,
                "active": True
            })
            
        safe_write_json(TOKENS_FILE, tokens)
            
        return new_token
        
    print("[AccountManager] Uygun kredi bakiyesine sahip hicbir hesap bulunamadi!")
    return None
