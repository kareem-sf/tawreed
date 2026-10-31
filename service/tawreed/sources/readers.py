"""Read a BOQ file into pages: one per spreadsheet sheet, PDF page or image frame.

A sheet keeps its cell values at their Excel positions. A PDF page keeps its text as lines of words with positions,
so a table can be split into columns. A page without a text layer (a scan) is marked, and read later from its image.
Reading never changes the file. The service reads each file in a child process (`read_apart`), so a file that
makes a reader's native code abort, or asks for more memory than the computer has, fails on its own."""

import codecs
import csv
import io
import json
import logging
import math
import os
import re
import subprocess
import sys
import threading
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

import openpyxl
import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_raw
import python_calamine as calamine
from PIL import Image, ImageSequence

from tawreed.sources.arabic import Char, lines_from_chars, reading_text

PDFIUM = threading.Lock()  # PDFium is not thread-safe
SCAN_CHARACTERS = 20  # a page with fewer visible characters than this is treated as a scan
IMAGE_WIDTH = 1400  # pixels, for page images shown to the engineer and to the AI
READ_SECONDS = 600  # a file still being read after this is too big for Tawreed
PIXEL_BUDGET = 25_000_000  # pixels in a page image, however large the page is drawn
HEIGHT_MOST = 12_000  # pixels tall at most, for a very long page
READ_MEMORY = 4 * 1024**3  # bytes a child reading one file may use, where the system can cap it
MOST_CELLS = 20_000_000  # cells a worksheet may declare; the spreadsheet library builds the whole grid in memory

Image.MAX_IMAGE_PIXELS = 50_000_000  # a picture larger than this is refused, not decoded (a decompression bomb)

log = logging.getLogger("tawreed.sources")


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


def read_apart(path: Path, kind: str) -> list[Page]:
    """Read a file in a child process, the service itself (`--read`). A spreadsheet with one value far below or to
    the right of its table makes the spreadsheet library build the whole grid, hundreds of gigabytes, and abort;
    in the service that would end it, and reading the file again at the next start would end it again. Here the
    child ends, and the file is marked too big to read."""
    command = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, "-m", "tawreed"]
    env = {k: v for k, v in os.environ.items() if k != "TAWREED_TOKEN"}  # the child serves nothing
    hidden = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0  # no console window flashes on Windows
    try:
        done = subprocess.run(
            [*command, "--read", str(path), kind],
            capture_output=True,
            timeout=READ_SECONDS,
            env=env,
            stdin=subprocess.DEVNULL,
            creationflags=hidden,
        )
    except subprocess.TimeoutExpired as error:
        raise Unreadable("too_big") from error
    if done.returncode == 1:  # an error in a reader, reported by the child itself
        log.error("Reading %s failed: %s", path.name, done.stderr.decode(errors="replace")[-2000:])
        raise Unreadable("unreadable_file")
    if done.returncode != 0:  # aborted or killed: out of memory
        raise Unreadable("too_big")
    answer = json.loads(done.stdout)
    if "unreadable" in answer:
        raise Unreadable(answer["unreadable"])
    return [Page(**page) for page in answer["pages"]]


def read_in_child(path: Path, kind: str) -> None:
    """The child's side of `read_apart`: read the file and write its pages to standard output as JSON."""
    if os.name != "nt":
        import resource  # not on Windows, where the library's own allocation failure ends the child instead

        try:
            hard = resource.getrlimit(resource.RLIMIT_AS)[1]
            limit = READ_MEMORY if hard == resource.RLIM_INFINITY else min(hard, READ_MEMORY)
            resource.setrlimit(resource.RLIMIT_AS, (limit, hard))
        except (ValueError, OSError):  # macOS refuses to lower the address space limit: read without the cap
            pass
    try:
        answer: dict[str, Any] = {"pages": [asdict(page) for page in read_file(path, kind)]}
    except Unreadable as error:
        answer = {"unreadable": error.code}
    except MemoryError:
        answer = {"unreadable": "too_big"}
    sys.stdout.buffer.write(json.dumps(answer, ensure_ascii=False).encode("utf-8"))
    sys.stdout.flush()


def read_file(path: Path, kind: str) -> list[Page]:
    if kind == "spreadsheet":
        return _spreadsheet(path)
    if kind == "csv":
        return _csv(path)
    if kind == "pdf":
        return _pdf(path)
    return _image(path)


# Spreadsheets -------------------------------------------------------------------------------------------------


def _declared_cells(path: Path) -> int:
    """The largest grid an .xlsx or .xlsm worksheet declares (its dimension), read without loading any cells."""
    if path.suffix.lower() not in (".xlsx", ".xlsm"):
        return 0
    try:
        book = openpyxl.load_workbook(path, read_only=True)
    except Exception:  # noqa: BLE001  (damage is reported by the reader proper)
        return 0
    try:
        return max(((sheet.max_row or 0) * (sheet.max_column or 0) for sheet in book.worksheets), default=0)
    finally:
        book.close()


