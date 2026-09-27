"""Write the synthetic PDF fixtures: python tests/fixtures/make_pdfs.py (from service/, on Windows for Arial).

The content is made up. Arial is embedded as a subset so the PDFs read the same on any machine."""

from pathlib import Path

from fpdf import FPDF
from fpdf.enums import EncryptionMethod

HERE = Path(__file__).parent
ARIAL = r"C:\Windows\Fonts\arial.ttf"

# English table columns: (label, x, width, align). Points on an A4 page (595 x 842).
COLUMNS = [
    ("ITEM", 40, 48, "L"),
    ("DESCRIPTION", 90, 258, "L"),
    ("UNIT", 350, 38, "L"),
    ("QTY", 390, 58, "R"),
    ("RATE", 450, 48, "R"),
    ("AMOUNT", 500, 58, "R"),
]


def row(pdf: FPDF, y: float, values: list[str]) -> None:
    for (_label, x, width, align), value in zip(COLUMNS, values, strict=True):
        if value:
            pdf.set_xy(x, y)
            pdf.cell(width, 12, value, align=align)


def english() -> None:
    pdf = FPDF(unit="pt", format="A4")
    pdf.set_auto_page_break(False)  # the footer sits near the bottom edge on purpose
    pdf.add_font("Arial", fname=ARIAL)
    pdf.set_font("Arial", size=9)
    pages = [
        [
            ["", "DIVISION 03 - CONCRETE", "", "", "", ""],
            ["3.1", "Cast-in-place concrete", "", "", "", ""],
            ["3.1.1", "Plain concrete grade C15 blinding 50 mm thick", "m3", "86", "", ""],
            ["3.1.2", "Reinforced concrete grade C35 to raft foundations,", "m3", "1,240.50", "", ""],
            ["", "including formwork and curing", "", "", "", ""],
            ["3.1.3", "High-yield steel reinforcement bars", "ton", "1,250.00", "", ""],
            ["", "* Rates shall include all testing", "", "", "", ""],
            ["", "Total carried to summary", "", "", "", "12,345.00"],
        ],
        [
            ["", "DIVISION 09 - FINISHES", "", "", "", ""],
            ["9.1.1", "Porcelain floor tiles 600x600 mm", "m2", "2,300", "", ""],
            ["9.1.2", "Skirting to match floor tiles (rate only)", "L.M.", "", "", ""],
        ],
    ]
    for number, rows in enumerate(pages, start=1):
        pdf.add_page()
        pdf.set_xy(40, 40)
        pdf.cell(300, 14, "Synthetic Tower - Bill of Quantities")
        row(pdf, 80, [label for label, *_ in COLUMNS])
        for index, values in enumerate(rows):
            row(pdf, 104 + index * 16, values)
        pdf.set_xy(40, 800)
        pdf.cell(200, 12, f"Page {number} of {len(pages)}")
    pdf.output(HERE / "boq-english.pdf")


def arabic() -> None:
    pdf = FPDF(unit="pt", format="A4")
    pdf.set_auto_page_break(False)  # the footer sits near the bottom edge on purpose
    pdf.add_font("Arial", fname=ARIAL)
    pdf.set_font("Arial", size=11)
    pdf.set_text_shaping(use_shaping_engine=True, direction="rtl", script="arab", language="ara")
    pdf.add_page()
    # Right to left: code at the right edge, then description, unit and quantity towards the left.
    columns = [(480, 75), (200, 278), (140, 58), (60, 78)]
    rows = [
        ["البند", "الوصف", "الوحدة", "الكمية"],
        ["", "الباب الثالث - أعمال الخرسانة", "", ""],
        ["3.1.1", "خرسانة عادية للنظافة سمك 10 سم", "م3", "86"],
        ["3.1.2", "خرسانة مسلحة للأساسات", "م3", "1240.5"],
        ["", "المجموع", "", ""],
    ]
    for index, values in enumerate(rows):
        for (x, width), value in zip(columns, values, strict=True):
            if value:
                pdf.set_xy(x, 80 + index * 20)
                pdf.cell(width, 14, value, align="R")
    pdf.output(HERE / "boq-arabic.pdf")


def locked() -> None:
    pdf = FPDF(unit="pt", format="A4")
    pdf.set_auto_page_break(False)  # the footer sits near the bottom edge on purpose
    pdf.set_encryption(owner_password="owner", user_password="secret", encryption_method=EncryptionMethod.RC4)
    pdf.add_font("Arial", fname=ARIAL)
    pdf.set_font("Arial", size=9)
    pdf.add_page()
    pdf.cell(200, 12, "Locked synthetic BOQ")
    pdf.output(HERE / "boq-locked.pdf")


if __name__ == "__main__":
    english()
    arabic()
    locked()
