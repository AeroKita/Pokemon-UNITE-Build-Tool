"""Download a local mirror of UNITE-DB's art (CloudFront CDN) into public/assets.

Reads the normalized bundle, collects every CDN image URL the app references
(Pokémon portraits + thumbnails, held/battle item icons, emblem faces for all
grades), de-dupes, and mirrors them under public/assets/<cdn-path> so the app
can serve art offline. Idempotent: skips valid files; re-downloads corrupt ones.

UNITE-DB only hosts A-grade emblem art for some newer Pokémon (B/C return 403).
When silver/bronze faces are missing on the CDN, the gold (A) face is copied so
the inventory UI never loads a broken image.

Usage:  python3 fetch_art.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent.parent
BUNDLE = PROJECT / "src" / "data" / "patch-current.json"
PUBLIC = PROJECT / "public" / "assets"
CDN = "https://d275t8dp8rxb42.cloudfront.net"
GRADE_SUFFIX = ("A", "B", "C")  # gold, silver, bronze — matches emblemIcon.ts


def is_valid_image(path: Path) -> bool:
    """True when path is a complete PNG/JPEG/WebP (not an HTML error page)."""
    try:
        data = path.read_bytes()
    except OSError:
        return False
    if len(data) < 16:
        return False
    if data[:1] == b"<":
        return False
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return data.rstrip()[-8:] == b"IEND\xaeB\x60\x82"
    if data[:3] == b"\xff\xd8\xff":
        return data[-2:] == b"\xff\xd9"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    return False


def collect_asset_paths() -> set[str]:
    """Collect every /assets/... path the app may request."""
    b = json.loads(BUNDLE.read_text())
    paths: set[str] = set()
    for p in b["pokemon"]:
        paths.add(p["imageAsset"])
        paths.add(p["iconAsset"])
        for m in p.get("moves", []):
            if m.get("iconAsset"):
                paths.add(m["iconAsset"])
        passive = p.get("passiveAbility") or {}
        if passive.get("iconAsset"):
            paths.add(passive["iconAsset"])
    for it in b["heldItems"] + b.get("battleItems", []):
        paths.add(it["iconAsset"])
    for e in b["emblems"]:
        paths.add(e["iconAsset"])
        if e.get("goldOnly"):
            continue
        pokedex = e["id"].split("-", 1)[0]
        for suffix in ("B", "C"):
            paths.add(f"/assets/emblems/pokedex/{pokedex}{suffix}.png")
    return {p for p in paths if p.startswith("/assets/")}


def cdn_url(rel: str) -> str:
    parts = urllib.parse.urlsplit(f"{CDN}/{rel}")
    # Percent-encode spaces etc., but keep '+' literal — UNITE-DB item icons use
    # a literal '+' (space→'+'), and '%2B' 403s on the CDN.
    return urllib.parse.urlunsplit(
        parts._replace(path=urllib.parse.quote(parts.path, safe="/+"))
    )


def download(asset_path: str) -> tuple[str, str]:
    rel = asset_path[len("/assets/") :]
    dest = PUBLIC / urllib.parse.unquote(rel)
    if dest.exists() and is_valid_image(dest):
        return asset_path, "skip"
    dest.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        [
            "curl",
            "-sSL",
            "--fail",
            "--retry",
            "4",
            "--retry-delay",
            "1",
            "--max-time",
            "60",
            "-o",
            str(dest),
            cdn_url(rel),
        ],
        capture_output=True,
    )
    if r.returncode == 0 and is_valid_image(dest):
        return asset_path, "ok"
    if dest.exists():
        dest.unlink(missing_ok=True)
    return asset_path, f"FAIL curl:{r.returncode}"


def emblem_fallbacks(failed: list[str]) -> tuple[int, int]:
    """Copy gold (A) emblem faces to missing silver/bronze paths."""
    copied = already = 0
    for asset_path in failed:
        rel = asset_path[len("/assets/") :]
        name = Path(rel).name  # e.g. 906B.png or 1008C.png
        if not (name.endswith("B.png") or name.endswith("C.png")):
            continue
        pokedex = name[:-5]  # strip grade letter + .png
        gold = PUBLIC / "emblems" / "pokedex" / f"{pokedex}A.png"
        dest = PUBLIC / urllib.parse.unquote(rel)
        if not gold.exists() or not is_valid_image(gold):
            continue
        if dest.exists() and is_valid_image(dest):
            already += 1
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(gold, dest)
        copied += 1
    return copied, already


def validate_all() -> list[str]:
    """Return relative paths of invalid files under public/assets."""
    bad: list[str] = []
    if not PUBLIC.exists():
        return bad
    for fp in PUBLIC.rglob("*"):
        if fp.suffix.lower() in {".mp4", ".webm"}:
            continue
        if fp.is_file() and not is_valid_image(fp):
            bad.append(str(fp.relative_to(PUBLIC)))
    return bad


def main() -> None:
    urls = sorted(collect_asset_paths())
    print(f"Mirroring {len(urls)} images -> {PUBLIC}")
    ok = skip = fail = 0
    fails: list[str] = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        for url, status in pool.map(download, urls):
            if status == "ok":
                ok += 1
            elif status == "skip":
                skip += 1
            else:
                fail += 1
                fails.append(url)
    copied, already = emblem_fallbacks(fails)
    print(f"done: {ok} downloaded, {skip} skipped, {fail} failed")
    if copied or already:
        print(f"emblem fallbacks: {copied} copied from gold (A), {already} already valid")
    still_bad = [
        u
        for u in fails
        if not is_valid_image(PUBLIC / urllib.parse.unquote(u[len("/assets/") :]))
    ]
    for url in still_bad[:20]:
        print(f"  still missing: {url}")

    bad = validate_all()
    if bad:
        print(f"VALIDATION FAILED: {len(bad)} invalid files remain")
        for p in bad[:20]:
            print(f"  {p}")
        raise SystemExit(1)
    print(f"validation: all {sum(1 for _ in PUBLIC.rglob('*') if _.is_file())} files OK")


if __name__ == "__main__":
    main()
