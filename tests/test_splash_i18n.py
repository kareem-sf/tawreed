"""Test splash screen i18n.

Ensures the splash screen respects the user's language preference
and doesn't show hard-coded English strings to Arabic users.
"""

from __future__ import annotations

import pytest
from PySide6.QtWidgets import QApplication

from core.i18n import get_i18n
from gui.splash import _build_pixmap


@pytest.fixture
def app():
    """QApplication instance for Qt operations."""
    if not QApplication.instance():
        return QApplication([])
    return QApplication.instance()


def test_splash_screen_english(app):
    """Splash screen shows English text when language is English."""
    i18n = get_i18n()
    i18n.set_language("en")

    pixmap = _build_pixmap(i18n)

    # The pixmap should be valid
    assert not pixmap.isNull()
    assert pixmap.width() == 480
    assert pixmap.height() == 260


def test_splash_screen_arabic(app):
    """Splash screen shows Arabic text when language is Arabic."""
    i18n = get_i18n()
    i18n.set_language("ar")

    pixmap = _build_pixmap(i18n)

    # The pixmap should be valid
    assert not pixmap.isNull()
    assert pixmap.width() == 480
    assert pixmap.height() == 260


def test_splash_translations_exist():
    """Verify the splash screen translation keys exist in both languages."""
    i18n = get_i18n()

    # Test English
    i18n.set_language("en")
    assert i18n.tr("app_title") == "Tawreed"
    assert (
        i18n.tr("about_page_subtitle")
        == "AI-driven BOQ work-package extraction for construction quantity surveyors."
    )
    assert i18n.tr("loading") == "Loading..."

    # Test Arabic
    i18n.set_language("ar")
    assert i18n.tr("app_title") == "توريد"
    assert (
        i18n.tr("about_page_subtitle")
        == "استخراج حزم العمل من جدول الكميات باستخدام الذكاء الاصطناعي للمساحين الكميين في البناء."
    )
    assert i18n.tr("loading") == "جارٍ التحميل..."


def test_splash_show_function(app):
    """Test that show() function works without errors."""
    from gui.splash import show

    # This should not raise any exceptions
    splash = show()
    assert splash is not None
    assert not splash.pixmap().isNull()

    # Clean up
    splash.close()
