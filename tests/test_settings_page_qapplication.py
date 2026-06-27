"""Test for the QApplication import fix in SettingsPage."""

import pytest
from PySide6.QtWidgets import QApplication


def test_settings_page_qapplication_import():
    """Test that QApplication is properly imported in SettingsPage."""
    # Import the module to check its namespace
    import gui.pages.settings_page as settings_module

    # Check that QApplication is available in the module namespace
    assert hasattr(settings_module, "QApplication"), \
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
        if "QApplication" in str(e):
            pytest.fail(f"QApplication import bug still exists: {e}")
        else:
            # Some other NameError - re-raise it
            raise
    # Note: _save_settings may succeed or return early due to validation,
    # but the important thing is that it doesn't fail with NameError


def test_settings_page_theme_change_qapplication():
    """Test that _on_theme_changed method can access QApplication."""
    # Create QApplication instance
    app = QApplication.instance() or QApplication([])

    from gui.pages.settings_page import SettingsPage
    page = SettingsPage()

    # This should not raise NameError
    try:
        page._on_theme_changed(1)  # Change to light theme
    except NameError as e:
        if "QApplication" in str(e):
            pytest.fail(f"QApplication import bug in _on_theme_changed: {e}")
        else:
            raise


def test_qapplication_in_top_level_imports():
    """Test that QApplication is imported at module level, not locally."""
    import gui.pages.settings_page as settings_module
    import inspect

    # Get the source code of the module
    source = inspect.getsource(settings_module)

    # Check that QApplication is in the top-level imports
    assert "from PySide6.QtWidgets import (\n    QApplication," in source, \
        "QApplication should be imported at module level"

    # Check that there are no local imports of QApplication in methods
    assert "from PySide6.QtWidgets import QApplication" not in source, \
        "QApplication should not be imported locally in methods"

    # Verify the specific methods don't have local imports
    save_settings_source = inspect.getsource(settings_module.SettingsPage._save_settings)
    theme_change_source = inspect.getsource(settings_module.SettingsPage._on_theme_changed)
    
    assert "from PySide6.QtWidgets import QApplication" not in save_settings_source, \
        "_save_settings should not have local QApplication import"
    assert "from PySide6.QtWidgets import QApplication" not in theme_change_source, \
        "_on_theme_changed should not have local QApplication import"
