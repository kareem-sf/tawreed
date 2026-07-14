"""Central logging and crash capture for the embedded Python engine.

The sidecar entry point configures one rotating log under
``~/.tawreed/logs``. Imports remain side-effect free so tests and library
consumers retain control of their own logging configuration.
"""

from __future__ import annotations

import logging
import os
import sys
import traceback
from logging.handlers import RotatingFileHandler
from pathlib import Path

DEFAULT_LOG_DIR = Path.home() / ".tawreed" / "logs"
DEFAULT_LEVEL = "INFO"
MAX_BYTES = 1024 * 1024
BACKUP_COUNT = 3

_CONFIGURED = False
_CRASH_HOOK_INSTALLED = False


def _log_directory(log_dir: Path | None = None) -> Path:
    return Path(log_dir or os.environ.get("TAWREED_LOG_DIR", DEFAULT_LOG_DIR)).expanduser()


def install_crash_hook(log_dir: Path | None = None) -> None:
    """Append unhandled exceptions to ``crash.log`` exactly once."""
    global _CRASH_HOOK_INSTALLED
    if _CRASH_HOOK_INSTALLED:
        return

    crash_path = _log_directory(log_dir) / "crash.log"

    def write_crash(prefix: str, exc_type, exc_value, exc_tb) -> None:
        try:
            crash_path.parent.mkdir(parents=True, exist_ok=True)
            with crash_path.open("a", encoding="utf-8") as stream:
                stream.write(f"\n--- {prefix} pid={os.getpid()} ---\n")
                if exc_type is not None:
                    traceback.print_exception(exc_type, exc_value, exc_tb, file=stream)
        except OSError:
            pass

    def excepthook(exc_type, exc_value, exc_tb) -> None:
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc_value, exc_tb)
            return
        write_crash("UNHANDLED", exc_type, exc_value, exc_tb)
        sys.__excepthook__(exc_type, exc_value, exc_tb)

    def unraisablehook(unraisable) -> None:
        write_crash(
            "UNRAISABLE",
            unraisable.exc_type,
            unraisable.exc_value,
            unraisable.exc_traceback,
        )
        sys.__unraisablehook__(unraisable)

    sys.excepthook = excepthook
    sys.unraisablehook = unraisablehook
    _CRASH_HOOK_INSTALLED = True


def setup_logging(
    log_dir: Path | None = None,
    level: str | None = None,
    *,
    force: bool = False,
) -> logging.Logger:
    """Configure the root logger once and return it."""
    global _CONFIGURED
    root = logging.getLogger()
    if _CONFIGURED and not force:
        return root

    destination = _log_directory(log_dir)
    destination.mkdir(parents=True, exist_ok=True)
    level_name = (level or os.environ.get("TAWREED_LOG_LEVEL", DEFAULT_LEVEL)).upper()
    numeric_level = getattr(logging, level_name, logging.INFO)
    if not isinstance(numeric_level, int):
        numeric_level = logging.INFO

    root.setLevel(numeric_level)
    for handler in list(root.handlers):
        root.removeHandler(handler)

    formatter = logging.Formatter(
        "%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    file_handler = RotatingFileHandler(
        destination / "tawreed.log",
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setLevel(numeric_level)
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)

    if not getattr(sys, "frozen", False):
        stderr_handler = logging.StreamHandler(sys.stderr)
        stderr_handler.setLevel(numeric_level)
        stderr_handler.setFormatter(formatter)
        root.addHandler(stderr_handler)

    root.info("logging initialized: directory=%s level=%s", destination, level_name)
    _CONFIGURED = True
    return root


__all__ = ["install_crash_hook", "setup_logging"]
