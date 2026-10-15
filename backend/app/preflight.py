"""Production preflight: checks a .env before the site goes public.

Pure Python, no FastAPI, so it can be unit tested and run anywhere:
    python scripts/preflight.py ../.env
"""
from __future__ import annotations

import re

PLACEHOLDERS = {"", "tu-dominio.com", "example.com", "cambia-esta-clave", "change-me"}


def parse_env(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def _int(values: dict[str, str], key: str, default: int) -> int:
    try:
        return int(values.get(key, str(default)))
    except ValueError:
        return -1


def check_env(values: dict[str, str]) -> list[tuple[str, str]]:
    """Returns (level, message) pairs; level is ERROR, WARN or OK."""
    out: list[tuple[str, str]] = []
    err = lambda m: out.append(("ERROR", m))  # noqa: E731
    warn = lambda m: out.append(("WARN", m))  # noqa: E731
    ok = lambda m: out.append(("OK", m))  # noqa: E731

    domain = values.get("DOMAIN", "").strip().lower()
    if domain in PLACEHOLDERS or not re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", domain):
        err("DOMAIN: escribe tu dominio real (ej. 4evertools.cl), sin https://")
    else:
        ok(f"DOMAIN = {domain}")
        origins = [o.strip() for o in values.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
        if f"https://{domain}" not in origins:
            err(f"ALLOWED_ORIGINS debe incluir https://{domain}")
        elif any(o.startswith("http://localhost") for o in origins):
            warn("ALLOWED_ORIGINS todavía incluye localhost; en producción no hace falta")
        else:
            ok("ALLOWED_ORIGINS apunta a tu dominio")

    if values.get("TRUST_PROXY_HEADERS", "").lower() not in {"true", "1", "yes", "on"}:
        err("TRUST_PROXY_HEADERS debe ser true detrás del nginx incluido (si no, todos comparten el mismo límite)")
    else:
        ok("TRUST_PROXY_HEADERS = true")

    if values.get("ENABLE_API_DOCS", "true").lower() in {"true", "1", "yes", "on"}:
        warn("ENABLE_API_DOCS está activo: la documentación de la API queda pública. Ponlo en false")
    else:
        ok("Documentación de la API oculta")

    youtube = values.get("YTDLP_ENABLED", "true").lower() in {"true", "1", "yes", "on"}
    key = values.get("YTDLP_ACCESS_KEY", "")
    if youtube:
        if key == "":
            ok("YouTube abierto para todos (lo decidió el colectivo); los límites contra abuso siguen activos")
        elif key in PLACEHOLDERS:
            err("YTDLP_ACCESS_KEY: cambia la clave de ejemplo por una propia (o déjala vacía para abrir YouTube a todos)")
        elif len(key) < 12:
            err("YTDLP_ACCESS_KEY es muy corta: usa al menos 12 caracteres")
        else:
            ok("YouTube protegido con la clave del colectivo")
    else:
        ok("YouTube desactivado")

    max_bytes = _int(values, "MAX_SOURCE_BYTES", 262144000)
    if max_bytes <= 0 or max_bytes > 1024 * 1024 * 1024:
        err("MAX_SOURCE_BYTES debe estar entre 1 byte y 1 GB")
    ttl = _int(values, "FILE_TTL_SECONDS", 3600)
    if ttl <= 0 or ttl > 6 * 3600:
        err("FILE_TTL_SECONDS debe estar entre 1 segundo y 6 horas (los archivos no deben quedarse en el servidor)")
    for key_name, low, high in [("MAX_CONCURRENT_JOBS", 1, 16), ("MAX_ACTIVE_JOBS_PER_CLIENT", 1, 10), ("RATE_LIMIT_REQUESTS", 1, 1000), ("MAX_QUEUED_JOBS", 1, 500)]:
        value = _int(values, key_name, low)
        if not low <= value <= high:
            err(f"{key_name} fuera de rango ({low}–{high})")
    if _int(values, "MIN_FREE_DISK_MB", 1024) < 256:
        warn("MIN_FREE_DISK_MB es bajo: deja al menos 256 MB libres para que el servidor no se llene")
    if not any(level == "ERROR" for level, _ in out):
        ok("Límites del conversor dentro de rango")
    return out
