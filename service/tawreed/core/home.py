import os
from pathlib import Path


def data_home() -> Path:
    """~/.tawreed, or TAWREED_HOME when set."""
    return Path(os.environ.get("TAWREED_HOME") or Path.home() / ".tawreed")
