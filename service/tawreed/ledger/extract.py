"""Turn a page into BOQ items, given its layout: which columns hold the code, description, unit, quantity, rate
and amount. The layout comes from the agent; the values come only from the page, exactly as written.

A row is an item when it has a description and a quantity or a unit (a lump sum or a rate-only item has a unit but
may have no quantity). A row with only a description is a heading, kept as context for the items below it, unless
it is a note or a total. Everything skipped is reported with its reason."""

import re
from collections import deque
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

from tawreed.ledger.numbers import parse_number, text_of
from tawreed.sources.arabic import Word, normalised, reading_text

ROLES = ("code", "description", "unit", "quantity", "rate", "amount", "comment")
HEADINGS_KEPT = 3  # the nearest headings above an item, kept as its context
SKIPPED_LISTED = 200  # skipped rows reported one by one; beyond this only counted

Column = Annotated[str, StringConstraints(pattern=r"^[A-Za-z]{1,3}$", to_upper=True)]

# A table's own header row, repeated at the top of each page: never an item.
_HEADER_WORDS = {
    "qty",
    "qty.",
    "quantity",
    "quantities",
    "unit",
    "units",
    "الكمية",
    "الكميه",
    "كمية",
    "الوحدة",
    "الوحده",
    "وحدة",
}

_TOTAL = re.compile(
    r"\b(sub[- ]?total|grand total|total|carried (forward|to|over)|brought forward|to (collection|summary))\b"
    r"|المجموع|مجموع|الاجمالي|اجمالي|المرحل|مرحل|ينقل|منقول"
)


class SheetLayout(BaseModel):
    """Which rows hold items and which column holds what. Columns are Excel letters; rows count from 1."""

    first_row: int = Field(ge=1)
    last_row: int | None = Field(default=None, ge=1)
    code: Column | None = None
    description: list[Column] = Field(min_length=1, max_length=4)
    unit: Column | None = None
    quantity: Column
    rate: Column | None = None
    amount: Column | None = None
    comment: Column | None = None


class PdfColumn(BaseModel):
    role: Literal["code", "description", "unit", "quantity", "rate", "amount", "comment"]
    x0: float = Field(ge=0)
    x1: float = Field(gt=0)


class PdfLayout(BaseModel):
    """Where a PDF table's columns fall, in points from the left edge of the page. `top` and `bottom` (points from
    the top) leave out repeated headers and footers. Description lines without a quantity belong to the item
    below them ("above"), to the item above them ("below"), or to none ("none")."""

    pages: list[int] = Field(min_length=1)
    columns: list[PdfColumn] = Field(min_length=2)
    top: float | None = None
    bottom: float | None = None
    continuation: Literal["below", "above", "none"] = "below"

    @model_validator(mode="after")
    def needs_description_and_quantity(self) -> "PdfLayout":
        roles = {c.role for c in self.columns}
        if not {"description", "quantity"} <= roles:
            raise ValueError("A PDF layout needs a description column and a quantity column.")
        return self


@dataclass
class Draft:
    page: int
    code: str
    description: str
    unit: str
    quantity: Decimal | None
    quantity_text: str
    rate: Decimal | None
    rate_text: str
    amount: Decimal | None
    amount_text: str
    comment: str
    headings: list[str]
    provenance: dict[str, Any]
    origin: str  # cell | text | image


@dataclass
class Report:
    rows: int = 0
    items: int = 0
    headings: int = 0
    notes: int = 0
    without_quantity: int = 0
    skipped: list[dict[str, Any]] = field(default_factory=list)
    skipped_count: int = 0
    totals: list[dict[str, Any]] = field(default_factory=list)
    amount_sum: Decimal | None = None

    def skip(self, where: dict[str, Any], reason: str, text: str) -> None:
        self.skipped_count += 1
        if len(self.skipped) < SKIPPED_LISTED:
            self.skipped.append({**where, "reason": reason, "text": text[:120]})

    def as_dict(self) -> dict[str, Any]:
        return {
            "rows": self.rows,
            "items": self.items,
            "headings": self.headings,
            "notes": self.notes,
            "without_quantity": self.without_quantity,
            "skipped": self.skipped,
            "skipped_count": self.skipped_count,
            "totals": self.totals,
            "amount_sum": str(self.amount_sum) if self.amount_sum is not None else None,
        }


def is_total(text: str) -> bool:
    return bool(_TOTAL.search(normalised(text)))


