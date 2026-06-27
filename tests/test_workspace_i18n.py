"""Test workspace page i18n routing."""

from __future__ import annotations

import pytest

from core.i18n import get_i18n
from gui.pages.workspace_page import WorkspacePage


@pytest.fixture
def workspace_page(qtbot):
    """Create a WorkspacePage for testing."""
    page = WorkspacePage()
    qtbot.addWidget(page)
    return page


def test_workspace_buttons_use_i18n(workspace_page):
    """Verify that workspace buttons use i18n translations."""
    i18n = get_i18n()

    # Check initial English translations
    assert workspace_page.browse_btn.text() == i18n.tr("select_file")
    assert workspace_page.clear_btn.text() == i18n.tr("clear")
    assert workspace_page.process_btn.text() == "▶  " + i18n.tr("process_button")
    assert workspace_page.open_output_btn.text() == i18n.tr("open_output")
    assert workspace_page.open_folder_btn.text() == i18n.tr("show_in_folder")
    assert workspace_page.clear_console_btn.text() == i18n.tr("clear_log")
    assert workspace_page.console_status.text() == i18n.tr("awaiting_input")


def test_workspace_retranslate_on_language_change(workspace_page, qtbot):
    """Verify that workspace page re-translates when language changes."""
    i18n = get_i18n()

    # Store initial English texts
    initial_browse = workspace_page.browse_btn.text()
    initial_clear = workspace_page.clear_btn.text()

    # Change to Arabic
    with qtbot.waitSignal(i18n.language_changed):
        i18n.set_language("ar")

    # Manually call retranslate_ui since we're testing in isolation
    workspace_page.retranslate_ui()

    # Verify Arabic translations are applied
    assert workspace_page.browse_btn.text() == i18n.tr("select_file")
    assert workspace_page.clear_btn.text() == i18n.tr("clear")
    assert workspace_page.process_btn.text() == "▶  " + i18n.tr("process_button")
    assert workspace_page.open_output_btn.text() == i18n.tr("open_output")
    assert workspace_page.open_folder_btn.text() == i18n.tr("show_in_folder")
    assert workspace_page.clear_console_btn.text() == i18n.tr("clear_log")
    assert workspace_page.console_status.text() == i18n.tr("awaiting_input")

    # Verify texts actually changed
    assert workspace_page.browse_btn.text() != initial_browse
    assert workspace_page.clear_btn.text() != initial_clear

    # Change back to English
    with qtbot.waitSignal(i18n.language_changed):
        i18n.set_language("en")

    # Manually call retranslate_ui again
    workspace_page.retranslate_ui()

    # Verify English translations are restored
    assert workspace_page.browse_btn.text() == initial_browse
    assert workspace_page.clear_btn.text() == initial_clear


def test_workspace_i18n_keys_exist():
    """Verify all workspace i18n keys exist in both languages."""
    i18n = get_i18n()

    keys = [
        "select_file",
        "clear",
        "process_button",
        "open_output",
        "show_in_folder",
        "clear_log",
        "awaiting_input",
    ]

    # Test English
    i18n.set_language("en")
    for key in keys:
        assert i18n.tr(key) != key, f"Missing English translation for key: {key}"

    # Test Arabic
    i18n.set_language("ar")
    for key in keys:
        assert i18n.tr(key) != key, f"Missing Arabic translation for key: {key}"


def test_workspace_file_label_i18n(workspace_page):
    """Test that file label uses i18n for 'No file selected'."""
    i18n = get_i18n()

    # Set English explicitly for this test
    i18n.set_language("en")
    workspace_page.retranslate_ui()

    # Initial state should show translated "No file selected" in English
    assert workspace_page.file_label.text() == i18n.tr("no_file_selected")
    assert workspace_page.file_label.text() == "No file selected"

    # Change language and verify it updates
    i18n.set_language("ar")
    workspace_page.retranslate_ui()

    # Clear selection to trigger the i18n text
    workspace_page._clear_selection()
    assert workspace_page.file_label.text() == i18n.tr("no_file_selected")
    assert workspace_page.file_label.text() == "لم يتم اختيار أي ملف"  # Arabic translation