def _spreadsheet(path: Path) -> list[Page]:
    if _declared_cells(path) > MOST_CELLS:
        raise Unreadable("too_big")  # refused before the grid is built: macOS and Windows can't cap the memory
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
        # After the cells are read: only a file that read is looked at again, and only inside the cells it has
        shown = _shown(path, {p.name: (p.rows or 0, p.cols or 0) for p in pages})
        for page in pages:
            if shown.get(page.name):
                page.content["shown"] = shown[page.name]
        return pages
    finally:
        workbook.close()


_FORMAT_NOISE = re.compile(r'\[[^\]]*\]|"[^"]*"|\\.|_.|\*.')
_FORMAT_SHAPE = re.compile(r"^([#0?,]*)(?:\.([0#]*))?$")


def _displayed(value: float, code: str) -> str | None:
    """How a number looks under a plain Excel number format (0.00, #,##0.00, 000), or None for any other format."""
    code = _FORMAT_NOISE.sub("", code.split(";")[0])
    found = _FORMAT_SHAPE.match(code)
    if not found or not code:
        return None
    whole, fraction = found[1], found[2] or ""
    decimals = fraction.count("0")
    number = Decimal(repr(value)).quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP)
    sign, digits = ("-" if number < 0 else ""), f"{abs(number):.{decimals}f}"
    head, _, tail = digits.partition(".")
    head = f"{int(head):,}" if "," in whole else head.zfill(whole.count("0"))
    return sign + head + ("." + tail if tail else "")


def _shown(path: Path, extent: dict[str, tuple[int, int]]) -> dict[str, dict[str, str]]:
    """What numeric cells of an .xlsx look like on screen where their number format changes the text: 2.1 shown
    as 2.10, 7 as 007. By sheet name, then "row:column" (from 0, as the sheet's rows are kept). Item codes read
    from here keep the digits the source shows; the values themselves are untouched."""
    if path.suffix.lower() not in (".xlsx", ".xlsm"):
        return {}
    shown: dict[str, dict[str, str]] = {}
    try:
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception:  # noqa: BLE001  (the displayed text is an extra: the cell values still read)
        log.exception("Could not read the number formats of %s", path.name)
        return {}
    try:
        for sheet in workbook.worksheets:
            if sheet.title not in extent:
                continue
            rows, columns = extent[sheet.title]
            cells = shown.setdefault(sheet.title, {})
            for row in sheet.iter_rows(max_row=rows, max_col=columns):
                for cell in row:
                    value = cell.value
                    if isinstance(value, bool) or not isinstance(value, int | float):
                        continue
                    if cell.number_format in ("General", "0", "@"):
                        continue
                    text = _displayed(value, cell.number_format)
                    if text is not None and text != (str(int(value)) if float(value).is_integer() else str(value)):
                        cells[f"{cell.row - 1}:{cell.column - 1}"] = text
    except Exception:  # noqa: BLE001
        log.exception("Could not read the number formats of %s", path.name)
    finally:
        workbook.close()
    return shown


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
    except Image.DecompressionBombError as error:
        raise Unreadable("too_big") from error
    except OSError as error:
        raise Unreadable("damaged_file") from error


# Page images --------------------------------------------------------------------------------------------------


def render_scale(width: float, height: float) -> float:
    """How much to enlarge a PDF page (in points) to IMAGE_WIDTH pixels wide, held to the pixel budget and the
    height cap so a drawing sheet the size of a wall doesn't ask for gigabytes."""
    scale = IMAGE_WIDTH / width
    scale = min(scale, (PIXEL_BUDGET / (width * height)) ** 0.5, HEIGHT_MOST / height)
    return scale


def render(path: Path, kind: str, number: int) -> bytes:
    """A PNG of one PDF page or image frame, about IMAGE_WIDTH pixels wide."""
    if kind == "pdf":
        with PDFIUM:
            document = pdfium.PdfDocument(path)
            try:
                page = document[number - 1]
                image = page.render(scale=render_scale(page.get_width(), page.get_height())).to_pil()
            finally:
                document.close()
    else:
        with Image.open(path) as source:
            source.seek(number - 1)
            if source.width > IMAGE_WIDTH * 1.5:
                factor = max(1, source.width // IMAGE_WIDTH)
                source.draft("RGB", (source.width // factor, source.height // factor))  # JPEG decodes smaller
                try:
                    source = source.reduce(factor)  # before the colour conversion, which copies every pixel
                except ValueError:
                    pass
            image = source.convert("RGB")
            if image.width > IMAGE_WIDTH * 1.5:
                image = image.resize((IMAGE_WIDTH, round(image.height * IMAGE_WIDTH / image.width)))
            if image.height > HEIGHT_MOST:
                image = image.resize((max(1, round(image.width * HEIGHT_MOST / image.height)), HEIGHT_MOST))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
