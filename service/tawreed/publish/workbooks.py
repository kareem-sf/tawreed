"""The revision's workbooks: the master, one per package, the decision log and the coverage check.

Every item's code, description, unit, quantity, rate, amount and comment go out exactly as the source states them:
a value the source wrote as a number is written as that number, shown with the source's decimals and grouping;
anything else is written as its text. Totals are computed by Tawreed from those values. A project whose items are
mostly Arabic gets Arabic labels and right-to-left sheets."""

import re
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

from tawreed.decisions import Decision
from tawreed.ledger import Item, Layout
from tawreed.packages import Assignment, Coverage, Package, Rule, code, money
from tawreed.projects import Project
from tawreed.sources import Source

ARABIC = re.compile("[؀-ۿ]")
BOLD = Font(bold=True)
TITLE = Font(bold=True, size=14)
HEADING = PatternFill("solid", fgColor="F2F2F0")
WRAP = Alignment(wrap_text=True, vertical="top")
HEADER_ROW = 5  # a package sheet's column headings; its items start on the next row
FIRST_ITEM_ROW = HEADER_ROW + 1
TOP = Alignment(vertical="top")

LABELS: dict[str, dict[str, str]] = {
    "en": {
        "item": "Item",
        "description": "Description",
        "unit": "Unit",
        "quantity": "Qty",
        "rate": "Rate",
        "amount": "Amount",
        "comment": "Comment",
        "source": "Source",
        "check": "read from a page picture: check it against the page",
        "total": "Total of the amounts above",
        "project": "Project",
        "revision": "Revision",
        "published": "Published",
        "package": "Package",
        "scope": "Scope",
        "items": "Items",
        "workbook": "Workbook",
        "cover": "Cover",
        "packages": "Packages",
        "files": "Files",
        "file": "File",
        "set_aside": "set aside: a newer file replaces it",
        "all_placed": "Every item in use is in exactly one package.",
        "summary": "Summary",
        "in_use": "Items in use",
        "placed": "Placed in exactly one package",
        "not_placed": "Not placed",
        "amounts_files": "Amounts of all items, as the files state them",
        "amounts_packages": "Amounts of all packages",
        "difference": "Difference",
        "stated": "Totals the sheet or pages state, added up",
        "items_sum": "Its items' amounts add up to",
        "row": "row",
        "page": "page",
        "lines": "lines",
        "decisions": "Decisions",
        "placements": "Placements",
        "rules": "Rules",
        "reading": "Reading",
        "when": "When",
        "decision": "Decision",
        "answer": "Engineer's answer",
        "placed_by": "Placed by",
        "reason": "Reason",
        "rule": "Rule",
        "applies": "Applies to",
        "this_project": "This project",
        "all_projects": "All projects",
        "pages": "Pages",
        "how": "How it was read",
        "by": "By",
        "skipped": "Rows skipped",
        "agent": "Tawreed's agent",
        "engineer": "The engineer",
        "revision_carry": "Carried over from the earlier file",
        "consent": "Consent to send the project to the AI service",
        "overlap": "How a new file relates to an earlier one",
        "plan": "Package plan",
        "uncertain": "Which package an item belongs in",
        "question": "Question",
        "publish": "Publish",
        "approved": "Approved",
        "declined": "Declined",
        "set_aside_pages": "Set aside",
        "columns": "Columns",
        "transcribed": "Transcribed from the page picture",
    },
    "ar": {
        "item": "البند",
        "description": "الوصف",
        "unit": "الوحدة",
        "quantity": "الكمية",
        "rate": "السعر",
        "amount": "المبلغ",
        "comment": "ملاحظة",
        "source": "المصدر",
        "check": "قُرئ من صورة الصفحة: راجعه مقابل الصفحة",
        "total": "مجموع المبالغ أعلاه",
        "project": "المشروع",
        "revision": "الإصدار",
        "published": "تاريخ الإصدار",
        "package": "الحزمة",
        "scope": "النطاق",
        "items": "البنود",
        "workbook": "المصنف",
        "cover": "الغلاف",
        "packages": "الحزم",
        "files": "الملفات",
        "file": "الملف",
        "set_aside": "مستبعد: يحل محله ملف أحدث",
        "all_placed": "كل بند مستخدم موجود في حزمة واحدة فقط.",
        "summary": "الملخص",
        "in_use": "البنود المستخدمة",
        "placed": "في حزمة واحدة فقط",
        "not_placed": "غير موزعة",
        "amounts_files": "مبالغ كل البنود كما في الملفات",
        "amounts_packages": "مبالغ كل الحزم",
        "difference": "الفرق",
        "stated": "مجاميع الورقة أو الصفحات مجتمعة",
        "items_sum": "مجموع مبالغ بنوده",
        "row": "الصف",
        "page": "الصفحة",
        "lines": "الأسطر",
        "decisions": "القرارات",
        "placements": "التوزيع",
        "rules": "القواعد",
        "reading": "القراءة",
        "when": "التاريخ",
        "decision": "القرار",
        "answer": "إجابة المهندس",
        "placed_by": "وزعه",
        "reason": "السبب",
        "rule": "القاعدة",
        "applies": "تنطبق على",
        "this_project": "هذا المشروع",
        "all_projects": "كل المشاريع",
        "pages": "الصفحات",
        "how": "طريقة القراءة",
        "by": "بواسطة",
        "skipped": "الصفوف المتروكة",
        "agent": "وكيل توريد",
        "engineer": "المهندس",
        "revision_carry": "منقول من الملف الأقدم",
        "consent": "الموافقة على إرسال المشروع إلى خدمة الذكاء الاصطناعي",
        "overlap": "علاقة ملف جديد بملف أقدم",
        "plan": "خطة الحزم",
        "uncertain": "الحزمة المناسبة لبند",
        "question": "سؤال",
        "publish": "الإصدار",
        "approved": "موافقة",
        "declined": "رفض",
        "set_aside_pages": "مستبعدة",
        "columns": "الأعمدة",
        "transcribed": "منسوخة من صورة الصفحة",
    },
}


