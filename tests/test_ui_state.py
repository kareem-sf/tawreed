"""Tests for the ui_state module (window geometry + last_page).

These tests are Qt-free — ``core.ui_state`` does all its IO in
plain Python so we don't need a QApplication. The QByteArray
round-trip is exercised indirectly via raw bytes (Qt's
``saveGeometry()`` returns a QByteArray; converting it to
``bytes()`` gives the same payload we'd hand to a stub).
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

import core.db as db
import core.ui_state as ui_state

pytestmark = pytest.mark.usefixtures("isolated_tawreed_dir")


def test_get_ui_state_returns_defaults_when_file_missing():
    state = ui_state.get_ui_state()
    assert state == {"geometry": None, "last_page": "workspace"}


def test_save_then_get_round_trips():
    payload = b"\x00\x01\x02 fake QByteArray contents \xff"
    assert ui_state.save_ui_state(geometry=payload, last_page="history") is True

    state = ui_state.get_ui_state()
    assert state["geometry"] == payload
    assert state["last_page"] == "history"


def test_save_merges_with_existing_fields():
    """A partial update must not wipe unrelated fields."""
    ui_state.save_ui_state(geometry=b"abc", last_page="settings")
    # Now update only the page; geometry should survive.
    ui_state.save_ui_state(last_page="about")
    state = ui_state.get_ui_state()
    assert state["geometry"] == b"abc"
    assert state["last_page"] == "about"


def test_save_writes_under_tawreed_dir(isolated_tawreed_dir):
    ui_state.save_ui_state(geometry=b"x", last_page="workspace")
    expected = isolated_tawreed_dir / "ui_state.json"
    assert expected.exists()
    on_disk = json.loads(expected.read_text(encoding="utf-8"))
    # Geometry must be base64-encoded so the file is grep-friendly
    # and round-trips through a normal text editor.
    assert base64.b64decode(on_disk["geometry"]) == b"x"
    assert on_disk["last_page"] == "workspace"


def test_get_ui_state_handles_corrupt_file(tmp_path, monkeypatch):
    """A garbage file must not crash the app on startup."""
    monkeypatch.setattr(db, "UI_STATE_PATH", str(tmp_path / "ui_state.json"))
    (tmp_path / "ui_state.json").write_text("this is not json {{{", encoding="utf-8")
    state = ui_state.get_ui_state()
    assert state == {"geometry": None, "last_page": "workspace"}


def test_get_ui_state_handles_wrong_types(tmp_path, monkeypatch):
    """A file with a list at the top level must not crash."""
    monkeypatch.setattr(db, "UI_STATE_PATH", str(tmp_path / "ui_state.json"))
    (tmp_path / "ui_state.json").write_text("[1, 2, 3]", encoding="utf-8")
    state = ui_state.get_ui_state()
    assert state["geometry"] is None
    assert state["last_page"] == "workspace"


def test_get_ui_state_ignores_invalid_base64_geometry(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "UI_STATE_PATH", str(tmp_path / "ui_state.json"))
    (tmp_path / "ui_state.json").write_text(
        json.dumps({"geometry": "!!!not-base64!!!", "last_page": "history"}),
        encoding="utf-8",
    )
    state = ui_state.get_ui_state()
    assert state["geometry"] is None
    assert state["last_page"] == "history"


def test_clear_ui_state_removes_file():
    ui_state.save_ui_state(geometry=b"abc", last_page="settings")
    assert Path(db.UI_STATE_PATH).exists()
    assert ui_state.clear_ui_state() is True
    assert not Path(db.UI_STATE_PATH).exists()


def test_clear_ui_state_is_idempotent():
    """Clearing a non-existent file must return True, not error."""
    assert not Path(db.UI_STATE_PATH).exists()
    assert ui_state.clear_ui_state() is True


def test_save_ui_state_uses_atomic_rename(isolated_tawreed_dir, monkeypatch):
    """A failed ``os.replace`` must not leave a ``.tmp`` file behind."""
    from core import ui_state as mod

    real_replace = __import__("os").replace

    def fail_replace(_src, _dst):
        raise OSError("simulated crash")

    monkeypatch.setattr("core.ui_state.os.replace", fail_replace)
    assert mod.save_ui_state(geometry=b"x", last_page="workspace") is False
    # Restore and check there's no leftover .tmp
    monkeypatch.setattr("core.ui_state.os.replace", real_replace)
    leftovers = list(isolated_tawreed_dir.glob("ui_state.json.tmp"))
    assert leftovers == []
