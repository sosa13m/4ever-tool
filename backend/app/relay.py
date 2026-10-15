"""Home relay for YouTube.

YouTube blocks downloads from cloud servers ("confirm you're not a bot"), but
not from a normal home connection. So YouTube links are converted on a PC at
home that runs this same API behind a Cloudflare quick tunnel. That PC tells
the cloud API its current tunnel address every minute (the address changes
each time the tunnel restarts); the web asks the cloud API where to send
YouTube links.

Only https://<name>.trycloudflare.com addresses are accepted, and only with
the shared HOME_RELAY_KEY, so nobody can point visitors somewhere else.
"""
from __future__ import annotations

import hmac
import re
import time

TUNNEL_URL = re.compile(r"^https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$")


class RelayError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


class HomeRelay:
    def __init__(self, key: str, ttl_seconds: int = 180) -> None:
        self.key = key.strip()
        self.ttl = ttl_seconds
        self.url: str | None = None
        self.seen = 0.0

    @property
    def enabled(self) -> bool:
        return bool(self.key)

    def register(self, url: str, key: str, now: float | None = None) -> str:
        if not self.enabled:
            raise RelayError(404, "The home relay is not configured on this server")
        if not hmac.compare_digest((key or "").encode(), self.key.encode()):
            raise RelayError(403, "Wrong relay key")
        url = (url or "").strip().rstrip("/").lower()
        if not TUNNEL_URL.match(url):
            raise RelayError(400, "Only https://….trycloudflare.com addresses are accepted")
        self.url = url
        self.seen = time.time() if now is None else now
        return url

    def current(self, now: float | None = None) -> str | None:
        """The home converter's address if it checked in recently, else None."""
        if not self.url:
            return None
        now = time.time() if now is None else now
        return self.url if now - self.seen <= self.ttl else None

    def forget(self) -> None:
        self.url = None
        self.seen = 0.0
