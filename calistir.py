import subprocess
import sys
import time
import webbrowser

BANNER = r"""
    /$$      /$$           /$$ /$$                           /$$
   | $$$    /$$$          | $$| $$                          | $$
   | $$$$  /$$$$  /$$$$$$ | $$| $$  /$$$$$$   /$$$$$$$  /$$$$$$$
   | $$ $$/$$ $$ /$$__  $$| $$| $$ /$$__  $$ /$$_____/ /$$__  $$
   | $$  $$$| $$| $$  \ $$| $$| $$| $$$$$$$$|  $$$$$$ | $$  | $$
   | $$\  $ | $$| $$  | $$| $$| $$| $$_____/ \____  $$| $$  | $$
   | $$ \/  | $$| $$$$$$$/| $$| $$|  $$$$$$$ /$$$$$$$/|  $$$$$$$
   |__/     |__/| $$____/ |__/|__/ \_______/|_______/  \_______/
               | $$
               | $$
               |__/
"""

LIBS = ["flask", "requests", "yt-dlp", "playwright"]

def check_and_install():
    # Hızlı kontrol: Eğer kütüphaneler zaten kuruluysa zaman alan pip sorgularını tamamen atla.
    try:
        import flask
        import requests
        import yt_dlp
        from playwright.sync_api import sync_playwright
        return
    except ImportError:
        pass

    print("  ========================================")
    print("        Musicful AI - Gerekli Kutuphaneler Kuruluyor")
    print("  ========================================\n")

    for i, lib in enumerate(LIBS, 1):
        print(f"  [{i}/{len(LIBS)}] {lib}...", end=" ", flush=True)
        result = subprocess.run(
            [sys.executable, "-m", "pip", "show", lib],
            capture_output=True
        )
        if result.returncode == 0:
            print("[*] Zaten kurulu")
        else:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", lib, "-q"],
                capture_output=True
            )
            print("[+] Kuruldu")

    print("\n  Playwright tarayicisi kontrol ediliyor...", end=" ", flush=True)
    subprocess.run(
        [sys.executable, "-m", "playwright", "install", "chromium"],
        capture_output=True
    )
    print("Hazir\n")

def main():
    check_and_install()

    print(BANNER)
    print("  ========================================")
    print("  TARAYICI ACILIYOR...")
    print("  http://127.0.0.1:5000")
    print("  Kapatmak icin CTRL+C")
    print("  ========================================\n")

    time.sleep(1)
    webbrowser.open("http://127.0.0.1:5000")

    subprocess.run([sys.executable, "app.py"])

if __name__ == "__main__":
    main()