@dataclass
class Book:
    """Everything a revision is written from, gathered once so every workbook agrees."""

    project: Project
    name: str  # "Rev 00"
    published: datetime
    language: str
    packages: list[Package]
    items: dict[str, list[Item]]  # by package id, in file order
    placed: dict[str, Assignment]  # by item id
    files: dict[str, Source]
    coverage: Coverage
    decisions: list[Decision] = field(default_factory=list)
    rules: list[Rule] = field(default_factory=list)
    layouts: list[Layout] = field(default_factory=list)

    @property
    def labels(self) -> dict[str, str]:
        return LABELS[self.language]

    @property
    def comments(self) -> bool:
        return any(i.comment for items in self.items.values() for i in items)


def language_of(items: list[Item]) -> str:
    arabic = sum(bool(ARABIC.search(i.description)) for i in items)
    return "ar" if arabic * 2 > len(items) else "en"


def sheet_name(text: str) -> str:
    """Excel allows 31 characters and none of []:*?/\\ in a sheet's name."""
    return re.sub(r"[\[\]:*?/\\]", " ", text).strip()[:31] or "Sheet"


def package_title(package: Package) -> str:
    return f"{code(package)} {package.name}"


def _number_format(parsed: str) -> str:
    """Thousands grouped, with the value's own decimals: 1,240.5 and 1,250.00 show just as many digits as the source
    gave, so the display never rounds and a column reads the same way whatever file its items came from."""
    exponent = Decimal(parsed).as_tuple().exponent
    decimals = -exponent if isinstance(exponent, int) and exponent < 0 else 0
    if decimals > 6:  # Excel's float noise from a formula (261016.92999999993): shown to the cent, value unchanged
        decimals = 2
    return "#,##0" + ("." + "0" * decimals if decimals else "")


def _value(cell, parsed: str | None, text: str) -> None:
    """A value the source wrote as a number goes out as that number; anything else as its text."""
    if parsed is not None:
        cell.value = Decimal(parsed)
        cell.number_format = _number_format(parsed)
    else:
        cell.value = text or None


def where(item: Item, files: dict[str, Source], labels: dict[str, str]) -> str:
    """Where the item is in its file, in words: "Tower.xlsx › Div.03 › row 10"."""
    provenance = item.provenance
    file = files[item.source_id].filename
    if "row" in provenance:
        return f"{file} › {provenance.get('sheet', '')} › {labels['row']} {provenance['row']}"
    lines = provenance.get("lines")
    if lines:
        span = f"{lines[0]}–{lines[-1]}" if len(lines) > 1 else str(lines[0])
        return f"{file} › {labels['page']} {item.page} › {labels['lines']} {span}"
    return f"{file} › {labels['page']} {item.page}"


def _prepare(sheet: Worksheet, book: Book, widths: list[int]) -> None:
    """Column widths and direction, and printing: landscape A4, one page wide, numbered pages."""
    sheet.sheet_view.rightToLeft = book.language == "ar"
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.oddFooter.center.text = "&P / &N"


