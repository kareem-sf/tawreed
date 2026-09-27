from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError
from reading import FIXTURES, read_all, start, workbook

from tawreed import ledger
from tawreed.ledger.extract import (
    PdfLayout,
    SheetLayout,
    TranscribedRow,
    extract_pdf,
    extract_sheet,
    is_total,
    transcribed,
)
from tawreed.ledger.numbers import parse_number
from tawreed.sources import Source
from tawreed.sources.readers import read_file

DIV03 = SheetLayout(first_row=4, code="A", description=["B"], unit="C", quantity="D", rate="E", amount="F")


@pytest.mark.parametrize(
    ("value", "number"),
    [
        (86, Decimal(86)),
        (1240.5, Decimal("1240.5")),
        ("1,250.00", Decimal("1250.00")),
        ("1.234,50", Decimal("1234.50")),
        ("12,5", Decimal("12.5")),
        ("1234,567", Decimal("1234.567")),
        ("1.234.567", Decimal("1234567")),
        ("12,345,678", Decimal("12345678")),
        ("١٢٤٠٫٥", Decimal("1240.5")),
        ("(1,500.00)", Decimal("-1500.00")),
        ("  42 ", Decimal(42)),
        ("120 m3", None),
        ("L.S.", None),
        ("", None),
        (None, None),
        (True, None),
        (float("nan"), None),
    ],
)
def test_numbers_as_boqs_write_them(value, number):
    assert parse_number(value) == number


def test_totals_are_recognised_in_english_and_arabic():
    assert is_total("Total carried to summary") and is_total("Sub-total") and is_total("المجموع")
    assert is_total("الإجمالي")
    assert not is_total("Porcelain floor tiles")


def test_a_row_that_starts_with_total_but_has_a_unit_and_quantity_is_an_item():
    content = {"name": "Div.05", "rows": [["5.1.1", "Total Area of external cladding", "m2", 230]]}
    drafts, report = extract_sheet(
        content, 1, SheetLayout(first_row=1, code="A", description=["B"], unit="C", quantity="D")
    )
    assert [(d.code, d.quantity) for d in drafts] == [("5.1.1", Decimal(230))]
    assert report.totals == []


def sheet_rows() -> dict:
    return read_file_rows(workbook())


def read_file_rows(data: bytes) -> dict:
    path = Path(FIXTURES.parent / "_tmp.xlsx")
    path.write_bytes(data)
    try:
        return read_file(path, "spreadsheet")[0].content
    finally:
        path.unlink()


def test_a_sheet_layout_finds_items_with_their_exact_values_and_where_they_are():
    drafts, report = extract_sheet(sheet_rows(), 1, DIV03)
    assert [(d.code, d.description, d.unit, d.quantity) for d in drafts] == [
        ("3.1.1", "Plain concrete grade C15 blinding", "m3", Decimal(86)),
        ("3.1.2", "Reinforced concrete to raft foundations", "m3", Decimal("1240.5")),
        ("3.1.3", "Formwork to sides of foundations", "m2", Decimal("1250.00")),
        ("3.1.4", "Waterstops to construction joints", "L.M.", None),  # rate-only: a unit, no quantity
    ]
    second = drafts[1]
    assert (second.quantity_text, second.rate, second.amount) == ("1240.5", Decimal("1150.25"), Decimal("1426885.13"))
    assert drafts[2].quantity_text == "1,250.00"  # exactly as the cell has it
    assert second.provenance == {
        "sheet": "Div.03",
        "row": 10,
        "cells": {
            "code": "A10",
            "description": "B10",
            "unit": "C10",
            "quantity": "D10",
            "rate": "E10",
            "amount": "F10",
        },
    }
    assert second.headings == ["DIVISION 03 - CONCRETE", "3.1 Cast-in-place concrete"]
    assert second.origin == "cell"

    assert report.items == 4 and report.without_quantity == 1
    assert report.headings == 2 and report.notes == 2
    assert report.skipped == [{"row": 13, "reason": "quantity_without_description", "text": "3.1.5 12"}]
    assert report.totals == [{"row": 14, "text": "Total carried to summary", "amount": "1465585.13"}]
    assert report.amount_sum == Decimal("38700") + Decimal("1426885.13")


def test_a_header_row_inside_the_range_is_never_an_item():
    drafts, report = extract_sheet(sheet_rows(), 1, DIV03.model_copy(update={"first_row": 1}))
    assert len(drafts) == 4
    assert {"row": 3, "reason": "header_row", "text": "ITEM DESCRIPTION UNIT"} in report.skipped


def test_layouts_are_checked():
    with pytest.raises(ValidationError):
        SheetLayout(first_row=0, description=["B"], quantity="D")
    with pytest.raises(ValidationError):
        SheetLayout(first_row=3, description=["B"], quantity="D5")
    with pytest.raises(ValidationError):
        PdfLayout(pages=[1], columns=[{"role": "code", "x0": 0, "x1": 50}, {"role": "unit", "x0": 50, "x1": 90}])
    assert SheetLayout(first_row=3, description=["b"], quantity="d").quantity == "D"


ENGLISH_COLUMNS = [
    {"role": "code", "x0": 30, "x1": 88},
    {"role": "description", "x0": 88, "x1": 348},
    {"role": "unit", "x0": 348, "x1": 388},
    {"role": "quantity", "x0": 388, "x1": 450},
    {"role": "rate", "x0": 450, "x1": 500},
    {"role": "amount", "x0": 500, "x1": 570},
]


def english_pages() -> dict:
    return {p.number: p.content for p in read_file(FIXTURES / "boq-english.pdf", "pdf")}


