import time

from conftest import TOKEN
from fastapi.testclient import TestClient
from reading import FIXTURES, read_all, scan, start, workbook

from tawreed.api.app import create_app
from tawreed.sources import overlap
from tawreed.sources.arabic import Char, lines_from_chars, reading_text


def source_of(client, project: dict, index: int = 0) -> dict:
    return client.get(f"/projects/{project['id']}/sources/{project['sources'][index]['id']}").json()


def page(client, project: dict, source: dict, number: int, **params) -> dict:
    return client.get(f"/projects/{project['id']}/sources/{source['id']}/pages/{number}", params=params).json()


def test_a_workbook_is_read_sheet_by_sheet_with_cells_where_excel_has_them(client):
    project = read_all(client, start(client, {"Tower BOQ.xlsx": workbook()})["id"])
    assert project["sources"][0]["status"] == "read"
    assert project["sources"][0]["page_count"] == 3
    source = source_of(client, project)
    assert [(p["name"], p["kind"], p["hidden"]) for p in source["pages"]] == [
        ("Div.03", "sheet", False),
        ("الملخص", "sheet", False),
        ("Rates", "sheet", True),
    ]

    sheet = page(client, project, source, 1)
    assert sheet["total_rows"] == 14
    assert sheet["rows"][2] == ["ITEM", "DESCRIPTION", "UNIT", "QTY", "RATE", "AMOUNT"]  # row 3
    assert sheet["rows"][9] == ["3.1.2", "Reinforced concrete to raft foundations", "m3", 1240.5, 1150.25, 1426885.13]
    assert sheet["rows"][8][3] == 86  # a whole number stays a number, not "86.0"
    assert sheet["merged"] == [[1, 2, 1, 4]]  # B1:D1

    window = page(client, project, source, 1, start=9, count=2)
    assert window["first_row"] == 9
    assert [r[0] for r in window["rows"]] == ["3.1.1", "3.1.2"]
    assert page(client, project, source, 2)["rows"][1] == ["1", "أعمال الحفر", "م3", 350]


def test_csv_files_in_utf8_and_in_the_arabic_windows_code_page(client):
    utf8 = b"Item;Description;Unit;Qty\n1;Excavation;m3;1240\n"
    arabic = "البند,الوصف,الوحدة,الكمية\n1,حفر,م3,1240\n".encode("cp1256")
    project = read_all(client, start(client, {"semicolons.csv": utf8, "arabic.csv": arabic})["id"])
    first, second = source_of(client, project, 0), source_of(client, project, 1)
    assert page(client, project, first, 1)["rows"] == [
        ["Item", "Description", "Unit", "Qty"],
        ["1", "Excavation", "m3", "1240"],
    ]
    assert page(client, project, second, 1)["rows"][1] == ["1", "حفر", "م3", "1240"]


def test_a_pdf_keeps_its_lines_and_a_scan_is_marked_for_reading_from_the_image(client):
    files = {"english.pdf": (FIXTURES / "boq-english.pdf").read_bytes(), "scan.png": scan()}
    project = read_all(client, start(client, files)["id"])
    pdf, image = source_of(client, project, 0), source_of(client, project, 1)

    assert [(p["kind"], p["has_text"]) for p in pdf["pages"]] == [("page", True), ("page", True)]
    lines = [line["text"] for line in page(client, project, pdf, 1)["lines"]]
    assert "3.1.2 Reinforced concrete grade C35 to raft foundations, m3 1,240.50" in lines
    assert "including formwork and curing" in lines

    assert [(p["kind"], p["has_text"], p["width"]) for p in image["pages"]] == [("image", False, 900)]
    png = client.get(f"/projects/{project['id']}/sources/{image['id']}/pages/1/image")
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"
    assert png.content.startswith(b"\x89PNG")
    rendered = client.get(f"/projects/{project['id']}/sources/{pdf['id']}/pages/1/image")
    assert rendered.content.startswith(b"\x89PNG")
    sheet_image = client.get(f"/projects/{project['id']}/sources/{pdf['id']}/pages/9/image")
    assert sheet_image.json()["detail"] == {"code": "page_not_found"}


def test_an_arabic_pdf_reads_right_to_left_with_its_ligatures_in_order(client):
    project = read_all(client, start(client, {"arabic.pdf": (FIXTURES / "boq-arabic.pdf").read_bytes()})["id"])
    lines = [line["text"] for line in page(client, project, source_of(client, project), 1)["lines"]]
    assert lines == [
        "البند الوصف الوحدة الكمية",
        "الباب الثالث - أعمال الخرسانة",
        "3.1.1 خرسانة عادية للنظافة سمك 10 سم م3 86",
        "3.1.2 خرسانة مسلحة للأساسات م3 1240.5",  # the lam-alef ligature reads lam first
        "المجموع",
    ]


def test_files_that_cannot_be_read_say_why(client):
    files = {"locked.pdf": (FIXTURES / "boq-locked.pdf").read_bytes(), "broken.xlsx": b"PK not really a workbook"}
    project = read_all(client, start(client, files)["id"])
    assert [(s["status"], s["problem"]) for s in project["sources"]] == [
        ("failed", "password_protected"),
        ("failed", "damaged_file"),
    ]


def test_reading_that_a_restart_interrupted_starts_again(tmp_path):
    headers = {"Authorization": f"Bearer {TOKEN}"}
    with TestClient(create_app(tmp_path, TOKEN), headers=headers) as c:
        project = read_all(c, start(c, {"Tower.xlsx": workbook()})["id"])
    import sqlite3

    with sqlite3.connect(tmp_path / "tawreed.sqlite") as db:
        db.execute("UPDATE sources SET status = 'reading'")
    with TestClient(create_app(tmp_path, TOKEN), headers=headers) as c:
        again = read_all(c, project["id"])
        assert again["sources"][0]["status"] == "read"
        assert again["sources"][0]["page_count"] == 3


def test_a_revised_file_overlaps_its_original_and_an_unrelated_one_does_not(client, tmp_path):
    original = workbook()
    project = read_all(client, start(client, {"Tower.xlsx": original})["id"])
    unrelated = (
        "Item,Description,Unit,Qty\n7.1,Suspended ceiling tiles 600x600,m2,900\n7.2,Gypsum board partitions,m2,450\n"
    )
    client.post(f"/projects/{project['id']}/sources", files=[("files", ("ceilings.csv", unrelated.encode()))])
    project = read_all(client, project["id"])
    folders = [tmp_path / "projects" / project["id"] / "pages" / s["id"] for s in project["sources"]]
    tower, ceilings = (overlap.load(f) for f in folders)
    assert overlap.share(tower, tower) == 1.0
    assert overlap.share(tower, ceilings) == 0.0


def test_the_reader_is_woken_by_new_files_rather_than_polling_slowly(client):
    started = time.monotonic()
    read_all(client, start(client, {"Tower.xlsx": workbook()})["id"])
    assert time.monotonic() - started < 5


def test_words_keep_their_positions_and_lines_run_top_first():
    def word(text: str, left: float, bottom: float) -> list[Char]:
        return [Char(c, left + i * 5, bottom, left + i * 5 + 5, bottom + 10) for i, c in enumerate(text)]

    chars = word("Qty", 400, 700) + word("Item", 40, 700) + word("Plain", 90, 680) + [Char(" ", 115, 680, 118, 690)]
    lines = lines_from_chars(chars + word("concrete", 120, 680))
    assert [reading_text(line) for line in lines] == ["Item Qty", "Plain concrete"]
    assert [(w.text, w.left) for w in lines[0]] == [("Item", 40), ("Qty", 400)]
