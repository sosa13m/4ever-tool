"""End-to-end check of the real API: starts uvicorn, converts a file and a
YouTube video, checks the security rejections, then stops the server.

Run from backend/ with the venv active:  python scripts/e2e_check.py
Needs internet (YouTube) plus FFmpeg and Deno installed.
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"
YOUTUBE_TEST = "https://www.youtube.com/watch?v=jNQXAC9IVRw"  # "Me at the zoo", 19 s, standard yt-dlp test video

results: list[tuple[str, bool]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{' :: ' + detail if detail else ''}", flush=True)
    return ok


def wait_for_server(client: httpx.Client, timeout: float = 40) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if client.get("/api/health").status_code == 200:
                return True
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    return False


def run_job(client: httpx.Client, label: str, timeout: float, **kwargs) -> dict | None:
    response = client.post("/api/conversions", **kwargs)
    if not check(f"{label}: job accepted", response.status_code == 202, f"HTTP {response.status_code} {response.text[:200]}"):
        return None
    job_id = response.json()["id"]
    seen: list[str] = []
    deadline = time.time() + timeout
    payload: dict = {}
    while time.time() < deadline:
        payload = client.get(f"/api/conversions/{job_id}").json()
        line = f"{payload['status']} {payload['progress']}% {payload['message']}"
        if not seen or seen[-1] != line:
            seen.append(line)
            print(f"    {line}", flush=True)
        if payload["status"] in {"complete", "error"}:
            break
        time.sleep(0.8)
    if not check(f"{label}: completed", payload.get("status") == "complete", payload.get("message", "timeout")):
        return payload
    download = client.get(payload["download_url"])
    disposition = download.headers.get("content-disposition", "")
    check(f"{label}: download", download.status_code == 200 and len(download.content) > 2000,
          f"{len(download.content)} bytes · {disposition}")
    payload["bytes"] = download.content
    return payload


def main() -> int:
    print(f"python {sys.version.split()[0]} · backend {ROOT}", flush=True)
    server_log = (ROOT / "e2e-server.log").open("w", encoding="utf-8")
    # 8 MB upload limit for this test server, so the size check can be exercised quickly.
    env = dict(os.environ, YTDLP_ENABLED="true", YTDLP_ACCESS_KEY="", LOG_LEVEL="INFO", PYTHONIOENCODING="utf-8", MAX_SOURCE_BYTES=str(8 * 1024 * 1024))
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=ROOT, stdout=server_log, stderr=subprocess.STDOUT, env=env,
    )
    try:
        with httpx.Client(base_url=BASE, timeout=30) as client:
            if not check("server starts", wait_for_server(client)):
                return 1

            health = client.get("/api/health").json()
            print(f"    health: {health}", flush=True)
            check("ffmpeg available", bool(health.get("ffmpeg")))
            check("yt-dlp installed", bool(health.get("ytdlp")), str(health.get("ytdlp")))
            check("JS runtime found (deno/node)", bool(health.get("js_runtime")), str(health.get("js_runtime")))

            caps = client.get("/api/capabilities").json()
            check("capabilities: youtube enabled", caps["youtube"]["enabled"], str(caps))

            r = client.post("/api/conversions", data={"format": "mp3", "url": f"{BASE}/api/health"})
            check("SSRF: localhost URL rejected", r.status_code == 400, r.text[:120])
            r = client.post("/api/conversions", data={"format": "mp3", "url": "https://www.youtube.com/playlist?list=PL0000000000"})
            check("YouTube playlist rejected", r.status_code == 400, r.text[:120])
            r = client.post("/api/conversions", data={"format": "mp3"})
            check("missing source rejected", r.status_code == 400, r.text[:120])

            tone = Path(tempfile.mkdtemp()) / "e2e tone.wav"
            subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", str(tone)], check=True)
            with tone.open("rb") as handle:
                run_job(client, "file upload -> mp3", 60, data={"format": "mp3", "quality": "192"}, files={"file": (tone.name, handle, "audio/wav")})

            # surround + tags + 24-bit WAV, size limit, wrong types, lost jobs.
            check("capabilities: WAV bit depths", caps.get("wav_bit_depths") == ["16", "24"], str(caps.get("wav_bit_depths")))
            work = Path(tempfile.mkdtemp())
            surround = work / "pelicula 5.1.flac"
            subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=3", "-filter_complex",
                            "[0]asplit=6[a][b][c][d][e][f];[a][b][c][d][e][f]join=inputs=6:channel_layout=5.1",
                            "-metadata", "title=Tema 4EVER", "-metadata", "artist=crew", str(surround)], check=True)
            with surround.open("rb") as handle:
                job = run_job(client, "5.1 FLAC -> WAV 24-bit", 60, data={"format": "wav", "bit_depth": "24"}, files={"file": (surround.name, handle, "audio/flac")})
            if job and job.get("status") == "complete":
                out = job.get("output") or {}
                check("WAV is stereo 24-bit", out.get("channels") == 2 and out.get("codec") == "pcm_s24le", str(out))
                check("expiry reported", (job.get("expires_at") or 0) > time.time() + 600, str(job.get("expires_at")))
                wav = work / "out.wav"
                wav.write_bytes(job["bytes"])
                tags = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags=title,artist", "-of", "default=nw=1", str(wav)], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
                check("your tags are kept", "Tema 4EVER" in tags and "crew" in tags, tags.replace("\n", " | "))
            big = work / "grande.wav"
            subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anoisesrc=d=60:a=0.1", "-ac", "2", str(big)], check=True)
            with big.open("rb") as handle:
                try:
                    r = client.post("/api/conversions", data={"format": "mp3"}, files={"file": (big.name, handle, "audio/wav")})
                    check("over-limit upload refused (413)", r.status_code == 413, f"HTTP {r.status_code} {r.text[:120]}")
                except httpx.HTTPError as exc:
                    # The server may close the socket while the body is still being sent: also a refusal.
                    check("over-limit upload refused (413)", True, f"connection closed early ({type(exc).__name__})")
            r = client.post("/api/conversions", data={"format": "mp3"}, files={"file": ("notas.txt", b"hola", "text/plain")})
            check("text file refused (415)", r.status_code == 415, r.text[:120])
            r = client.get("/api/conversions/doesnotexist")
            check("unknown job explains itself", r.status_code == 404 and "restarted" in r.text, r.text[:120])

            yt = run_job(client, "YouTube -> mp3", 240, data={"format": "mp3", "quality": "192", "url": YOUTUBE_TEST})
            if yt and yt.get("status") == "complete":
                check("YouTube title captured", bool(yt.get("title")), str(yt.get("title")))
                out = ROOT / "e2e-youtube.mp3"
                out.write_bytes(yt["bytes"])
                tags = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags=title,artist", "-of", "default=nw=1", str(out)], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
                print("    " + tags.replace("\n", " | "), flush=True)
                check("YouTube mp3 is playable", "duration=" in tags)
                out.unlink(missing_ok=True)
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
        server_log.close()

    failed = [name for name, ok in results if not ok]
    print(f"\nE2E SUMMARY: {len(results) - len(failed)}/{len(results)} passed", flush=True)
    for name in failed:
        print(f"  FAILED: {name}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
