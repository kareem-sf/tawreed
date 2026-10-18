"""Three made-up BOQ layouts, none like El Far's, each taken from import to publishing.

For each: every source item reaches exactly one package workbook with its code, description, unit, quantity, rate and
amount as the source states them, and the packages add up to the source's own total to the cent."""

import io
from decimal import Decimal

import openpyxl
from reading import read_all, start
from test_publish import approve, computed, folder

from tawreed import decisions, ledger, packages
from tawreed.ledger.extract import SheetLayout
from tawreed.projects import Project
from tawreed.sources import Source


def _bytes(book) -> bytes:
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


# (code, description, unit, quantity, rate, amount): what each layout's source states
CIVIL = [
    ("C-01", "Excavation in ordinary soil", "m3", 1520.5, 38.75, 58919.38),  # 58,919.375 rounded by the source
    ("C-02", "Backfill with selected material", "m3", 640, 52.2, 33408),
    ("C-03", "Reinforced concrete C30 to columns", "m3", 212.35, 1875.4, 398237.19),
    ("C-04", "Steel reinforcement high tensile", "ton", 48.125, 24500, 1179062.5),
]
FINISH = [
    ("F-01", "Ceramic floor tiles 60x60", "m2", 880, 215, 189200),
    ("F-02", "Gypsum board ceiling", "m2", 1204.6, 162.5, 195747.5),
    ("F-03", "Emulsion paint, three coats", "m2", 3410.25, 48.9, 166763.2),
]


def _total(items) -> Decimal:
    return sum((Decimal(str(i[5])) for i in items), Decimal(0))


def reordered_columns() -> tuple[bytes, dict[int, SheetLayout], list]:
    """Quantity first, then unit, description, code, then amount before rate; a title block above the header."""
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = "BOQ"
    sheet["A1"] = "Synthetic Villa - Bill of Quantities"
    sheet["A2"] = "Prepared for tender"
    for column, label in zip("ABCDEF", ["Qty", "Unit", "Description", "Ref", "Amount", "Rate"], strict=True):
        sheet[f"{column}5"] = label
    items = CIVIL + FINISH
    for number, (code, description, unit, quantity, rate, amount) in enumerate(items, start=6):
        for column, value in zip("ABCDEF", [quantity, unit, description, code, amount, rate], strict=True):
            sheet[f"{column}{number}"] = value
    layout = SheetLayout(first_row=6, code="D", description=["C"], unit="B", quantity="A", rate="F", amount="E")
    return _bytes(book), {1: layout}, items


def totals_sheet() -> tuple[bytes, dict[int, SheetLayout], list]:
    """Two item sheets and a summary sheet of formulas that add them up: the summary holds no items."""
    book = openpyxl.Workbook()
    civil = book.active
    civil.title = "Civil"
    finishes = book.create_sheet("Finishes")
    for sheet, items in ((civil, CIVIL), (finishes, FINISH)):
        for column, label in zip("ABCDEF", ["Item", "Description", "Unit", "Qty", "Rate", "Amount"], strict=True):
            sheet[f"{column}1"] = label
        for number, (code, description, unit, quantity, rate, amount) in enumerate(items, start=2):
            for column, value in zip("ABCDEF", [code, description, unit, quantity, rate, amount], strict=True):
                sheet[f"{column}{number}"] = value
    summary = book.create_sheet("Summary", 0)
    summary["A1"], summary["B1"] = "Trade", "Amount"
    summary["A2"], summary["B2"] = "Civil", f"=SUM(Civil!F2:F{len(CIVIL) + 1})"
    summary["A3"], summary["B3"] = "Finishes", f"=SUM(Finishes!F2:F{len(FINISH) + 1})"
    summary["A4"], summary["B4"] = "Total", "=B2+B3"
    layout = SheetLayout(first_row=2, code="A", description=["B"], unit="C", quantity="D", rate="E", amount="F")
    return _bytes(book), {2: layout, 3: layout}, CIVIL + FINISH


