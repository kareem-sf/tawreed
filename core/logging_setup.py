"""Centralised logging setup for Tawreed.

Design
------
A single ``setup_logging()`` is called from ``main._run()`` before
anything else runs. It configures a ``RotatingFileHandler`` writing
to ``~/.tawreed/logs/tawreed.log`` (rotated at 1 MB × 3 backups), and
optionally a stderr handler when the process is *not* frozen (i.e.
running as ``python main.py`` in dev).

Why a separate file?
- We never want ``import logging`` to be the trigger for configuring
  handlers. Configuring once at the entry point keeps the log output
  consistent across modules.
- ``core.db`` is imported by the very first thing the app does
  (init_db), and we want the log directory to exist before any
  error could occur there.
- Tests don't call ``setup_logging()`` — they get Python's default
  "no handlers" behaviour, which is what pytest wants.

Layering with the GUI
---------------------
``print()`` calls in the GUI are unavoidable during early boot
(``qasync`` isn't up yet, ``QMessageBox`` would block). Those are
deliberate; the four print→log.exception() conversions in
``core/ai.py`` and ``gui/worker.py`` are for catch-block logging of
exceptions that *would otherwise* be invisible to the user once
``console=False`` is set in tawreed.spec.
"""

from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

# Default values. ``core.db`` overrides these on first ``init_db()``
# call so the file lands in the canonical state directory.
DEFAULT_LOG_DIR = Path.home() / ".tawreed" / "logs"
DEFAULT_LOG_FILE = DEFAULT_LOG_DIR / "tawreed.log"
DEFAULT_CRASH_FILE = DEFAULT_LOG_DIR / "crash.log"
DEFAULT_LEVEL = "INFO"
MAX_BYTES = 1 * 1024 * 1024  # 1 MB per file
BACKUP_COUNT = 3  # keep tawreed.log.1, .2, .3

_CONFIGURED = False
_CRASH_HOOK_INSTALLED = False


def install_crash_hook(log_dir: Path | None = None) -> None:
    """Install ``sys.excepthook`` and ``sys.unraisablehook`` that
    write to ``~/.tawreed/logs/crash.log``.

    This is the LAST-LINE-OF-DEFENCE for unhandled exceptions.
    The user releases the EXE with ``console=False`` so the
    usual "Traceback (most recent call last):" output never
    appears anywhere; without this hook a crash is completely
    silent — the user sees the app vanish and has nothing to
    report.

    The hook is installed at import time, BEFORE
    ``setup_logging()`` runs, so it can capture errors that
    happen during the first import phase (qasync, PySide6
    platform plugin load, etc.). We append to crash.log (no
    rotation; each crash is a few KB and the user can clean
    up manually if needed).
    """
    global _CRASH_HOOK_INSTALLED
    if _CRASH_HOOK_INSTALLED:
        return
    crash_path = Path(log_dir or os.environ.get("TAWREED_LOG_DIR", DEFAULT_LOG_DIR)) / "crash.log"

    def _write_crash(prefix: str, exc_type, exc_value, exc_tb) -> None:
        try:
            crash_path.parent.mkdir(parents=True, exist_ok=True)
            import traceback

            with open(crash_path, "a", encoding="utf-8") as f:
                f.write(
                    f"\n--- {prefix} @ {os.environ.get('COMPUTERNAME', '?')} "
                    f"pid={os.getpid()} ---\n"
                )
                if exc_type is not None:
                    traceback.print_exception(exc_type, exc_value, exc_tb, file=f)
        except Exception:
            # If we can't even write the crash file, there's
            # nothing left to do. Don't raise from inside the
            # hook.
            pass

    def _excepthook(exc_type, exc_value, exc_tb):
        # Don't intercept KeyboardInterrupt — the user pressing
        # Ctrl+C is not a "crash".
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc_value, exc_tb)
            return
        _write_crash("UNHANDLED", exc_type, exc_value, exc_tb)
        # Also call the previous hook so pytest / IDE debuggers
        # still see the traceback in their own output.
        sys.__excepthook__(exc_type, exc_value, exc_tb)

    def _unraisable_hook(unraisable):
        _write_crash(
            "UNRAISABLE",
            unraisable.exc_type,
            unraisable.exc_value,
            unraisable.exc_traceback,
        )
        sys.__unraisablehook__(unraisable)

    sys.excepthook = _excepthook
    sys.unraisablehook = _unraisable_hook
    _CRASH_HOOK_INSTALLED = True


def setup_logging(
    log_dir: Path | None = None,
    level: str | None = None,
    *,
    force: bool = False,
) -> logging.Logger:
    """Configure the root logger once.

    Safe to call multiple times — does nothing after the first call
    unless ``force=True``. The point of being idempotent is so that
    tests, dev scripts, and the frozen EXE can all call it without
    getting duplicate-handler warnings.

    Returns the root logger so callers can ``log.info("started")``
    immediately if they want.
    """
    global _CONFIGURED
    if _CONFIGURED and not force:
        return logging.getLogger()

    log_dir = Path(log_dir or os.environ.get("TAWREED_LOG_DIR", DEFAULT_LOG_DIR))
    level = (level or os.environ.get("TAWREED_LOG_LEVEL", DEFAULT_LEVEL)).upper()
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "tawreed.log"

    root = logging.getLogger()
    root.setLevel(level)
    # Wipe any prior handlers (e.g. from a previous force=True call)
    # so we don't end up with duplicate output.
    for h in list(root.handlers):
        root.removeHandler(h)

    fmt = logging.Formatter(
        "%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = RotatingFileHandler(
        log_file, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)
    file_handler.setLevel(level)
    root.addHandler(file_handler)

    # Stderr tee only when running from source (i.e. not PyInstaller
    # frozen). Detecting "frozen" via the standard ``sys.frozen`` attr
    # is the PyInstaller contract.
    if not getattr(sys, "frozen", False):
        stream_handler = logging.StreamHandler(stream=sys.stderr)
        stream_handler.setFormatter(fmt)
        stream_handler.setLevel(level)
        root.addHandler(stream_handler)

    root.info(
        "logging initialised: file=%s level=%s frozen=%s",
        log_file,
        level,
        getattr(sys, "frozen", False),
    )
    _CONFIGURED = True
    return root