def _header(sheet: Worksheet, row: int, values: list[str], numbers: tuple[int, ...] = ()) -> None:
    """Column headings, those over `numbers` columns aligned with their figures. An empty heading belongs to the
    column before it, so the two share one merged heading."""
    for column, value in enumerate(values, start=1):
        cell = sheet.cell(row=row, column=column, value=value or None)
        cell.font = BOLD
        cell.fill = HEADING
        if column in numbers:
            cell.alignment = Alignment(horizontal="right")
        if not value and column > 1:
            sheet.merge_cells(start_row=row, start_column=column - 1, end_row=row, end_column=column)
    sheet.print_title_rows = f"{row}:{row}"


def source_column(book: Book) -> int:
    """A package sheet's last column: where each item's source is. Only item rows have one."""
    return 8 if book.comments else 7


def write_package(sheet: Worksheet, book: Book, package: Package) -> int:
    """A package's items under their headings, with the total of their amounts. Returns the items written."""
    labels = book.labels
    columns = ["item", "description", "unit", "quantity", "rate", "amount"] + (["comment"] if book.comments else [])
    columns.append("source")
    _prepare(sheet, book, [12, 60, 9, 13, 13, 16] + ([30] if book.comments else []) + [40])
    sheet["A1"] = package_title(package)
    sheet["A1"].font = TITLE
    sheet["A2"] = f"{labels['project']}: {book.project.name} · {labels['revision']}: {book.name}"
    if package.scope:
        sheet["A3"] = f"{labels['scope']}: {package.scope}"
    numbers = tuple(columns.index(c) + 1 for c in ("quantity", "rate", "amount"))
    _header(sheet, HEADER_ROW, [labels[c] for c in columns], numbers)
    sheet.freeze_panes = sheet.cell(row=FIRST_ITEM_ROW, column=1)
    row, under, written, total = FIRST_ITEM_ROW, None, 0, None
    for item in book.items.get(package.id, []):
        heading = " › ".join(item.headings)
        if heading and heading != under:
            sheet.cell(row=row, column=2, value=heading).font = BOLD
            row += 1
        under = heading
        values = {
            "item": item.code or None,
            "description": item.description,
            "unit": item.unit or None,
            "comment": item.comment or None,
            "source": where(item, book.files, labels) + (f" ({labels['check']})" if item.verify else ""),
        }
        for column, key in enumerate(columns, start=1):
            cell = sheet.cell(row=row, column=column)
            if key == "quantity":
                _value(cell, item.quantity, item.quantity_text)
            elif key == "rate":
                _value(cell, item.rate, item.rate_text)
            elif key == "amount":
                _value(cell, item.amount, item.amount_text)
            else:
                cell.value = values[key]
            cell.alignment = WRAP if key in ("description", "comment", "source") else TOP
        if item.amount is not None:
            total = (total or Decimal(0)) + Decimal(item.amount)
        row += 1
        written += 1
    if total is not None:  # no total for items the source leaves unpriced: 0.00 would read as priced at nothing
        sheet.cell(row=row + 1, column=2, value=labels["total"]).font = BOLD
        cell = sheet.cell(row=row + 1, column=columns.index("amount") + 1, value=total)
        cell.font = BOLD
        cell.number_format = "#,##0.00"
    return written


def master(book: Book) -> Workbook:
    labels = book.labels
    workbook = Workbook()
    cover = workbook.active
    cover.title = sheet_name(labels["cover"])
    _prepare(cover, book, [34, 70])
    cover["A1"] = book.project.name
    cover["A1"].font = TITLE
    priced = any(i.amount is not None for items in book.items.values() for i in items)
    rows = [
        (labels["revision"], book.name),
        (labels["published"], book.published.strftime("%Y-%m-%d %H:%M UTC")),
        (labels["packages"], len(book.packages)),
        (labels["items"], book.coverage.items),
        *(
            [(labels["amounts_packages"], sum((c.amount for c in book.coverage.packages), Decimal(0)))]
            if priced
            else []
        ),
        ("", labels["all_placed"]),
        (labels["files"], ""),
    ]
    for offset, (label, value) in enumerate(rows, start=3):
        cover.cell(row=offset, column=1, value=label).font = BOLD
        cell = cover.cell(row=offset, column=2, value=value)
        cell.alignment = Alignment(horizontal="right" if book.language == "ar" else "left")  # beside its label
        if isinstance(value, Decimal):
            cell.number_format = "#,##0.00"
    row = 3 + len(rows)
    for source in sorted(book.files.values(), key=lambda s: s.added_at):
        note = "" if source.active else f" ({labels['set_aside']})"
        cover.cell(row=row, column=2, value=source.filename + note)
        row += 1

    index = workbook.create_sheet(sheet_name(labels["packages"]))
    _prepare(index, book, [8, 40, 60, 10, 18, 44])
    _header(index, 1, [labels["package"], "", labels["scope"], labels["items"], labels["amount"], labels["workbook"]])
    counts = {c.package.id: c for c in book.coverage.packages}
    for row, package in enumerate(book.packages, start=2):
        count = counts[package.id]
        index.cell(row=row, column=1, value=code(package))
        index.cell(row=row, column=2, value=package.name)
        index.cell(row=row, column=3, value=package.scope or None).alignment = WRAP
        index.cell(row=row, column=4, value=count.items)
        index.cell(row=row, column=5, value=count.amount).number_format = "#,##0.00"
        index.cell(row=row, column=6, value=package_file(book, package))

    for package in book.packages:
        write_package(workbook.create_sheet(sheet_name(package_title(package))), book, package)
    return workbook


