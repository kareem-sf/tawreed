"""Test that the reset functionality correctly clears all provider keys."""

from unittest.mock import MagicMock, patch

from core.ai import get_provider_names
from core.db import clear_all_api_keys


def test_clear_all_api_keys_uses_provider_registry():
    """Test that clear_all_api_keys iterates over actual provider names."""
    # Mock the keyring functions
    with (
        patch("core.db._keyring_is_usable", return_value=True),
        patch("core.db._load_keyring") as mock_load_keyring,
        patch("core.db._load_fallback_file"),
        patch("core.db._save_fallback_file"),
        patch("os.path.exists", return_value=False),
        patch("os.remove"),
    ):
        # Setup mocks
        mock_keyring = MagicMock()
        mock_load_keyring.return_value = mock_keyring

        # Get the actual provider names
        expected_providers = get_provider_names()

        # Call the function
        clear_all_api_keys()

        # Verify that delete_password was called for each provider
        assert mock_keyring.delete_password.call_count == len(expected_providers)

        # Verify the providers that were passed to delete_password
        actual_providers = []
        for call in mock_keyring.delete_password.call_args_list:
            args, kwargs = call
            provider_key = args[1]  # Second argument is the account key
            # Extract provider from "api_key:provider" format
            provider = provider_key.split(":", 1)[1]
            actual_providers.append(provider)

        # Should have called for all providers
        for provider in expected_providers:
            assert provider in actual_providers


def test_clear_all_api_keys_with_no_keyring():
    """Test that clear_all_api_keys works when keyring is not available."""
    with (
        patch("core.db._keyring_is_usable", return_value=False),
        patch("core.db._load_fallback_file") as mock_load_fallback,
        patch("core.db._save_fallback_file"),
        patch("os.path.exists", return_value=True),
        patch("os.remove"),
    ):
        # Setup mocks
        mock_load_fallback.return_value = {"api_key:OpenAI": "test_key"}

        # Call the function
        result = clear_all_api_keys()

        # Should have cleared the fallback file
        mock_load_fallback.assert_called_once()

        # Should return 1 for the fallback key cleared
        assert result == 1


def test_clear_all_api_keys_clears_fallback_file():
    """Test that clear_all_api_keys clears the fallback file."""

    # Mock the load fallback to return some keys
    def mock_load_fallback():
        return {"api_key:OpenAI": "key1", "api_key:Claude": "key2"}

    with (
        patch("core.db._keyring_is_usable", return_value=True),
        patch("core.db._load_keyring") as mock_load_keyring,
        patch("core.db._load_fallback_file", side_effect=mock_load_fallback),
        patch("core.db._save_fallback_file"),
        patch("os.path.exists", return_value=True),
        patch("os.remove"),
    ):
        # Setup mocks
        mock_keyring = MagicMock()
        mock_load_keyring.return_value = mock_keyring

        # Call the function
        result = clear_all_api_keys()

        # Should have cleared both keyring and fallback
        expected_providers = get_provider_names()
        assert mock_keyring.delete_password.call_count == len(expected_providers)

        # Result should be count of keyring deletions + fallback keys
        assert result == len(expected_providers) + 2