def is_note(text: str) -> bool:
    """A note ("* Rates include testing", "Note: ...") never names an item or continues a description."""
    stripped = text.lstrip()
    return stripped[:1] == "*" or normalised(stripped).startswith(("note", "notes", "ملاحظ"))


def _is_bullet(text: str) -> bool:
    """A bulleted line on its own is part of a preamble, not a heading; after an item it may continue it."""
    return text.lstrip()[:1] in "•-–"


def column_index(letter: str) -> int:
    index = 0
    for char in letter.upper():
        index = index * 26 + ord(char) - 64
    return index - 1


# Sheets -------------------------------------------------------------------------------------------------------


def extract_sheet(content: dict[str, Any], page: int, layout: SheetLayout) -> tuple[list[Draft], Report]:
    rows = content["rows"]
    last = min(layout.last_row or len(rows), len(rows))
    report, drafts = Report(), []
    headings: deque[str] = deque(maxlen=HEADINGS_KEPT)

    for number in range(layout.first_row, last + 1):
        row = rows[number - 1]

        def value(col: str | None, row: list[Any] = row) -> Any:
            if col is None:
                return None
            index = column_index(col)
            return row[index] if index < len(row) else None

        def ref(col: str | None, number: int = number) -> str | None:
            return f"{col}{number}" if col else None

        code = text_of(value(layout.code))
        description = " ".join(t for t in (text_of(value(c)) for c in layout.description) if t)
        unit = text_of(value(layout.unit))
        raw_quantity = value(layout.quantity)
        if not (code or description or unit or raw_quantity is not None):
            continue
        report.rows += 1
        where = {"row": number}
        kind = _classify(report, where, code, description, unit, raw_quantity, value(layout.amount))
        if kind == "heading":
            headings.append(f"{code} {description}".strip())
        elif kind == "item":
            cells = {role: ref(getattr(layout, role)) for role in ("code", "unit", "quantity", "rate", "amount")}
            cells["description"] = ",".join(f"{c}{number}" for c in layout.description)
            if layout.comment:
                cells["comment"] = ref(layout.comment)
            provenance = {
                "sheet": content.get("name", ""),
                "row": number,
                "cells": {k: v for k, v in cells.items() if v},
            }
            drafts.append(
                _draft(
                    report,
                    page,
                    code,
                    description,
                    unit,
                    raw_quantity,
                    value(layout.rate),
                    value(layout.amount),
                    text_of(value(layout.comment)),
                    list(headings),
                    provenance,
                    "cell",
                )
            )
    return drafts, report


def _classify(report: Report, where: dict, code: str, description: str, unit: str, raw_quantity: Any, amount: Any):
    quantity = parse_number(raw_quantity)
    if normalised(unit) in _HEADER_WORDS or normalised(text_of(raw_quantity)) in _HEADER_WORDS:
        report.skip(where, "header_row", " ".join(t for t in (code, description, unit) if t))
        return None
    if description and (quantity is not None or unit):
        return "item"
    if quantity is not None:
        report.skip(where, "quantity_without_description", f"{code} {text_of(raw_quantity)}".strip())
        return None
    if description and not unit:
        if is_total(description):
            report.totals.append({**where, "text": description[:120], "amount": text_of(amount) or None})
            return None
        if is_note(description) or _is_bullet(description):
            report.notes += 1
            return None
        report.headings += 1
        return "heading"
    report.skip(where, "incomplete_row", " ".join(t for t in (code, description, unit) if t))
    return None


def _draft(
    report: Report,
    page: int,
    code: str,
    description: str,
    unit: str,
    raw_quantity: Any,
    raw_rate: Any,
    raw_amount: Any,
    comment: str,
    headings: list[str],
    provenance: dict[str, Any],
    origin: str,
) -> Draft:
    quantity, amount = parse_number(raw_quantity), parse_number(raw_amount)
    report.items += 1
    if quantity is None:
        report.without_quantity += 1
    if amount is not None:
        report.amount_sum = (report.amount_sum or Decimal(0)) + amount
    return Draft(
        page=page,
        code=code,
        description=description,
        unit=unit,
        quantity=quantity,
        quantity_text=text_of(raw_quantity),
        rate=parse_number(raw_rate),
        rate_text=text_of(raw_rate),
        amount=amount,
        amount_text=text_of(raw_amount),
        comment=comment,
        headings=headings,
        provenance=provenance,
        origin=origin,
    )


# PDF text -----------------------------------------------------------------------------------------------------


