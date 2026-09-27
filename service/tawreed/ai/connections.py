"""AI connections and their keys, kept in ~/.tawreed/auth.json.

The engineer chose a plain file over the operating system's credential store. It is made readable by the current
user only, and keys never leave the service except to their own provider."""

import logging
import os
import subprocess
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from tawreed.core import jsonfile

log = logging.getLogger("tawreed.ai")


def path(home: Path) -> Path:
    return home / "auth.json"


def _empty() -> dict[str, Any]:
    return {"connections": []}


def all_connections(home: Path) -> list[dict[str, Any]]:
    return jsonfile.read(path(home), _empty())["connections"]


def get(home: Path, connection_id: str) -> dict[str, Any] | None:
    return next((c for c in all_connections(home) if c["id"] == connection_id), None)


def add(home: Path, provider: str, label: str, api_key: str, base_url: str | None) -> dict[str, Any]:
    connection = {
        "id": uuid.uuid4().hex,
        "provider": provider,
        "label": label,
        "base_url": base_url,
        "api_key": api_key,
        "checks": {},
    }
    _update(home, lambda data: data["connections"].append(connection))
    return connection


def remove(home: Path, connection_id: str) -> None:
    def change(data: dict[str, Any]) -> None:
        data["connections"] = [c for c in data["connections"] if c["id"] != connection_id]

    _update(home, change)


def record_check(home: Path, connection_id: str, model: str, ok: bool, problem: str | None, sees_images: bool) -> None:
    result = {"ok": ok, "problem": problem, "sees_images": sees_images, "checked_at": datetime.now(UTC).isoformat()}

    def change(data: dict[str, Any]) -> None:
        for connection in data["connections"]:
            if connection["id"] == connection_id:
                connection["checks"][model] = result

    _update(home, change)


def _update(home: Path, change) -> None:
    jsonfile.update(path(home), _empty(), change)
    make_private(path(home))


def make_private(file: Path) -> None:
    """Let only the current user read or change the file."""
    try:
        if os.name == "nt":
            # By security ID rather than name, so domain and Microsoft accounts work too.
            sid = _run(["whoami", "/user", "/fo", "csv", "/nh"]).strip().split(",")[-1].strip('"')
            _run(["icacls", str(file), "/inheritance:r", "/grant:r", f"*{sid}:F"])
        else:
            file.chmod(0o600)
    except (OSError, subprocess.CalledProcessError) as error:
        log.warning("Could not restrict %s to the current user: %s", file.name, error)


def _run(command: list[str]) -> str:
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout
