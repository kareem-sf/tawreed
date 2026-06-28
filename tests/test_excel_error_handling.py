"""Tests for enhanced Excel error handling."""

import os
import tempfile

import pytest

from core.excel import parse_excel
from core.i18n import get_i18n


def test_excel_corrupt_file_error_message():
    """Test that corrupt Excel files produce helpful error messages."""
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
        corrupt_file = f.name

    try:
        # Create a corrupt file by writing invalid data
        with open(corrupt_file, "wb") as f:
            f.write(b"This is not a valid Excel file")

        # Test without i18n
        with pytest.raises(ValueError) as exc_info:
            parse_excel(corrupt_file)

        error_msg = str(exc_info.value)
        assert "corrupt or incomplete" in error_msg
        assert "re-exporting it from Excel" in error_msg

        # Test with i18n (English)
        i18n = get_i18n()
        i18n.set_language("en")

        with pytest.raises(ValueError) as exc_info:
            parse_excel(corrupt_file, i18n=i18n)

        error_msg = str(exc_info.value)
        assert "corrupt or incomplete" in error_msg
        assert "re-exporting it from Excel" in error_msg

        # Test with i18n (Arabic)
        i18n.set_language("ar")

        with pytest.raises(ValueError) as exc_info:
            parse_excel(corrupt_file, i18n=i18n)

        error_msg = str(exc_info.value)
        assert "تالف أو غير مكتمل" in error_msg
        assert "إعادة تصديره من Excel" in error_msg

    finally:
        if os.path.exists(corrupt_file):
            os.unlink(corrupt_file)


def test_excel_old_format_error_message():
    """Test that .xls files produce helpful error messages."""
    with tempfile.NamedTemporaryFile(suffix=".xls", delete=False) as f:
        old_format_file = f.name

    try:
        # Create a fake .xls file
        with open(old_format_file, "wb") as f:
            f.write(b"Fake XLS content")

        # Test without i18n
        with pytest.raises(ValueError) as exc_info:
            parse_excel(old_format_file)

        error_msg = str(exc_info.value)
        assert "older .xls format" in error_msg
        assert "only supports .xlsx files" in error_msg

        # Test with i18n (English)
        i18n = get_i18n()
        i18n.set_language("en")

        with pytest.raises(ValueError) as exc_info:
            parse_excel(old_format_file, i18n=i18n)

        error_msg = str(exc_info.value)
        assert "older .xls format" in error_msg
        assert "only supports .xlsx files" in error_msg

        # Test with i18n (Arabic)
        i18n.set_language("ar")

        with pytest.raises(ValueError) as exc_info:
            parse_excel(old_format_file, i18n=i18n)

        error_msg = str(exc_info.value)
        assert "تنسيق .xls القديم" in error_msg
        assert "يدعم توريد ملفات .xlsx فقط" in error_msg

    finally:
        if os.path.exists(old_format_file):
            os.unlink(old_format_file)


def test_excel_invalid_format_error_message():
    """Test that invalid Excel files produce helpful error messages."""
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
        invalid_file = f.name

    try:
        # Create a file that looks like Excel but isn't valid
        # We'll create a minimal invalid Excel by writing a corrupt zip
        with open(invalid_file, "wb") as f:
            f.write(b"PK\x03\x04" + b"invalid_excel_content" * 100)

        # Test without i18n
        with pytest.raises(ValueError) as exc_info:
            parse_excel(invalid_file)

        error_msg = str(exc_info.value)
        # This should trigger the BadZipFile path, so we expect the corrupt file message
        assert "corrupt or incomplete" in error_msg
        assert "re-exporting it from Excel" in error_msg

        # Test with i18n (English)
        i18n = get_i18n()
        i18n.set_language("en")

        with pytest.raises(ValueError) as exc_info:
            parse_excel(invalid_file, i18n=i18n)

        error_msg = str(exc_info.value)
        # This should trigger the BadZipFile path, so we expect the corrupt file message
        assert "corrupt or incomplete" in error_msg
        assert "re-exporting it from Excel" in error_msg

        # Test with i18n (Arabic)
        i18n.set_language("ar")

        with pytest.raises(ValueError) as exc_info:
            parse_excel(invalid_file, i18n=i18n)

        error_msg = str(exc_info.value)
        # This should trigger the BadZipFile path, so we expect the corrupt file message in Arabic
        assert "تالف أو غير مكتمل" in error_msg
        assert "إعادة تصديره من Excel" in error_msg

    finally:
        try:
            if os.path.exists(invalid_file):
                # Close any open handles first
                import time

                time.sleep(0.1)  # Give time for file handles to close
                os.unlink(invalid_file)
        except Exception:
            pass  # Best effort cleanup


def test_excel_error_messages_use_i18n():
    """Test that Excel error messages properly use i18n translations."""
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
        corrupt_file = f.name

    try:
        # Create a corrupt file
        with open(corrupt_file, "wb") as f:
            f.write(b"This is not a valid Excel file")

        # Test that i18n is used when provided
        i18n = get_i18n()

        # Mock the tr method to track calls
        original_tr = i18n.tr
        tr_calls = []

        def mock_tr(key):
            tr_calls.append(key)
            return original_tr(key)

        i18n.tr = mock_tr

        try:
            parse_excel(corrupt_file, i18n=i18n)
        except ValueError:
            pass  # Expected

        # Should have called i18n.tr for the error message
        assert any("excel_corrupt_file" in call for call in tr_calls)

    finally:
        if os.path.exists(corrupt_file):
            os.unlink(corrupt_file)
