"""Test that workspace page uses i18n for all strings."""

import pytest
from PySide6.QtWidgets import QApplication

from core.i18n import get_i18n
from gui.pages.workspace_page import WorkspacePage


@pytest.fixture(scope="function")
def app():
    """Fixture for QApplication."""
    if not QApplication.instance():
        app = QApplication([])
        yield app
        app.quit()
    else:
        yield QApplication.instance()


def test_workspace_page_uses_i18n(app):
    """Test that WorkspacePage uses i18n for all visible strings."""
    i18n = get_i18n()

    # Set language to English
    i18n.set_language("en")
    page = WorkspacePage()

    # Check that key strings use i18n translations
    assert page.drop_zone._title.text() == i18n.tr("drop_zone_title")
    assert page.drop_zone._subtitle.text() == i18n.tr("drop_zone_subtitle")
    assert page.file_label.text() == i18n.tr("no_file_selected")
    assert page.browse_btn.text() == i18n.tr("select_file")
    assert page.clear_btn.text() == i18n.tr("clear")
    assert page.process_btn.text() == i18n.tr("process_button_prefix") + i18n.tr("process_button")
    assert page.open_output_btn.text() == i18n.tr("open_output")
    assert page.open_folder_btn.text() == i18n.tr("show_in_folder")
    assert page.clear_console_btn.text() == i18n.tr("clear_log")
    assert page.console_status.text() == i18n.tr("awaiting_input")

    page.close()


def test_workspace_page_arabic(app):
    """Test that WorkspacePage works correctly in Arabic."""
    i18n = get_i18n()

    # Store original language to restore later
    original_lang = i18n._language

    try:
        # Set language to Arabic
        i18n.set_language("ar")
        page = WorkspacePage()

        # Check that key strings use Arabic translations
        assert page.drop_zone._title.text() == i18n.tr("drop_zone_title")
        assert page.drop_zone._subtitle.text() == i18n.tr("drop_zone_subtitle")
        assert page.file_label.text() == i18n.tr("no_file_selected")
        assert page.browse_btn.text() == i18n.tr("select_file")
        assert page.clear_btn.text() == i18n.tr("clear")
        assert page.open_output_btn.text() == i18n.tr("open_output")
        assert page.open_folder_btn.text() == i18n.tr("show_in_folder")

        page.close()
    finally:
        # Restore original language
        i18n.set_language(original_lang)


def test_no_hardcoded_strings_in_workspace():
    """Test that workspace_page.py doesn't contain hard-coded UI strings."""
    with open("gui/pages/workspace_page.py", encoding="utf-8") as f:
        content = f.read()

    # Should not contain these hard-coded strings in the actual UI code
    # (comments and docstrings are OK)
    assert 'QFileDialog.getOpenFileName(\n            self, "Select BOQ' not in content
    assert 'Card("Live Console")' not in content
    # The file label should use i18n, not hard-coded string
    assert 'QLabel("No file selected")' not in content.replace('"""', "").replace('"""', "")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
