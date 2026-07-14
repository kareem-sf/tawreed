"""Versioned, row-free messages shared with the Tauri host.

The protocol intentionally exposes progress and approval summaries only. Raw
BOQ rows, prompts, and model output never cross the process boundary.
"""

from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from enum import Enum
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = 1


class ProtocolError(ValueError):
    """Raised when the host sends a malformed or unsupported command."""


def to_jsonable(value: Any) -> Any:
    """Convert trusted engine values into JSON-compatible primitives."""
    if is_dataclass(value) and not isinstance(value, type):
        return to_jsonable(asdict(value))
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    return value


def event(kind: str, payload: Any = None, *, request_id: str | None = None) -> dict[str, Any]:
    message: dict[str, Any] = {
        "version": PROTOCOL_VERSION,
        "kind": kind,
        "payload": to_jsonable({} if payload is None else payload),
    }
    if request_id:
        message["requestId"] = request_id
    return message


def response(request_id: str, payload: Any = None) -> dict[str, Any]:
    return event("response", {"ok": True, "data": payload}, request_id=request_id)


def error_response(request_id: str | None, message: str, code: str) -> dict[str, Any]:
    return event(
        "response",
        {"ok": False, "error": {"code": code, "message": message}},
        request_id=request_id,
    )


def parse_command(line: str) -> dict[str, Any]:
    try:
        value = json.loads(line)
    except json.JSONDecodeError as exc:
        raise ProtocolError("Command is not valid JSON.") from exc
    if not isinstance(value, dict):
        raise ProtocolError("Command must be a JSON object.")
    if value.get("version") != PROTOCOL_VERSION:
        raise ProtocolError(f"Unsupported protocol version: {value.get('version')!r}.")
    if not isinstance(value.get("type"), str) or not value["type"]:
        raise ProtocolError("Command type is required.")
    request_id = value.get("requestId")
    if request_id is not None and not isinstance(request_id, str):
        raise ProtocolError("requestId must be a string.")
    payload = value.get("payload", {})
    if not isinstance(payload, dict):
        raise ProtocolError("Command payload must be an object.")
    return value


def dumps(message: dict[str, Any]) -> str:
    return json.dumps(message, ensure_ascii=False, separators=(",", ":"))


__all__ = [
    "PROTOCOL_VERSION",
    "ProtocolError",
    "dumps",
    "error_response",
    "event",
    "parse_command",
    "response",
    "to_jsonable",
]
