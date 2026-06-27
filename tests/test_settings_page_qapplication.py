"""Test for the QApplication import fix in SettingsPage."""

import pytest
from PySide6.QtWidgets import QApplication


def test_settings_page_qapplication_import():
    """Test that QApplication is properly imported in SettingsPage methods."""
    # Import the module to check its namespace

    # The fix moved QApplication from local import to top-level import
    # But we've optimized it to use local imports only where needed
    # So we check that the methods can access QApplication when they need it

    # Create QApplication instance first (required for Qt widgets)
    # This is needed even if unused - Qt requires a QApplication instance to exist
    app = QApplication.instance() or QApplication([])  # noqa: F841

    # Create an instance to verify it works
    from gui.pages.settings_page import SettingsPage

    page = SettingsPage()

    # Verify that the _save_settings method can access QApplication
    # (This would fail with NameError if QApplication wasn't imported)
    try:
        page._save_settings()
    except NameError as e:
        if "QApplication" in str(e):
            pytest.fail(f"QApplication import bug still exists: {e}")
        else:
            # Some other NameError - re-raise it
            raise
    # Note: _save_settings may succeed or return early due to validation,
    # but the important thing is that it doesn't fail with NameError
