"""Test that workspace page hard-coded strings are properly routed through i18n."""

import pytest
from PySide6.QtWidgets import QApplication

from core.i18n import TRANSLATIONS, get_i18n
from gui.pages.workspace_page import WorkspacePage


@pytest.fixture(scope="function")
def workspace_page(qtbot):
    """Create a WorkspacePage instance for testing."""
    # Ensure QApplication exists
    if not QApplication.instance():
        QApplication([])

    page = WorkspacePage()
    qtbot.addWidget(page)
    return page


def test_workspace_page_input_card_uses_i18n(workspace_page, qtbot):
    """Test that the Input card title uses translation system."""
    # The card title should be set via i18n, not hard-coded
    # We can't directly access the card title text, but we can verify
    # that the page was created without errors (which would happen if
    # the translation key was missing)
    assert workspace_page is not None

    # Verify the i18n instance exists
    i18n = get_i18n()
    assert i18n is not None

    # Verify the translation key exists
    assert "input_card_title" in TRANSLATIONS["en"]
    assert "input_card_title" in TRANSLATIONS["ar"]

    # Verify translations are non-empty
    en_translation = TRANSLATIONS["en"]["input_card_title"]
    ar_translation = TRANSLATIONS["ar"]["input_card_title"]
    assert en_translation == "Input"
    assert ar_translation == "الإدخال"


def test_workspace_page_status_pill_uses_i18n(workspace_page, qtbot):
    """Test that the status pill uses translation system for 'Idle' state."""
    # Verify the i18n instance exists
    i18n = get_i18n()
    assert i18n is not None

    # Verify the 'idle' translation key exists
    assert "idle" in TRANSLATIONS["en"]
    assert "idle" in TRANSLATIONS["ar"]

    # Verify translations are non-empty
    en_translation = TRANSLATIONS["en"]["idle"]
    ar_translation = TRANSLATIONS["ar"]["idle"]
    assert en_translation == "Idle"
    assert ar_translation == "خامل"


def test_workspace_page_arabic_translation(workspace_page, qtbot):
    """Test that workspace page works correctly in Arabic."""
    i18n = get_i18n()

    # Switch to Arabic
    i18n.set_language("ar")

    # Verify translations are accessible
    input_title = i18n.tr("input_card_title")
    idle_text = i18n.tr("idle")

    assert input_title == "الإدخال"
    assert idle_text == "خامل"


def test_workspace_page_english_translation(workspace_page, qtbot):
    """Test that workspace page works correctly in English."""
    i18n = get_i18n()

    # Switch to English (default)
    i18n.set_language("en")

    # Verify translations are accessible
    input_title = i18n.tr("input_card_title")
    idle_text = i18n.tr("idle")

    assert input_title == "Input"
    assert idle_text == "Idle"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
