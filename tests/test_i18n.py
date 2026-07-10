"""Tests for core/i18n.py."""

from __future__ import annotations

import pytest

from core.i18n import SUPPORTED_LANGUAGES, TRANSLATIONS, I18n, detect_system_language, get_i18n


@pytest.fixture
def i18n_fresh():
    """Return a fresh I18n instance for each test (not the singleton)."""
    return I18n()


def test_supported_languages_includes_en_and_ar():
    assert "en" in SUPPORTED_LANGUAGES
    assert "ar" in SUPPORTED_LANGUAGES


def test_translations_have_same_keys_en_ar():
    """Both language dicts must have the exact same set of keys.
    A missing key in one language will silently fall through to
    the raw key, which is hard to spot in production — this test
    catches drift early."""
    en_keys = set(TRANSLATIONS["en"].keys())
    ar_keys = set(TRANSLATIONS["ar"].keys())
    assert en_keys == ar_keys, (
        f"EN/AR key sets differ. Only in EN: {en_keys - ar_keys}. Only in AR: {ar_keys - en_keys}."
    )


def test_tr_returns_english_by_default(i18n_fresh):
    assert i18n_fresh.tr("app_title") == "Tawreed"
    assert i18n_fresh.tr("process_button") == "Process BOQ"


def test_tr_returns_arabic_after_set_language(i18n_fresh):
    i18n_fresh.set_language("ar")
    assert i18n_fresh.tr("app_title") == "توريد"
    assert i18n_fresh.tr("process_button") == "معالجة جدول الكميات"


def test_excel_i18n_keys_exist():
    """Test that all Excel-related i18n keys exist and have translations."""
    excel_keys = [
        "excel_file_not_found",
        "cannot_read_excel",
        "excel_no_worksheets",
        "cannot_write_excel",
        "cannot_write_excel_permission",
        "large_file_detected",
        "very_large_file_detected",
        "starting_chunked_processing",
        "processed_rows",
        "completed_processing",
    ]

    for key in excel_keys:
        # Check English translations exist
        assert key in TRANSLATIONS["en"], f"Missing English translation for {key}"
        en_translation = TRANSLATIONS["en"][key]
        assert en_translation and isinstance(en_translation, str), (
            f"Empty or invalid English translation for {key}"
        )

        # Check Arabic translations exist
        assert key in TRANSLATIONS["ar"], f"Missing Arabic translation for {key}"
        ar_translation = TRANSLATIONS["ar"][key]
        assert ar_translation and isinstance(ar_translation, str), (
            f"Empty or invalid Arabic translation for {key}"
        )


def test_excel_i18n_formatting(i18n_fresh):
    """Test that Excel i18n keys can be properly formatted."""
    # Test English formatting
    assert "Excel file not found: test.xlsx" in i18n_fresh.tr("excel_file_not_found").format(
        file_path="test.xlsx"
    )
    assert "Cannot read 'test.xlsx': permission denied" in i18n_fresh.tr(
        "cannot_read_excel"
    ).format(file_name="test.xlsx", error="permission denied")
    assert "'test.xlsx' has no worksheets." == i18n_fresh.tr("excel_no_worksheets").format(
        file_name="test.xlsx"
    )

    # Test Arabic formatting
    i18n_fresh.set_language("ar")
    assert "ملف Excel غير موجود" in i18n_fresh.tr("excel_file_not_found").format(
        file_path="test.xlsx"
    )
    assert "تعذر قراءة" in i18n_fresh.tr("cannot_read_excel").format(
        file_name="test.xlsx", error="permission denied"
    )
    assert "لا يحتوي على أي أوراق عمل" in i18n_fresh.tr("excel_no_worksheets").format(
        file_name="test.xlsx"
    )


