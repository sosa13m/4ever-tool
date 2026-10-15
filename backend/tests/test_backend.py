"""Backend unit tests that do not need network access.

Run from backend/:  python -m unittest discover -s tests -v
"""
from __future__ import annotations

import asyncio
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path

from app.media import MediaError, Probe, convert_media, describe_output, ensure_convertible, probe_media, wav_sample_rate
from app.preflight import check_env, parse_env
from app.security import RateLimiter, UnsafeUrlError, assert_public_http_url, assert_public_peer, has_free_space, is_public_address, peer_ip
from app import youtube
from app.relay import HomeRelay, RelayError
from app.youtube import YoutubeError, extract_video_id, friendly_error, is_youtube_url

HAS_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


class SecurityTests(unittest.TestCase):
    def test_private_addresses_are_rejected(self):
        for address in ["127.0.0.1", "10.0.0.5", "192.168.1.10", "172.16.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]:
            self.assertFalse(is_public_address(address), address)

    def test_public_addresses_are_allowed(self):
        for address in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]:
            self.assertTrue(is_public_address(address), address)

    def test_url_validation(self):
        for url in ["ftp://example.com/a.mp3", "http://localhost/a.mp3", "http://127.0.0.1:8000/api/health", "http://user:pass@example.com/a.mp3", "not a url", "http://[::1]/x"]:
            with self.assertRaises(UnsafeUrlError, msg=url):
                asyncio.run(assert_public_http_url(url))

    def test_rate_limiter_blocks_then_recovers(self):
        limiter = RateLimiter(limit=3, window_seconds=10)
        self.assertEqual([limiter.hit("a", now=t)[0] for t in (0, 1, 2)], [True, True, True])
        allowed, retry = limiter.hit("a", now=3)
        self.assertFalse(allowed)
        self.assertGreaterEqual(retry, 1)
        self.assertTrue(limiter.hit("b", now=3)[0], "other clients are independent")
        self.assertTrue(limiter.hit("a", now=10.5)[0], "window slides")

    def test_rate_limiter_sweeps_idle_clients(self):
        limiter = RateLimiter(limit=5, window_seconds=10)
        for i in range(100):
            limiter.hit(f"client-{i}", now=0)
        limiter.hit("late", now=50)
        self.assertEqual(len(limiter), 1)


class FakeStream:
    def __init__(self, address):
        self.address = address

    def get_extra_info(self, name):
        return (self.address, 443) if name == "server_addr" else None


