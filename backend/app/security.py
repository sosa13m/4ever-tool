"""Network and abuse guards shared by the API.

Pure Python (no FastAPI imports) so it can be unit tested in isolation.
"""
from __future__ import annotations

import asyncio
import ipaddress
import shutil
import socket
import time
from collections import deque
from urllib.parse import urlparse


class UnsafeUrlError(ValueError):
    """Raised when a URL must not be fetched by the server."""


def is_public_address(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    # is_global excludes private, loopback, link-local, reserved, CGNAT (100.64/10), etc.
    return ip.is_global and not ip.is_multicast


async def assert_public_http_url(url: str) -> None:
    """Validate scheme/host and make sure every resolved address is public.

    Called for the first URL *and* for every redirect hop, so a public URL
    cannot bounce the server into the internal network.
    """
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise UnsafeUrlError("A valid HTTP(S) URL is required")
    if parsed.username or parsed.password:
        raise UnsafeUrlError("URLs with embedded credentials are not allowed")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as exc:
        raise UnsafeUrlError("The URL port is invalid") from exc
    try:
        infos = await asyncio.to_thread(socket.getaddrinfo, parsed.hostname, port, 0, socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UnsafeUrlError("The URL host could not be resolved") from exc
    if not infos:
        raise UnsafeUrlError("The URL host could not be resolved")
    for info in infos:
        if not is_public_address(str(info[4][0])):
            raise UnsafeUrlError("Private or reserved network targets are not allowed")


def peer_ip(extensions: dict | None) -> str | None:
    """IP the HTTP client actually connected to (httpx/httpcore response extensions)."""
    stream = (extensions or {}).get("network_stream")
    if stream is None:
        return None
    try:
        address = stream.get_extra_info("server_addr")
    except Exception:
        return None
    if isinstance(address, (tuple, list)) and address:
        return str(address[0])
    return None


def assert_public_peer(extensions: dict | None) -> None:
    """Second line of defence against DNS rebinding.

    assert_public_http_url() checks what the host resolves to *before* the
    request, but the HTTP client resolves again when it connects. A hostile DNS
    server can answer "public" the first time and "169.254.169.254" the second.
    So once connected we look at the real peer and refuse private targets
    before a single byte of the body is read.
    """
    address = peer_ip(extensions)
    if address is None:
        return
    try:
        public = is_public_address(address)
    except ValueError:
        public = False
    if not public:
        raise UnsafeUrlError("Private or reserved network targets are not allowed")


def has_free_space(path, min_free_bytes: int) -> bool:
    """True when the disk holding *path* keeps at least *min_free_bytes* free."""
    try:
        return shutil.disk_usage(path).free >= min_free_bytes
    except OSError:
        return True  # unknown: never block the service because of the probe itself


class RateLimiter:
    """Sliding-window limiter keyed by client IP. In-memory, single process."""

    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._last_sweep: float | None = None

    def hit(self, key: str, now: float | None = None) -> tuple[bool, int]:
        """Register a request. Returns (allowed, retry_after_seconds)."""
        now = time.monotonic() if now is None else now
        bucket = self._hits.setdefault(key, deque())
        while bucket and bucket[0] <= now - self.window:
            bucket.popleft()
        if len(bucket) >= self.limit:
            retry_after = max(1, int(bucket[0] + self.window - now) + 1)
            return False, retry_after
        bucket.append(now)
        self._sweep(now)
        return True, 0

    def _sweep(self, now: float) -> None:
        # Drop idle clients so the dict does not grow forever.
        if self._last_sweep is not None and now - self._last_sweep < self.window:
            return
        self._last_sweep = now
        for key in [k for k, b in self._hits.items() if not b or b[-1] <= now - self.window]:
            self._hits.pop(key, None)

    def __len__(self) -> int:
        return len(self._hits)
