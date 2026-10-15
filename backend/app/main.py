from __future__ import annotations

import asyncio
import hmac
import logging
import mimetypes
import os
import re
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable, Literal
from urllib.parse import urlparse

import httpx
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .media import MediaError, convert_media, describe_output, ensure_convertible, ffmpeg_available, probe_media
from .security import RateLimiter, UnsafeUrlError, assert_public_http_url, assert_public_peer, has_free_space
from .youtube import YoutubeError, download_audio, extract_video_id, is_youtube_url, ytdlp_version
from .relay import HomeRelay, RelayError

VERSION = "1.0.0"


def env_bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


ROOT = Path(__file__).resolve().parents[1]
STORAGE = Path(os.getenv("STORAGE_DIR", str(ROOT / "storage")))
STORAGE.mkdir(parents=True, exist_ok=True)
MAX_BYTES = int(os.getenv("MAX_SOURCE_BYTES", str(250 * 1024 * 1024)))
TTL_SECONDS = int(os.getenv("FILE_TTL_SECONDS", "3600"))
MAX_CONCURRENT_JOBS = int(os.getenv("MAX_CONCURRENT_JOBS", "2"))
MAX_CONCURRENT_DOWNLOADS = int(os.getenv("MAX_CONCURRENT_DOWNLOADS", "2"))
MAX_ACTIVE_JOBS_PER_CLIENT = int(os.getenv("MAX_ACTIVE_JOBS_PER_CLIENT", "2"))
MAX_REDIRECTS = int(os.getenv("MAX_REDIRECTS", "5"))
RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "60"))
RATE_LIMIT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
TRUST_PROXY_HEADERS = env_bool("TRUST_PROXY_HEADERS", False)
# Behind a Cloudflare tunnel (the home converter) only cf-connecting-ip can be
# trusted: Cloudflare overwrites it, while X-Real-IP passes through from the visitor.
CLIENT_IP_HEADER = os.getenv("CLIENT_IP_HEADER", "").strip().lower()
# Production guards
ENABLE_API_DOCS = env_bool("ENABLE_API_DOCS", True)
MAX_QUEUED_JOBS = int(os.getenv("MAX_QUEUED_JOBS", "40"))
MIN_FREE_DISK_BYTES = int(os.getenv("MIN_FREE_DISK_MB", "1024")) * 1024 * 1024
ALLOWED_ORIGINS = [item.strip() for item in os.getenv("ALLOWED_ORIGINS", "http://localhost:4173,http://localhost:5173").split(",") if item.strip()]

YTDLP_ENABLED = env_bool("YTDLP_ENABLED", True)
YTDLP_ACCESS_KEY = os.getenv("YTDLP_ACCESS_KEY", "").strip()
YTDLP_MAX_DURATION = int(os.getenv("YTDLP_MAX_DURATION_SECONDS", str(20 * 60)))
YTDLP_JS_RUNTIMES = [item.strip() for item in os.getenv("YTDLP_JS_RUNTIMES", "deno,node").split(",") if item.strip()]
# Which sources this server takes: the home converter only does YouTube.
ACCEPT_SOURCES = {item.strip() for item in os.getenv("ACCEPT_SOURCES", "file,direct,youtube").split(",") if item.strip()}
# Cloud server: shared key the home converter uses to report its tunnel address.
home_relay = HomeRelay(os.getenv("HOME_RELAY_KEY", ""))

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("4evertools")

conversion_slots = asyncio.Semaphore(MAX_CONCURRENT_JOBS)
download_slots = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)
rate_limiter = RateLimiter(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW)

JobStatus = Literal["queued", "fetching", "processing", "complete", "error"]
SourceKind = Literal["file", "direct", "youtube"]


class Job(BaseModel):
    id: str
    status: JobStatus
    source: SourceKind
    progress: int = 0
    message: str = "QUEUED"
    title: str | None = None
    created_at: float
    # Filled when the job completes: what the file really is, and when it disappears.
    output: dict | None = None
    expires_at: float | None = None
    finished_at: float | None = Field(default=None, exclude=True)
    client: str = Field(exclude=True)
    output_path: str | None = Field(default=None, exclude=True)

    def advance(self, progress: float, message: str | None = None, status: JobStatus | None = None) -> None:
        # Progress only moves forward, even when updated from worker threads.
        self.progress = max(self.progress, min(100, int(progress)))
        if message:
            self.message = message
        if status:
            self.status = status

    def fail(self, message: str) -> None:
        self.status = "error"
        self.message = message.upper()[:180]
        self.finished_at = time.time()


