"""YouTube support through yt-dlp. Pure Python, no FastAPI imports.

Only single YouTube videos are accepted. The URL is rebuilt from the video ID
before it reaches yt-dlp, so yt-dlp is never pointed at arbitrary sites.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, urlparse

logger = logging.getLogger("4evertools.youtube")

YOUTUBE_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
    "youtu.be", "www.youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
}
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
PATH_PREFIXES = {"shorts", "live", "embed", "v"}


class YoutubeError(Exception):
    """User-facing YouTube problem."""


@dataclass
class YoutubeSource:
    path: Path
    video_id: str
    title: str
    uploader: str | None
    duration: float | None


def is_youtube_url(url: str) -> bool:
    try:
        host = (urlparse(url.strip()).hostname or "").lower()
    except ValueError:
        return False
    return host in YOUTUBE_HOSTS


def extract_video_id(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"}:
        raise YoutubeError("Use a full YouTube link (https://...)")
    host = (parsed.hostname or "").lower()
    segments = [segment for segment in parsed.path.split("/") if segment]
    candidate = ""
    if host in {"youtu.be", "www.youtu.be"}:
        candidate = segments[0] if segments else ""
    elif segments[:1] == ["watch"]:
        candidate = (parse_qs(parsed.query).get("v") or [""])[0]
    elif len(segments) >= 2 and segments[0] in PATH_PREFIXES:
        candidate = segments[1]
    elif segments[:1] == ["playlist"]:
        raise YoutubeError("Playlists are not supported. Paste a single video link")
    if not VIDEO_ID.match(candidate):
        raise YoutubeError("This does not look like a single YouTube video link")
    return candidate


def canonical_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def ytdlp_version() -> str | None:
    try:
        from yt_dlp.version import __version__
    except ImportError:
        return None
    return str(__version__)


def friendly_error(message: str) -> str:
    text = message.lower()
    if "private video" in text:
        return "This video is private"
    if "confirm your age" in text or "age-restricted" in text or "inappropriate for some users" in text:
        return "Age-restricted videos are not supported"
    if "confirm you" in text and "bot" in text:
        return "YouTube is temporarily blocking this server (bot check). Try again later"
    if "not available in your country" in text or "geo" in text and "restrict" in text:
        return "This video is not available in the server's region"
    if "members-only" in text or "join this channel" in text:
        return "Members-only videos are not supported"
    if "video unavailable" in text or "has been removed" in text or "does not exist" in text:
        return "Video unavailable"
    if "javascript" in text or "js runtime" in text or "challenge" in text or "requested format is not available" in text:
        return "The server's yt-dlp needs an update or a JavaScript runtime (Deno)"
    if "http error 429" in text or "too many requests" in text:
        return "YouTube is rate limiting this server. Try again in a few minutes"
    return "YouTube rejected the request"


class _LogBridge:
    def debug(self, msg: str) -> None:
        if not msg.startswith("[debug] "):
            logger.debug(msg)

    def info(self, msg: str) -> None:
        logger.debug(msg)

    def warning(self, msg: str) -> None:
        logger.info("yt-dlp warning: %s", msg)

    def error(self, msg: str) -> None:
        logger.warning("yt-dlp error: %s", msg)


def download_audio(
    video_id: str,
    destination_stem: Path,
    *,
    max_duration: int,
    max_bytes: int,
    js_runtimes: list[str] | None = None,
    on_progress: Callable[[float], None] | None = None,
    on_title: Callable[[str], None] | None = None,
) -> YoutubeSource:
    """Download the best audio stream of one video to `<destination_stem>.<ext>`."""
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.utils import DownloadError
    except ImportError as exc:
        raise YoutubeError("yt-dlp is not installed on the server") from exc

    def hook(status: dict) -> None:
        if on_progress and status.get("status") == "downloading":
            total = status.get("total_bytes") or status.get("total_bytes_estimate")
            done = status.get("downloaded_bytes") or 0
            if total:
                on_progress(min(1.0, done / total))

    options: dict = {
        "format": "bestaudio/best",
        "outtmpl": f"{destination_stem}.%(ext)s",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "cachedir": False,
        "overwrites": True,
        "max_filesize": max_bytes,
        "socket_timeout": 30,
        "retries": 3,
        "progress_hooks": [hook],
        "logger": _LogBridge(),
    }
    if js_runtimes:
        options["js_runtimes"] = {name: {} for name in js_runtimes}

    url = canonical_url(video_id)
    try:
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False, process=False)
            if not info:
                raise YoutubeError("YouTube returned no information for this video")
            if info.get("_type") in {"playlist", "multi_video"}:
                raise YoutubeError("Playlists are not supported. Paste a single video link")
            if info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming", "post_live"}:
                raise YoutubeError("Live streams and premieres cannot be converted")
            duration = info.get("duration")
            if duration and duration > max_duration:
                raise YoutubeError(f"Video is longer than the {max_duration // 60} minute limit")
            title = str(info.get("title") or video_id)
            if on_title:
                on_title(title)
            result = ydl.process_ie_result(info, download=True)
    except DownloadError as exc:
        logger.warning("ytdlp_download_error id=%s error=%s", video_id, exc)
        raise YoutubeError(friendly_error(str(exc))) from exc

    path: Path | None = None
    for item in (result or {}).get("requested_downloads") or []:
        candidate = item.get("filepath")
        if candidate and Path(candidate).exists():
            path = Path(candidate)
            break
    if path is None:
        matches = sorted(destination_stem.parent.glob(f"{destination_stem.name}.*"))
        matches = [m for m in matches if not m.name.endswith((".part", ".ytdl"))]
        path = matches[0] if matches else None
    if path is None:
        raise YoutubeError("The download produced no file (it may exceed the size limit)")

    return YoutubeSource(
        path=path,
        video_id=video_id,
        title=title,
        uploader=(result or info).get("uploader") or (result or info).get("channel"),
        duration=float(duration) if duration else None,
    )
