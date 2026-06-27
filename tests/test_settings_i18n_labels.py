"""Test for the new i18n keys added for settings form labels."""


def test_new_i18n_keys_exist():
    """Test that the new base_url_label and api_key_label keys exist in both languages."""
    from core.i18n import TRANSLATIONS

    # Check English translations
    en_translations = TRANSLATIONS["en"]
    assert "base_url_label" in en_translations, "base_url_label missing from English translations"
    assert "api_key_label" in en_translations, "api_key_label missing from English translations"
    assert en_translations["base_url_label"] == "Base URL"
    assert en_translations["api_key_label"] == "API Key"

    # Check Arabic translations
    ar_translations = TRANSLATIONS["ar"]
    assert "base_url_label" in ar_translations, "base_url_label missing from Arabic translations"
    assert "api_key_label" in ar_translations, "api_key_label missing from Arabic translations"
    assert ar_translations["base_url_label"] == "عنوان URL الأساسي"
    assert ar_translations["api_key_label"] == "مفتاح API"


def test_settings_page_uses_i18n_labels():
    """Test that SettingsPage uses i18n for form labels instead of hard-coded strings."""
    # Import and check the source code
    import inspect

    from gui.pages.settings_page import SettingsPage

    source = inspect.getsource(SettingsPage._build_ui)

    # Should NOT contain hard-coded English strings
    assert '"Base URL"' not in source, "SettingsPage still contains hard-coded 'Base URL' string"
    assert '"API Key"' not in source, "SettingsPage still contains hard-coded 'API Key' string"

    # Should contain i18n calls
    assert "base_url_label" in source, "SettingsPage should use i18n key 'base_url_label'"
    assert "api_key_label" in source, "SettingsPage should use i18n key 'api_key_label'"
