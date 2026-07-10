"""Tests for the settings migration in core.db.get_settings().

When the provider list changes (e.g. PR #5 promoted the old
"OpenAI" + custom-base-url pattern to "OpenAI Compatible"), users
who already have a config.json on disk shouldn't have to manually
re-enter their settings. ``get_settings()`` detects the legacy
shape and rewrites it transparently.

v0.0.1 hardening: any plaintext ``api_key`` in a legacy config.json
is migrated to the OS keyring and stripped from disk on first
``get_settings()`` call. The migration tests below verify the
non-secret fields migrate correctly; the secret-stripping behaviour
is covered in detail in ``test_keyring.py``.

The state tree is now at ``~/.tawreed`` for both dev and frozen
builds (was previously split between %LOCALAPPDATA%, the project
root, and ~/.tawreed). These tests override ``os.path.expanduser``
so they don't pollute the real home directory.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

import core.db as db
from core.ai import PROVIDERS


@pytest.fixture
def isolated_config(tmp_path, monkeypatch):
    """Point core.db at a tmp dir + a writable config.json path,
    with an in-memory keyring stub so tests don't touch the
    developer's real OS credential store.

    The new policy is ``~/.tawreed`` for everything, so we redirect
    ``os.path.expanduser('~')`` to ``tmp_path`` and the state
    ends up at ``<tmp>/.tawreed/...``.
    """
    monkeypatch.setattr(os.path, "expanduser", lambda p: str(tmp_path) if p == "~" else p)

    # In-memory keyring stub (same shape as conftest's
    # ``isolated_tawreed_dir`` but re-asserted here because the
    # migration tests ``importlib.reload(db)`` which would
    # otherwise wipe the monkeypatched attributes on the freshly
    # loaded module object).
    store: dict[tuple[str, str], str] = {}

    class _StubKeyring:
        def get_password(self, s, a):
            return store.get((s, a))

        def set_password(self, s, a, v):
            store[(s, a)] = v

        def delete_password(self, s, a):
            try:
                del store[(s, a)]
            except KeyError as e:
                import keyring.errors

                raise keyring.errors.PasswordDeleteError(str(e)) from e

    class _Mod:
        def get_keyring(self):
            return _StubKeyring()

        def get_password(self, s, a):
            return store.get((s, a))

        def set_password(self, s, a, v):
            store[(s, a)] = v

        def delete_password(self, s, a):
            try:
                del store[(s, a)]
            except KeyError as e:
                import keyring.errors

                raise keyring.errors.PasswordDeleteError(str(e)) from e

    monkeypatch.setattr(db, "_load_keyring", lambda: _Mod())
    monkeypatch.setattr(db, "_keyring_is_usable", lambda: True)
    monkeypatch.setattr(db, "_keyring_warned", False)
    monkeypatch.setattr(db, "_secret_fallback_data", None)
    monkeypatch.setattr(db, "_secret_fallback_key", None)

    # Reload so module-level path constants pick up the new home.
    import importlib

    importlib.reload(db)
    # Re-apply monkeypatches to the freshly reloaded module.
    monkeypatch.setattr(db, "_load_keyring", lambda: _Mod())
    monkeypatch.setattr(db, "_keyring_is_usable", lambda: True)
    monkeypatch.setattr(db, "_keyring_warned", False)
    monkeypatch.setattr(db, "_secret_fallback_data", None)
    monkeypatch.setattr(db, "_secret_fallback_key", None)

    # Make sure the new tree exists so tests can write into it.
    db.init_db()
    return tmp_path / ".tawreed"


def _write_config(p: Path, payload: dict) -> None:
    p.write_text(json.dumps(payload), encoding="utf-8")


def test_legacy_minimax_openai_promotes_to_compatible(isolated_config):
    """User had provider=OpenAI, base_url=https://api.minimax.io/v1.
    After upgrade, the provider should auto-become 'OpenAI Compatible'
    and the base_url should be preserved. The api_key in the legacy
    config.json is migrated to the OS keyring."""
    _write_config(
        Path(db.CONFIG_PATH),
        {
            "provider": "OpenAI",
            "base_url": "https://api.minimax.io/v1",
            "api_key": "placeholder-openai-key",
            "model": "MiniMax-M3",
        },
    )
    s = db.get_settings()
    assert s["provider"] == "OpenAI Compatible"
    assert s["base_url"] == "https://api.minimax.io/v1"
    assert s["model"] == "MiniMax-M3"
    # The plaintext api_key should have been migrated to the
    # keyring stub and read back from there.
    assert s["api_key"] == "placeholder-openai-key"
    # And it should no longer be sitting in config.json on disk.
    on_disk = json.loads(Path(db.CONFIG_PATH).read_text(encoding="utf-8"))
    assert "api_key" not in on_disk


def test_legitimate_openai_url_does_not_promote(isolated_config):
    """User has provider=OpenAI, base_url=api.openai.com. That's
    the canonical OpenAI case — should stay as 'OpenAI'."""
    _write_config(
        Path(db.CONFIG_PATH),
        {
            "provider": "OpenAI",
            "base_url": "https://api.openai.com/v1",
            "api_key": "placeholder-real-key",
            "model": "gpt-4.1",
        },
    )
    s = db.get_settings()
    assert s["provider"] == "OpenAI"
    assert s["base_url"] == "https://api.openai.com/v1"
    # The api_key still got migrated to keyring (this test
    # only checks the provider decision, but the migration is
    # still applied as a side effect).
    assert s["api_key"] == "placeholder-real-key"


def test_other_custom_url_promotes_to_compatible(isolated_config):
    """User has provider=OpenAI, base_url=anything-not-openai. Promotes."""
    for url in [
        "https://api.groq.com/openai/v1",
        "http://localhost:1234/v1",
        "https://api.together.xyz/v1",
    ]:
        _write_config(
            Path(db.CONFIG_PATH),
            {
                "provider": "OpenAI",
                "base_url": url,
                "api_key": "x",
                "model": "y",
            },
        )
        s = db.get_settings()
        assert s["provider"] == "OpenAI Compatible", f"failed for {url}"
        assert s["base_url"] == url


def test_empty_base_url_does_not_promote(isolated_config):
    """OpenAI now defaults to api.openai.com — an empty base_url
    should stay as 'OpenAI' (the empty string isn't a custom proxy)."""
    _write_config(
        Path(db.CONFIG_PATH),
        {
            "provider": "OpenAI",
            "base_url": "",
            "api_key": "sk-x",
            "model": "gpt-4.1",
        },
    )
    s = db.get_settings()
    assert s["provider"] == "OpenAI"


def test_unknown_provider_falls_back_to_default(isolated_config):
    """If the saved provider is not in PROVIDERS at all, fall back
    to the default rather than crashing."""
    _write_config(
        Path(db.CONFIG_PATH),
        {
            "provider": "NotARealProvider",
            "base_url": "https://x",
            "api_key": "",
            "model": "x",
        },
    )
    s = db.get_settings()
    assert s["provider"] in PROVIDERS
    assert s["provider"] == "OpenAI"


def test_corrupt_config_returns_defaults(isolated_config):
    """A non-JSON config.json must not crash the app."""
    Path(db.CONFIG_PATH).write_text("not json at all", encoding="utf-8")
    s = db.get_settings()
    assert s["provider"] in PROVIDERS
    assert s["api_key"] == ""  # never default-fill an API key


# ---------------------------------------------------------------------------
# One-shot migration of legacy state into ~/.tawreed
# ---------------------------------------------------------------------------


def test_migrate_legacy_localappdata(monkeypatch, tmp_path):
    """If the user had state at ``%LOCALAPPDATA%\\Tawreed`` (the old
    frozen-build layout), init_db() should copy config + db + outputs
    into the new ``~/.tawreed/`` tree."""
    import sqlite3

    legacy = tmp_path / "fake_localappdata" / "Tawreed"
    legacy.mkdir(parents=True)
    (legacy / "config.json").write_text(
        '{"provider": "OpenAI", "base_url": "https://api.minimax.io/v1", '
        '"api_key": "sk-legacy", "model": "MiniMax-M3"}',
        encoding="utf-8",
    )
    legacy_db = legacy / "db"
    legacy_db.mkdir()
    real_db = legacy_db / "tawreed.db"
    conn = sqlite3.connect(str(real_db))
    conn.execute("CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY)")
    conn.commit()
    conn.close()
    legacy_out = legacy / "outputs"
    legacy_out.mkdir()
    (legacy_out / "old_run.xlsx").write_bytes(b"fake-xlsx")

    # Pretend %LOCALAPPDATA% points at our tmp dir.
    monkeypatch.setattr(
        os.environ,
        "get",
        lambda k, d=None: str(legacy.parent) if k == "LOCALAPPDATA" else os.environ.get(k, d),
    )
    # Pretend the user's home is the new tawreed dir.
    new_home = tmp_path / "fake_home"
    new_home.mkdir()
    monkeypatch.setattr(os.path, "expanduser", lambda p: str(new_home) if p == "~" else p)

    # Reload db so its module-level constants re-evaluate.
    import importlib

    importlib.reload(db)
    db.init_db()

    # All three things should be in ~/.tawreed now.
    new_tawreed = new_home / ".tawreed"
    assert (new_tawreed / "config.json").exists()
    assert (new_tawreed / "db" / "tawreed.db").exists()
    assert (new_tawreed / "outputs" / "old_run.xlsx").exists()
    # A breadcrumb migration log was written.
    assert (new_tawreed / "logs" / "migration.log").exists()


def test_migrate_legacy_exe_dir(monkeypatch, tmp_path):
    """If the user had state at ``<exe-dir>/tawreed`` (the broken
    v0.0.1 frozen-build behaviour), init_db() should copy it into
    ``~/.tawreed/`` and preserve the legacy tree as a recovery source."""
    import sqlite3

    legacy = tmp_path / "dist" / "Tawreed" / "tawreed"
    legacy.mkdir(parents=True)
    (legacy / "config.json").write_text(
        '{"provider": "OpenAI", "api_key": "sk-legacy", "model": "gpt-4.1"}',
        encoding="utf-8",
    )
    legacy_db = legacy / "db"
    legacy_db.mkdir()
    real_db = legacy_db / "tawreed.db"
    conn = sqlite3.connect(str(real_db))
    conn.execute("CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY)")
    conn.commit()
    conn.close()

    fake_exe = legacy.parent / "Tawreed.exe"
    fake_exe.write_text("")

    new_home = tmp_path / "fake_home2"
    new_home.mkdir()
    monkeypatch.setattr(os.path, "expanduser", lambda p: str(new_home) if p == "~" else p)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(fake_exe), raising=False)
    monkeypatch.delenv("LOCALAPPDATA", raising=False)

    import importlib

    importlib.reload(db)
    db.init_db()

    new_tawreed = new_home / ".tawreed"
    assert (new_tawreed / "config.json").exists()
    assert (new_tawreed / "db" / "tawreed.db").exists()
    # Copying is deliberately non-destructive. The legacy source remains
    # available until the user explicitly removes it.
    assert legacy.exists()
    assert real_db.exists()


