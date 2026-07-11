from __future__ import annotations

import json

from core import db
from core.settings_service import SettingsService


def _seed() -> None:
    db.save_settings(
        {
            "provider": "OpenAI",
            "api_key": "secret-key",
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4.1-mini",
            "model_id": "gpt-4.1-mini",
            "language": "en",
            "theme": "system",
        }
    )


def test_section_updates_merge_without_overwriting_other_fields(isolated_tawreed_dir):
    _seed()
    service = SettingsService()

    service.save_appearance("dark")
    service.save_language("ar")

    saved = service.load()
    assert saved.provider == "OpenAI"
    assert saved.model == "gpt-4.1-mini"
    assert saved.api_key == "secret-key"
    assert saved.theme == "dark"
    assert saved.language == "ar"


def test_section_updates_never_write_api_key_to_config(isolated_tawreed_dir):
    _seed()
    SettingsService().save_model("gpt-4.1")

    on_disk = json.loads(isolated_tawreed_dir.joinpath("config.json").read_text("utf-8"))
    assert "api_key" not in on_disk
    assert db.get_api_key("OpenAI") == "secret-key"


def test_provider_change_uses_first_live_model_when_saved_model_is_invalid(
    isolated_tawreed_dir,
):
    _seed()
    saved = SettingsService().save_ai_connection(
        "Google",
        "google-key",
        "https://generativelanguage.googleapis.com/v1beta/openai",
        ("gemini-2.5-pro", "gemini-2.5-flash"),
    )

    assert saved.provider == "Google"
    assert saved.model == "gemini-2.5-pro"
    assert db.get_api_key("Google") == "google-key"