jobs: dict[str, Job] = {}


def ytdlp_ready() -> bool:
    return YTDLP_ENABLED and ytdlp_version() is not None


def js_runtime_found() -> str | None:
    for name in YTDLP_JS_RUNTIMES:
        if shutil.which(name):
            return name
    return None


async def cleanup_loop() -> None:
    while True:
        try:
            cutoff = time.time() - TTL_SECONDS
            active = {job_id for job_id, job in jobs.items() if job.status in {"queued", "fetching", "processing"}}
            for path in STORAGE.iterdir():
                if path.is_file() and path.stat().st_mtime < cutoff and path.name.split(".", 1)[0] not in active:
                    path.unlink(missing_ok=True)
            for job_id, job in list(jobs.items()):
                # A job lives as long as its file: TTL counted from when it finished.
                if (job.finished_at or job.created_at) < cutoff and job_id not in active:
                    jobs.pop(job_id, None)
        except Exception:
            logger.exception("cleanup_failed")
        await asyncio.sleep(300)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info(
        "startup version=%s ffmpeg=%s ytdlp=%s ytdlp_enabled=%s js_runtime=%s access_key=%s",
        VERSION, ffmpeg_available(), ytdlp_version(), YTDLP_ENABLED, js_runtime_found(), bool(YTDLP_ACCESS_KEY),
    )
    if YTDLP_ENABLED and ytdlp_version() and not js_runtime_found():
        logger.warning("No JavaScript runtime (deno/node) found: yt-dlp may fail on YouTube. Install Deno.")
    task = asyncio.create_task(cleanup_loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(
    title="4EVERTOOLS API",
    version=VERSION,
    docs_url="/api/docs" if ENABLE_API_DOCS else None,
    openapi_url="/api/openapi.json" if ENABLE_API_DOCS else None,
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)


def client_ip(request: Request) -> str:
    # Behind nginx every request comes from the proxy container, so the real
    # client IP must be read from X-Real-IP. Only trust it when configured,
    # otherwise anyone could spoof the header to dodge the rate limit.
    if TRUST_PROXY_HEADERS and CLIENT_IP_HEADER:
        trusted = request.headers.get(CLIENT_IP_HEADER, "").strip()
        if trusted:
            return trusted
    elif TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("x-real-ip") or request.headers.get("x-forwarded-for", "").split(",")[0]
        if forwarded.strip():
            return forwarded.strip()
    return request.client.host if request.client else "unknown"


@app.middleware("http")
async def production_guard(request: Request, call_next):
    request_id = uuid.uuid4().hex[:12]
    started = time.perf_counter()
    # Only "expensive" calls count: submitting work and hitting SoundCloud.
    # Status polling (GET every ~1s during a long YouTube job) must not
    # exhaust the user's own budget.
    if request.method == "POST" and request.url.path == "/api/conversions":
        # Refuse oversized uploads from the header, before the whole body is
        # received and spooled to disk (the browser checks too; this is the backstop).
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > MAX_BYTES + 2 * 1024 * 1024:
            return JSONResponse({"detail": f"File is bigger than the {MAX_BYTES // (1024 * 1024)} MB limit"}, status_code=413, headers={"X-Request-ID": request_id, "Connection": "close"})
    limited = request.method == "POST" or request.url.path.startswith("/api/soundcloud/")
    if request.url.path.startswith("/api/") and limited:
        allowed, retry_after = rate_limiter.hit(client_ip(request))
        if not allowed:
            # Returning a response here (instead of raising HTTPException) is
            # what makes the client actually receive a 429 and not a 500.
            response = JSONResponse({"detail": "Too many requests. Try again shortly."}, status_code=429, headers={"Retry-After": str(retry_after)})
            response.headers["X-Request-ID"] = request_id
            return response
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("request_failed id=%s path=%s", request_id, request.url.path)
        response = JSONResponse({"detail": "Internal server error"}, status_code=500)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/conversions") else "no-cache"
    logger.info("request id=%s method=%s path=%s status=%s ms=%.1f", request_id, request.method, request.url.path, response.status_code, (time.perf_counter() - started) * 1000)
    return response


# ---------------------------------------------------------------- sources

async def save_upload(upload: UploadFile, destination: Path) -> None:
    size = 0
    with destination.open("wb") as target:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                target.close()
                destination.unlink(missing_ok=True)
                raise HTTPException(413, f"File is bigger than the {MAX_BYTES // (1024 * 1024)} MB limit")
            target.write(chunk)


async def fetch_direct(url: str, destination: Path, on_progress: Callable[[float], None]) -> None:
    """Download a direct media URL, validating every redirect hop."""
    timeout = httpx.Timeout(30, read=120)
    current = url
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            await assert_public_http_url(current)
            async with client.stream("GET", current, headers={"User-Agent": f"4EVERTOOLS/{VERSION}"}) as response:
                assert_public_peer(response.extensions)  # DNS rebinding: check who we really reached
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise MediaError("The source redirected without a destination")
                    current = str(response.url.join(location))
                    continue
                if response.status_code >= 400:
                    raise MediaError(f"The source answered HTTP {response.status_code}")
                content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
                if not (content_type.startswith(("audio/", "video/")) or content_type == "application/octet-stream"):
                    raise MediaError(f"URL did not return downloadable media ({content_type or 'unknown type'})")
                declared = int(response.headers.get("content-length") or 0)
                if declared > MAX_BYTES:
                    raise MediaError("Remote source exceeds the configured size limit")
                size = 0
                with destination.open("wb") as target:
                    async for chunk in response.aiter_bytes(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_BYTES:
                            target.close()
                            destination.unlink(missing_ok=True)
                            raise MediaError("Remote source exceeds the configured size limit")
                        target.write(chunk)
                        if declared:
                            on_progress(size / declared)
                return
    raise MediaError("Too many redirects")


def remove_sources(job_id: str) -> None:
    for path in STORAGE.glob(f"{job_id}.source*"):
        path.unlink(missing_ok=True)


async def process_job(job_id: str, kind: SourceKind, target: str, fmt: str, quality: str, bit_depth: str = "16") -> None:
    """Background pipeline: fetch (URL/YouTube) -> probe -> FFmpeg."""
    job = jobs[job_id]
    stem = STORAGE / f"{job_id}.source"
    output = STORAGE / f"{job_id}.{fmt}"
    metadata: dict[str, str] = {}
    try:
        source = stem
        if kind == "direct":
            job.advance(8, "DOWNLOADING SOURCE…", "fetching")
            await fetch_direct(target, stem, lambda f: job.advance(8 + f * 47))
        elif kind == "youtube":
            job.advance(6, "WAITING FOR A DOWNLOAD SLOT…", "fetching")
            async with download_slots:
                job.advance(8, "ASKING YOUTUBE…")
                result = await asyncio.to_thread(
                    download_audio,
                    target,
                    stem,
                    max_duration=YTDLP_MAX_DURATION,
                    max_bytes=MAX_BYTES,
                    js_runtimes=YTDLP_JS_RUNTIMES,
                    on_progress=lambda f: job.advance(12 + f * 43, "PULLING AUDIO FROM YOUTUBE…"),
                    on_title=lambda title: setattr(job, "title", title[:160]),
                )
            source = result.path
            job.title = result.title[:160]
            metadata = {"title": result.title, "artist": result.uploader or "", "comment": f"youtube:{result.video_id}"}

        job.advance(58, "INSPECTING MEDIA…", "processing")
        probe = await asyncio.to_thread(probe_media, source)
        ensure_convertible(probe)
        # Your own file keeps its title/artist/album; YouTube gets the video's.
        metadata = {**(probe.tags if kind != "youtube" else {}), **metadata}

        job.advance(62, "WAITING FOR FFMPEG…")
        async with conversion_slots:
            job.advance(64, "FFMPEG IS COOKING…")
            await asyncio.to_thread(
                lambda: convert_media(
                    source, output, fmt, quality, probe.duration, metadata,
                    lambda f: job.advance(64 + f * 32), probe=probe, bit_depth=bit_depth,
                )
            )
        job.advance(97, "CHECKING THE FILE…")
        try:
            job.output = await asyncio.to_thread(describe_output, output)
        except MediaError:
            job.output = None  # the file is fine; we just can't describe it
        job.output_path = str(output)
        job.finished_at = time.time()
        job.expires_at = job.finished_at + TTL_SECONDS
        job.advance(100, "FILE READY", "complete")
    except (MediaError, YoutubeError, UnsafeUrlError) as exc:
        job.fail(str(exc))
        output.unlink(missing_ok=True)
    except httpx.HTTPError as exc:
        logger.info("fetch_failed job=%s error=%r", job_id, exc)
        job.fail("Could not reach the source URL")
        output.unlink(missing_ok=True)
    except Exception:
        logger.exception("job_failed id=%s", job_id)
        job.fail("Conversion failed on the server")
        output.unlink(missing_ok=True)
    finally:
        remove_sources(job_id)


# ---------------------------------------------------------------- routes

@app.get("/api/capabilities")
def capabilities():
    return {
        "version": VERSION,
        "max_source_bytes": MAX_BYTES,
        "formats": ["mp3", "wav"],
        "wav_bit_depths": ["16", "24"],
        "file_ttl_seconds": TTL_SECONDS,
        "youtube": {
            "enabled": ytdlp_ready() and "youtube" in ACCEPT_SOURCES,
            "requires_key": bool(YTDLP_ACCESS_KEY),
            "max_duration_seconds": YTDLP_MAX_DURATION,
            # Where the web should send YouTube links instead (the PC at home), if it is on.
            "relay_url": home_relay.current(),
            "relay_configured": home_relay.enabled,
        },
        "sources": sorted(ACCEPT_SOURCES),
    }


class RelayRegistration(BaseModel):
    url: str


@app.post("/api/relay/register")
def relay_register(payload: RelayRegistration, request: Request):
    try:
        url = home_relay.register(payload.url, request.headers.get("x-relay-key", ""))
    except RelayError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    return {"ok": True, "url": url}


@app.post("/api/conversions", status_code=202)
async def create_conversion(
    request: Request,
    background: BackgroundTasks,
    format: Literal["mp3", "wav"] = Form(...),
    quality: Literal["192", "256", "320"] = Form("320"),
    bit_depth: Literal["16", "24"] = Form("16"),
    url: str | None = Form(None),
    access_key: str | None = Form(None),
    file: UploadFile | None = File(None),
):
    url = (url or "").strip() or None
    if bool(url) == bool(file):
        raise HTTPException(400, "Provide exactly one source: URL or file")

    client = client_ip(request)
    active = sum(1 for job in jobs.values() if job.client == client and job.status in {"queued", "fetching", "processing"})
    if active >= MAX_ACTIVE_JOBS_PER_CLIENT:
        raise HTTPException(429, f"You already have {active} conversions running. Wait for them to finish")
    # Whole-server guards: a public site must not queue forever or fill the disk.
    queued = sum(1 for job in jobs.values() if job.status in {"queued", "fetching", "processing"})
    if queued >= MAX_QUEUED_JOBS:
        raise HTTPException(503, "The server is busy right now. Try again in a minute")
    if not has_free_space(STORAGE, MIN_FREE_DISK_BYTES):
        logger.warning("disk_low storage=%s", STORAGE)
        raise HTTPException(503, "The server is out of space for a moment. Try again later")

    job_id = uuid.uuid4().hex
    kind: SourceKind
    target = ""
    title: str | None = None
    if file:
        # The browser's MIME type is only a hint (Windows reports .ogg/.opus/.mkv in
        # many ways); FFprobe decides. Only obvious non-media is turned away early.
        if (file.content_type or "").startswith(("text/", "image/")):
            raise HTTPException(415, "That is not an audio or video file")
        if "file" not in ACCEPT_SOURCES:
            raise HTTPException(403, "This converter only takes YouTube links")
        await save_upload(file, STORAGE / f"{job_id}.source")
        kind = "file"
        title = Path(file.filename or "").stem[:160] or None
    elif is_youtube_url(url or ""):
        if "youtube" not in ACCEPT_SOURCES or not ytdlp_ready():
            raise HTTPException(400, "YouTube conversion is not enabled on this server")
        if YTDLP_ACCESS_KEY and not hmac.compare_digest((access_key or "").encode(), YTDLP_ACCESS_KEY.encode()):
            raise HTTPException(403, "A valid collective access key is required for YouTube links")
        try:
            target = extract_video_id(url or "")
        except YoutubeError as exc:
            raise HTTPException(400, str(exc)) from exc
        kind = "youtube"
    else:
        if "direct" not in ACCEPT_SOURCES:
            raise HTTPException(403, "This converter only takes YouTube links")
        try:
            await assert_public_http_url(url or "")
        except UnsafeUrlError as exc:
            raise HTTPException(400, str(exc)) from exc
        kind = "direct"
        target = url or ""
        title = Path(urlparse(target).path).stem[:160] or None

    jobs[job_id] = Job(id=job_id, status="queued", source=kind, progress=4, message="SOURCE RECEIVED", title=title, created_at=time.time(), client=client)
    background.add_task(process_job, job_id, kind, target, format, quality, bit_depth)
    return {"id": job_id, "source": kind}


@app.get("/api/conversions/{job_id}")
def conversion_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Conversion job not found. It expired or the server restarted")
    data = job.model_dump()
    if job.status == "complete":
        data["download_url"] = f"/api/conversions/{job_id}/download"
    return data


SAFE_NAME = re.compile(r"[^\w\-. ()\[\]&']+", re.UNICODE)


def download_name(job: Job, suffix: str) -> str:
    base = SAFE_NAME.sub("", (job.title or "").replace("/", "-")).strip(" .")[:90]
    return f"{base or '4evertools-' + job.id[:8]}{suffix}"


@app.get("/api/conversions/{job_id}/download")
def download_conversion(job_id: str):
    job = jobs.get(job_id)
    if not job or job.status != "complete" or not job.output_path:
        raise HTTPException(404, "This file is not available. It expired or the server restarted")
    path = Path(job.output_path)
    if not path.exists():
        raise HTTPException(410, "This file expired. Convert it again")
    return FileResponse(path, filename=download_name(job, path.suffix), media_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream")


# ---------------------------------------------------------------- SoundCloud metadata (unchanged behaviour)

class SoundCloudMetadata(BaseModel):
    url: str
    title: str
    author_name: str | None = None
    author_url: str | None = None
    thumbnail_url: str | None = None
    provider_name: str = "SoundCloud"


metadata_cache: dict[str, tuple[float, SoundCloudMetadata]] = {}
METADATA_TTL_SECONDS = 6 * 60 * 60


@app.get("/api/soundcloud/oembed", response_model=SoundCloudMetadata)
async def soundcloud_oembed(url: str) -> SoundCloudMetadata:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or not (host == "soundcloud.com" or host.endswith(".soundcloud.com")):
        raise HTTPException(400, "A valid SoundCloud URL is required")

    cached = metadata_cache.get(url)
    if cached and time.time() - cached[0] < METADATA_TTL_SECONDS:
        return cached[1]

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            response = await client.get(
                "https://soundcloud.com/oembed",
                params={"format": "json", "url": url},
                headers={"User-Agent": f"4EVERTOOLS/{VERSION}"},
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "SoundCloud metadata is temporarily unavailable") from exc

    item = SoundCloudMetadata(
        url=url,
        title=str(payload.get("title") or "SoundCloud profile"),
        author_name=payload.get("author_name"),
        author_url=payload.get("author_url"),
        thumbnail_url=payload.get("thumbnail_url"),
        provider_name=str(payload.get("provider_name") or "SoundCloud"),
    )
    if len(metadata_cache) > 500:
        metadata_cache.clear()
    metadata_cache[url] = (time.time(), item)
    return item


# ---------------------------------------------------------------- health

@app.get("/api/health")
def health():
    ffmpeg_ready = ffmpeg_available()
    return {
        "status": "ok" if ffmpeg_ready else "degraded",
        "ffmpeg": ffmpeg_ready,
        "ytdlp": ytdlp_version(),
        "ytdlp_enabled": YTDLP_ENABLED,
        "js_runtime": js_runtime_found(),
        "jobs": len(jobs),
        "version": VERSION,
    }


@app.get("/api/ready")
def ready():
    if not ffmpeg_available():
        raise HTTPException(503, "FFmpeg is unavailable")
    if not STORAGE.exists() or not os.access(STORAGE, os.W_OK):
        raise HTTPException(503, "Storage is unavailable")
    return {"ready": True}
