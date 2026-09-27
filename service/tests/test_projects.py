import hashlib

import pytest
from conftest import TOKEN
from fastapi.testclient import TestClient

from tawreed.api.app import create_app
from tawreed.projects import name_from_filename
from tawreed.sources import SIZE_LIMIT

XLSX = b"PK\x03\x04 a synthetic workbook"
PDF = b"%PDF-1.7 a synthetic BOQ"


def start(client, files, name=None):
    data = {"name": name} if name is not None else None
    return client.post("/projects", files=[("files", (n, b)) for n, b in files], data=data)


def test_dropping_files_starts_a_project_named_after_the_first_file(client, tmp_path):
    response = start(client, [("BoQ_Package 04 - R1.xlsx", XLSX), ("Electrical.pdf", PDF)])
    assert response.status_code == 201
    project = response.json()
    assert project["name"] == "BoQ Package 04 - R1"
    assert [(s["filename"], s["kind"], s["size"]) for s in project["sources"]] == [
        ("BoQ_Package 04 - R1.xlsx", "spreadsheet", len(XLSX)),
        ("Electrical.pdf", "pdf", len(PDF)),
    ]


def test_the_copies_are_unchanged_and_named_by_their_hash(client, tmp_path):
    project = start(client, [("Tower.xlsx", XLSX)]).json()
    copy = tmp_path / "projects" / project["id"] / "sources" / f"{hashlib.sha256(XLSX).hexdigest()}.xlsx"
    assert copy.read_bytes() == XLSX


def test_a_given_name_wins(client):
    assert start(client, [("x.csv", b"a,b\n1,2\n")], name="  Al Noor Tower  ").json()["name"] == "Al Noor Tower"


def test_the_same_file_twice_is_kept_once(client):
    project = start(client, [("A.xlsx", XLSX), ("A copy.xlsx", XLSX)]).json()
    assert len(project["sources"]) == 1
    again = client.post(f"/projects/{project['id']}/sources", files=[("files", ("A.xlsx", XLSX))]).json()
    assert len(again["sources"]) == 1


def test_adding_files_to_a_project(client):
    project = start(client, [("A.xlsx", XLSX)]).json()
    added = client.post(f"/projects/{project['id']}/sources", files=[("files", ("MEP.pdf", PDF))])
    assert added.status_code == 200
    assert [s["filename"] for s in added.json()["sources"]] == ["A.xlsx", "MEP.pdf"]


@pytest.mark.parametrize(
    ("files", "code"),
    [
        ([("notes.docx", b"word")], "unsupported_file"),
        ([("A.xlsx", XLSX), ("empty.pdf", b"")], "empty_file"),
        ([("huge.pdf", b"0" * (SIZE_LIMIT + 1))], "file_too_large"),
    ],
)
def test_a_bad_file_refuses_the_whole_drop(client, tmp_path, files, code):
    response = start(client, files)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code
    assert client.get("/projects").json() == []
    assert not (tmp_path / "projects").exists()


def test_projects_list_most_recent_first_with_their_file_count(client):
    first = start(client, [("First.xlsx", XLSX)]).json()
    start(client, [("Second.pdf", PDF)])
    client.post(f"/projects/{first['id']}/sources", files=[("files", ("More.pdf", PDF))])
    listed = client.get("/projects").json()
    assert [(p["name"], p["files"]) for p in listed] == [("First", 2), ("Second", 1)]


def test_rename(client):
    project = start(client, [("A.xlsx", XLSX)]).json()
    renamed = client.patch(f"/projects/{project['id']}", json={"name": " Riverside Clinic "})
    assert renamed.json()["name"] == "Riverside Clinic"
    assert client.patch(f"/projects/{project['id']}", json={"name": "  "}).status_code == 422


def test_unknown_project(client):
    response = client.get("/projects/nope")
    assert response.status_code == 404
    assert response.json()["detail"] == {"code": "project_not_found"}


def test_data_survives_a_restart(tmp_path):
    headers = {"Authorization": f"Bearer {TOKEN}"}
    with TestClient(create_app(tmp_path, TOKEN), headers=headers) as c:
        start(c, [("Kept.xlsx", XLSX)])
    with TestClient(create_app(tmp_path, TOKEN), headers=headers) as c:
        assert [p["name"] for p in c.get("/projects").json()] == ["Kept"]
    assert (tmp_path / "tawreed.sqlite").exists()


@pytest.mark.parametrize(
    ("filename", "name"),
    [("Tower_BOQ.xlsx", "Tower BOQ"), ("  spaced   out .pdf", "spaced out"), (".xlsx", "Untitled project")],
)
def test_name_from_filename(filename, name):
    assert name_from_filename(filename) == name
