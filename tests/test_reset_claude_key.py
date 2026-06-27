"""Test that reset clears the Claude provider key correctly."""

import os
import tempfile
import json
from unittest.mock import patch, MagicMock

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
        result = db.clear_all_api_keys()

        # Verify Claude was included in the deletion attempts
        claude_key = db._keyring_account_key("Claude")
        assert any(
            "Claude" in provider for provider in deleted_providers
        ), f"Claude provider key should be cleared. Deleted providers: {deleted_providers}"

        # Verify all expected providers were attempted
        expected_providers = ["OpenAI", "Claude", "Google", "OpenAI Compatible"]
        for provider in expected_providers:
            account_key = db._keyring_account_key(provider)
            assert any(
                account_key in deleted for deleted in deleted_providers
            ), f"{provider} provider key should be cleared"


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
                report = reset_all()

                # Verify Claude was included in the deletion attempts
                claude_key = db._keyring_account_key("Claude")
                assert any(
                    "Claude" in provider for provider in deleted_providers
                ), f"Claude provider key should be cleared during reset. Deleted providers: {deleted_providers}"

        finally:
            # Restore original TAWREED_DIR
            db.TAWREED_DIR = original_tawreed_dir


def test_provider_names_match_ai_module():
    """Test that provider names in db.py match those in ai.py."""
    from core.ai import PROVIDERS

    # Get provider names from ai.py
    ai_providers = set(PROVIDERS.keys())

    # Get provider names hardcoded in clear_all_api_keys
    # We need to extract them from the function
    import inspect

    source = inspect.getsource(db.clear_all_api_keys)

    # The providers are in a tuple in the for loop
    # Extract the line with the for loop
    for line in source.split("\n"):
        if "for provider in" in line and "OpenAI" in line:
            # Extract the tuple content
            start = line.find("(") + 1
            end = line.find(")")
            providers_tuple = line[start:end]
            # Split by commas and clean up quotes
            db_providers = [p.strip().strip("\"'") for p in providers_tuple.split(",")]
            break

    # Convert to set for comparison
    db_providers_set = set(db_providers)

    # Check that all providers in db.py are in ai.py
    missing_in_ai = db_providers_set - ai_providers
    assert not missing_in_ai, f"Providers in db.py but not in ai.py: {missing_in_ai}"

    # Check that all providers in ai.py are in db.py (except possibly some)
    # This is less strict as db.py might not need all providers
    print(f"Providers in ai.py: {ai_providers}")
    print(f"Providers in db.py clear_all_api_keys: {db_providers_set}")

    # Most importantly, verify Claude is in both
    assert "Claude" in ai_providers, "Claude should be in ai.py PROVIDERS"
    assert "Claude" in db_providers_set, "Claude should be in db.py clear_all_api_keys"
