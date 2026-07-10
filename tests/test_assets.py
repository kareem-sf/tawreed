"""Tests for gui.assets — path resolution in dev and PyInstaller modes.

In dev, ``gui.assets.ROOT`` is the ``gui`` package directory
and both ``APP_ICON_PATH`` and ``LOGO_PNG_PATH`` point at the real
files that ship in the repo.

In a PyInstaller onedir build, ``sys._MEIPASS`` is the ``_internal/``
folder next to the EXE, and PyInstaller copies the ICO + PNG there
because of the entries in ``tawreed.spec`` ``datas=[...]``.

We mock ``sys._MEIPASS`` to exercise the PyInstaller branch without
actually running a frozen build.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest


@pytest.fixture
def assets_module():
    """Reload gui.assets so the top-level path bindings are fresh."""
    import importlib

    import gui.assets

    importlib.reload(gui.assets)
    return gui.assets


def test_root_is_project_root_in_dev(assets_module):
    """In dev, ROOT is the package directory that ships in the wheel."""
    gui_dir = Path(assets_module.__file__).resolve().parent
    assert assets_module.ROOT == gui_dir


def test_paths_resolve_to_existing_files(assets_module):
    """Both bundled assets exist at the resolved paths (dev mode)."""
    assert assets_module.APP_ICON_PATH.exists(), f"ICO not found: {assets_module.APP_ICON_PATH}"
    assert assets_module.LOGO_PNG_PATH.exists(), f"PNG not found: {assets_module.LOGO_PNG_PATH}"


def test_paths_use_meipass_when_frozen(assets_module, tmp_path, monkeypatch):
    """When sys._MEIPASS is set, ROOT resolves to that directory."""
    # Lay down a fake ICO + PNG in the simulated _internal dir.
    fake_ico = tmp_path / "tawreed_logo.ico"
    fake_png = tmp_path / "tawreed_logo_transparent.png"
    fake_ico.write_bytes(b"\x00\x00\x01\x00")  # minimal ICO header
    fake_png.write_bytes(b"\x89PNG\r\n\x1a\n")

    # Force the module to think it's frozen.
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    import importlib

    importlib.reload(assets_module)

    assert assets_module.ROOT == tmp_path
    assert assets_module.APP_ICON_PATH == fake_ico
    assert assets_module.LOGO_PNG_PATH == fake_png
    assert assets_module.APP_ICON_PATH.exists()


def test_paths_are_path_objects(assets_module):
    """Callers may want .exists() / .read_bytes() — must be pathlib.Path."""
    assert isinstance(assets_module.APP_ICON_PATH, Path)
    assert isinstance(assets_module.LOGO_PNG_PATH, Path)
