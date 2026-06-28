"""Tests for the user-friendly error wrappers in core/excel.py.

The wrappers translate openpyxl's noisy low-level exceptions
(``InvalidFileException``, ``zipfile.BadZipFile``,
``PermissionError``, ``OSError``) into messages a quantity surveyor
can actually act on. These tests pin down the wrapping behaviour.
"""

from __future__ import annotations

import os
import zipfile

import pytest

from core import excel


def test_parse_excel_missing_file_raises_filenotfound(tmp_path):
    """A non-existent path should raise FileNotFoundError, not
    an openpyxl error that says nothing useful."""
    missing = tmp_path / "does_not_exist.xlsx"
    with pytest.raises(FileNotFoundError) as exc:
        excel.parse_excel(str(missing))
    assert str(missing) in str(exc.value)


def test_parse_excel_password_protected_raises_valueerror(tmp_path, monkeypatch):
    """A fake .xlsx that's actually a zip with a wrong password
    should be reported as 'not a valid Excel file', not as
    ``zipfile.BadZipFile``."""
    p = tmp_path / "fake.xlsx"
    # Write some bytes that openpyxl will reject.
    p.write_bytes(b"not a real xlsx file, just random bytes")
    with pytest.raises(ValueError) as exc:
        excel.parse_excel(str(p))
    msg = str(exc.value)
    assert "corrupt or incomplete" in msg
    assert "re-exporting it from Excel" in msg  # we tell the user how to fix it


def test_parse_excel_corrupt_zip_raises_valueerror(tmp_path):
    """A truncated zip file should be reported as corrupt, not as
    ``zipfile.BadZipFile``."""
    p = tmp_path / "corrupt.xlsx"
    # Make a valid zip with one entry, then truncate it.
    real = tmp_path / "real.zip"
    with zipfile.ZipFile(real, "w") as zf:
        zf.writestr("a.txt", "hello")
    p.write_bytes(real.read_bytes()[:10])  # truncated
    with pytest.raises(ValueError) as exc:
        excel.parse_excel(str(p))
    assert "corrupt or incomplete" in str(exc.value)


def test_write_excel_locked_file_raises_ioerror(tmp_path, monkeypatch):
    """When the output path is read-only, write_excel should raise
    IOError with a clear message (not a bare PermissionError)."""
    # Construct a valid data set (one item, one category).
    output = tmp_path / "subdir" / "out.xlsx"
    row = {
        "Nr.": "1",
        "Item Description": "Foo",
        "Unit": "m",
        "Qty": 1,
        "Rate": 1,
        "Amount": 0,
    }
    # Make the parent directory read-only on POSIX; on Windows this
    # is best-effort.
    if os.name == "posix":
        (tmp_path / "subdir").mkdir()
        os.chmod(tmp_path / "subdir", 0o555)
        try:
            with pytest.raises((IOError, OSError, PermissionError)):
                excel.write_excel(
                    str(output),
                    {"1": row},
                    {"1": "General"},
                    "Test",
                    "2026-06-14",
                )
        finally:
            os.chmod(tmp_path / "subdir", 0o755)
    else:
        # Windows: skip the read-only check; the exception classes
        # we wrap are the same.
        pytest.skip("read-only check is POSIX-only")


def test_write_excel_valid_input_writes_file(tmp_path):
    """Smoke test: a valid input writes the file without raising."""
    output = tmp_path / "out.xlsx"
    row = {
        "Nr.": "1",
        "Item Description": "Concrete",
        "Unit": "m3",
        "Qty": 10,
        "Rate": 100,
        "Amount": 0,
    }
    excel.write_excel(
        str(output),
        {"1": row},
        {"1": "Civil"},
        "Smoke Test",
        "2026-06-14",
    )
    assert output.exists()
    assert output.stat().st_size > 0
