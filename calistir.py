import json
import os
import uuid
from urllib.request import urlopen
from urllib.error import URLError
import subprocess
import signal
import sys
import time
import webbrowser
from pathlib import Path
from importlib.metadata import version, PackageNotFoundError

BANNER = """
  +--------------------------------------------------+
  |               MUSICFUL AI STUDIO                 |
  |           Hayal et. Olustur. Dinle.               |
  +--------------------------------------------------+
"""
ROOT = Path(__file__).resolve().parent
URL = "http://127.0.0.1:5000"


def wait_until_ready(process, instance, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Sunucu baslatilamadi. 5000 portu kullanimda olabilir.")
        try:
            with urlopen(URL + "/api/health", timeout=1) as response:
                data = json.load(response)
            if data.get("status") == "ready" and data.get("instance") == instance:
                # Also verify the actual application page renders successfully.
                with urlopen(URL, timeout=3) as response:
                    if response.status == 200 and process.poll() is None:
                        return
        except (URLError, TimeoutError, OSError, ValueError):
            pass
        time.sleep(0.25)
    raise RuntimeError("Uygulama zamaninda hazir olmadi.")

LIBS = [line.strip() for line in Path(__file__).with_name("requirements.txt").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")]

def requirement_installed(requirement):
    name, _, minimum = requirement.partition('>=')
    try:
        installed = version(name)
        return not minimum or tuple(map(int, installed.split('.'))) >= tuple(map(int, minimum.split('.')))
    except (PackageNotFoundError, ValueError):
        return False


def check_and_install():
    missing = [lib for lib in LIBS if not requirement_installed(lib)]
    if not missing:
        return
    for lib in missing:
        print(f"  Bilesen hazirlaniyor: {lib}", flush=True)
        subprocess.run([sys.executable, '-m', 'pip', 'install', lib, '-q'],
                       capture_output=True, check=True)
    if 'playwright' in missing:
        subprocess.run([sys.executable, '-m', 'playwright', 'install', 'chromium'],
                       capture_output=True, check=True)


def wait_for_server(process):
    # Windows' unbounded process.wait() can defer Python's Ctrl+C handler.
    while process.poll() is None:
        time.sleep(0.2)
    return process.returncode


def stop_server(process):
    if process is None or process.poll() is not None:
        return
    if os.name == 'nt':
        try:
            # Target only the server we started and its child processes.
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                           capture_output=True, timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            pass
    if process.poll() is None:
        process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main():
    print(BANNER, flush=True)
    process = None
    log_path = ROOT / "musicful-server.log"
    handled_signals = [signal.SIGINT]
    if hasattr(signal, 'SIGBREAK'):
        handled_signals.append(signal.SIGBREAK)
    previous_handlers = {sig: signal.signal(sig, signal.default_int_handler) for sig in handled_signals}
    try:
        print("  [1/2] Bilesenler kontrol ediliyor...", flush=True)
        check_and_install()
        print("  [2/2] Uygulama hazirlaniyor...", flush=True)
        instance = uuid.uuid4().hex
        env = dict(os.environ, MUSICFUL_INSTANCE=instance, PYTHONUNBUFFERED="1")
        with log_path.open("w", encoding="utf-8") as log:
            process = subprocess.Popen(
                [sys.executable, "app.py"], cwd=ROOT, env=env,
                stdout=log, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            )
            wait_until_ready(process, instance)
            print("\n  HAZIR  |  " + URL, flush=True)
            print("  Tarayici aciliyor. Kapatmak icin CTRL+C.\n", flush=True)
            webbrowser.open(URL)
            if wait_for_server(process) != 0:
                raise RuntimeError("Sunucu beklenmedik sekilde durdu.")
    except KeyboardInterrupt:
        print("\n  Studio kapatiliyor...", flush=True)
    except Exception as error:
        print(f"\n  Baslatilamadi: {error}\n  Ayrintilar: {log_path}", flush=True)
        return 1
    finally:
        # A second Ctrl+C must not interrupt cleanup and leave the server alive.
        for sig in handled_signals:
            signal.signal(sig, signal.SIG_IGN)
        try:
            stop_server(process)
        finally:
            for sig, handler in previous_handlers.items():
                signal.signal(sig, handler)
    return 0


if __name__ == "__main__":
    sys.exit(main())
