# -*- mode: python ; coding: utf-8 -*-
"""One-file, console-enabled Python engine embedded as a Tauri sidecar."""

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

DESKTOP_ROOT = Path(SPECPATH).resolve()
REPO_ROOT = DESKTOP_ROOT.parent

analysis = Analysis(
    [str(REPO_ROOT / "tawreed_engine" / "__main__.py")],
    pathex=[str(REPO_ROOT)],
    binaries=[],
    datas=[],
    hiddenimports=collect_submodules("keyring.backends"),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pytest", "ruff"],
    noarchive=False,
    optimize=1,
)

pyz = PYZ(analysis.pure)

executable = EXE(
    pyz,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name="tawreed-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
