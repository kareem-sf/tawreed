"""Test that reset clears the Claude provider key correctly."""

import json
import os
import tempfile
from unittest.mock import MagicMock, patch

from core import db
from core.reset import reset_all


def test_clear_all_api_keys_includes_claude():
    """Test that clear_all_api_keys includes 'Claude' provider."""
    # Mock keyring module
    with (
        patch("core.db._load_keyring") as mock_load_keyring,
        patch("core.db._keyring_is_usable") as mock_keyring_is_usable,
    ):
        # Setup mock keyring
        mock_keyring = MagicMock()
        mock_load_keyring.return_value = mock_keyring
        mock_keyring_is_usable.return_value = True

        # Mock the delete_password method to track calls
        deleted_providers = []

        def mock_delete_password(service, account):
            deleted_providers.append(account)
            return None

        mock_keyring.delete_password = mock_delete_password

        # Call the function
        db.clear_all_api_keys()

        # Verify Claude was included in the deletion attempts
        assert any("Claude" in provider for provider in deleted_providers), (
            f"Claude provider key should be cleared. Deleted providers: {deleted_providers}"
        )

        # Verify all expected providers were attempted (from registry)
        from core.ai import get_provider_names

        expected_providers = get_provider_names()
        for provider in expected_providers:
            account_key = db._keyring_account_key(provider)
            assert any(account_key in deleted for deleted in deleted_providers), (
                f"{provider} provider key should be cleared"
            )


def test_reset_all_clears_claude_key():
    """Test that reset_all() properly clears Claude keys."""
    # Create a temporary directory for testing
    with tempfile.TemporaryDirectory() as tmpdir:
        # Override TAWREED_DIR for testing
        original_tawreed_dir = db.TAWREED_DIR
        db.TAWREED_DIR = os.path.join(tmpdir, ".tawreed")

        try:
            # Mock keyring module
            with (
                patch("core.db._load_keyring") as mock_load_keyring,
                patch("core.db._keyring_is_usable") as mock_keyring_is_usable,
            ):
                # Setup mock keyring
                mock_keyring = MagicMock()
                mock_load_keyring.return_value = mock_keyring
                mock_keyring_is_usable.return_value = True

                # Mock the delete_password method to track calls
                deleted_providers = []

                def mock_delete_password(service, account):
                    deleted_providers.append(account)
                    return None

                mock_keyring.delete_password = mock_delete_password

                # Create necessary directories
                os.makedirs(db.TAWREED_DIR, exist_ok=True)
                os.makedirs(os.path.join(db.TAWREED_DIR, "db"), exist_ok=True)

                # Create a minimal config file
                config_path = os.path.join(db.TAWREED_DIR, "config.json")
                with open(config_path, "w") as f:
                    json.dump({"provider": "Claude", "model": "claude-3-opus-20240229"}, f)

                # Call reset_all
                reset_all()

                # Verify Claude was included in the deletion attempts
                assert any("Claude" in provider for provider in deleted_providers), (
                    f"Claude provider key should be cleared during reset. Deleted providers: {deleted_providers}"
                )

        finally:
            # Restore original TAWREED_DIR
            db.TAWREED_DIR = original_tawreed_dir


def test_provider_names_match_ai_module():
    """Test that clear_all_api_keys uses provider names from ai.py."""
    from core.ai import PROVIDERS, get_provider_names

    # Get provider names from ai.py
    ai_providers = set(PROVIDERS.keys())
    registry_providers = set(get_provider_names())

    # They should match exactly
    assert ai_providers == registry_providers, (
        f"Provider names mismatch: ai.py={ai_providers}, registry={registry_providers}"
    )

    # Most importantly, verify Claude is in both
    assert "Claude" in ai_providers, "Claude should be in ai.py PROVIDERS"
    assert "Claude" in registry_providers, "Claude should be in provider registry"

    # Test that clear_all_api_keys actually uses the registry
    with (
        patch("core.db._load_keyring") as mock_load_keyring,
        patch("core.db._keyring_is_usable") as mock_keyring_is_usable,
    ):
        # Setup mock keyring
        mock_keyring = MagicMock()
        mock_load_keyring.return_value = mock_keyring
        mock_keyring_is_usable.return_value = True

        # Mock the delete_password method to track calls
        deleted_providers = []

        def mock_delete_password(service, account):
            deleted_providers.append(account)
            return None

        mock_keyring.delete_password = mock_delete_password

        # Call the function
        db.clear_all_api_keys()

        # Verify all providers from registry were attempted
        for provider in registry_providers:
            account_key = db._keyring_account_key(provider)
            assert any(account_key in deleted for deleted in deleted_providers), (
                f"{provider} provider key should be cleared"
            )
