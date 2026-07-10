"""Test the new i18n translation keys for Excel error messages."""

from core.i18n import get_i18n


def _raise_permission_error(*_args, **_kwargs):
    raise PermissionError("destination is locked")


def test_excel_error_translations():
    """Test that Excel error messages have proper translations."""
    i18n = get_i18n()

    # Test English translations
    i18n.set_language("en")
    assert i18n.tr("testing_connection_status") == "Testing connection…"
    assert i18n.tr("excel_file_not_found") == "Excel file not found: {file_path}"
    assert i18n.tr("cannot_read_excel") == "Cannot read '{file_name}': {error}"
    assert i18n.tr("excel_no_worksheets") == "'{file_name}' has no worksheets."
    assert i18n.tr("cannot_write_excel") == "Cannot write '{file_name}': {error}"

    # Test Arabic translations
    i18n.set_language("ar")
    assert i18n.tr("testing_connection_status") == "جارٍ اختبار الاتصال…"
    assert i18n.tr("excel_file_not_found") == "ملف Excel غير موجود: {file_path}"
    assert i18n.tr("cannot_read_excel") == "تعذر قراءة '{file_name}': {error}"
    assert i18n.tr("excel_no_worksheets") == "'{file_name}' لا يحتوي على أي أوراق عمل."
    assert i18n.tr("cannot_write_excel") == "تعذر كتابة '{file_name}': {error}"

    # Test formatting works correctly
    i18n.set_language("en")
    formatted = i18n.tr("excel_file_not_found").format(file_path="/path/to/file.xlsx")
    assert formatted == "Excel file not found: /path/to/file.xlsx"

    i18n.set_language("ar")
    formatted = i18n.tr("excel_file_not_found").format(file_path="/path/to/file.xlsx")
    assert formatted == "ملف Excel غير موجود: /path/to/file.xlsx"


def test_settings_page_status_translation():
    """Test that the settings page status message uses translation."""
    i18n = get_i18n()

    # Test English
    i18n.set_language("en")
    assert i18n.tr("testing_connection_status") == "Testing connection…"

    # Test Arabic
    i18n.set_language("ar")
    assert i18n.tr("testing_connection_status") == "جارٍ اختبار الاتصال…"


def test_fallback_behavior(monkeypatch):
    """Test that Excel functions work without i18n parameter (fallback mode)."""
    import os
    import tempfile

    from core.excel import parse_excel, write_excel

    # Test parse_excel fallback
    try:
        parse_excel("nonexistent_file.xlsx")  # Should raise FileNotFoundError
        assert False, "Should have raised FileNotFoundError"
    except FileNotFoundError as e:
        # Should have English fallback message
        assert "Excel file not found:" in str(e)

    # Patch the final atomic replace instead of relying on chmod semantics.
    # A CI runner may execute as root and can replace a read-only file.
    monkeypatch.setattr("core.excel.os.replace", _raise_permission_error)
    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = os.path.join(tmpdir, "readonly_file")

        try:
            # Try to write to the same location (should fail due to permission)
            write_excel(test_file, {}, {}, "Test", "2024-01-01")
            assert False, "Should have raised OSError"
        except (OSError, PermissionError) as e:
            # Should have English fallback message
            error_str = str(e)
            assert "Cannot write" in error_str or "Permission denied" in error_str


def test_i18n_parameter_usage(monkeypatch):
    """Test that Excel functions work with i18n parameter."""
    import os
    import tempfile

    from core.excel import parse_excel, write_excel
    from core.i18n import get_i18n

    i18n = get_i18n()
    monkeypatch.setattr("core.excel.os.replace", _raise_permission_error)

    # Test parse_excel with i18n - English
    i18n.set_language("en")
    try:
        parse_excel("nonexistent_file.xlsx", i18n=i18n)
        assert False, "Should have raised FileNotFoundError"
    except FileNotFoundError as e:
        assert "Excel file not found:" in str(e)

    # Test parse_excel with i18n - Arabic
    i18n.set_language("ar")
    try:
        parse_excel("nonexistent_file.xlsx", i18n=i18n)
        assert False, "Should have raised FileNotFoundError"
    except FileNotFoundError as e:
        assert "ملف Excel غير موجود:" in str(e)

    # Test write_excel with i18n - English
    i18n.set_language("en")
    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = os.path.join(tmpdir, "readonly_file.xlsx")

        try:
            write_excel(test_file, {}, {}, "Test", "2024-01-01", i18n=i18n)
            assert False, "Should have raised OSError"
        except (OSError, PermissionError) as e:
            error_str = str(e)
            assert (
                "Cannot write" in error_str
                or "Permission denied" in error_str
                or "تعذر كتابة" in error_str
            )

    # Test write_excel with i18n - Arabic
    i18n.set_language("ar")
    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = os.path.join(tmpdir, "readonly_file.xlsx")

        try:
            write_excel(test_file, {}, {}, "Test", "2024-01-01", i18n=i18n)
            assert False, "Should have raised OSError"
        except (OSError, PermissionError) as e:
            error_str = str(e)
            assert (
                "تعذر كتابة" in error_str
                or "Permission denied" in error_str
                or "Cannot write" in error_str
            )
