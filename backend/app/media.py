"""FFprobe / FFmpeg helpers. Pure Python, no FastAPI imports."""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

logger = logging.getLogger("4evertools.media")

# Container names reported by ffprobe that we accept. Anything else (HLS/m3u8
# playlists, concat lists, SDP, images, lavfi...) is rejected, because those
# formats can make FFmpeg open other files or network resources.
ALLOWED_CONTAINERS = {
    "mp3", "wav", "w64", "flac", "ogg", "aac", "aiff", "caf", "amr", "ac3", "eac3", "dts",
    "wv", "ape", "asf", "mov", "mp4", "m4a", "3gp", "3g2", "mj2", "matroska", "webm",
    "avi", "flv", "mpegts", "mpeg",
}


class MediaError(Exception):
    """User-facing media problem (bad file, unsupported container, ...)."""


# Tags worth carrying over from the user's own file (anything else, like
# "encoder" or "major_brand", is container noise that would end up as junk ID3 frames).
KEEP_TAGS = ("title", "artist", "album", "album_artist", "genre", "date", "track", "composer", "comment")
WAV_MIN_RATE = 44100
WAV_MAX_RATE = 96000


@dataclass
class Probe:
    format_name: str
    duration: float | None
    has_audio: bool
    channels: int | None = None
    sample_rate: int | None = None
    tags: dict[str, str] = field(default_factory=dict)
    codec: str | None = None
    bit_rate: int | None = None


