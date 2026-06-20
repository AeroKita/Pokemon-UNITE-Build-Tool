"""Transcode raw move-preview recordings into small, looping-ready tooltip clips.

Reads raw captures from tools/community/_clips/<pokemon-id>/<move-id>.<mp4|mov>
(git-ignored), normalizes each with ffmpeg to a uniform 320x180 muted H.264 MP4
(~60-120 KB), writes them next to the move's icon under public/assets/skills/,
and records a manifest (tools/community/move_clips.json) mapping each move to its
clip path. normalize.py reads that manifest to set Move.videoAsset.

Idempotent: skips a clip whose output is newer than its source. Re-run any time
after adding more recordings.

Requires ffmpeg + ffprobe on PATH (brew install ffmpeg).

Usage:  python3 transcode_clips.py [--force]
"""
from __future__ import annotations

import json
import subprocess
import sys
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent.parent
BUNDLE = PROJECT / "src" / "data" / "patch-current.json"
CLIPS = HERE / "_clips"
PUBLIC = PROJECT / "public" / "assets"
OUT = HERE / "move_clips.json"

# Proven spec (validated on Talonflame Fly): 16:9 to match the media box, muted,
# 30fps, CRF 28 -> ~90 KB for a ~5s clip. Looping is a <video> attribute, not baked in.
WIDTH, HEIGHT, FPS, CRF = 320, 180, 30, 28
VF = f"scale={WIDTH}:{HEIGHT}:flags=lanczos,fps={FPS}"


def move_index(bundle: dict) -> dict:
    """(pokemon-id, move-id) -> move dict, for moves that can have a clip."""
    idx = {}
    for p in bundle["pokemon"]:
        for m in p["moves"]:
            if m.get("slot") in ("move1", "move2", "uniteMove"):
                idx[(p["id"], m["id"])] = m
    return idx


def is_mp4(path: Path) -> bool:
    return path.exists() and path.stat().st_size > 0 and b"ftyp" in path.read_bytes()[:32]


def transcode(src: Path, dest: Path) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-an", "-vf", VF,
         "-c:v", "libx264", "-crf", str(CRF), "-preset", "slow",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(dest)],
        capture_output=True,
    )
    if r.returncode == 0 and is_mp4(dest):
        return True
    dest.unlink(missing_ok=True)
    sys.stderr.write(r.stderr.decode("utf-8", "ignore")[-400:] + "\n")
    return False


def main() -> None:
    force = "--force" in sys.argv
    bundle = json.loads(BUNDLE.read_text())
    idx = move_index(bundle)
    manifest: dict[str, dict[str, str]] = {}
    done = skipped = failed = 0
    misses: list[str] = []

    sources = sorted(
        p for p in CLIPS.glob("*/*") if p.suffix.lower() in (".mp4", ".mov")
    ) if CLIPS.exists() else []

    for src in sources:
        pid, mid = src.parent.name, src.stem.lower()
        move = idx.get((pid, mid))
        if not move or not move.get("iconAsset"):
            misses.append(f"{pid}/{src.name} (no matching move-id with an icon)")
            continue
        asset_path = move["iconAsset"].rsplit(".", 1)[0] + ".mp4"  # /assets/skills/<Folder>/<Move>.mp4
        dest = PUBLIC / urllib.parse.unquote(asset_path[len("/assets/"):])
        fresh = dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime
        if force or not fresh:
            if transcode(src, dest):
                done += 1
            else:
                failed += 1
                misses.append(f"{pid}/{src.name} (ffmpeg failed)")
                continue
        else:
            skipped += 1
        manifest.setdefault(pid, {})[mid] = asset_path

    OUT.write_text(json.dumps(
        {"_source": "self-recorded (Nintendo Switch 2)",
         "_spec": f"{WIDTH}x{HEIGHT} h264 crf{CRF} {FPS}fps muted",
         "clips": manifest}, indent=2, ensure_ascii=False) + "\n")
    total = sum(len(v) for v in manifest.values())
    print(f"transcoded {done}, skipped {skipped} (up-to-date), failed {failed}")
    print(f"wrote {OUT}: {total} clips across {len(manifest)} pokemon")
    for m in misses:
        print("  miss:", m)


if __name__ == "__main__":
    main()