class ProductionGuardTests(unittest.TestCase):
    """guards that matter once the site is public."""

    def test_rebinding_peer_is_refused(self):
        for address in ["127.0.0.1", "169.254.169.254", "10.1.2.3", "::1", "::ffff:192.168.0.1"]:
            with self.assertRaises(UnsafeUrlError, msg=address):
                assert_public_peer({"network_stream": FakeStream(address)})

    def test_public_peer_and_unknown_peer_pass(self):
        assert_public_peer({"network_stream": FakeStream("8.8.8.8")})
        assert_public_peer({})
        assert_public_peer(None)
        self.assertEqual(peer_ip({"network_stream": FakeStream("1.1.1.1")}), "1.1.1.1")

    def test_free_space_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertTrue(has_free_space(tmp, 0))
            self.assertFalse(has_free_space(tmp, 10 ** 18))
        self.assertTrue(has_free_space("/definitely/not/here", 10 ** 18))  # unknown never blocks

    GOOD = {
        "DOMAIN": "4evertools.cl", "ALLOWED_ORIGINS": "https://4evertools.cl", "TRUST_PROXY_HEADERS": "true",
        "ENABLE_API_DOCS": "false", "YTDLP_ENABLED": "true", "YTDLP_ACCESS_KEY": "una-clave-larga-del-colectivo",
        "MAX_SOURCE_BYTES": "262144000", "FILE_TTL_SECONDS": "3600", "MAX_CONCURRENT_JOBS": "2",
        "MAX_ACTIVE_JOBS_PER_CLIENT": "2", "RATE_LIMIT_REQUESTS": "60", "MAX_QUEUED_JOBS": "40", "MIN_FREE_DISK_MB": "1024",
    }

    def levels(self, values):
        return [level for level, _ in check_env(values)]

    def test_preflight_good_config(self):
        self.assertNotIn("ERROR", self.levels(self.GOOD))
        self.assertNotIn("WARN", self.levels(self.GOOD))

    def test_preflight_catches_mistakes(self):
        cases = {
            "DOMAIN": "tu-dominio.com",
            "ALLOWED_ORIGINS": "http://localhost:5173",
            "TRUST_PROXY_HEADERS": "false",
            "YTDLP_ACCESS_KEY": "corta",
            "FILE_TTL_SECONDS": "999999",
            "MAX_CONCURRENT_JOBS": "0",
        }
        for key, value in cases.items():
            self.assertIn("ERROR", self.levels({**self.GOOD, key: value}), key)

    def test_preflight_accepts_open_youtube_and_warns_on_docs(self):
        # the collective decided YouTube stays open, so an empty key is fine.
        open_youtube = self.levels({**self.GOOD, "YTDLP_ACCESS_KEY": ""})
        self.assertNotIn("WARN", open_youtube)
        self.assertNotIn("ERROR", open_youtube)
        self.assertIn("WARN", self.levels({**self.GOOD, "ENABLE_API_DOCS": "true"}))

    def test_parse_env(self):
        values = parse_env("# comment\nDOMAIN=4evertools.cl\nKEY=\"a=b\"\n\nBROKEN LINE\n")
        self.assertEqual(values, {"DOMAIN": "4evertools.cl", "KEY": "a=b"})

    def test_production_example_needs_only_the_domain(self):
        example = Path(__file__).resolve().parents[2] / "env.production.example"
        results = check_env(parse_env(example.read_text(encoding="utf-8")))
        errors = [message for level, message in results if level == "ERROR"]
        self.assertTrue(errors and all("DOMAIN" in m or "ALLOWED_ORIGINS" in m for m in errors), errors)
        self.assertEqual(parse_env(example.read_text(encoding="utf-8")).get("YTDLP_ACCESS_KEY"), "")


class HomeRelayTests(unittest.TestCase):
    """The PC at home tells the cloud API where its tunnel is."""

    KEY = "una-clave-larga-de-la-casa-0123456789"
    URL = "https://alpha-beta-42.trycloudflare.com"

    def test_disabled_without_key(self):
        relay = HomeRelay("")
        self.assertFalse(relay.enabled)
        with self.assertRaises(RelayError) as ctx:
            relay.register(self.URL, "")
        self.assertEqual(ctx.exception.status, 404)
        self.assertIsNone(relay.current())

    def test_wrong_key_is_refused(self):
        relay = HomeRelay(self.KEY)
        for key in ["", "otra-clave", self.KEY[:-1]]:
            with self.assertRaises(RelayError) as ctx:
                relay.register(self.URL, key)
            self.assertEqual(ctx.exception.status, 403)
        self.assertIsNone(relay.current())

    def test_only_quick_tunnel_addresses(self):
        relay = HomeRelay(self.KEY)
        for url in ["http://alpha.trycloudflare.com", "https://evil.com", "https://alpha.trycloudflare.com.evil.com",
                    "https://alpha.trycloudflare.com/path", "https://a_b.trycloudflare.com", "https://user@alpha.trycloudflare.com",
                    "javascript:alert(1)", ""]:
            with self.assertRaises(RelayError, msg=url) as ctx:
                relay.register(url, self.KEY)
            self.assertEqual(ctx.exception.status, 400)

    def test_register_then_expire(self):
        relay = HomeRelay(self.KEY, ttl_seconds=180)
        self.assertEqual(relay.register(self.URL.upper() + "/", self.KEY, now=1000), self.URL)
        self.assertEqual(relay.current(now=1100), self.URL)
        self.assertEqual(relay.current(now=1180), self.URL)
        self.assertIsNone(relay.current(now=1181))
        relay.register("https://new-one.trycloudflare.com", self.KEY, now=2000)
        self.assertEqual(relay.current(now=2001), "https://new-one.trycloudflare.com")
        relay.forget()
        self.assertIsNone(relay.current(now=2002))


