"""Path resolution for bundled assets.

The PyInstaller onedir build drops a ``_internal/`` folder next to
``Tawreed.exe`` and copies the data files declared in ``tawreed.spec``
into that tree. In dev, the assets live next to ``main.py``.

This module gives the rest of the app a single import point that
returns the right absolute path in both modes:

    from gui.assets import APP_ICON_PATH, LOGO_PNG_PATH

We use ``sys._MEIPASS`` (the PyInstaller bootloader sets it to the
``_internal/`` path) when available, else fall back to the project
root. This is the standard PyInstaller pattern — see
https://pyinstaller.org/en/stable/runtime-information.html
"""

from __future__ import annotations

import sys
from pathlib import Path


def _project_root() -> Path:
    """Return the directory holding the bundled data files.

    - In dev / wheel installs: the ``gui`` package directory.
    - In the PyInstaller onedir build: the ``_internal/`` directory
      next to the EXE, which is where the bootloader extracts data.
    """
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    return Path(__file__).resolve().parent


ROOT = _project_root()
APP_ICON_PATH = ROOT / "tawreed_logo.ico"
LOGO_PNG_PATH = ROOT / "tawreed_logo_transparent.png"
