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


def test_set_language_unknown_falls_silently(i18n_fresh):
    i18n_fresh.set_language("fr")  # not supported
    assert i18n_fresh.language == "en"  # unchanged
    i18n_fresh.set_language("xx")
    assert i18n_fresh.language == "en"


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
