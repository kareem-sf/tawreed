"""Tests for the OS keyring integration in core.db.

The api_key never lands in ``~/.tawreed/config.json`` — it lives
in the OS-provided credential store (Windows Credential Manager /
macOS Keychain / libsecret on Linux). ``core.db`` is the only
module that touches the keyring; the rest of the app reads via
``get_settings()``, which transparently pulls the key from
keyring and exposes it as a regular dict field.

These tests use the ``isolated_tawreed_dir`` fixture from
conftest.py, which installs an in-memory keyring stub so the
real OS credential store is never touched during a test run.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

import core.db as db


def test_save_settings_writes_api_key_to_keyring_only(isolated_tawreed_dir):
    """After save_settings(), config.json on disk must NOT contain
    the api_key, but the value must be readable from keyring."""
    db.save_settings(
        {
            "provider": "OpenAI",
            "api_key": "sk-test-abc",
            "model": "gpt-4.1",
            "base_url": "https://api.openai.com/v1",
        }
    )
    # On disk: no plaintext key.
    on_disk = json.loads(Path(db.CONFIG_PATH).read_text(encoding="utf-8"))
    assert "api_key" not in on_disk
    assert on_disk["provider"] == "OpenAI"
    assert on_disk["model"] == "gpt-4.1"
    # Via the API: the key is there.
    assert db.get_api_key("OpenAI") == "sk-test-abc"
    # And get_settings() returns it.
    s = db.get_settings()
    assert s["api_key"] == "sk-test-abc"


def test_per_provider_keys_are_isolated(isolated_tawreed_dir):
    """Setting a key for one provider must not leak to another."""
    db.set_api_key("OpenAI", "openai-key")
    db.set_api_key("Anthropic", "anthropic-key")
    assert db.get_api_key("OpenAI") == "openai-key"
    assert db.get_api_key("Anthropic") == "anthropic-key"
    assert db.get_api_key("Google") == ""


def test_set_api_key_empty_string_deletes(isolated_tawreed_dir):
    """Passing an empty string to set_api_key removes the entry."""
    db.set_api_key("OpenAI", "key-1")
    assert db.get_api_key("OpenAI") == "key-1"
    db.set_api_key("OpenAI", "")
    assert db.get_api_key("OpenAI") == ""


def test_clear_all_api_keys_removes_everything(isolated_tawreed_dir):
    """core.reset.reset_all() relies on this to wipe the
    Credential Manager when the user hits "Reset everything"."""
    db.set_api_key("OpenAI", "k1")
    db.set_api_key("Anthropic", "k2")
    db.set_api_key("OpenAI Compatible", "k3")
    n = db.clear_all_api_keys()
    assert n == 3
    assert db.get_api_key("OpenAI") == ""
    assert db.get_api_key("Anthropic") == ""
    assert db.get_api_key("OpenAI Compatible") == ""


def test_legacy_plaintext_key_in_config_is_migrated_on_read(isolated_tawreed_dir):
    """If a pre-v0.0.1 config.json still has an api_key in
    plaintext, the first get_settings() call must move it to
    keyring and strip it from disk. This is the upgrade path
    for users who already had a working v0.0.1 install."""
    Path(db.CONFIG_PATH).write_text(
        json.dumps(
            {
                "provider": "OpenAI",
                "api_key": "sk-still-plaintext",
                "model": "gpt-4.1",
                "base_url": "https://api.openai.com/v1",
            }
        ),
        encoding="utf-8",
    )
    s = db.get_settings()
    # Returned dict has the key (for backward compat with the GUI).
    assert s["api_key"] == "sk-still-plaintext"
    # Disk: key is gone.
    on_disk = json.loads(Path(db.CONFIG_PATH).read_text(encoding="utf-8"))
    assert "api_key" not in on_disk
    # Keyring: key is there.
    assert db.get_api_key("OpenAI") == "sk-still-plaintext"


def test_get_settings_with_no_config_returns_empty_api_key(isolated_tawreed_dir):
    """Brand-new install: no config.json, no keyring entry.
    get_settings() should return defaults with api_key=''."""
    assert not Path(db.CONFIG_PATH).exists()
    s = db.get_settings()
    assert s["provider"] in ("OpenAI", "OpenAI Compatible")
    assert s["api_key"] == ""


def test_get_settings_does_not_persist_api_key(isolated_tawreed_dir):
    """Calling get_settings() must never write the api_key to
    config.json. The only writer to config.json is save_settings,
    and even that routes the key to keyring."""
    db.set_api_key("OpenAI", "key-1")
    # Trigger a get_settings() roundtrip.
    s = db.get_settings()
    assert s["api_key"] == "key-1"
    # Even if a config.json didn't exist before, one was created
    # by the migration? No — get_settings() only READS. config.json
    # should still not exist on disk.
    assert not Path(db.CONFIG_PATH).exists(), "get_settings() must not create config.json"


def test_save_settings_without_api_key_leaves_keyring_intact(isolated_tawreed_dir):
    """When the user changes only the model in the Settings page,
    the payload sent to save_settings() may not include the
    api_key. In that case the existing keyring value must
    survive — the user would be furious if saving a model
    selection nuked their stored key."""
    db.set_api_key("OpenAI", "existing-key")
    db.save_settings(
        {
            "provider": "OpenAI",
            "model": "gpt-4.1",
            "base_url": "https://api.openai.com/v1",
            # No api_key field.
        }
    )
    assert db.get_api_key("OpenAI") == "existing-key"


def test_save_settings_with_empty_api_key_clears_it(isolated_tawreed_dir):
    """Explicit empty api_key in the payload means "forget it"."""
    db.set_api_key("OpenAI", "old-key")
    db.save_settings(
        {
            "provider": "OpenAI",
            "api_key": "",
            "model": "gpt-4.1",
            "base_url": "https://api.openai.com/v1",
        }
    )
    assert db.get_api_key("OpenAI") == ""


def test_config_json_on_disk_never_contains_api_key(isolated_tawreed_dir):
    """Defence-in-depth: even after many save/get cycles, the
    plaintext api_key must not appear anywhere in config.json."""
    for i in range(5):
        db.save_settings(
            {
                "provider": "OpenAI",
                "api_key": f"key-{i}",
                "model": "gpt-4.1",
                "base_url": "https://api.openai.com/v1",
            }
        )
        # Read the file from disk every time and grep for "key-N".
        text = Path(db.CONFIG_PATH).read_text(encoding="utf-8")
        for j in range(i + 1):
            assert f'"key-{j}"' not in text, f"key-{j} leaked to disk in cycle {i}"


def test_fallback_path_used_when_keyring_unavailable(isolated_tawreed_dir, monkeypatch):
    """If the keyring backend is the no-op Fail/Null one, the
    secret falls back to a per-install obfuscated file. This is
    a degradation path for headless Linux / containers, NOT a
    real security claim — but the key still must survive a
    get/set cycle."""
    # Pretend keyring is unavailable.
    monkeypatch.setattr(db, "_keyring_is_usable", lambda: False)
    # Drop the in-memory cache so the file is actually read.
    monkeypatch.setattr(db, "_secret_fallback_data", None)
    monkeypatch.setattr(db, "_secret_fallback_key", None)
    db.set_api_key("OpenAI", "fallback-key")
    # No keyring call was made.
    assert db.get_api_key("OpenAI") == "fallback-key"
    # The fallback file exists on disk.
    assert Path(db.SECRET_FALLBACK_PATH).exists()
    # Drop the in-memory cache and re-read — the value must
    # survive across "process restarts" (i.e. dict clears).
    monkeypatch.setattr(db, "_secret_fallback_data", None)
    monkeypatch.setattr(db, "_secret_fallback_key", None)
    assert db.get_api_key("OpenAI") == "fallback-key"


def test_fallback_file_mode_is_0600_on_posix(isolated_tawreed_dir, monkeypatch):
    """The fallback file must be created with owner-only read/write
    on POSIX systems. Windows uses NTFS ACLs and ignores chmod,
    so the assertion is skipped there."""
    if os.name != "posix":
        pytest.skip("chmod is a no-op on Windows")
    monkeypatch.setattr(db, "_keyring_is_usable", lambda: False)
    monkeypatch.setattr(db, "_secret_fallback_data", None)
    monkeypatch.setattr(db, "_secret_fallback_key", None)
    db.set_api_key("OpenAI", "secret")
    mode = Path(db.SECRET_FALLBACK_PATH).stat().st_mode & 0o777
    assert mode == 0o600, f"fallback file mode is {oct(mode)}, expected 0o600"
