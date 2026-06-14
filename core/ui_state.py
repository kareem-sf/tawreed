"""Window-level UI state persistence for Tawreed.

Why this module exists
----------------------
``gui/main_window.py`` needs to persist two pieces of UI state
across launches:

  * ``geometry`` — the QMainWindow's ``saveGeometry()`` blob
    (window size, position, maximised/normal state, dock layout).
  * ``last_page`` — which nav page the user was on (workspace,
    history, settings, about) so the next launch lands them
    back where they left off.

The previous implementation used ``QSettings("sfkareem",
"Tawreed")``, which on Windows is backed by the registry at
``HKEY_CURRENT_USER\\SOFTWARE\\sfkareem\\Tawreed``. The
architecture rule for this project is "all persistent state
lives under ``~/.tawreed/``" — see ``core/db.py``'s module
docstring and ``SECURITY.md``. The registry was the only
documented exception, and it's a leak surface: a sandbox
monitor, AV scanner, or a user poking around regedit can
discover "Tawreed is installed" and the user's last-visited
page even when ``~/.tawreed/`` is locked down.

This module replaces ``QSettings`` with a plain JSON file at
``~/.tawreed/ui_state.json`` (path exposed as ``db.UI_STATE_PATH``).
The geometry is stored as base64 so the file is grep-friendly
and round-trips through a normal text editor.

Design constraints
------------------
* **Atomic write** — same temp-file-then-rename pattern as
  ``core/db.py``'s config.json path. A crash mid-write must
  never leave a half-written ui_state.json.
* **Qt-free IO** — the read/write helpers are pure Python so
  tests can exercise them without instantiating a QApplication.
  The Qt-typed ``QByteArray`` is converted to a base64 string at
  the call site in ``gui/main_window.py``.
* **Tolerant parse** — if the file is corrupt, missing, or from
  an older schema, ``get_ui_state()`` returns sensible defaults
  instead of raising. The cost of a bad parse should never be a
  crash on startup.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any

from core import db

_log = logging.getLogger(__name__)

# Default values returned by ``get_ui_state()`` when the file
# is missing or unparseable. Picked so the first launch lands
# on the workspace page (the app's primary view) and falls
# back to a reasonable default window size if the geometry blob
# is absent.
_DEFAULT_STATE: dict[str, Any] = {
    "geometry": None,  # base64-encoded QByteArray, or None
    "last_page": "workspace",
}


def _decode_geometry(blob: str) -> bytes | None:
    """Decode a base64 geometry string back to raw bytes.

    Returns ``None`` if the string is not valid base64 — the
    caller is expected to treat that as "no saved geometry",
    which is the same as a fresh install.
    """
    try:
        return base64.b64decode(blob.encode("ascii"), validate=True)
    except (ValueError, TypeError) as exc:
        _log.warning("ui_state: invalid base64 geometry, ignoring: %s", exc)
        return None


def get_ui_state() -> dict[str, Any]:
    """Read the persisted UI state. Returns defaults on any failure.

    The returned dict always contains ``geometry`` (bytes or None)
    and ``last_page`` (str). Callers should not assume the file
    exists — first launch is a normal code path.
    """
    out = dict(_DEFAULT_STATE)
    path = db.UI_STATE_PATH
    if not os.path.exists(path):
        return out
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        _log.warning("ui_state: read failed, using defaults: %s", exc)
        return out
    if not isinstance(raw, dict):
        _log.warning("ui_state: top-level value is not a dict, using defaults")
        return out

    geo = raw.get("geometry")
    if isinstance(geo, str) and geo:
        decoded = _decode_geometry(geo)
        if decoded is not None:
            out["geometry"] = decoded

    last = raw.get("last_page")
    if isinstance(last, str) and last:
        out["last_page"] = last

    return out


def save_ui_state(*, geometry: bytes | None = None, last_page: str | None = None) -> bool:
    """Persist the UI state to ``~/.tawreed/ui_state.json``.

    Merges with any existing values so callers can update just
    one field (e.g. closeEvent only knows about geometry+page,
    not anything else that may be added later). Returns True
    if the file was written successfully, False otherwise.
    """
    path = db.UI_STATE_PATH
    current: dict[str, Any] = {}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                existing = json.load(f)
            if isinstance(existing, dict):
                current = existing
        except (OSError, json.JSONDecodeError):
            # Treat corrupt file as empty — the rewrite below
            # will replace it with a clean payload.
            current = {}

    if geometry is not None:
        current["geometry"] = base64.b64encode(geometry).decode("ascii")
    if last_page is not None:
        current["last_page"] = last_page

    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
        return True
    except OSError as exc:
        _log.warning("ui_state: write failed: %s", exc)
        # Best-effort cleanup of the half-written temp file so a
        # subsequent failure doesn't leave stale ``.tmp`` files
        # accumulating in the user's state directory.
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        return False


def clear_ui_state() -> bool:
    """Remove the persisted UI state file.

    Returns True if the file was deleted (or didn't exist).
    Used by ``core/reset.py`` to give the "reset everything"
    flow a clean slate for the next launch.
    """
    path = db.UI_STATE_PATH
    if not os.path.exists(path):
        return True
    try:
        os.remove(path)
        return True
    except OSError as exc:
        _log.warning("ui_state: delete failed: %s", exc)
        return False
