"""Test final hard-coded strings cleanup."""

import pytest
from PySide6.QtWidgets import QApplication

from core.i18n import get_i18n
from gui.widgets.chrome import PageHeader
from gui.worker import BOQProcessor, WorkerSignals


@pytest.fixture
def app():
    """QApplication fixture for Qt widgets."""
    if not QApplication.instance():
        return QApplication([])
    return QApplication.instance()


def test_i18n_keys_exist():
    """Test that all required i18n keys exist."""
    i18n = get_i18n()

    # Test English keys
    required_keys = [
        "app_tagline",
        "output_file_suffix",
        "default_project_name",
        "successfully_parsed",
        "api_key_missing_error",
        "sending_request",
        "ai_identified_project",
        "categorized_items",
        "generating_output",
    ]

    for key in required_keys:
        assert i18n.tr(key) != key, f"Missing translation for key: {key}"
        assert len(i18n.tr(key)) > 0, f"Empty translation for key: {key}"

    # Test Arabic keys
    i18n.set_language("ar")
    for key in required_keys:
        assert i18n.tr(key) != key, f"Missing Arabic translation for key: {key}"
        assert len(i18n.tr(key)) > 0, f"Empty Arabic translation for key: {key}"


def test_page_header_uses_i18n(app):
    """Test that PageHeader can be created with i18n keys."""
    i18n = get_i18n()

    # This should not raise any errors
    header = PageHeader(i18n.tr("workspace_page_title"), i18n.tr("workspace_page_subtitle"))

    assert header is not None
    assert header._title.text() == i18n.tr("workspace_page_title")


def test_worker_fallback_strings():
    """Test that worker uses i18n for fallback strings."""
    i18n = get_i18n()
    signals = WorkerSignals()

    # Test that the worker can be created without errors
    # We're not testing the full processing, just that the i18n fallback works
    processor = BOQProcessor("dummy.xlsx", signals, i18n)

    # Verify that the i18n object is properly set
    assert processor._i18n is not None
    assert processor._i18n == i18n


def test_output_file_suffix():
    """Test that output file suffix uses i18n."""
    i18n = get_i18n()

    # Test English suffix
    i18n.set_language("en")
    suffix = i18n.tr("output_file_suffix")
    assert suffix == "_Tawreed_Output"

    # Test Arabic suffix
    i18n.set_language("ar")
    suffix = i18n.tr("output_file_suffix")
    assert suffix == "_مخرج_توريد"


def test_no_hardcoded_strings_in_worker():
    """Test that worker.py doesn't contain hard-coded English strings."""
    import gui.worker

    source = gui.worker.__file__

    with open(source, encoding="utf-8") as f:
        content = f.read()

    # These should not appear as literal strings in the code
    # (they should be wrapped in i18n.tr() calls)
    hardcoded_strings = [
        "Tawreed Project",
        "Successfully parsed",
        "API Key is missing",
        "Sending request to AI Model",
        "AI identified project:",
        "Categorized",
        "Generating output workbook:",
        "_Tawreed_Output",
    ]

    for string in hardcoded_strings:
        # Check if the string appears as a literal (not in a comment or i18n call)
        lines = content.split("\n")
        for line in lines:
            if string in line and not line.strip().startswith("#"):
                # Make sure it's not in an i18n.tr() call
                if "i18n.tr(" not in line and "self._i18n.tr(" not in line:
                    # Allow these strings in fallback else clauses when i18n is None
                    if 'else f"' not in line and 'else "' not in line:
                        assert False, (
                            f"Found hard-coded string '{string}' in worker.py: {line.strip()}"
                        )


def test_no_hardcoded_strings_in_chrome():
    """Test that chrome.py doesn't contain hard-coded English strings."""
    import gui.widgets.chrome

    source = gui.widgets.chrome.__file__

    with open(source, encoding="utf-8") as f:
        content = f.read()

    # These should not appear as literal strings in docstring examples
    hardcoded_strings = [
        '"Workspace"',
        '"Run BOQ extraction against your data."',
    ]

    for string in hardcoded_strings:
        # Check if the string appears in docstrings
        if string in content:
            assert False, f"Found hard-coded string {string} in chrome.py docstring"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