def package_file(book: Book, package: Package) -> str:
    return f"{file_name(package_title(package))} - {book.name}.xlsx"


def file_name(text: str) -> str:
    """A name Windows accepts for a file."""
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", text).strip(" .")[:80] or "Untitled"


def package_workbook(book: Book, package: Package) -> Workbook:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = sheet_name(package_title(package))
    write_package(sheet, book, package)
    return workbook


def coverage_check(book: Book) -> Workbook:
    labels = book.labels
    workbook = Workbook()
    summary = workbook.active
    summary.title = sheet_name(labels["summary"])
    _prepare(summary, book, [48, 22, 40, 22])
    coverage = book.coverage
    in_files = sum((Decimal(i.amount) for items in book.items.values() for i in items if i.amount), Decimal(0))
    in_packages = sum((c.amount for c in coverage.packages), Decimal(0))
    rows: list[tuple[str, Any]] = [
        (labels["in_use"], coverage.items),
        (labels["placed"], coverage.placed),
        (labels["not_placed"], coverage.unplaced + coverage.waiting),
        (labels["amounts_files"], in_files),
        (labels["amounts_packages"], in_packages),
        (labels["difference"], in_files - in_packages),
        ("", labels["all_placed"]),
    ]
    for row, (label, value) in enumerate(rows, start=1):
        summary.cell(row=row, column=1, value=label).font = BOLD
        cell = summary.cell(row=row, column=2, value=value)
        if isinstance(value, Decimal):
            cell.number_format = "#,##0.00"
    row = len(rows) + 2
    _header(summary, row, [labels["file"], labels["stated"], labels["items_sum"], labels["difference"]], (2, 3, 4))
    for total in coverage.totals:
        row += 1
        summary.cell(row=row, column=1, value=f"{total['file']} › {total['where']}")
        for column, key in ((2, "stated_sum"), (3, "items_sum"), (4, "difference")):
            summary.cell(row=row, column=column, value=money(total[key])).number_format = "#,##0.00"

    items = workbook.create_sheet(sheet_name(labels["items"]))
    _prepare(items, book, [12, 60, 9, 13, 16, 8, 34, 40])
    _header(
        items,
        1,
        [labels[k] for k in ("item", "description", "unit", "quantity", "amount", "package")] + ["", labels["source"]],
    )
    row = 1
    for package in book.packages:
        for item in book.items.get(package.id, []):
            row += 1
            items.cell(row=row, column=1, value=item.code or None)
            items.cell(row=row, column=2, value=item.description).alignment = WRAP
            items.cell(row=row, column=3, value=item.unit or None)
            _value(items.cell(row=row, column=4), item.quantity, item.quantity_text)
            _value(items.cell(row=row, column=5), item.amount, item.amount_text)
            items.cell(row=row, column=6, value=code(package))
            items.cell(row=row, column=7, value=package.name)
            items.cell(row=row, column=8, value=where(item, book.files, labels))
    return workbook


