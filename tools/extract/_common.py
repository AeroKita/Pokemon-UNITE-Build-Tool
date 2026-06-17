"""Shared paths/constants for the extraction pipeline."""

from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = TOOLS_DIR.parent.parent  # FoxForge-GG/
WORK = TOOLS_DIR / "_work"

# The .apkm lives next to the project, in "UNITE APK Data".
APK_DATA_DIR = PROJECT_ROOT.parent / "UNITE APK Data"

AB_DIR = WORK / "ab"          # split_ab.apk contents (assets/Main/*.bundle)
BASE_DIR = WORK / "base"      # base.apk contents (assets/bin/Data, metadata)
ARM64_DIR = WORK / "arm64"    # split_config.arm64_v8a.apk (libil2cpp.so)
OUT_DIR = WORK / "out"        # pipeline outputs (reports, dumps, art)

GAME_VERSION = "1.23.1.1"


def find_apkm() -> Path:
    matches = sorted(APK_DATA_DIR.glob("*.apkm"))
    if not matches:
        raise SystemExit(f"No .apkm found in {APK_DATA_DIR}")
    return matches[0]