def merged_rows() -> tuple[bytes, dict[int, SheetLayout], list]:
    """Section headings merged across the table, descriptions merged over two columns, a subtotal after each section
    and a grand total that are not items."""
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = "Works"
    for column, label in zip("ABCDEFG", ["No.", "Description", "", "Unit", "Qty", "Rate", "Amount"], strict=True):
        sheet[f"{column}1"] = label
    sheet.merge_cells("B1:C1")
    row, items = 2, []
    for title, group in (("A. EARTHWORKS AND CONCRETE", CIVIL), ("B. FINISHES", FINISH)):
        sheet[f"A{row}"] = title
        sheet.merge_cells(f"A{row}:G{row}")
        row += 1
        for code, description, unit, quantity, rate, amount in group:
            for column, value in zip("ABDEFG", [code, description, unit, quantity, rate, amount], strict=True):
                sheet[f"{column}{row}"] = value
            sheet.merge_cells(f"B{row}:C{row}")
            items.append((code, description, unit, quantity, rate, amount))
            row += 1
        sheet[f"B{row}"] = "Sub-total"
        sheet.merge_cells(f"B{row}:F{row}")
        sheet[f"G{row}"] = float(_total(group))
        row += 1
    sheet[f"B{row}"] = "Grand total"
    sheet.merge_cells(f"B{row}:F{row}")
    sheet[f"G{row}"] = float(_total(items))
    layout = SheetLayout(first_row=2, code="A", description=["B", "C"], unit="D", quantity="E", rate="F", amount="G")
    return _bytes(book), {1: layout}, items


def published(client, build):
    """Import, lay out, plan, place every item in one of two packages and publish. Returns the master's package
    sheets, the source's items and the project id."""
    content, layouts, expected = build()
    project = read_all(client, start(client, {"Layout.xlsx": content})["id"])
    assert project["sources"][0]["status"] == "read"
    home = client.app.state.home
    with client.app.state.sessions() as session:
        source = session.get(Source, project["sources"][0]["id"])
        pages = {p.number: p for p in source.pages}
        for page, layout in layouts.items():
            ledger.lay_out_sheet(session, home, source, page, layout, "agent")
        skipped = [n for n in pages if n not in layouts]
        if skipped:
            ledger.skip_pages(session, source, skipped, "totals", "agent")
        me = session.get(Project, project["id"])
        first, second = packages.apply_plan(
            session, me, [{"name": n, "scope": "", "reason": "", "keeps": []} for n in ("Civil", "Finishes")]
        )
        items = packages.active_items(session, me.id)
        packages.place(session, me, [i for i in items if i.ref % 2], first, "agent")
        packages.place(session, me, [i for i in items if not i.ref % 2], second, "agent")
        decisions.raise_decision(session, me.id, "publish", {}, "tawreed")
        session.commit()
    assert approve(client, project["id"]).status_code == 204
    master = openpyxl.load_workbook(folder(client, project["id"]) / "Layout - Master - Rev 00.xlsx")
    return master, expected


def check_like_the_source(master, expected):
    """Every source item once, with the source's values; the packages' totals equal the source's to the cent."""
    want = {i[0]: i for i in expected}
    found, total = {}, Decimal(0)
    for name in master.sheetnames[2:]:
        sheet = master[name]
        for r in range(6, sheet.max_row + 1):
            code = sheet[f"A{r}"].value
            if code not in want:
                continue
            assert code not in found, f"{code} is in two packages"
            found[code] = name
            _, description, unit, quantity, rate, _ = want[code]
            assert [sheet[f"{c}{r}"].value for c in "BCDE"] == [description, unit, quantity, rate]
            total += Decimal(str(round(computed(sheet, f"F{r}"), 2)))
    assert sorted(found) == sorted(want)  # none missing, none extra
    assert total == _total(expected)
    index = master["Packages"]
    assert round(computed(index, "E2") + computed(index, "E3"), 2) == float(_total(expected))
    assert round(computed(master["Cover"], "B7"), 2) == float(_total(expected))


def test_a_boq_with_its_columns_in_another_order_is_published(client):
    master, expected = published(client, reordered_columns)
    check_like_the_source(master, expected)


def test_a_boq_with_a_totals_sheet_is_published_without_the_totals_counted_as_items(client):
    master, expected = published(client, totals_sheet)
    check_like_the_source(master, expected)


def test_a_boq_with_merged_headings_descriptions_and_subtotals_is_published(client):
    master, expected = published(client, merged_rows)
    check_like_the_source(master, expected)