def test_cleanup_preserves_unmigrated_legacy_files(monkeypatch, tmp_path):
    """A destination conflict must never delete the legacy source."""
    legacy = tmp_path / "fake_localappdata" / "Tawreed"
    legacy_output = legacy / "outputs" / "run.xlsx"
    legacy_output.parent.mkdir(parents=True)
    legacy_output.write_bytes(b"legacy-version")

    new_home = tmp_path / "home"
    new_output = new_home / ".tawreed" / "outputs" / "run.xlsx"
    new_output.parent.mkdir(parents=True)
    new_output.write_bytes(b"current-version")

    monkeypatch.setattr(os.path, "expanduser", lambda p: str(new_home) if p == "~" else p)
    monkeypatch.setattr(
        os.environ,
        "get",
        lambda k, d=None: str(legacy.parent) if k == "LOCALAPPDATA" else os.environ.get(k, d),
    )
    monkeypatch.setattr(sys, "frozen", False, raising=False)

    import importlib

    importlib.reload(db)
    db.init_db()

    assert legacy_output.read_bytes() == b"legacy-version"
    assert new_output.read_bytes() == b"current-version"


def test_migrate_skips_when_no_legacy(monkeypatch, tmp_path):
    """If there's no legacy state, init_db() just creates the new
    tree without writing a migration log."""
    new_home = tmp_path / "fresh_home"
    new_home.mkdir()
    monkeypatch.setattr(os.path, "expanduser", lambda p: str(new_home) if p == "~" else p)
    monkeypatch.delenv("LOCALAPPDATA", raising=False)

    import importlib

    importlib.reload(db)
    db.init_db()

    new_tawreed = new_home / ".tawreed"
    assert new_tawreed.exists()
    # No breadcrumb when there was nothing to migrate.
    assert not (new_tawreed / "logs" / "migration.log").exists()


