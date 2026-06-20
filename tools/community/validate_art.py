"""Validate every file under public/assets is a real image (not HTML/truncated).

Exit 0 when clean; exit 1 and list offenders otherwise. Used in CI before build.

Usage:  python3 validate_art.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Re-use the same rules as fetch_art.py (single source of truth).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_art import PUBLIC, is_valid_image  # noqa: E402


def main() -> None:
    if not PUBLIC.exists():
        print(f"ERROR: {PUBLIC} does not exist")
        raise SystemExit(1)
    bad: list[str] = []
    total = 0
    for fp in sorted(PUBLIC.rglob("*")):
        if fp.suffix.lower() in {".mp4", ".webm"}:
            continue
        if fp.is_file():
            total += 1
            if not is_valid_image(fp):
                bad.append(str(fp.relative_to(PUBLIC)))
    if bad:
        print(f"INVALID: {len(bad)} / {total} asset files")
        for p in bad:
            print(f"  {p}")
        raise SystemExit(1)
    print(f"OK: {total} asset files validated")


if __name__ == "__main__":
    main()