def ffmpeg_available() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def _int(value) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def probe_media(source: Path, timeout: int = 60) -> Probe:
    if not ffmpeg_available():
        raise RuntimeError("FFmpeg/FFprobe is not installed or not in PATH")
    command = [
        "ffprobe", "-v", "error", "-protocol_whitelist", "file",
        "-show_entries", "format=format_name,duration,bit_rate:format_tags:stream=codec_type,codec_name,channels,sample_rate,bit_rate:stream_tags",
        "-of", "json", str(source),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise MediaError("The file took too long to inspect") from exc
    if result.returncode != 0:
        logger.info("ffprobe_rejected stderr=%s", result.stderr[-500:])
        raise MediaError("This file is not a readable audio or video file")
    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise MediaError("This file is not a readable audio or video file") from exc
    fmt = payload.get("format") or {}
    duration_value = fmt.get("duration")
    try:
        duration = float(duration_value) if duration_value not in (None, "N/A") else None
    except (TypeError, ValueError):
        duration = None
    audio = [stream for stream in payload.get("streams") or [] if stream.get("codec_type") == "audio"]
    first = audio[0] if audio else {}
    # Vorbis/Opus keep their tags on the stream, MP3/MP4/FLAC on the container; keys vary in case.
    tags: dict[str, str] = {}
    for source_tags in (first.get("tags") or {}, fmt.get("tags") or {}):
        for key, value in source_tags.items():
            name = str(key).lower()
            if name in KEEP_TAGS and str(value).strip() and name not in tags:
                tags[name] = str(value).strip()[:200]
    return Probe(
        format_name=str(fmt.get("format_name") or ""),
        duration=duration,
        has_audio=bool(audio),
        channels=_int(first.get("channels")),
        sample_rate=_int(first.get("sample_rate")),
        tags=tags,
        codec=first.get("codec_name"),
        bit_rate=_int(first.get("bit_rate")) or _int(fmt.get("bit_rate")),
    )


def ensure_convertible(probe: Probe) -> None:
    tokens = {token.strip() for token in probe.format_name.split(",") if token.strip()}
    if not tokens & ALLOWED_CONTAINERS:
        raise MediaError(f"Unsupported container ({probe.format_name or 'unknown'})")
    if not probe.has_audio:
        raise MediaError("No audio track found in this file")


def wav_sample_rate(source_rate: int | None) -> int:
    """Keep the source rate (no needless resampling of 48 kHz YouTube audio or
    96 kHz studio files) but never go below CD rate or above 96 kHz."""
    if not source_rate:
        return WAV_MIN_RATE
    return max(WAV_MIN_RATE, min(WAV_MAX_RATE, source_rate))


def build_ffmpeg_command(
    source: Path,
    output: Path,
    fmt: str,
    quality: str,
    metadata: dict[str, str] | None = None,
    probe: Probe | None = None,
    bit_depth: str = "16",
) -> list[str]:
    command = [
        "ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
        "-protocol_whitelist", "file", "-i", str(source),
        "-map", "0:a:0", "-vn", "-map_metadata", "-1",
    ]
    for key, value in (metadata or {}).items():
        if value:
            command += ["-metadata", f"{key}={value[:200]}"]
    # Surround (5.1 from films, 4.0 field recordings...) → stereo. Producers expect
    # a stereo file, and MP3 cannot hold more than two channels anyway.
    if probe and probe.channels and probe.channels > 2:
        command += ["-ac", "2"]
    if fmt == "mp3":
        command += ["-codec:a", "libmp3lame", "-b:a", f"{quality}k", "-id3v2_version", "3"]
    elif fmt == "wav":
        codec = "pcm_s24le" if bit_depth == "24" else "pcm_s16le"
        command += ["-codec:a", codec, "-ar", str(wav_sample_rate(probe.sample_rate if probe else None))]
    else:
        raise ValueError(f"Unsupported output format: {fmt}")
    command += ["-progress", "pipe:1", "-nostats", str(output)]
    return command


def describe_output(path: Path) -> dict:
    """What the user actually gets: shown on the result card and in the history."""
    probe = probe_media(path)
    return {
        "format": path.suffix.lstrip(".").lower(),
        "bytes": path.stat().st_size,
        "duration": round(probe.duration, 2) if probe.duration else None,
        "sample_rate": probe.sample_rate,
        "channels": probe.channels,
        "codec": probe.codec,
        "bit_rate": probe.bit_rate,
    }


def convert_media(
    source: Path,
    output: Path,
    fmt: str,
    quality: str,
    duration: float | None = None,
    metadata: dict[str, str] | None = None,
    on_progress: Callable[[float], None] | None = None,
    timeout: int = 600,
    *,
    probe: Probe | None = None,
    bit_depth: str = "16",
) -> None:
    """Run FFmpeg and report progress (0..1) when the duration is known."""
    if not ffmpeg_available():
        raise RuntimeError("FFmpeg is not installed or not available in PATH")
    command = build_ffmpeg_command(source, output, fmt, quality, metadata, probe, bit_depth)
    started = time.monotonic()
    # stderr goes to a temp file so a chatty FFmpeg can never fill the pipe and deadlock.
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8", errors="replace") as stderr_file:
        with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=stderr_file, text=True, encoding="utf-8", errors="replace") as process:
            try:
                _pump_progress(process, started, timeout, duration, on_progress)
            except BaseException:
                output.unlink(missing_ok=True)
                raise
            finally:
                if process.poll() is None:
                    process.kill()
        if process.returncode != 0:
            stderr_file.seek(0)
            logger.warning("ffmpeg_failed code=%s stderr=%s", process.returncode, stderr_file.read()[-1500:])
            output.unlink(missing_ok=True)
            raise MediaError("FFmpeg could not convert this source")


def _pump_progress(
    process: subprocess.Popen,
    started: float,
    timeout: int,
    duration: float | None,
    on_progress: Callable[[float], None] | None,
) -> None:
    assert process.stdout is not None
    for line in process.stdout:
        if time.monotonic() - started > timeout:
            process.kill()
            raise MediaError("Conversion took too long and was stopped")
        key, _, value = line.strip().partition("=")
        if on_progress and duration and key in {"out_time_us", "out_time_ms"} and value.isdigit():
            on_progress(min(1.0, int(value) / 1_000_000 / duration))
    try:
        process.wait(timeout=30)
    except subprocess.TimeoutExpired as exc:
        process.kill()
        raise MediaError("Conversion took too long and was stopped") from exc
