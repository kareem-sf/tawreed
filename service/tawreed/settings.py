"""The engineer's settings, kept in ~/.tawreed/settings.json."""

from pathlib import Path
from typing import Any

from tawreed.core import jsonfile

DEFAULTS: dict[str, Any] = {
    "language": "en",  # "en" | "ar"
    "theme": "system",  # "system" | "light" | "dark"
    # The connection and model Tawreed works with: {"connection_id": ..., "model": ...}, once its check passed.
    "ai": None,
}


def _path(home: Path) -> Path:
    return home / "settings.json"


def load(home: Path) -> dict[str, Any]:
    return {**DEFAULTS, **jsonfile.read(_path(home), {})}


def save(home: Path, **values: Any) -> dict[str, Any]:
    jsonfile.update(_path(home), {}, lambda data: data.update(values))
    return load(home)
