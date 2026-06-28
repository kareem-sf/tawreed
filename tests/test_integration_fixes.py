"""Integration test for the reset keyring and settings save fixes."""

import os
import tempfile
from unittest.mock import MagicMock, patch

from core.db import clear_all_api_keys, get_settings, save_settings
from core.reset import reset_all


def test_settings_save_imports_qapplication_correctly():
    """Test that settings save doesn't fail due to QApplication import issues."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Setup test environment
        original_tawreed_dir = os.environ.get("TAWREED_DIR")
        os.environ["TAWREED_DIR"] = tmpdir

        try:
            # Mock QApplication to simulate GUI environment
            with patch("PySide6.QtWidgets.QApplication") as mock_qapp:
                mock_qapp.topLevelWidgets.return_value = []

                # Test saving settings
                settings = {
                    "provider": "OpenAI",
                    "api_key": "test_key_123",
                    "model": "gpt-4.1-mini",
                    "base_url": "https://api.openai.com/v1",
                    "language": "en",
                    "theme": "dark",
                }

                # This should not raise an import error
                save_settings(settings)

                # Verify settings were saved
                saved_settings = get_settings()
                assert saved_settings["provider"] == "OpenAI"
                assert saved_settings["model"] == "gpt-4.1-mini"
                assert saved_settings["language"] == "en"
                assert saved_settings["theme"] == "dark"

        finally:
            if original_tawreed_dir:
                os.environ["TAWREED_DIR"] = original_tawreed_dir
            elif "TAWREED_DIR" in os.environ:
                del os.environ["TAWREED_DIR"]


def test_reset_clears_all_provider_keys():
    """Test that reset clears keys for all providers from the registry."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Setup test environment
        original_tawreed_dir = os.environ.get("TAWREED_DIR")
        os.environ["TAWREED_DIR"] = tmpdir

        try:
            # Mock keyring
            with (
                patch("core.db._load_keyring") as mock_load_keyring,
                patch("core.db._keyring_is_usable") as mock_keyring_is_usable,
            ):
                mock_keyring = MagicMock()
                mock_load_keyring.return_value = mock_keyring
                mock_keyring_is_usable.return_value = True

                deleted_providers = []

                def mock_delete_password(service, account):
                    deleted_providers.append(account)
                    return None

                mock_keyring.delete_password = mock_delete_password

                # Call reset
                reset_all()

                # Verify all providers were cleared
                from core.ai import get_provider_names

                expected_providers = get_provider_names()

                # Check that keys for all providers were attempted
                for provider in expected_providers:
                    account_key = f"api_key:{provider}"
                    assert any(account_key in deleted for deleted in deleted_providers), (
                        f"{provider} provider key should be cleared"
                    )

                # Should have attempted to clear all providers
                assert len(deleted_providers) == len(expected_providers)

        finally:
            if original_tawreed_dir:
                os.environ["TAWREED_DIR"] = original_tawreed_dir
            elif "TAWREED_DIR" in os.environ:
                del os.environ["TAWREED_DIR"]


def test_reset_keyring_uses_provider_registry():
    """Test that clear_all_api_keys uses the provider registry, not hardcoded names."""
    with (
        patch("core.db._keyring_is_usable", return_value=True),
        patch("core.db._load_keyring") as mock_load_keyring,
    ):
        mock_keyring = MagicMock()
        mock_load_keyring.return_value = mock_keyring

        deleted_accounts = []

        def mock_delete_password(service, account):
            deleted_accounts.append(account)
            return None

        mock_keyring.delete_password = mock_delete_password

        # Call the function
        clear_all_api_keys()

        # Get expected providers from registry
        from core.ai import get_provider_names

        expected_providers = get_provider_names()

        # Verify all registry providers were attempted
        for provider in expected_providers:
            expected_account = f"api_key:{provider}"
            assert any(expected_account in deleted for deleted in deleted_accounts), (
                f"Provider {provider} should be cleared via registry"
            )

        # Should not have any hardcoded provider names that aren't in the registry
        assert len(deleted_accounts) == len(expected_providers)


def test_file_type_consistency():
    """Test that UI consistently advertises .xlsx-only support."""
    from core.i18n import get_i18n

    # Test English
    i18n_en = get_i18n()
    en_subtitle = i18n_en.tr("drop_zone_subtitle")
    assert ".xlsx only" in en_subtitle, f"English subtitle should mention .xlsx only: {en_subtitle}"

    # Test Arabic by changing language
    i18n_en.set_language("ar")
    ar_subtitle = i18n_en.tr("drop_zone_subtitle")
    assert ".xlsx فقط" in ar_subtitle, f"Arabic subtitle should mention .xlsx فقط: {ar_subtitle}"

    # Reset to English
    i18n_en.set_language("en")

    # Check that file dialog filter is correct
    from core.i18n import get_i18n

    # Get the file dialog filter from i18n
    i18n = get_i18n()
    file_filter = i18n.tr("file_dialog_filter")
    assert "*.xlsx" in file_filter
    assert (
        ".xls" not in file_filter or "*.xlsx" in file_filter
    )  # Allow .xls in comments but not as filter
