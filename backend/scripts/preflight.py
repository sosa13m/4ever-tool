"""Revisa el .env de producción antes de publicar.

Uso (desde la carpeta backend):  python scripts/preflight.py ../.env
Sale con código 1 si hay errores.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.preflight import check_env, parse_env  # noqa: E402


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "../.env")
    if not path.exists():
        print(f"No encuentro {path}. Copia env.production.example a .env y complétalo.")
        return 1
    results = check_env(parse_env(path.read_text(encoding="utf-8")))
    for level, message in results:
        print(f"[{level:5}] {message}")
    errors = sum(1 for level, _ in results if level == "ERROR")
    warnings = sum(1 for level, _ in results if level == "WARN")
    print(f"\nPREFLIGHT: {errors} errores, {warnings} avisos" + ("" if errors else " — listo para publicar"))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
