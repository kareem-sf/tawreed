"""Read a BOQ file into pages: one per spreadsheet sheet, PDF page or image frame.

A sheet keeps its cell values at their Excel positions. A PDF page keeps its text as lines of words with positions,
so a table can be split into columns. A page without a text layer (a scan) is marked, and read later from its image.
Reading never changes the file."""

import codecs
import csv
import io
import math
import threading
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_raw
import python_calamine as calamine
from PIL import Image, ImageSequence

from tawreed.sources.arabic import Char, lines_from_chars, reading_text

PDFIUM = threading.Lock()  # PDFium is not thread-safe
SCAN_CHARACTERS = 20  # a page with fewer visible characters than this is treated as a scan
IMAGE_WIDTH = 1400  # pixels, for page images shown to the engineer and to the AI


class Unreadable(Exception):
    """A file Tawreed can't read, with a stable code the interface translates."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass
class Page:
    number: int  # from 1, in file order
    kind: str  # "sheet" | "page" | "image"
    name: str  # the sheet's name; empty for PDF pages and images
    has_text: bool
    content: dict[str, Any] = field(default_factory=dict)
    rows: int | None = None
    cols: int | None = None
    width: float | None = None
    height: float | None = None


def read_file(path: Path, kind: str) -> list[Page]:
    if kind == "spreadsheet":
        return _spreadsheet(path)
    if kind == "csv":
        return _csv(path)
    if kind == "pdf":
        return _pdf(path)
    return _image(path)


# Spreadsheets -------------------------------------------------------------------------------------------------


def _spreadsheet(path: Path) -> list[Page]:
    try:
        workbook = calamine.CalamineWorkbook.from_path(str(path))
    except Exception as error:  # noqa: BLE001  (calamine raises its own error types for every kind of damage)
        text = str(error).lower()
        raise Unreadable("password_protected" if "password" in text or "encrypt" in text else "damaged_file") from error
    try:
        pages = []
        for meta in workbook.sheets_metadata:
            if meta.typ != calamine.SheetTypeEnum.WorkSheet:
                continue  # chart sheets and dialog sheets hold no cells
            sheet = workbook.get_sheet_by_name(meta.name)
            rows = _trim([[_cell(v) for v in row] for row in sheet.to_python(skip_empty_area=False)])
            if not rows:
                continue
            merged = [[a[0] + 1, a[1] + 1, b[0] + 1, b[1] + 1] for a, b in (sheet.merged_cell_ranges or [])]
            hidden = meta.visible != calamine.SheetVisibleEnum.Visible
            content = {"kind": "sheet", "name": meta.name, "rows": rows, "merged": merged, "hidden": hidden}
            width = max(len(r) for r in rows)
            pages.append(Page(len(pages) + 1, "sheet", meta.name, True, content, rows=len(rows), cols=width))
        return pages
    finally:
        workbook.close()


def _cell(value: Any) -> Any:
    """A value JSON can hold: numbers stay numbers (whole ones as integers), dates become ISO text."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return int(value) if value.is_integer() and abs(value) < 1e15 else value
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    if isinstance(value, timedelta):
        return str(value)
    if isinstance(value, str):
        return value if value.strip() else None
    return value


def _trim(rows: list[list[Any]]) -> list[list[Any]]:
    """Drop trailing empty cells in each row and trailing empty rows; positions of everything else stay."""
    trimmed = []
    for row in rows:
        end = len(row)
        while end and row[end - 1] is None:
            end -= 1
        trimmed.append(row[:end])
    while trimmed and not trimmed[-1]:
        trimmed.pop()
    return trimmed


# CSV ----------------------------------------------------------------------------------------------------------


def _csv(path: Path) -> list[Page]:
    text = _decode(path.read_bytes())
    sample = text[:20000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = _trim([[_cell(v) for v in row] for row in csv.reader(io.StringIO(text), dialect)])
    if not rows:
        return []
    content = {"kind": "sheet", "name": path.stem, "rows": rows, "merged": [], "hidden": False}
    return [Page(1, "sheet", "", True, content, rows=len(rows), cols=max(len(r) for r in rows))]


def _decode(data: bytes) -> str:
    """UTF-8 (with or without a byte order mark), else the Arabic Windows code page, which Excel uses for Arabic
    CSV files on Arabic Windows."""
    if data.startswith(codecs.BOM_UTF16_LE) or data.startswith(codecs.BOM_UTF16_BE):
        return data.decode("utf-16")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1256", errors="replace")


# PDF ----------------------------------------------------------------------------------------------------------


def _pdf(path: Path) -> list[Page]:
    with PDFIUM:
        try:
            document = pdfium.PdfDocument(path)
        except pdfium.PdfiumError as error:
            raise Unreadable("password_protected" if "password" in str(error).lower() else "damaged_file") from error
        try:
            return [_pdf_page(document[index], index + 1) for index in range(len(document))]
        finally:
            document.close()


def _pdf_page(page: pdfium.PdfPage, number: int) -> Page:
    width, height = page.get_size()
    textpage = page.get_textpage()
    chars = []
    for index in range(textpage.count_chars()):
        code = pdfium_raw.FPDFText_GetUnicode(textpage.raw, index)
        if not code:
            continue
        left, bottom, right, top = textpage.get_charbox(index, loose=True)  # font boxes: one height per line
        chars.append(Char(_clean(chr(code)), left, bottom, right, top))
    visible = sum(1 for c in chars if not c.text.isspace())
    lines = []
    for words in lines_from_chars(chars):
        lines.append(
            {
                "top": round(height - max(w.top for w in words), 1),
                "bottom": round(height - min(w.bottom for w in words), 1),
                "text": reading_text(words),
                "words": [{"t": w.text, "x0": round(w.left, 1), "x1": round(w.right, 1)} for w in words],
            }
        )
    content = {"kind": "page", "lines": lines, "width": round(width, 1), "height": round(height, 1)}
    return Page(number, "page", "", visible >= SCAN_CHARACTERS, content, width=width, height=height)


def _clean(text: str) -> str:
    """Some PDFs give characters as UTF-16 halves: replace a half left on its own."""
    return text.encode("utf-16", "surrogatepass").decode("utf-16", "replace")


# Images -------------------------------------------------------------------------------------------------------


def _image(path: Path) -> list[Page]:
    try:
        with Image.open(path) as image:
            pages = []
            for frame in ImageSequence.Iterator(image):
                width, height = frame.size
                content = {"kind": "image", "width": width, "height": height}
                pages.append(Page(len(pages) + 1, "image", "", False, content, width=width, height=height))
            return pages
    except OSError as error:
        raise Unreadable("damaged_file") from error


# Page images --------------------------------------------------------------------------------------------------


def render(path: Path, kind: str, number: int) -> bytes:
    """A PNG of one PDF page or image frame, about IMAGE_WIDTH pixels wide."""
    if kind == "pdf":
        with PDFIUM:
            document = pdfium.PdfDocument(path)
            try:
                page = document[number - 1]
                image = page.render(scale=IMAGE_WIDTH / page.get_width()).to_pil()
            finally:
                document.close()
    else:
        with Image.open(path) as source:
            source.seek(number - 1)
            image = source.convert("RGB")
            if image.width > IMAGE_WIDTH * 1.5:
                image = image.resize((IMAGE_WIDTH, round(image.height * IMAGE_WIDTH / image.width)))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
