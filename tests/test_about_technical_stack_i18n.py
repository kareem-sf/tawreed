"""Test that the About page uses i18n for all strings."""


def test_i18n_keys_exist():
    """Test that the new i18n keys exist in both English and Arabic."""
    from core.i18n import TRANSLATIONS

    # Check English translations
    en_translations = TRANSLATIONS["en"]
    assert "about_language_value" in en_translations
    assert en_translations["about_language_value"] == "Python 3.10+"
    assert "about_ui_framework_value" in en_translations
    assert en_translations["about_ui_framework_value"] == "PySide6 (Qt for Python)"
    assert "about_llm_providers_value" in en_translations
    assert en_translations["about_llm_providers_value"] == "openpyxl · pandas · SQLite"
    assert "about_packaging_value" in en_translations
    assert en_translations["about_packaging_value"] == "PyInstaller (onedir)"
    assert "about_footer_format" in en_translations
    assert "©" in en_translations["about_footer_format"]

    # Check Arabic translations
    ar_translations = TRANSLATIONS["ar"]
    assert "about_language_value" in ar_translations
    assert ar_translations["about_language_value"] == "Python 3.10+"
    assert "about_ui_framework_value" in ar_translations
    assert ar_translations["about_ui_framework_value"] == "PySide6 (Qt for Python)"
    assert "about_llm_providers_value" in ar_translations
    assert ar_translations["about_llm_providers_value"] == "openpyxl · pandas · SQLite"
    assert "about_packaging_value" in ar_translations
    assert ar_translations["about_packaging_value"] == "PyInstaller (onedir)"
    assert "about_footer_format" in ar_translations
    assert "©" in ar_translations["about_footer_format"]


def test_about_page_code_uses_i18n():
    """The minimal About page uses translated product/privacy copy."""
    with open("gui/pages/about_page.py", encoding="utf-8") as f:
        content = f.read()

    # Check that the hard-coded strings are no longer present
    assert '"Python 3.10+"' not in content
    assert '"openpyxl · pandas · SQLite"' not in content
    assert '"PyInstaller (onedir)"' not in content
    assert '"PySide6 (Qt for Python)"' not in content
    assert '"©"' not in content or "about_footer_format" in content

    assert "about_product_heading" in content
    assert "about_product_text" in content
    assert "about_privacy_heading" in content
    assert "about_privacy_text" in content