def extract_pdf(contents: dict[int, dict[str, Any]], layout: PdfLayout) -> tuple[list[Draft], Report]:
    report, drafts = Report(), []
    headings: deque[str] = deque(maxlen=HEADINGS_KEPT)
    for page in layout.pages:
        open_item: Draft | None = None
        waiting: list[tuple[int, dict[str, str], dict]] = []  # description lines waiting for their item (above)
        for index, line in enumerate(contents[page]["lines"], start=1):
            if layout.top is not None and line["top"] < layout.top:
                continue
            if layout.bottom is not None and line["bottom"] > layout.bottom:
                continue
            cells, box = _cells(line, layout)
            code, description, unit = cells["code"], cells["description"], cells["unit"]
            if not any(cells.values()):
                continue
            report.rows += 1
            where = {"page": page, "line": index}
            lone_description = (
                description
                and not (code or unit or cells["quantity"] or cells["rate"] or cells["amount"])
                and not is_total(description)
                and not is_note(description)
            )
            if lone_description and layout.continuation == "below" and open_item is not None:
                open_item.description = f"{open_item.description} {description}"
                _extend(open_item.provenance, index, box)
                continue
            if lone_description and layout.continuation == "above":
                waiting.append((index, cells, box))
                continue
            kind = _classify(report, where, code, description, unit, cells["quantity"], cells["amount"])
            if kind == "item":
                prefix = [w[1]["description"] for w in waiting]
                provenance = {"page": page, "lines": [index], "box": box}
                for waiting_index, _, waiting_box in waiting:
                    _extend(provenance, waiting_index, waiting_box)
                draft = _draft(
                    report,
                    page,
                    code,
                    " ".join([*prefix, description]),
                    unit,
                    cells["quantity"] or None,
                    cells["rate"] or None,
                    cells["amount"] or None,
                    cells["comment"],
                    list(headings),
                    provenance,
                    "text",
                )
                drafts.append(draft)
                open_item, waiting = draft, []
            else:
                for _, waited, _ in waiting:  # description lines no item claimed were headings after all
                    report.headings += 1
                    headings.append(waited["description"])
                waiting = []
                if kind == "heading":
                    headings.append(f"{code} {description}".strip())
                open_item = None
        for _, waited, _ in waiting:
            report.headings += 1
            headings.append(waited["description"])
    return drafts, report


def _cells(line: dict[str, Any], layout: PdfLayout) -> tuple[dict[str, str], list[float]]:
    grouped: dict[str, list[Word]] = {role: [] for role in ROLES}
    placed: list[dict[str, Any]] = []
    for word in line["words"]:
        centre = (word["x0"] + word["x1"]) / 2
        column = next((c for c in layout.columns if c.x0 <= centre < c.x1), None)
        if column:
            grouped[column.role].append(Word(word["t"], word["x0"], word["x1"], 0, 0))
            placed.append(word)
    cells = {role: reading_text(words) if words else "" for role, words in grouped.items()}
    if not placed:
        return cells, [0, line["top"], 0, line["bottom"]]
    box = [min(w["x0"] for w in placed), line["top"], max(w["x1"] for w in placed), line["bottom"]]
    return cells, box


def _extend(provenance: dict[str, Any], line: int, box: list[float]) -> None:
    provenance["lines"] = sorted({*provenance["lines"], line})
    old = provenance["box"]
    provenance["box"] = [min(old[0], box[0]), min(old[1], box[1]), max(old[2], box[2]), max(old[3], box[3])]


# Page images --------------------------------------------------------------------------------------------------


class TranscribedRow(BaseModel):
    """One BOQ row as the AI read it from a page image. Numbers stay as the text it read."""

    code: str = ""
    description: str
    unit: str = ""
    quantity: str = ""
    rate: str = ""
    amount: str = ""


def transcribed(page: int, rows: list[TranscribedRow]) -> tuple[list[Draft], Report]:
    """Items read from a page image by the AI. They are marked for checking against the page."""
    report, drafts = Report(), []
    for index, row in enumerate(rows, start=1):
        report.rows += 1
        if not row.description.strip() or not (row.unit.strip() or parse_number(row.quantity) is not None):
            report.skip({"page": page, "row": index}, "incomplete_row", row.description)
            continue
        drafts.append(
            _draft(
                report,
                page,
                row.code.strip(),
                row.description.strip(),
                row.unit.strip(),
                row.quantity.strip() or None,
                row.rate.strip() or None,
                row.amount.strip() or None,
                "",
                [],
                {"page": page, "row": index},
                "image",
            )
        )
    return drafts, report
