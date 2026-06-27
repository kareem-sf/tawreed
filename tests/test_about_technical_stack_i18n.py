"""Test that the About page uses i18n for all strings."""


def test_i18n_keys_exist():
    """Test that the new i18n keys exist in both English and Arabic."""
    from core.i18n import TRANSLATIONS

    # Check English translations
    en_translations = TRANSLATIONS["en"]
    assert "about_python_version" in en_translations
    assert en_translations["about_python_version"] == "Python 3.10+"
    assert "about_data_stack" in en_translations
    assert en_translations["about_data_stack"] == "openpyxl · pandas · SQLite"
    assert "about_packaging_type" in en_translations
    assert en_translations["about_packaging_type"] == "PyInstaller (onedir)"
    assert "about_ui_framework_value" in en_translations
    assert en_translations["about_ui_framework_value"] == "PySide6 (Qt for Python)"

    # Check Arabic translations
    ar_translations = TRANSLATIONS["ar"]
    assert "about_python_version" in ar_translations
    assert ar_translations["about_python_version"] == "Python 3.10+"
    assert "about_data_stack" in ar_translations
    assert ar_translations["about_data_stack"] == "openpyxl · pandas · SQLite"
    assert "about_packaging_type" in ar_translations
    assert ar_translations["about_packaging_type"] == "PyInstaller (onedir)"
    assert "about_ui_framework_value" in ar_translations
    assert ar_translations["about_ui_framework_value"] == "PySide6 (Qt for Python)"


def test_about_page_code_uses_i18n():
    """Test that the About page code contains i18n calls for technical stack strings."""
    # Read the about_page.py file and check that it uses i18n for the technical stack
    with open("gui/pages/about_page.py", encoding="utf-8") as f:
        content = f.read()

    # Check that the hard-coded strings are no longer present
    assert '"Python 3.10+"' not in content
    assert '"openpyxl · pandas · SQLite"' not in content
    assert '"PyInstaller (onedir)"' not in content
    assert '"PySide6 (Qt for Python)"' not in content

    # Check that the i18n calls are present
    assert "about_python_version" in content
    assert "about_data_stack" in content
    assert "about_packaging_type" in content
    assert "about_ui_framework_value" in content