def test_a_pdf_layout_splits_lines_into_columns_and_joins_continued_descriptions():
    layout = PdfLayout(pages=[1, 2], columns=ENGLISH_COLUMNS, top=95, bottom=790)
    drafts, report = extract_pdf(english_pages(), layout)
    assert [(d.page, d.code, d.description, d.unit, d.quantity_text) for d in drafts] == [
        (1, "3.1.1", "Plain concrete grade C15 blinding 50 mm thick", "m3", "86"),
        (
            1,
            "3.1.2",
            "Reinforced concrete grade C35 to raft foundations, including formwork and curing",
            "m3",
            "1,240.50",
        ),
        (1, "3.1.3", "High-yield steel reinforcement bars", "ton", "1,250.00"),
        (2, "9.1.1", "Porcelain floor tiles 600x600 mm", "m2", "2,300"),
        (2, "9.1.2", "Skirting to match floor tiles (rate only)", "L.M.", ""),
    ]
    assert drafts[1].quantity == Decimal("1240.50")
    assert drafts[1].provenance["lines"] == [6, 7]  # lines count from the top of the page, title included
    assert drafts[0].headings == ["DIVISION 03 - CONCRETE", "3.1 Cast-in-place concrete"]
    assert drafts[3].headings[-1] == "DIVISION 09 - FINISHES"
    assert drafts[0].origin == "text"
    assert report.totals == [{"page": 1, "line": 10, "text": "Total carried to summary", "amount": "12,345.00"}]
    assert report.notes == 1


def test_without_top_and_bottom_the_repeated_header_is_still_not_an_item():
    drafts, report = extract_pdf(english_pages(), PdfLayout(pages=[1], columns=ENGLISH_COLUMNS))
    assert [d.code for d in drafts] == ["3.1.1", "3.1.2", "3.1.3"]
    assert any(s["reason"] == "header_row" for s in report.skipped)


def test_descriptions_that_run_on_above_their_quantity():
    line = lambda top, *words: {"top": top, "bottom": top + 10, "text": "", "words": list(words)}  # noqa: E731
    word = lambda t, x: {"t": t, "x0": x, "x1": x + 20}  # noqa: E731
    page = {
        "lines": [
            line(100, word("Supply", 100), word("and", 130), word("install", 160)),
            line(112, word("4.1", 40), word("fire", 100), word("doors", 130), word("No.", 360), word("12", 420)),
        ]
    }
    layout = PdfLayout(pages=[1], columns=ENGLISH_COLUMNS, continuation="above")
    drafts, _ = extract_pdf({1: page}, layout)
    assert [(d.code, d.description, d.quantity) for d in drafts] == [("4.1", "Supply and install fire doors", 12)]
    assert drafts[0].provenance["lines"] == [1, 2]


def test_an_arabic_pdf_table_right_to_left():
    pages = {p.number: p.content for p in read_file(FIXTURES / "boq-arabic.pdf", "pdf")}
    columns = [
        {"role": "code", "x0": 480, "x1": 560},
        {"role": "description", "x0": 200, "x1": 480},
        {"role": "unit", "x0": 140, "x1": 200},
        {"role": "quantity", "x0": 55, "x1": 140},
    ]
    drafts, report = extract_pdf(pages, PdfLayout(pages=[1], columns=columns))
    assert [(d.code, d.description, d.unit, d.quantity) for d in drafts] == [
        ("3.1.1", "خرسانة عادية للنظافة سمك 10 سم", "م3", Decimal(86)),
        ("3.1.2", "خرسانة مسلحة للأساسات", "م3", Decimal("1240.5")),
    ]
    assert drafts[0].headings == ["الباب الثالث - أعمال الخرسانة"]
    assert report.totals[0]["text"] == "المجموع"


def test_rows_read_from_a_page_image_are_marked_for_checking():
    rows = [
        TranscribedRow(code="1.1", description="Excavation in soil", unit="m3", quantity="1,240"),
        TranscribedRow(description="Unreadable smudge"),
    ]
    drafts, report = transcribed(1, rows)
    assert [(d.code, d.quantity, d.origin) for d in drafts] == [("1.1", Decimal("1240"), "image")]
    assert report.skipped == [{"page": 1, "row": 2, "reason": "incomplete_row", "text": "Unreadable smudge"}]


def test_laying_out_a_page_again_replaces_its_items_and_keeps_the_layout(client):
    project = read_all(client, start(client, {"Tower.xlsx": workbook()})["id"])
    app = client.app
    with app.state.sessions() as session:
        source = session.get(Source, project["sources"][0]["id"])
        first = ledger.lay_out_sheet(session, app.state.home, source, 1, DIV03, "agent")
        again = ledger.lay_out_sheet(session, app.state.home, source, 1, DIV03, "agent")
        session.commit()
        items = ledger.source_items(session, source.id)
        assert first == again and first["items"] == 4
        assert [i.code for i in items] == ["3.1.1", "3.1.2", "3.1.3", "3.1.4"]
        assert [i.position for i in items] == [1, 2, 3, 4]
        assert items[1].quantity == "1240.5" and items[3].quantity is None
        assert items[0].verify is False
        layouts = session.scalars(ledger.select(ledger.Layout)).all()
        assert len(layouts) == 1 and layouts[0].spec["quantity"] == "D" and layouts[0].decided_by == "agent"

        with pytest.raises(ledger.NotReadable) as wrong:
            ledger.lay_out_pdf(session, app.state.home, source, PdfLayout(pages=[1], columns=ENGLISH_COLUMNS), "agent")
        assert wrong.value.code == "wrong_page_kind"
        with pytest.raises(ledger.NotReadable) as missing:
            ledger.lay_out_sheet(session, app.state.home, source, 9, DIV03, "agent")
        assert missing.value.code == "page_not_found"
