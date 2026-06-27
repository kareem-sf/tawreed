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


def test_no_hardcoded_success_title():
    """Test that 'Success' string doesn't appear as hard-coded message box title in settings_page.py."""
    with open("gui/pages/settings_page.py", encoding="utf-8") as f:
        content = f.read()

    # Check for hard-coded "Success" in QMessageBox calls
    import re

    # Look for patterns like QMessageBox.information(..., "Success", ...)
    pattern = r'QMessageBox\.(information|warning|critical|question)\([^)]*"Success"[^)]*\)'
    matches = re.findall(pattern, content, re.DOTALL)

    assert len(matches) == 0, (
        f"settings_page.py should not contain hard-coded 'Success' message box titles. "
        f"Found {len(matches)} occurrences. Use self._i18n.tr('success_title') instead."
    )


def test_success_title_translation_exists():
    """Test that success_title translation key exists in both languages."""
    from core.i18n import get_i18n

    i18n = get_i18n()

    # Store original language to restore later
    original_lang = i18n._language

    try:
        # Test English
        i18n.set_language("en")
        english_title = i18n.tr("success_title")
        assert english_title == "Success", f"Expected 'Success', got '{english_title}'"

        # Test Arabic
        i18n.set_language("ar")
        arabic_title = i18n.tr("success_title")
        assert arabic_title == "نجاح", f"Expected 'نجاح', got '{arabic_title}'"
    finally:
        # Restore original language
        i18n.set_language(original_lang)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
