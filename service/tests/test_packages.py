"""Packages, placements and the overlap gate, without an AI: the checked operations the agent and the engineer share."""

import io
import sqlite3
from decimal import Decimal

import openpyxl
import pytest
from reading import read_all, start, workbook

from tawreed import decisions, ledger, packages
from tawreed.ledger.extract import SheetLayout
from tawreed.projects import Project
from tawreed.sources import Source

DIV03 = SheetLayout(first_row=4, code="A", description=["B"], unit="C", quantity="D", rate="E", amount="F")


def laid_out(client, files) -> str:
    """A project whose first sheet in each file is laid out, as the agent would."""
    project = read_all(client, start(client, files)["id"])
    with client.app.state.sessions() as session:
        for s in project["sources"]:
            ledger.lay_out_sheet(session, client.app.state.home, session.get(Source, s["id"]), 1, DIV03, "agent")
        session.commit()
    return project["id"]


def planned(session, project_id, names=("Concrete", "Formwork")) -> list[packages.Package]:
    project = session.get(Project, project_id)
    return packages.apply_plan(session, project, [{"name": n, "scope": "", "reason": "", "keeps": []} for n in names])


def by_ref(session, project_id) -> dict[int, ledger.Item]:
    return {i.ref: i for i in packages.active_items(session, project_id)}


def placed(session, project_id) -> dict[int, str]:
    names = {p.id: p.name for p in packages.packages(session, project_id)}
    where = packages.assignments(session, project_id)
    return {i.ref: names[where[i.id].package_id] for i in packages.active_items(session, project_id) if i.id in where}


def test_items_are_numbered_within_the_project_and_numbers_are_not_reused(client):
    project_id = laid_out(client, {"Tower.xlsx": workbook()})
    with client.app.state.sessions() as session:
        assert sorted(by_ref(session, project_id)) == [1, 2, 3, 4]
        source = session.scalars(ledger.select(Source)).first()
        ledger.lay_out_sheet(session, client.app.state.home, source, 1, DIV03, "agent")  # laid out again
        session.commit()
        assert sorted(by_ref(session, project_id)) == [5, 6, 7, 8]


def test_the_plan_keeps_renames_merges_splits_and_removes_packages(client):
    project_id = laid_out(client, {"Tower.xlsx": workbook()})
    with client.app.state.sessions() as session:
        project = session.get(Project, project_id)
        concrete, formwork, other = planned(session, project_id, ("Concrete", "Formwork", "Other"))
        items = by_ref(session, project_id)
        packages.place(session, project, [items[1], items[2]], concrete, "agent")
        packages.place(session, project, [items[3]], formwork, "engineer")
        packages.place(session, project, [items[4]], other, "agent")

        # Concrete renamed; Formwork merged with Other; nothing else.
        packages.apply_plan(
            session,
            project,
            [
                {"name": "Concrete works", "scope": "", "reason": "", "keeps": [concrete.id]},
                {"name": "Formwork and sundries", "scope": "", "reason": "", "keeps": [formwork.id, other.id]},
            ],
        )
        assert [(packages.code(p), p.name) for p in packages.packages(session, project_id)] == [
            ("01", "Concrete works"),
            ("02", "Formwork and sundries"),
        ]
        assert placed(session, project_id) == {
            1: "Concrete works",
            2: "Concrete works",
            3: "Formwork and sundries",
            4: "Formwork and sundries",
        }
        assert packages.assignments(session, project_id)[items[3].id].decided_by == "engineer"  # kept who placed it

        # Concrete split in two: its items are placed again. A new package gets the next number.
        packages.apply_plan(
            session,
            project,
            [
                {"name": "Plain concrete", "scope": "", "reason": "", "keeps": [concrete.id]},
                {"name": "Reinforced concrete", "scope": "", "reason": "", "keeps": [concrete.id]},
                {"name": "Formwork and sundries", "scope": "", "reason": "", "keeps": [formwork.id]},
            ],
        )
        assert [(packages.code(p), p.name) for p in packages.packages(session, project_id)] == [
            ("04", "Plain concrete"),
            ("05", "Reinforced concrete"),
            ("02", "Formwork and sundries"),
        ]
        assert placed(session, project_id) == {3: "Formwork and sundries", 4: "Formwork and sundries"}


def test_an_item_is_only_ever_in_one_package_and_the_engineer_has_the_last_word(client):
    project_id = laid_out(client, {"Tower.xlsx": workbook()})
    with client.app.state.sessions() as session:
        project = session.get(Project, project_id)
        concrete, formwork = planned(session, project_id)
        item = by_ref(session, project_id)[1]
        packages.place(session, project, [item], concrete, "agent")
        packages.place(session, project, [item], formwork, "agent")  # moved, not copied
        assert placed(session, project_id) == {1: "Formwork"}

        packages.place(session, project, [item], concrete, "engineer")
        with pytest.raises(packages.Refused) as refused:
            packages.place(session, project, [item], formwork, "agent")
        assert refused.value.code == "decided_by_engineer"
        assert placed(session, project_id) == {1: "Concrete"}


