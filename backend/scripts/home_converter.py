"""4EVERTOOLS - YouTube converter at home.

YouTube blocks cloud servers, but not a home connection. This script runs the
same API on this PC (YouTube links only), opens a free Cloudflare quick tunnel
to it and tells the cloud API (Render) the tunnel address every minute. The
web then sends YouTube links here. Files and direct links stay on Render.

Run it with conversor-casa.bat. Standard library only.
Exit codes: 0 = stopped with Ctrl+C, 3 = setup needed (casa.env / cloudflared).
"""
from __future__ import annotations

import json
import os
import queue
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
CONFIG = ROOT / "casa.env"
TUNNEL_URL = re.compile(r"https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com")

HEARTBEAT_SECONDS = 60
# A brand-new trycloudflare name can take a while to resolve on this PC, so the
# tunnel is only judged after a grace period and several failed checks in a row.
TUNNEL_GRACE_SECONDS = 120
TUNNEL_MAX_FAILURES = 5

DEFAULTS = {
    "CLOUD_API_URL": "https://fourever-tool-api.onrender.com",
    "WEB_ORIGIN": "https://4ever-tool.vercel.app",
    "PORT": "8010",
}


def say(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


# ---------------------------------------------------------------- config

def parse_env(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def create_config() -> str:
    key = secrets.token_urlsafe(32)
    CONFIG.write_text(
        "# 4EVERTOOLS - conversor de YouTube en casa. No subas este archivo a GitHub.\n"
        f"CLOUD_API_URL={DEFAULTS['CLOUD_API_URL']}\n"
        f"WEB_ORIGIN={DEFAULTS['WEB_ORIGIN']}\n"
        "# La misma clave va en Render -> 4ever-tool-api -> Environment -> HOME_RELAY_KEY\n"
        f"HOME_RELAY_KEY={key}\n"
        f"PORT={DEFAULTS['PORT']}\n",
        encoding="utf-8",
    )
    return key


def load_config() -> dict[str, str] | None:
    if not CONFIG.exists():
        key = create_config()
        say("Cree casa.env con una clave nueva. Falta un paso, solo esta vez:")
        print()
        print("  1. Abre Render -> 4ever-tool-api -> Environment -> Add Environment Variable")
        print("  2. Key:   HOME_RELAY_KEY")
        print(f"     Value: {key}")
        print("  3. Pulsa Save. Render se reinicia solo (1-2 minutos).")
        print("  4. Vuelve a abrir conversor-casa.bat")
        print()
        print("  (La clave tambien quedo guardada en casa.env, en la carpeta del proyecto.)")
        return None
    config = {**DEFAULTS, **parse_env(CONFIG.read_text(encoding="utf-8"))}
    config["CLOUD_API_URL"] = config["CLOUD_API_URL"].rstrip("/")
    config["WEB_ORIGIN"] = config["WEB_ORIGIN"].rstrip("/")
    if len(config.get("HOME_RELAY_KEY", "")) < 24:
        say("casa.env no tiene una HOME_RELAY_KEY valida (minimo 24 caracteres). Borra casa.env y vuelve a abrir el .bat.")
        return None
    return config


def find_cloudflared() -> str | None:
    found = shutil.which("cloudflared")
    if found:
        return found
    candidates = [
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "cloudflared" / "cloudflared.exe",
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "cloudflared" / "cloudflared.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Links" / "cloudflared.exe",
    ]
    for path in candidates:
        if path.is_file():
            return str(path)
    return None


# ---------------------------------------------------------------- http

def http_json(url: str, data: dict | None = None, headers: dict[str, str] | None = None, timeout: float = 15) -> tuple[int, dict]:
    body = json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(url, data=body, method="POST" if body is not None else "GET")
    request.add_header("Accept", "application/json")
    request.add_header("User-Agent", "4evertools-home-converter")
    if body is not None:
        request.add_header("Content-Type", "application/json")
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read() or b"{}")
        except ValueError:
            payload = {}
        return exc.code, payload
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return 0, {"detail": str(getattr(exc, "reason", exc))}


def wait_until_healthy(url: str, seconds: float) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        status, _ = http_json(url, timeout=3)
        if status == 200:
            return True
        time.sleep(1)
    return False


# ---------------------------------------------------------------- processes

def api_env(config: dict[str, str]) -> dict[str, str]:
    env = dict(os.environ)
    env.update({
        "ALLOWED_ORIGINS": config["WEB_ORIGIN"],
        "ACCEPT_SOURCES": "youtube",
        "TRUST_PROXY_HEADERS": "true",
        "CLIENT_IP_HEADER": "cf-connecting-ip",
        "ENABLE_API_DOCS": "false",
        "YTDLP_ENABLED": "true",
        "YTDLP_MAX_DURATION_SECONDS": config.get("YTDLP_MAX_DURATION_SECONDS", "1200"),
        "STORAGE_DIR": str(BACKEND / "storage-casa"),
        "MAX_CONCURRENT_JOBS": config.get("MAX_CONCURRENT_JOBS", "2"),
        "MAX_CONCURRENT_DOWNLOADS": config.get("MAX_CONCURRENT_DOWNLOADS", "2"),
        "MAX_ACTIVE_JOBS_PER_CLIENT": "1",
        "MAX_QUEUED_JOBS": "10",
        "MIN_FREE_DISK_MB": "1024",
        "FILE_TTL_SECONDS": "3600",
        "LOG_LEVEL": "WARNING",
        "PYTHONIOENCODING": "utf-8",
    })
    # This PC must never act as the relay itself.
    env.pop("HOME_RELAY_KEY", None)
    return env


def start_api(config: dict[str, str]) -> subprocess.Popen:
    command = [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", config["PORT"], "--log-level", "warning", "--no-access-log"]
    return subprocess.Popen(command, cwd=BACKEND, env=api_env(config))


class Tunnel:
    def __init__(self, cloudflared: str, port: str) -> None:
        self.process = subprocess.Popen(
            [cloudflared, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        self.urls: queue.Queue[str] = queue.Queue()
        self.url: str | None = None
        self.started = time.time()
        self.failures = 0
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        assert self.process.stdout is not None
        for line in self.process.stdout:
            match = TUNNEL_URL.search(line)
            if match:
                self.urls.put(match.group(0))

    def wait_for_url(self, seconds: float) -> str | None:
        try:
            self.url = self.urls.get(timeout=seconds)
        except queue.Empty:
            self.url = None
        return self.url

    def alive(self) -> bool:
        return self.process.poll() is None

    def stop(self) -> None:
        stop_process(self.process)


def stop_process(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


def keep_pc_awake() -> None:
    """Ask Windows not to sleep while this script runs (the screen may still turn off)."""
    if os.name != "nt":
        return
    try:
        import ctypes

        ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
    except Exception:
        pass


# ---------------------------------------------------------------- main loop

def register(config: dict[str, str], url: str) -> tuple[bool, str]:
    status, payload = http_json(
        f"{config['CLOUD_API_URL']}/api/relay/register",
        {"url": url},
        {"X-Relay-Key": config["HOME_RELAY_KEY"]},
        timeout=90,  # the free Render instance may be waking up
    )
    if status == 200:
        return True, "ok"
    reasons = {
        0: f"no pude llegar a Render ({payload.get('detail', 'sin conexion')})",
        403: "Render rechazo la clave: HOME_RELAY_KEY en Render no es igual a la de casa.env",
        404: "Render todavia no tiene HOME_RELAY_KEY (agregala en Environment y espera que reinicie)",
    }
    return False, reasons.get(status, f"Render respondio {status}: {payload.get('detail', '')}")


def run(config: dict[str, str], cloudflared: str) -> None:
    local = f"http://127.0.0.1:{config['PORT']}"
    api: subprocess.Popen | None = None
    tunnel: Tunnel | None = None
    last_beat = 0.0
    registered = False
    try:
        while True:
            keep_pc_awake()
            if api is None or api.poll() is not None:
                if api is not None:
                    say("El conversor local se cerro. Reiniciando...")
                api = start_api(config)
                if not wait_until_healthy(f"{local}/api/health", 60):
                    say("El conversor local no responde. Reviso de nuevo en 15 s.")
                    stop_process(api)
                    api = None
                    time.sleep(15)
                    continue
                say(f"Conversor local listo en {local}")

            if tunnel is None or not tunnel.alive():
                if tunnel is not None:
                    say("El tunel se cayo. Abriendo uno nuevo...")
                    tunnel.stop()
                tunnel = Tunnel(cloudflared, config["PORT"])
                if not tunnel.wait_for_url(60):
                    say("Cloudflare no entrego una direccion. Reintento en 30 s.")
                    tunnel.stop()
                    tunnel = None
                    time.sleep(30)
                    continue
                say(f"Tunel abierto: {tunnel.url}")
                last_beat = 0.0
                registered = False

            if time.time() - last_beat >= HEARTBEAT_SECONDS:
                last_beat = time.time()
                ok, reason = register(config, tunnel.url or "")
                if ok and not registered:
                    say("Render ya sabe donde estoy. Los links de YouTube de la web se convierten en este PC.")
                    say("Deja esta ventana abierta. Para apagar: Ctrl+C o cierra la ventana.")
                elif not ok:
                    say(f"Aviso: {reason}. Reintento en {HEARTBEAT_SECONDS} s.")
                registered = ok

                if time.time() - tunnel.started > TUNNEL_GRACE_SECONDS:
                    status, _ = http_json(f"{tunnel.url}/api/health", timeout=20)
                    tunnel.failures = 0 if status == 200 else tunnel.failures + 1
                    if tunnel.failures >= TUNNEL_MAX_FAILURES:
                        say("El tunel no responde desde internet. Abriendo uno nuevo...")
                        tunnel.stop()
                        tunnel = None
                        continue
            time.sleep(2)
    finally:
        if tunnel is not None:
            tunnel.stop()
        stop_process(api)


def main() -> int:
    print()
    print("  #4EVER TOOLS - conversor de YouTube en casa")
    print()
    config = load_config()
    if config is None:
        return 3
    cloudflared = find_cloudflared()
    if not cloudflared:
        say("No encuentro cloudflared. Instalalo con:  winget install --id Cloudflare.cloudflared")
        say("Despues cierra esta ventana y vuelve a abrir conversor-casa.bat")
        return 3
    say(f"Render: {config['CLOUD_API_URL']}  |  Web: {config['WEB_ORIGIN']}")
    try:
        run(config, cloudflared)
    except KeyboardInterrupt:
        say("Apagado. La web va a avisar que el conversor de YouTube esta apagado.")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
