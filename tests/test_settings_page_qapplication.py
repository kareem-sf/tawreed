"""Test for the QApplication import fix in SettingsPage."""

import pytest
from PySide6.QtWidgets import QApplication


def test_settings_page_qapplication_import():
    """Test that QApplication is properly imported in SettingsPage."""
    # Import the module to check its namespace
    import gui.pages.settings_page as settings_module
    
    # Check that QApplication is available in the module namespace
    assert hasattr(settings_module, 'QApplication'), \
        "QApplication should be imported in settings_page module"
    
    # Create an instance to verify it works
    app = QApplication.instance() or QApplication([])
    from gui.pages.settings_page import SettingsPage
    page = SettingsPage()
    
    # Verify that the _save_settings method can access QApplication
    # (This would fail with NameError if QApplication wasn't imported)
    try:
        page._save_settings()
    except NameError as e:
        if 'QApplication' in str(e):
            pytest.fail(f"QApplication import bug still exists: {e}")
        else:
            # Some other NameError - re-raise it
            raise
    # Note: _save_settings may succeed or return early due to validation,
    # but the important thing is that it doesn't fail with NameError