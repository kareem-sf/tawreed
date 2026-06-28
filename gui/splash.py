"""Splash screen for cold-start UX.

A ``QSplashScreen`` is the right tool for the first ~1–3 seconds of
launch, while the database initialises, providers are queried, and
the main window assembles. The user sees *something* immediately
instead of staring at a blank taskbar.

Design decisions:
- 480x260 dark card matching the main window palette. Small enough
  not to dominate the screen, large enough to show version + status.
- ``Qt.WindowStaysOnTopHint`` so the splash is visible even if the
  user alt-tabs during the load.
- ``showMessage()`` is the standard way to update the status line
  — Qt renders it natively on the splash pixmap.
- The pixmap is built from a ``QWidget`` styled with the same QSS
  tokens as the main app, so re-theming is automatic.
- ``finish(window)`` is called by the caller once the main window is
  shown — Qt handles the fade-out.
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QFont, QPainter, QPixmap
from PySide6.QtWidgets import QApplication, QSplashScreen

from core.i18n import get_i18n
from gui.assets import LOGO_PNG_PATH
from tawreed_app import __version__

# Version is sourced from the canonical package constant so the
# About page, splash, and `pyproject.toml` can never drift apart.
_VERSION = f"v{__version__}"
_WIDTH = 480
_HEIGHT = 260


def _build_pixmap(i18n) -> QPixmap:
    """Render the splash background to a QPixmap.

    We draw the title and version directly so the splash looks the
    same on every machine, regardless of font availability. The status
    line is updated via ``showMessage()`` after construction.
    """
    pixmap = QPixmap(_WIDTH, _HEIGHT)
    pixmap.fill(QColor("#0d0e15"))  # matches COLOR_BG

    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.Antialiasing, True)

    # Brand logo (centered, top of card). Fall back to text if the
    # PNG is missing — same fallback as the nav rail in main_window.
    if LOGO_PNG_PATH.exists():
        logo = QPixmap(str(LOGO_PNG_PATH)).scaled(
            72, 72, Qt.KeepAspectRatio, Qt.SmoothTransformation
        )
        x = (_WIDTH - logo.width()) // 2
        painter.drawPixmap(x, 30, logo)
    else:
        painter.setPen(QColor("#89b4fa"))
        title_font = QFont("Segoe UI", 28, QFont.Bold)
        painter.setFont(title_font)
        painter.drawText(0, 30, _WIDTH, 80, Qt.AlignHCenter | Qt.AlignVCenter, "T")

    # Title (under the logo)
    title_font = QFont("Segoe UI", 22, QFont.Bold)
    painter.setFont(title_font)
    painter.setPen(QColor("#ffffff"))
    painter.drawText(0, 115, _WIDTH, 40, Qt.AlignHCenter | Qt.AlignVCenter, i18n.tr("app_title"))

    # Tagline
    tagline_font = QFont("Segoe UI", 10)
    painter.setFont(tagline_font)
    painter.setPen(QColor("#a6adc8"))
    painter.drawText(
        0,
        150,
        _WIDTH,
        24,
        Qt.AlignHCenter | Qt.AlignVCenter,
        i18n.tr("about_page_subtitle"),
    )

    # Version (bottom-left)
    version_font = QFont("Segoe UI", 9)
    painter.setFont(version_font)
    painter.setPen(QColor("#7f849c"))
    painter.drawText(20, _HEIGHT - 28, 200, 20, Qt.AlignVCenter, _VERSION)

    # Accent stripe along the bottom
    painter.setPen(Qt.NoPen)
    painter.setBrush(QColor("#89b4fa"))
    painter.drawRect(0, _HEIGHT - 4, _WIDTH, 4)

    painter.end()
    return pixmap


def show() -> QSplashScreen:
    """Create and show the splash screen. Returns it for ``finish()``.

    Shows an initial "Loading..." status message. Caller is responsible
    for calling ``splash.showMessage("...")`` as work progresses and
    ``splash.finish(main_window)`` once the main window is visible.
    """
    i18n = get_i18n()
    splash = QSplashScreen(_build_pixmap(i18n), Qt.WindowStaysOnTopHint)
    splash.setWindowFlag(Qt.FramelessWindowHint, True)
    splash.show()
    QApplication.processEvents()
    splash.showMessage(i18n.tr("loading"), Qt.AlignBottom | Qt.AlignHCenter, QColor("#7f849c"))
    QApplication.processEvents()
    return splash