def test_excel_large_file_i18n_formatting(i18n_fresh):
    """Test that large file detection messages can be properly formatted."""
    # Test English formatting
    large_msg = i18n_fresh.tr("large_file_detected").format(file_size=10.5, estimated_time=5.2)
    assert "Large file detected (10.5 MB)" in large_msg
    assert "Estimated processing time: 5.2 seconds" in large_msg

    very_large_msg = i18n_fresh.tr("very_large_file_detected").format(
        file_size=50.3, estimated_time=12.8
    )
    assert "Very large file detected (50.3 MB)" in very_large_msg
    assert "Processing will continue but may take significant time" in very_large_msg

    # Test Arabic formatting
    i18n_fresh.set_language("ar")
    ar_large_msg = i18n_fresh.tr("large_file_detected").format(file_size=10.5, estimated_time=5.2)
    assert "تم اكتشاف ملف كبير" in ar_large_msg
    assert "10.5 ميجابايت" in ar_large_msg

    ar_very_large_msg = i18n_fresh.tr("very_large_file_detected").format(
        file_size=50.3, estimated_time=12.8
    )
    assert "تم اكتشاف ملف كبير جدًا" in ar_very_large_msg
    assert "ستستمر المعالجة ولكن قد تستغرق وقتًا كبيرًا" in ar_very_large_msg


def test_excel_progress_i18n_formatting(i18n_fresh):
    """Test that progress messages can be properly formatted."""
    # Test English formatting
    start_msg = i18n_fresh.tr("starting_chunked_processing").format(sheet_title="Sheet1")
    assert "Starting chunked processing of Sheet1" == start_msg

    processed_msg = i18n_fresh.tr("processed_rows").format(processed_rows=100)
    assert "Processed 100 rows" == processed_msg

    completed_msg = i18n_fresh.tr("completed_processing").format(sheet_title="Sheet1")
    assert "Completed processing Sheet1" == completed_msg

    # Test Arabic formatting
    i18n_fresh.set_language("ar")
    ar_start_msg = i18n_fresh.tr("starting_chunked_processing").format(sheet_title="ورقة1")
    assert "بدء المعالجة المجزأة لورقة ورقة1" == ar_start_msg

    ar_processed_msg = i18n_fresh.tr("processed_rows").format(processed_rows=100)
    assert "تم معالجة 100 صفًا" == ar_processed_msg

    ar_completed_msg = i18n_fresh.tr("completed_processing").format(sheet_title="ورقة1")
    assert "تمت معالجة ورقة ورقة1" == ar_completed_msg


def test_set_language_same_value_no_signal(i18n_fresh):
    """Re-setting the same language should not emit a signal
    (would force a needless retranslate of every page)."""
    received: list[str] = []
    i18n_fresh.language_changed.connect(received.append)
    i18n_fresh.set_language("en")  # already en
    assert received == []
    i18n_fresh.set_language("ar")
    assert received == ["ar"]
    i18n_fresh.set_language("ar")  # same again
    assert received == ["ar"]


def test_tr_returns_input_key_for_untranslated(i18n_fresh):
    """If a key is missing in the active language's dict, return
    the key itself (not None, not empty string) so the developer
    notices the gap in QA."""
    assert i18n_fresh.tr("nonexistent_string_xyz") == "nonexistent_string_xyz"


def test_is_rtl_property(i18n_fresh):
    i18n_fresh.set_language("en")
    assert i18n_fresh.is_rtl() is False
    i18n_fresh.set_language("ar")
    assert i18n_fresh.is_rtl() is True


def test_get_i18n_returns_singleton():
    a = get_i18n()
    b = get_i18n()
    assert a is b


def test_detect_system_language_returns_supported():
    """detect_system_language must always return a code in
    SUPPORTED_LANGUAGES (or "en" as fallback)."""
    lang = detect_system_language()
    assert lang in SUPPORTED_LANGUAGES


def test_arabic_translations_are_non_empty():
    """Sanity check: a few hand-picked Arabic strings are
    non-empty and contain Arabic characters. This catches
    accidental deletion of the Arabic half during a merge."""
    for key in ("app_title", "process_button", "ready", "error"):
        value = TRANSLATIONS["ar"][key]
        assert value.strip(), f"{key} is empty in AR"
        # Arabic Unicode block is U+0600..U+06FF
        assert any("\u0600" <= c <= "\u06ff" for c in value), (
            f"{key}={value!r} has no Arabic characters"
        )
