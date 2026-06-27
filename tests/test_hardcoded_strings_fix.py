"""Test that hard-coded strings have been properly routed through i18n."""

import pytest
from PySide6.QtWidgets import QApplication

from core.i18n import get_i18n
from gui.main_window import MainWindow


@pytest.fixture(scope="function")
def app():
    """Fixture for QApplication."""
    if not QApplication.instance():
        app = QApplication([])
        yield app
        app.quit()
    else:
        yield QApplication.instance()


def test_main_window_title_uses_i18n(app):
    """Test that MainWindow title uses i18n instead of hard-coded string."""
    i18n = get_i18n()

    # Set language to English
    i18n.set_language("en")
    window = MainWindow()

    # Check that title contains the translated app_title
    title = window.windowTitle()
    assert "Tawreed" in title
    assert "AI BOQ Processing" not in title  # Should not contain hard-coded string
    assert i18n.tr("app_title") in title

    window.close()


def test_main_window_title_arabic(app):
    """Test that MainWindow title works correctly in Arabic."""
    i18n = get_i18n()

    # Store original language to restore later
    original_lang = i18n._language

    try:
        # Set language to Arabic
        i18n.set_language("ar")
        window = MainWindow()

        # Check that title contains the Arabic translated app_title
        title = window.windowTitle()
        assert "توريد" in title  # Arabic for "Tawreed"
        assert "AI BOQ Processing" not in title  # Should not contain hard-coded string

        window.close()
    finally:
        # Restore original language
        i18n.set_language(original_lang)


def test_no_hardcoded_ai_boq_processing():
    """Test that 'AI BOQ Processing' string doesn't appear in main_window.py."""
    with open("gui/main_window.py", encoding="utf-8") as f:
        content = f.read()

    # Should not contain the hard-coded string
    assert "AI BOQ Processing" not in content, (
        "main_window.py should not contain hard-coded 'AI BOQ Processing' string"
    )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