class HomeConverterScriptTests(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
        import home_converter
        self.home = home_converter

    def tearDown(self):
        sys.path.pop(0)

    def test_finds_tunnel_address_in_cloudflared_output(self):
        line = "2026-10-15T12:00:00Z INF |  https://quiet-river-bold-moon.trycloudflare.com                    |"
        self.assertEqual(self.home.TUNNEL_URL.search(line).group(0), "https://quiet-river-bold-moon.trycloudflare.com")
        self.assertIsNone(self.home.TUNNEL_URL.search("INF Requesting new quick Tunnel on trycloudflare.com..."))

    def test_reads_casa_env(self):
        values = self.home.parse_env("# x\nCLOUD_API_URL=https://api.example/\nHOME_RELAY_KEY='abc'\n\nBROKEN\n")
        self.assertEqual(values, {"CLOUD_API_URL": "https://api.example/", "HOME_RELAY_KEY": "abc"})

    def test_home_api_only_takes_youtube_and_trusts_cloudflare_ip(self):
        env = self.home.api_env({"WEB_ORIGIN": "https://4ever-tool.vercel.app", "PORT": "8010"})
        self.assertEqual(env["ACCEPT_SOURCES"], "youtube")
        self.assertEqual(env["ALLOWED_ORIGINS"], "https://4ever-tool.vercel.app")
        self.assertEqual(env["CLIENT_IP_HEADER"], "cf-connecting-ip")
        self.assertEqual(env["ENABLE_API_DOCS"], "false")
        self.assertNotIn("HOME_RELAY_KEY", env)


class YoutubeUrlTests(unittest.TestCase):
    VALID = {
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ": "dQw4w9WgXcQ",
        "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=42s": "dQw4w9WgXcQ",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ": "dQw4w9WgXcQ",
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ&feature=share": "dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ?si=abc": "dQw4w9WgXcQ",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ": "dQw4w9WgXcQ",
        "https://www.youtube.com/live/dQw4w9WgXcQ": "dQw4w9WgXcQ",
        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ": "dQw4w9WgXcQ",
    }
    INVALID = [
        "https://www.youtube.com/playlist?list=PL123",
        "https://www.youtube.com/@channel",
        "https://www.youtube.com/watch?v=short",
        "https://youtu.be/",
        "youtube.com/watch?v=dQw4w9WgXcQ",
    ]

    def test_detection(self):
        self.assertTrue(is_youtube_url("https://youtu.be/dQw4w9WgXcQ"))
        self.assertFalse(is_youtube_url("https://evil-youtube.com/watch?v=dQw4w9WgXcQ"))
        self.assertFalse(is_youtube_url("https://youtube.com.evil.net/watch?v=dQw4w9WgXcQ"))
        self.assertFalse(is_youtube_url("https://soundcloud.com/a/b"))

    def test_valid_links(self):
        for url, video_id in self.VALID.items():
            self.assertEqual(extract_video_id(url), video_id, url)

    def test_invalid_links(self):
        for url in self.INVALID:
            with self.assertRaises(YoutubeError, msg=url):
                extract_video_id(url)

    def test_friendly_errors(self):
        self.assertEqual(friendly_error("ERROR: [youtube] x: Private video. Sign in"), "This video is private")
        self.assertIn("Age-restricted", friendly_error("Sign in to confirm your age"))
        self.assertIn("bot check", friendly_error("Sign in to confirm you're not a bot"))
        self.assertEqual(friendly_error("Video unavailable"), "Video unavailable")
        self.assertEqual(friendly_error("something new"), "YouTube rejected the request")


class FakeDownloadError(Exception):
    pass


def install_fake_ytdlp(info: dict, write_ext: str | None = "webm", raise_error: str | None = None):
    """Inject a minimal fake `yt_dlp` module that mimics the API we use."""
    calls: dict = {}

    class FakeYDL:
        def __init__(self, options):
            calls["options"] = options

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def extract_info(self, url, download=True, process=True):
            calls["url"], calls["download"], calls["process"] = url, download, process
            if raise_error:
                raise FakeDownloadError(raise_error)
            return dict(info)

        def process_ie_result(self, ie_result, download=True):
            calls["processed"] = True
            if write_ext is None:
                return {**ie_result, "requested_downloads": []}
            path = Path(calls["options"]["outtmpl"].replace("%(ext)s", write_ext))
            path.write_bytes(b"fake-audio")
            for hook in calls["options"]["progress_hooks"]:
                hook({"status": "downloading", "downloaded_bytes": 5, "total_bytes": 10})
            return {**ie_result, "requested_downloads": [{"filepath": str(path)}]}

    module = types.ModuleType("yt_dlp")
    module.YoutubeDL = FakeYDL
    utils = types.ModuleType("yt_dlp.utils")
    utils.DownloadError = FakeDownloadError
    sys.modules["yt_dlp"] = module
    sys.modules["yt_dlp.utils"] = utils
    return calls


class YoutubeDownloadTests(unittest.TestCase):
    def tearDown(self):
        sys.modules.pop("yt_dlp", None)
        sys.modules.pop("yt_dlp.utils", None)

    def run_download(self, **kwargs):
        tmp = Path(tempfile.mkdtemp())
        progress: list[float] = []
        titles: list[str] = []
        result = youtube.download_audio(
            "dQw4w9WgXcQ", tmp / "job.source", max_duration=600, max_bytes=1000,
            js_runtimes=["deno", "node"], on_progress=progress.append, on_title=titles.append, **kwargs,
        )
        return result, progress, titles

    def test_happy_path(self):
        calls = install_fake_ytdlp({"id": "dQw4w9WgXcQ", "title": "Track", "uploader": "Crew", "duration": 200, "live_status": "not_live"})
        result, progress, titles = self.run_download()
        self.assertEqual(calls["url"], "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        self.assertFalse(calls["download"])
        self.assertFalse(calls["process"])
        self.assertTrue(calls["options"]["noplaylist"])
        self.assertEqual(calls["options"]["max_filesize"], 1000)
        self.assertEqual(calls["options"]["js_runtimes"], {"deno": {}, "node": {}})
        self.assertTrue(result.path.exists())
        self.assertEqual((result.title, result.uploader, result.duration), ("Track", "Crew", 200.0))
        self.assertEqual(progress, [0.5])
        self.assertEqual(titles, ["Track"])

    def test_too_long_is_rejected_before_download(self):
        calls = install_fake_ytdlp({"title": "Mix", "duration": 3600})
        with self.assertRaisesRegex(YoutubeError, "10 minute limit"):
            self.run_download()
        self.assertNotIn("processed", calls)

    def test_live_is_rejected(self):
        install_fake_ytdlp({"title": "Live", "is_live": True})
        with self.assertRaisesRegex(YoutubeError, "Live"):
            self.run_download()

    def test_download_error_is_translated(self):
        install_fake_ytdlp({}, raise_error="ERROR: [youtube] dQw4w9WgXcQ: Private video")
        with self.assertRaisesRegex(YoutubeError, "private"):
            self.run_download()

    def test_missing_file_is_reported(self):
        install_fake_ytdlp({"title": "Big", "duration": 100}, write_ext=None)
        with self.assertRaisesRegex(YoutubeError, "size limit"):
            self.run_download()

    def test_missing_ytdlp(self):
        sys.modules["yt_dlp"] = None  # makes `import yt_dlp` raise ImportError
        with self.assertRaisesRegex(YoutubeError, "not installed"):
            self.run_download()


@unittest.skipUnless(HAS_FFMPEG, "ffmpeg/ffprobe not installed")
class MediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.tone = cls.tmp / "tone.source"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-f", "wav", str(cls.tone)], check=True)
        cls.video_only = cls.tmp / "video.source"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1", "-f", "mp4", str(cls.video_only)], check=True)

    def test_probe_and_convert_mp3_with_progress_and_tags(self):
        probe = probe_media(self.tone)
        ensure_convertible(probe)
        self.assertAlmostEqual(probe.duration or 0, 6, delta=0.2)
        output = self.tmp / "out.mp3"
        progress: list[float] = []
        convert_media(self.tone, output, "mp3", "192", probe.duration, {"title": "Señal 4EVER", "artist": "crew"}, progress.append)
        self.assertGreater(output.stat().st_size, 10_000)
        self.assertTrue(progress and progress[-1] > 0.9, progress)
        tags = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags=title,artist", "-of", "default=nw=1", str(output)], capture_output=True, text=True, encoding="utf-8").stdout
        self.assertIn("Señal 4EVER", tags)
        self.assertIn("crew", tags)

    def test_convert_wav(self):
        output = self.tmp / "out.wav"
        convert_media(self.tone, output, "wav", "320", 6.0)
        self.assertEqual(probe_media(output).format_name, "wav")

    def test_video_without_audio_is_rejected(self):
        with self.assertRaisesRegex(MediaError, "No audio"):
            ensure_convertible(probe_media(self.video_only))

    def test_playlist_files_are_rejected(self):
        # An uploaded m3u8 must not make FFmpeg open other files (SSRF / local file read).
        playlist = self.tmp / "evil.source"
        playlist.write_text(f"#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n{self.tone}\n#EXT-X-ENDLIST\n")
        with self.assertRaises(MediaError):
            ensure_convertible(probe_media(playlist))

    def test_concat_lists_are_rejected(self):
        listing = self.tmp / "list.source"
        listing.write_text(f"ffconcat version 1.0\nfile '{self.tone}'\n")
        with self.assertRaises(MediaError):
            ensure_convertible(probe_media(listing))

    def test_garbage_is_rejected(self):
        junk = self.tmp / "junk.source"
        junk.write_bytes(b"this is not media" * 100)
        with self.assertRaises(MediaError):
            ensure_convertible(probe_media(junk))

    def test_container_allowlist(self):
        ensure_convertible(Probe("mov,mp4,m4a,3gp,3g2,mj2", 10, True))
        ensure_convertible(Probe("matroska,webm", 10, True))
        for name in ["hls", "concat", "image2", "lavfi", "sdp", ""]:
            with self.assertRaises(MediaError, msg=name):
                ensure_convertible(Probe(name, 10, True))


def make_media(path: Path, *args: str) -> Path:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args, str(path)], check=True)
    return path


