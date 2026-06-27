"""Tests for the wipe-everything reset path.

We never touch the real TAWREED_DIR — every test points core.db at
a tmp_path so the user's actual config / history / outputs are
untouched. The in-memory keyring stub from conftest.py keeps the
test away from the developer's real OS credential store.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

import core.db as db
import core.reset as reset_mod

# Reuse the shared fixture from conftest.py so the keyring stub
# is installed exactly the same way as for the rest of the suite.
pytestmark = pytest.mark.usefixtures("isolated_tawreed_dir")


def _write_config(p: Path) -> None:
    p.write_text(
        '{"provider": "OpenAI", "api_key": "***", "model": "MiniMax-M3"}',
        encoding="utf-8",
    )


def _seed_history(n: int) -> None:
    db.init_db()
    conn = sqlite3.connect(db.DB_PATH)
    cur = conn.cursor()
    for i in range(n):
        cur.execute(
            "INSERT INTO history (timestamp, project_name, packages_count, output_path) "
            "VALUES (?, ?, ?, ?)",
            (f"2026-06-13 1{i:02d}:00", f"Project {i}", i + 1, f"/tmp/p{i}.xlsx"),
        )
    conn.commit()
    conn.close()


def _seed_outputs(n: int) -> list[Path]:
    out = []
    for i in range(n):
        p = Path(db.OUTPUTS_DIR) / f"run_{i}.xlsx"
        p.write_bytes(b"fake xlsx content")
        out.append(p)
    return out


def test_reset_deletes_config(isolated_tawreed_dir):
    cfg = Path(db.CONFIG_PATH)
    _write_config(cfg)
    assert cfg.exists()

    report = reset_mod.reset_all()
    assert report.config_deleted is True
    assert not cfg.exists()


def test_reset_clears_api_keys_from_keyring(isolated_tawreed_dir):
    """The v0.0.1 hardening: the 'Reset everything' button must
    wipe the OS keyring too, otherwise the api_key survives in
    Credential Manager and the reset is a half-job."""
    db.set_api_key("OpenAI", "key-1")
    db.set_api_key("Claude", "key-2")
    db.set_api_key("OpenAI Compatible", "key-3")
    assert db.get_api_key("OpenAI") == "key-1"
    assert db.get_api_key("Claude") == "key-2"
    assert db.get_api_key("OpenAI Compatible") == "key-3"

    report = reset_mod.reset_all()
    assert report.api_keys_cleared == 3
    assert db.get_api_key("OpenAI") == ""
    assert db.get_api_key("Claude") == ""
    assert db.get_api_key("OpenAI Compatible") == ""


def test_reset_truncates_history(isolated_tawreed_dir):
    _seed_history(5)
    report = reset_mod.reset_all()
    assert report.history_rows_deleted == 5
    # The file is preserved (schema stays), but the table is empty.
    conn = sqlite3.connect(db.DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM history")
    (n,) = cur.fetchone()
    assert n == 0
    conn.close()


def test_reset_clears_outputs(isolated_tawreed_dir):
    files = _seed_outputs(3)
    assert all(f.exists() for f in files)

    report = reset_mod.reset_all()
    assert report.outputs_deleted == 3
    assert not any(f.exists() for f in files)
    # The outputs/ directory itself is preserved.
    assert Path(db.OUTPUTS_DIR).is_dir()


def test_reset_handles_missing_files_gracefully(isolated_tawreed_dir):
    """Fresh install — nothing to delete. Should not raise."""
    report = reset_mod.reset_all()
    assert report.config_deleted is False
    assert report.history_rows_deleted == 0
    assert report.outputs_deleted == 0


def test_reset_clears_ui_state(isolated_tawreed_dir):
    """``reset_all()`` must also remove the persisted UI state file
    so a future launch starts with the default window size and the
    workspace page. Replaces the previous ``test_reset_clears_qsettings``
    which asserted that the QSettings registry key was wiped.
    """
    ui_state_path = Path(db.UI_STATE_PATH)
    ui_state_path.write_text('{"last_page": "settings"}', encoding="utf-8")
    assert ui_state_path.exists()

    report = reset_mod.reset_all()
    assert report.ui_state_cleared is True
    assert not ui_state_path.exists()


def test_reset_returns_human_summary(isolated_tawreed_dir):
    # Make sure no other test left outputs in the shared tmp dir.
    for stale in Path(db.OUTPUTS_DIR).iterdir():
        if stale.is_file():
            stale.unlink()
    _write_config(Path(db.CONFIG_PATH))
    db.set_api_key("OpenAI", "test-key")
    _seed_history(2)
    _seed_outputs(4)
    report = reset_mod.reset_all()
    s = report.human_summary()
    # The summary calls out the keyring wipe explicitly (the
    # "API key" copy is gone — it's now phrased as "API key(s)
    # removed from the OS keyring"). The provider/model/base_url
    # copy stays.
    assert "API key" in s
    assert "2 history row" in s
    assert "4 output file" in s
    assert "Window" in s
    assert "Tawreed will restart" in s
