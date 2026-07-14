from __future__ import annotations

import io
import json
from dataclasses import dataclass
from pathlib import Path

import pytest

from tawreed_engine.__main__ import _reconfigure_text_stream
from tawreed_engine.protocol import (
    PROTOCOL_VERSION,
    ProtocolError,
    event,
    parse_command,
    to_jsonable,
)
from tawreed_engine.service import EngineService, ThreadSafeWriter, _public_settings


def test_protocol_rejects_unknown_version():
    with pytest.raises(ProtocolError, match="Unsupported protocol version"):
        parse_command('{"version":2,"type":"health","payload":{}}')


def test_public_settings_never_return_api_key():
    public = _public_settings({"provider": "OpenAI", "api_key": "secret", "theme": "dark"})

    assert "api_key" not in public
    assert public["has_api_key"] is True


def test_json_conversion_handles_dataclasses_paths_and_tuples():
    @dataclass
    class Value:
        path: Path
        values: tuple[int, ...]

    assert to_jsonable(Value(Path("book.xlsx"), (1, 2))) == {
        "path": "book.xlsx",
        "values": [1, 2],
    }


def test_protocol_writer_uses_utf8_instead_of_the_windows_code_page():
    raw = io.BytesIO()
    stream = io.TextIOWrapper(raw, encoding="cp1252", errors="strict", newline="\n")
    _reconfigure_text_stream(stream, errors="strict")

    message = event("log", "AI proposal ready \x9d — مشروع")
    ThreadSafeWriter(stream)(message)

    assert stream.encoding.casefold() == "utf-8"
    assert json.loads(raw.getvalue().decode("utf-8")) == message


class FakeStorage:
    def __init__(self) -> None:
        self.settings = {
            "provider": "Codex",
            "model": "test-model",
            "base_url": "",
            "api_key": "secret",
            "language": "en",
            "theme": "dark",
        }

    def init_db(self) -> None:
        return None

    def get_settings(self):
        return dict(self.settings)

    def save_settings(self, settings):
        self.settings.update(settings)

    def set_api_key(self, provider, value):
        self.settings["api_key"] = value

    def get_api_key(self, provider):
        return self.settings.get("api_key", "")

    def get_history(self):
        return []


@pytest.mark.asyncio
async def test_service_health_and_settings_are_request_correlated():
    messages = []
    service = EngineService(messages.append, storage=FakeStorage())
    service.initialize()

    await service.handle(
        {"version": PROTOCOL_VERSION, "type": "health", "requestId": "one", "payload": {}}
    )
    await service.handle(
        {
            "version": PROTOCOL_VERSION,
            "type": "get_settings",
            "requestId": "two",
            "payload": {},
        }
    )

    health = next(message for message in messages if message.get("requestId") == "one")
    settings = next(message for message in messages if message.get("requestId") == "two")
    assert health["payload"]["data"] == {"status": "ok", "activeRun": False}
    assert settings["payload"]["data"]["has_api_key"] is True
    assert "api_key" not in settings["payload"]["data"]


@pytest.mark.asyncio
async def test_service_rejects_secrets_in_settings_payload():
    messages = []
    service = EngineService(messages.append, storage=FakeStorage())

    await service.handle(
        {
            "version": PROTOCOL_VERSION,
            "type": "save_settings",
            "requestId": "secret-test",
            "payload": {"settings": {"api_key": "must-not-cross"}},
        }
    )

    result = next(message for message in messages if message.get("requestId") == "secret-test")
    assert result["payload"]["ok"] is False
    assert "credential command" in result["payload"]["error"]["message"]


@pytest.mark.asyncio
async def test_service_stores_api_key_without_returning_it():
    messages = []
    storage = FakeStorage()
    service = EngineService(messages.append, storage=storage)

    await service.handle(
        {
            "version": PROTOCOL_VERSION,
            "type": "set_api_key",
            "requestId": "credential-test",
            "payload": {"provider": "OpenAI", "api_key": "new-secret"},
        }
    )

    result = next(message for message in messages if message.get("requestId") == "credential-test")
    assert storage.settings["api_key"] == "new-secret"
    assert result["payload"]["data"] == {"has_api_key": True}
    assert "new-secret" not in str(result)
