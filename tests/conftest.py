"""Shared, side-effect-free fixtures for the headless Python engine."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture
def isolated_tawreed_dir(tmp_path, monkeypatch):
    """Redirect persistent state and credentials into ``tmp_path``."""
    import core.db as db

    monkeypatch.setattr(db, "TAWREED_DIR", str(tmp_path))
    monkeypatch.setattr(db, "DB_DIR", str(tmp_path / "db"))
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "db" / "tawreed.db"))
    monkeypatch.setattr(db, "CONFIG_PATH", str(tmp_path / "config.json"))
    monkeypatch.setattr(db, "OUTPUTS_DIR", str(tmp_path / "outputs"))
    monkeypatch.setattr(db, "LOGS_DIR", str(tmp_path / "logs"))
    monkeypatch.setattr(db, "SECRET_FALLBACK_PATH", str(tmp_path / ".secret_fallback"))
    monkeypatch.setattr(db, "_detect_legacy_locations", lambda: [])
    (tmp_path / "db").mkdir(exist_ok=True)
    (tmp_path / "outputs").mkdir(exist_ok=True)

    values: dict[tuple[str, str], str] = {}

    class StubKeyring:
        def get_password(self, service: str, account: str) -> str | None:
            return values.get((service, account))

        def set_password(self, service: str, account: str, value: str) -> None:
            values[(service, account)] = value

        def delete_password(self, service: str, account: str) -> None:
            key = (service, account)
            if key not in values:
                raise KeyError(account)
            del values[key]

        def get_keyring(self):
            return self

    keyring = StubKeyring()
    monkeypatch.setattr(db, "_load_keyring", lambda: keyring)
    monkeypatch.setattr(db, "_keyring_is_usable", lambda: True)
    monkeypatch.setattr(db, "_secret_fallback_data", None)
    monkeypatch.setattr(db, "_secret_fallback_key", None)
    monkeypatch.setattr(db, "_keyring_warned", False)
    return tmp_path