def test_coverage_counts_from_the_ledger(client):
    project_id = laid_out(client, {"Tower.xlsx": workbook()})
    with client.app.state.sessions() as session:
        project = session.get(Project, project_id)
        concrete, _ = planned(session, project_id)
        items = by_ref(session, project_id)
        packages.place(session, project, [items[1], items[2]], concrete, "agent")
        coverage = packages.coverage(session, project_id, {items[4].id})
        assert (coverage.items, coverage.placed, coverage.unplaced, coverage.waiting) == (4, 2, 1, 1)
        assert coverage.pages_left == 2  # the Arabic sheet and the rates sheet aren't handled yet
        assert not coverage.complete
        assert (coverage.packages[0].items, str(coverage.packages[0].amount)) == (2, "1465585.13")
        [total] = coverage.totals  # the sheet's one stated total against all its items
        assert (total["where"], total["count"], str(total["stated_sum"])) == ("Div.03", 1, "1465585.13")
        assert total["difference"] == 0


def revised() -> bytes:
    """The same BOQ with one quantity changed and one item added: a revision."""
    book = openpyxl.load_workbook(io.BytesIO(workbook()))
    sheet = book["Div.03"]
    sheet["D9"] = 90
    sheet["A13"], sheet["B13"], sheet["C13"], sheet["D13"] = "3.1.5", "Dowel bars to joints", "No.", 40
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def test_a_revised_file_waits_for_the_engineer_then_carries_placements_over(client):
    project_id = laid_out(client, {"Tower.xlsx": workbook()})
    with client.app.state.sessions() as session:
        project = session.get(Project, project_id)
        concrete, formwork = planned(session, project_id)
        items = by_ref(session, project_id)
        packages.place(session, project, [items[1], items[2]], concrete, "agent")
        packages.place(session, project, [items[3], items[4]], formwork, "engineer")
        session.commit()

    client.post(f"/projects/{project_id}/sources", files=[("files", ("Tower R1.xlsx", revised()))])
    project = read_all(client, project_id)
    new_id = project["sources"][1]["id"]
    with client.app.state.sessions() as session:
        [overlap] = decisions.waiting(session, project_id, "overlap")
        assert overlap.raised_by == "tawreed" and overlap.payload["recommended"] == "revision"
        assert session.get(Source, new_id).relation == "pending"
        ledger.lay_out_sheet(session, client.app.state.home, session.get(Source, new_id), 1, DIV03, "agent")
        session.commit()
        assert len(packages.active_items(session, project_id)) == 4  # the new file's items don't count yet

    work = client.get(f"/projects/{project_id}/work").json()
    assert (work["decisions"][0]["file"], work["decisions"][0]["earlier"]) == ("Tower R1.xlsx", "Tower.xlsx")
    response = client.post(f"/projects/{project_id}/decisions/{overlap.id}", json={"relation": "revision"})
    assert response.status_code == 204

    with client.app.state.sessions() as session:
        assert session.get(Source, project["sources"][0]["id"]).active is False
        active = packages.active_items(session, project_id)
        assert {i.source_id for i in active} == {new_id}
        codes = {i.ref: i.code for i in active}
        assert {codes[r]: p for r, p in placed(session, project_id).items()} == {
            "3.1.1": "Concrete",  # its quantity changed, but it is the same item: it stays in its package
            "3.1.2": "Concrete",
            "3.1.3": "Formwork",
            "3.1.4": "Formwork",
        }  # 3.1.5 is new: it waits to be placed
        deciders = {
            codes[i.ref]: packages.assignments(session, project_id)[i.id].decided_by
            for i in active
            if i.code != "3.1.5"
        }
        assert deciders == {"3.1.1": "revision", "3.1.2": "revision", "3.1.3": "engineer", "3.1.4": "engineer"}


def test_the_engineer_edits_packages_directly(client):
    project_id = laid_out(client, {"Tower.xlsx": workbook()})
    with client.app.state.sessions() as session:
        concrete, formwork = planned(session, project_id)
        items = by_ref(session, project_id)
        waiting = decisions.raise_decision(
            session,
            project_id,
            "uncertain",
            {
                "item_id": items[4].id,
                "candidates": [concrete.id, formwork.id],
                "recommended": formwork.id,
                "reason": "",
            },
            "agent",
        )
        session.commit()
    url = f"/projects/{project_id}"

    created = client.post(f"{url}/packages", json={"name": "Waterproofing", "scope": "Membranes"}).json()
    assert created["code"] == "03"
    assert (
        client.post(f"{url}/packages", json={"name": "waterproofing"}).json()["detail"]["code"] == "package_name_taken"
    )
    moved = client.post(f"{url}/placements", json={"item_ids": [items[3].id, items[4].id], "package_id": created["id"]})
    assert moved.status_code == 204
    assert client.patch(f"{url}/packages/{created['id']}", json={"name": "Waterproofing and joints"}).status_code == 200
    assert client.post(f"{url}/packages/{concrete.id}/merge", json={"package_ids": [created["id"]]}).status_code == 204

    work = client.get(f"{url}/work").json()
    assert [(p["name"], p["items"]) for p in work["packages"]] == [("Concrete", 2), ("Formwork", 0)]
    assert work["decisions"] == []  # moving the item settled the agent's question about it
    listed = client.get(f"{url}/items", params={"package_id": concrete.id}).json()
    assert [(i["ref"], i["decided_by"]) for i in listed["items"]] == [(3, "engineer"), (4, "engineer")]
    assert client.get(f"{url}/items", params={"unplaced": True}).json()["total"] == 2

    assert client.delete(f"{url}/packages/{concrete.id}").status_code == 204
    assert client.get(f"{url}/items", params={"unplaced": True}).json()["total"] == 4
    with client.app.state.sessions() as session:
        assert session.get(decisions.Decision, waiting.id).status == "withdrawn"