def test_migrate_does_not_overwrite_existing(monkeypatch, tmp_path):
    """If ~/.tawreed/ already has a config.json, the legacy file
    is NOT copied over — the user's current settings win."""

    legacy = tmp_path / "fake_localappdata" / "Tawreed"
    legacy.mkdir(parents=True)
    (legacy / "config.json").write_text('{"api_key": "OLD"}', encoding="utf-8")

    new_home = tmp_path / "fresh_home2"
    new_tawreed = new_home / ".tawreed"
    new_tawreed.mkdir(parents=True)
    (new_tawreed / "config.json").write_text('{"provider": "Anthropic"}', encoding="utf-8")

    monkeypatch.setattr(os.path, "expanduser", lambda p: str(new_home) if p == "~" else p)
    monkeypatch.setattr(
        os.environ,
        "get",
        lambda k, d=None: str(legacy.parent) if k == "LOCALAPPDATA" else os.environ.get(k, d),
    )
    monkeypatch.setattr(sys, "frozen", False, raising=False)

    import importlib

    importlib.reload(db)
    db.init_db()
    # The new file is untouched.
    text = (new_tawreed / "config.json").read_text(encoding="utf-8")
    assert '"provider": "Anthropic"' in text
    # And the legacy plaintext api_key did NOT leak into the
    # new config.json.
    assert '"api_key"' not in text
    assert "OLD" not in text
