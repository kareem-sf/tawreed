"""Test Excel i18n functionality end-to-end."""

from __future__ import annotations

from openpyxl import Workbook

from core.excel import _should_warn_about_file_size, parse_excel
from core.i18n import get_i18n


def create_test_workbook(path) -> None:
    """Create a small valid BOQ workbook."""
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(["Nr.", "Item Description", "Unit", "Qty", "Rate", "Amount"])
    worksheet.append(["1", "Concrete work", "m3", 100, 50, "=D2*E2"])
    workbook.save(path)
    workbook.close()


def test_excel_large_file_warnings_with_i18n():
    i18n = get_i18n()
    i18n.set_language("en")

    warning = _should_warn_about_file_size(150 * 1024 * 1024, i18n)
    assert warning is not None
    assert "Very large file detected" in warning
    assert "150.0 MB" in warning

    warning = _should_warn_about_file_size(75 * 1024 * 1024, i18n)
    assert warning is not None
    assert "Large file detected" in warning
    assert "75.0 MB" in warning

    assert _should_warn_about_file_size(1 * 1024 * 1024, i18n) is None

    i18n.set_language("ar")
    warning = _should_warn_about_file_size(150 * 1024 * 1024, i18n)
    assert warning is not None
    assert "150.0" in warning
    assert any(ord(character) > 127 for character in warning)


def test_excel_large_file_warnings_without_i18n():
    warning = _should_warn_about_file_size(150 * 1024 * 1024, None)
    assert warning is not None
    assert "Very large file detected (150.0 MB)" in warning
    assert "Estimated processing time" in warning

    warning = _should_warn_about_file_size(75 * 1024 * 1024, None)
    assert warning is not None
    assert "Large file detected (75.0 MB)" in warning


def test_excel_progress_messages_with_i18n(tmp_path):
    input_path = tmp_path / "boq.xlsx"
    create_test_workbook(input_path)
    i18n = get_i18n()
    progress_messages: list[str] = []

    def capture_progress(_percentage, message, _metadata=None):
        progress_messages.append(message)

    i18n.set_language("en")
    parse_excel(input_path, i18n=i18n, progress_callback=capture_progress)
    expected = i18n.tr("completed_processing").format(sheet_title="Sheet")
    assert expected in progress_messages

    progress_messages.clear()
    i18n.set_language("ar")
    parse_excel(input_path, i18n=i18n, progress_callback=capture_progress)
    expected = i18n.tr("completed_processing").format(sheet_title="Sheet")
    assert expected in progress_messages


def test_excel_progress_messages_without_i18n(tmp_path):
    input_path = tmp_path / "boq.xlsx"
    create_test_workbook(input_path)
    progress_messages: list[str] = []

    def capture_progress(_percentage, message, _metadata=None):
        progress_messages.append(message)

    parse_excel(input_path, i18n=None, progress_callback=capture_progress)
    assert "Completed processing Sheet" in progress_messages