def test_an_uncertain_item_answered_for_all_projects_becomes_a_rule_everywhere(client):
    project_id = laid_out(client, {"Tower.xlsx": workbook()})
    with client.app.state.sessions() as session:
        concrete, formwork = planned(session, project_id)
        item = by_ref(session, project_id)[4]
        decision = decisions.raise_decision(
            session,
            project_id,
            "uncertain",
            {"item_id": item.id, "candidates": [concrete.id, formwork.id], "recommended": formwork.id, "reason": "?"},
            "agent",
        )
        session.commit()
    body = {"package_id": formwork.id, "scope": "all"}
    assert client.post(f"/projects/{project_id}/decisions/{decision.id}", json=body).status_code == 204
    again = client.post(f"/projects/{project_id}/decisions/{decision.id}", json=body)
    assert again.json()["detail"]["code"] == "decision_closed"

    rules = client.get("/rules").json()
    assert [r["text"] for r in rules] == ["“Waterstops to construction joints” (L.M.) belongs in Formwork."]
    other = start(client, {"Other.csv": b"Item,Description,Unit,Qty\n1,Excavation,m3,10\n"})["id"]
    with client.app.state.sessions() as session:
        assert [r.text for r in packages.rules(session, other)] == [rules[0]["text"]]
    assert client.delete(f"/rules/{rules[0]['id']}").status_code == 204
    assert client.get("/rules").json() == []


def test_existing_items_are_numbered_by_the_migration(tmp_path):
    from alembic import command
    from alembic.config import Config

    from tawreed.core.db import MIGRATIONS, open_database

    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    database = tmp_path / "tawreed.sqlite"
    from sqlalchemy import create_engine

    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0002")
    engine.dispose()
    with sqlite3.connect(database) as db:
        db.execute("INSERT INTO projects VALUES ('p1', 'One', '2026-09-27', '2026-09-27')")
        db.execute("INSERT INTO projects VALUES ('p2', 'Two', '2026-09-27', '2026-09-27')")
        for project, source in (("p1", "s1"), ("p2", "s2")):
            db.execute(
                "INSERT INTO sources (id, project_id, filename, sha256, size, kind, added_at, status) "
                f"VALUES ('{source}', '{project}', 'f.csv', '{source}', 1, 'csv', '2026-09-27', 'read')"
            )
        for n, project, source in ((1, "p1", "s1"), (2, "p2", "s2"), (3, "p1", "s1")):
            db.execute(
                "INSERT INTO items (id, project_id, source_id, page, position, code, description, unit, quantity_text,"
                " rate_text, amount_text, comment, headings, provenance, origin, verify) VALUES "
                f"('i{n}', '{project}', '{source}', 1, {n}, '', 'x', '', '', '', '', '', '[]', '{{}}', 'cell', 0)"
            )
    open_database(tmp_path).kw["bind"].dispose()  # brings it up to date
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT id, ref FROM items ORDER BY id").fetchall() == [("i1", 1), ("i2", 1), ("i3", 2)]
        assert db.execute("SELECT active, relation FROM sources").fetchall() == [(1, None), (1, None)]


def test_a_sheet_with_a_total_per_section_reconciles_when_the_sections_add_up(client):
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = "Mechanical"
    rows = [
        ("1", "Split unit 2 TR", "No.", 4, 1000.1, 4000.4),
        ("", "TOTAL", "", "", "", 4000.4),
        ("2", "Exhaust fan", "No.", 3, 86.99999999999999, 260.99999999999997),  # Excel's float noise
        ("", "TOTAL", "", "", "", 260.99999999999997),
    ]
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    project = read_all(client, start(client, {"Sections.xlsx": buffer.getvalue()})["id"])
    layout = SheetLayout(first_row=1, code="A", description=["B"], unit="C", quantity="D", rate="E", amount="F")
    with client.app.state.sessions() as session:
        ledger.lay_out_sheet(
            session, client.app.state.home, session.get(Source, project["sources"][0]["id"]), 1, layout, "agent"
        )
        session.commit()
        [total] = packages.coverage(session, project["id"], set()).totals
    assert total["count"] == 2 and packages.money(total["stated_sum"]) == Decimal("4261.40")
    assert str(packages.money(total["difference"])) == "0.00"  # each section total, added up, equals the items
