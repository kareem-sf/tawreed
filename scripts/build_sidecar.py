"""Build the Python engine payload embedded by the portable Tauri host."""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DESKTOP_ROOT = REPO_ROOT / "desktop"
BINARY_DIR = DESKTOP_ROOT / "src-tauri" / "binaries"
BUILD_ROOT = DESKTOP_ROOT / ".build" / "sidecar"


def target_triple() -> str:
    configured = os.environ.get("TAURI_ENV_TARGET_TRIPLE", "").strip()
    if configured:
        return configured
    machine = platform.machine().casefold()
    architecture = "aarch64" if machine in {"arm64", "aarch64"} else "x86_64"
    if sys.platform == "win32":
        return f"{architecture}-pc-windows-msvc"
    if sys.platform == "darwin":
        return f"{architecture}-apple-darwin"
    if sys.platform.startswith("linux"):
        return f"{architecture}-unknown-linux-gnu"
    raise RuntimeError(f"Unsupported sidecar platform: {sys.platform} ({machine})")


def newest_source_mtime() -> float:
    roots = [REPO_ROOT / "core", REPO_ROOT / "tawreed_engine"]
    candidates = [DESKTOP_ROOT / "tawreed-engine.spec", REPO_ROOT / "pyproject.toml"]
    for root in roots:
        candidates.extend(root.rglob("*.py"))
    return max(path.stat().st_mtime for path in candidates if path.exists())


def build(*, force: bool = False) -> Path:
    triple = target_triple()
    suffix = ".exe" if sys.platform == "win32" else ""
    destination = BINARY_DIR / f"tawreed-engine-{triple}{suffix}"
    if not force and destination.exists() and destination.stat().st_mtime >= newest_source_mtime():
        print(f"Tawreed sidecar is current: {destination}")
        return destination

    dist = BUILD_ROOT / "dist"
    work = BUILD_ROOT / "work"
    BINARY_DIR.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--clean",
        "--noconfirm",
        "--distpath",
        str(dist),
        "--workpath",
        str(work),
        str(DESKTOP_ROOT / "tawreed-engine.spec"),
    ]
    subprocess.run(command, cwd=DESKTOP_ROOT, check=True)
    built = dist / f"tawreed-engine{suffix}"
    if not built.is_file():
        raise FileNotFoundError(f"PyInstaller did not create {built}")
    shutil.copy2(built, destination)
    if sys.platform != "win32":
        destination.chmod(0o755)
    print(f"Built Tawreed sidecar: {destination}")
    return destination


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    build(force=args.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
