import os
import sys
from pathlib import Path


def data_home() -> Path:
    """~/.tawreed, or TAWREED_HOME when set."""
    return Path(os.environ.get("TAWREED_HOME") or Path.home() / ".tawreed")


def long_path(path: Path) -> Path:
    """The path in Windows' extended form, which has no 260-character limit: a long data folder, project name or
    package name can pass it (package names alone may run to 120 characters). Elsewhere the path as it is."""
    if sys.platform != "win32":
        return path
    text = str(path.resolve())
    prefix = "\\\\?\\"
    return Path(text if text.startswith(prefix) else prefix + text)
