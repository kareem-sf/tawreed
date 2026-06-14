"""Tawreed — entry point.

Two ways to launch:

    python main.py            (development)
    python -m tawreed         (after `pip install -e .`)
    dist\\Tawreed\\Tawreed.exe  (PyInstaller onedir build)

The launcher does four things in order:
    1. Initialise the database (fast, <100ms).
    2. Build the SingleApplication. If another instance is running,
       signal it to come to the foreground and exit.
    3. Show the splash screen with "Loading...".
    4. Build the main window, show it, and finish the splash.

qasync is set up around the Qt event loop so the AI streaming
QThread worker can integrate cleanly.
"""

from __future__ import annotations

import asyncio
import logging
import sys

import qasync
from PySide6.QtCore import Qt
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import QApplication

from core import db
from core.i18n import get_i18n
from core.logging_setup import install_crash_hook, setup_logging
from gui import splash as splash_mod
from gui.assets import APP_ICON_PATH
from gui.main_window import MainWindow
from gui.single_app import SingleApplication

log = logging.getLogger(__name__)


def _excepthook(exc_type, exc_value, exc_tb):
    """Catch-all for unhandled exceptions.

    Routes them to the log file and, if a QApplication exists,
    shows a modal dialog so the user knows what happened. Without
    this, a single bad line in an async task could silently kill
    the app under the frozen build (no console, no stderr visible).
    """
    log.error("Unhandled exception", exc_info=(exc_type, exc_value, exc_tb))
    try:
        from PySide6.QtWidgets import QMessageBox

        app = QApplication.instance()
        if app is not None:
            QMessageBox.critical(
                None,
                "Tawreed — unexpected error",
                f"An unhandled error occurred:\n\n{exc_value}\n\n"
                f"Details have been saved to:\n{db.LOGS_DIR}/tawreed.log",
            )
    except Exception:
        # If we can't even build the dialog (e.g. QApplication
        # is gone, font subsystem is broken), don't make it worse.
        log.exception("Failed to show unhandled-exception dialog")


def _run() -> int:
    # Install the crash-log hook FIRST so any failure during the
    # boot sequence (qasync import, platform plugin load, even
    # ``setup_logging`` itself) lands in ``crash.log`` even if
    # the rotating file handler never comes up. The hook is
    # idempotent and chained with our GUI ``_excepthook`` below.
    install_crash_hook()
    sys.excepthook = _excepthook

    # 0. Logging — must be the very first thing, so any failure in
    # db.init_db() or single-instance handshake ends up in the log
    # file even when the GUI never starts (frozen build with
    # console=False).
    setup_logging()

    # 1. Database (synchronous, fast — no splash needed for this).
    db.init_db()

    # 2. Single-instance check.
    app = SingleApplication(sys.argv)
    # The previous version of this block called
    # ``app.setOrganizationName("sfkareem")`` and
    # ``app.setApplicationName(__appname__)`` here. Those calls
    # existed solely to set the QSettings namespace — the only
    # writer to the Windows registry, used for window geometry
    # and last page. Both have been removed; persistent UI state
    # now lives in ``~/.tawreed/ui_state.json`` (see
    # ``core/ui_state.py``). Keeping the calls would still be
    # harmless, but dropping them removes the last Qt-side
    # reason to identify the application to the OS.
    from tawreed_app import __version__

    app.setApplicationVersion(__version__)
    # Set the application icon globally. This is what actually
    # shows up in the title bar and taskbar at runtime — the
    # `icon=` arg in tawreed.spec only embeds the icon in the
    # Windows EXE resource section (file properties, Explorer).
    # Without this setWindowIcon call, Windows falls back to the
    # generic "unknown app" icon.
    app.setWindowIcon(QIcon(str(APP_ICON_PATH)))
    # i18n: switch the application layout direction based on the
    # active language. Arabic flips to RTL; everything else LTR.
    # The i18n object also emits language_changed for any QObject
    # that wants to retranslate itself on the fly.
    i18n = get_i18n()
    app.setLayoutDirection(Qt.RightToLeft if i18n.is_rtl() else Qt.LeftToRight)
    i18n.language_changed.connect(
        lambda _lang: app.setLayoutDirection(Qt.RightToLeft if i18n.is_rtl() else Qt.LeftToRight)
    )
    if app.is_running():
        # Another instance owns the window — ask it to come forward
        # and exit. We don't even need to build a window ourselves.
        app.notify_primary("show")
        return 0

    # 3. Splash. Visible from this point onward.
    splash = splash_mod.show()

    # 4. Main window — built behind the splash, then revealed.
    loop = qasync.QEventLoop(app)
    asyncio.set_event_loop(loop)

    try:
        window = MainWindow()
    except Exception:
        # If window construction fails, release the single-instance
        # server so a retry isn't blocked by a stale named pipe.
        log.exception("Failed to construct MainWindow")
        app.stop_server()
        raise
    window.show()
    splash.finish(window)

    # Wire the single-app signal so a future double-click focuses us.
    app.message_received.connect(window.bring_to_front)
    # Make sure the server is up — we already know we're primary
    # because is_running() returned False, but start_server is what
    # actually begins accepting new-connection attempts.
    app.start_server()
    # Make sure the server is torn down cleanly on a normal exit
    # (so the PID file goes away and the next launch is a fresh
    # primary, not a stale-secondary-recovery).
    app.aboutToQuit.connect(app.stop_server)

    try:
        with loop:
            loop.run_forever()
    finally:
        # Release the named pipe and the PID file so a future launch
        # is a clean primary, not a stale-secondary-recovery.
        app.stop_server()

    return 0


if __name__ == "__main__":
    sys.exit(_run())
