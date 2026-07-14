"""Tests for the framework-independent engine translations."""

from __future__ import annotations

import pytest

from core.i18n import SUPPORTED_LANGUAGES, TRANSLATIONS, I18n, detect_system_language, get_i18n


@pytest.fixture
def i18n_fresh():
    return I18n()


def test_translation_catalogs_have_identical_nonempty_keys():
    assert set(SUPPORTED_LANGUAGES) == {"en", "ar"}
    assert set(TRANSLATIONS["en"]) == set(TRANSLATIONS["ar"])
    assert all(value.strip() for catalog in TRANSLATIONS.values() for value in catalog.values())


def test_engine_copy_translates_between_english_and_arabic(i18n_fresh):
    assert i18n_fresh.tr("cover_title") == "Tawreed"
    assert i18n_fresh.tr("parsing_excel") == "Parsing Excel BOQ file..."

    i18n_fresh.set_language("ar")
    assert i18n_fresh.tr("cover_title") == "توريد"
    assert i18n_fresh.tr("parsing_excel") == "جارٍ تحليل ملف Excel لجدول الكميات..."


def test_excel_messages_preserve_format_parameters(i18n_fresh):
    english = i18n_fresh.tr("large_file_detected").format(
        file_size=10.5,
        estimated_time=5.2,
    )
    assert "10.5 MB" in english
    assert "5.2 seconds" in english

    i18n_fresh.set_language("ar")
    arabic = i18n_fresh.tr("large_file_detected").format(
        file_size=10.5,
        estimated_time=5.2,
    )
    assert "10.5 ميجابايت" in arabic
    assert "5.2 ثانية" in arabic


def test_language_change_signal_only_fires_for_real_changes(i18n_fresh):
    received: list[str] = []
    i18n_fresh.language_changed.connect(received.append)

    i18n_fresh.set_language("en")
    i18n_fresh.set_language("ar")
    i18n_fresh.set_language("ar")

    assert received == ["ar"]


def test_unknown_language_and_translation_fall_back_safely(i18n_fresh):
    i18n_fresh.set_language("not-supported")
    assert i18n_fresh.language == "en"
    assert i18n_fresh.tr("missing-key") == "missing-key"


def test_direction_singleton_and_system_detection(i18n_fresh):
    assert i18n_fresh.is_rtl() is False
    i18n_fresh.set_language("ar")
    assert i18n_fresh.is_rtl() is True
    assert get_i18n() is get_i18n()
    assert detect_system_language() in SUPPORTED_LANGUAGES