def decision_log(book: Book) -> Workbook:
    labels = book.labels
    workbook = Workbook()
    log = workbook.active
    log.title = sheet_name(labels["decisions"])
    _prepare(log, book, [18, 40, 60, 50])
    _header(log, 1, [labels["when"], labels["decision"], "", labels["answer"]])
    for row, decision in enumerate(book.decisions, start=2):
        asked, answered = _described(decision, book)
        log.cell(row=row, column=1, value=(decision.answered_at or decision.created_at).strftime("%Y-%m-%d %H:%M"))
        log.cell(row=row, column=2, value=labels[decision.kind])
        log.cell(row=row, column=3, value=asked).alignment = WRAP
        log.cell(row=row, column=4, value=answered).alignment = WRAP

    placements = workbook.create_sheet(sheet_name(labels["placements"]))
    _prepare(placements, book, [12, 60, 8, 34, 22, 50])
    _header(
        placements,
        1,
        [labels["item"], labels["description"], labels["package"], "", labels["placed_by"], labels["reason"]],
    )
    by = {"agent": labels["agent"], "engineer": labels["engineer"], "revision": labels["revision_carry"]}
    row = 1
    for package in book.packages:
        for item in book.items.get(package.id, []):
            row += 1
            assignment = book.placed[item.id]
            placements.cell(row=row, column=1, value=item.code or None)
            placements.cell(row=row, column=2, value=item.description).alignment = WRAP
            placements.cell(row=row, column=3, value=code(package))
            placements.cell(row=row, column=4, value=package.name)
            placements.cell(row=row, column=5, value=by.get(assignment.decided_by, assignment.decided_by))
            placements.cell(row=row, column=6, value=assignment.reason or None).alignment = WRAP

    rules = workbook.create_sheet(sheet_name(labels["rules"]))
    _prepare(rules, book, [80, 20])
    _header(rules, 1, [labels["rule"], labels["applies"]])
    for row, rule in enumerate(book.rules, start=2):
        rules.cell(row=row, column=1, value=rule.text).alignment = WRAP
        rules.cell(row=row, column=2, value=labels["this_project"] if rule.project_id else labels["all_projects"])

    reading = workbook.create_sheet(sheet_name(labels["reading"]))
    _prepare(reading, book, [36, 14, 60, 18, 10, 14])
    _header(
        reading,
        1,
        [labels["file"], labels["pages"], labels["how"], labels["by"], labels["items"], labels["skipped"]],
    )
    for row, layout in enumerate(book.layouts, start=2):
        reading.cell(row=row, column=1, value=book.files[layout.source_id].filename)
        reading.cell(row=row, column=2, value=", ".join(str(p) for p in layout.pages))
        reading.cell(row=row, column=3, value=_how(layout, labels)).alignment = WRAP
        reading.cell(row=row, column=4, value=labels["agent"] if layout.decided_by == "agent" else labels["engineer"])
        reading.cell(row=row, column=5, value=layout.report.get("items", 0))
        reading.cell(row=row, column=6, value=layout.report.get("skipped_count", 0))
    return workbook


def _how(layout: Layout, labels: dict[str, str]) -> str:
    spec = layout.spec
    if "skip" in spec:
        return f"{labels['set_aside_pages']}: {spec['skip']}"
    if "transcribed" in spec:
        return labels["transcribed"]
    if "columns" in spec:  # a PDF layout
        return f"{labels['columns']}: " + ", ".join(f"{c['role']} {c['x0']:.0f}–{c['x1']:.0f}" for c in spec["columns"])
    roles = ("code", "description", "unit", "quantity", "rate", "amount", "comment")
    columns = ", ".join(
        f"{role} {'+'.join(spec[role]) if isinstance(spec[role], list) else spec[role]}"
        for role in roles
        if spec.get(role)
    )
    rows = f"{spec['first_row']}–{spec['last_row'] or ''}".rstrip("–")
    return f"{labels['row']} {rows}; {labels['columns']}: {columns}"


def _described(decision: Decision, book: Book) -> tuple[str, str]:
    """What was asked and what the engineer answered, in words, for the log."""
    labels, p, a = book.labels, decision.payload, decision.answer or {}
    yes = labels["approved"] if a.get("approve") else labels["declined"]
    note = f": {a['note']}" if a.get("note") else ""
    files = {s.id: s.filename for s in book.files.values()}
    if decision.kind == "consent":
        return p.get("host") or p.get("provider", ""), yes
    if decision.kind == "overlap":
        return f"{files.get(p['source_id'], '')} / {files.get(p['earlier_id'], '')}", str(a.get("relation", ""))
    if decision.kind == "plan":
        return "; ".join(e["name"] for e in p["packages"]) + (f" — {p['note']}" if p.get("note") else ""), yes + note
    if decision.kind == "uncertain":
        scope = {"item": "", "project": labels["this_project"], "all": labels["all_projects"]}.get(a.get("scope"), "")
        item = next((i for items in book.items.values() for i in items if i.id == p["item_id"]), None)
        about = f"{item.code} {item.description[:120]}" if item else ""
        return f"{about} — {p.get('reason', '')}", f"{a.get('package', '')}" + (f" ({scope})" if scope else "")
    if decision.kind == "question":
        return p["question"], str(a.get("choice") or a.get("note") or "")
    return p.get("summary", ""), yes + note