SURROUND = ["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-filter_complex",
            "[0]asplit=6[a][b][c][d][e][f];[a][b][c][d][e][f]join=inputs=6:channel_layout=5.1"]


@unittest.skipUnless(HAS_FFMPEG, "ffmpeg/ffprobe not installed")
class FormatMatrixTests(unittest.TestCase):
    """the problems a format sweep found, so they stay fixed."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())

    def convert(self, source: Path, fmt: str, **kwargs) -> dict:
        probe = probe_media(source)
        ensure_convertible(probe)
        output = self.tmp / f"{source.stem}-{fmt}-{kwargs.get('bit_depth', '16')}.{fmt}"
        convert_media(source, output, fmt, "320", probe.duration, {**probe.tags}, None, probe=probe, **kwargs)
        info = describe_output(output)
        info["tags"] = probe_media(output).tags
        return info

    def test_surround_becomes_stereo(self):
        source = make_media(self.tmp / "surround.wav", *SURROUND)
        self.assertEqual(probe_media(source).channels, 6)
        self.assertEqual(self.convert(source, "wav")["channels"], 2)
        self.assertEqual(self.convert(source, "mp3")["channels"], 2)

    def test_surround_video_becomes_stereo(self):
        source = make_media(self.tmp / "film.mkv", *SURROUND, "-c:a", "aac")
        self.assertEqual(self.convert(source, "wav")["channels"], 2)

    def test_user_tags_survive(self):
        flac = make_media(self.tmp / "tagged.flac", "-f", "lavfi", "-i", "sine=duration=2",
                          "-metadata", "title=Mi Tema", "-metadata", "ARTIST=4EVER", "-metadata", "album=Cinta 1")
        ogg = make_media(self.tmp / "tagged.ogg", "-f", "lavfi", "-i", "sine=duration=2", "-c:a", "libvorbis",
                         "-metadata", "title=Ñandú", "-metadata", "artist=crew")
        for source, title, artist in [(flac, "Mi Tema", "4EVER"), (ogg, "Ñandú", "crew")]:
            for fmt in ("mp3", "wav"):
                tags = self.convert(source, fmt)["tags"]
                self.assertEqual(tags.get("title"), title, f"{source.name} -> {fmt}: {tags}")
                self.assertEqual(tags.get("artist"), artist, f"{source.name} -> {fmt}: {tags}")

    def test_container_noise_is_not_copied(self):
        mp4 = make_media(self.tmp / "clip.m4a", "-f", "lavfi", "-i", "sine=duration=2", "-c:a", "aac", "-metadata", "title=Clip")
        tags = probe_media(mp4).tags
        self.assertEqual(tags, {"title": "Clip"})

    def test_wav_bit_depth_and_rate(self):
        hi = make_media(self.tmp / "studio.wav", "-f", "lavfi", "-i", "sine=duration=2:sample_rate=96000", "-c:a", "pcm_s24le")
        info = self.convert(hi, "wav", bit_depth="24")
        self.assertEqual((info["codec"], info["sample_rate"]), ("pcm_s24le", 96000))
        info = self.convert(hi, "wav", bit_depth="16")
        self.assertEqual((info["codec"], info["sample_rate"]), ("pcm_s16le", 96000))
        self.assertEqual([wav_sample_rate(r) for r in (None, 8000, 22050, 44100, 48000, 96000, 192000)],
                         [44100, 44100, 44100, 44100, 48000, 96000, 96000])

    def test_youtube_rate_is_not_resampled(self):
        opus = make_media(self.tmp / "yt.webm", "-f", "lavfi", "-i", "sine=duration=2:sample_rate=48000", "-c:a", "libopus")
        self.assertEqual(self.convert(opus, "wav")["sample_rate"], 48000)

    def test_describe_output(self):
        source = make_media(self.tmp / "len.wav", "-f", "lavfi", "-i", "sine=duration=4")
        info = self.convert(source, "mp3")
        self.assertEqual(info["format"], "mp3")
        self.assertAlmostEqual(info["duration"], 4, delta=0.1)
        self.assertGreater(info["bytes"], 100_000)
        self.assertEqual(info["bit_rate"] // 1000, 320)

    def test_many_containers_convert(self):
        sources = {
            "aiff": ["-f", "lavfi", "-i", "sine=duration=1"],
            "caf": ["-f", "lavfi", "-i", "sine=duration=1"],
            "wv": ["-f", "lavfi", "-i", "sine=duration=1"],
            "opus": ["-f", "lavfi", "-i", "sine=duration=1", "-c:a", "libopus"],
            "mov": ["-f", "lavfi", "-i", "color=s=64x64:d=1", "-f", "lavfi", "-i", "sine=duration=1", "-c:v", "mpeg4", "-c:a", "pcm_s16le", "-shortest"],
        }
        for ext, args in sources.items():
            source = make_media(self.tmp / f"many.{ext}", *args)
            self.assertGreater(self.convert(source, "mp3")["bytes"], 1000, ext)

    def test_empty_file_is_rejected(self):
        empty = self.tmp / "empty.source"
        empty.write_bytes(b"")
        with self.assertRaises(MediaError):
            probe_media(empty)


if __name__ == "__main__":
    unittest.main()
