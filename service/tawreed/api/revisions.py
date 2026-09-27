"""Published revisions: what each holds, and opening or exporting its folder."""

from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Response
from pydantic import BaseModel

from tawreed import projects as project_records
from tawreed import publish
from tawreed.api.common import DB, Home, problem

router = APIRouter(prefix="/projects/{project_id}/revisions", tags=["revisions"])


class RevisionFile(BaseModel):
    path: str
    bytes: int


class RevisionOut(BaseModel):
    number: int
    name: str
    created_at: datetime
    items: int
    packages: int
    files: list[RevisionFile]


def revision_out(revision: publish.Revision) -> RevisionOut:
    manifest = revision.manifest
    return RevisionOut(
        number=revision.number,
        name=revision.name,
        created_at=revision.created_at,
        items=manifest["items"],
        packages=len(manifest["packages"]),
        files=[RevisionFile(path=f["path"], bytes=f["bytes"]) for f in manifest["files"]],
    )


def _revision(session, project_id: str, number: int) -> publish.Revision:
    if project_records.get_project(session, project_id) is None:
        raise problem(404, "project_not_found")
    revision = publish.get_revision(session, project_id, number)
    if revision is None:
        raise problem(404, "revision_not_found")
    return revision


@router.get("")
def list_revisions(project_id: str, session: DB) -> list[RevisionOut]:
    if project_records.get_project(session, project_id) is None:
        raise problem(404, "project_not_found")
    return [revision_out(r) for r in reversed(publish.revisions(session, project_id))]


@router.post("/{number}/open", status_code=204)
def open_revision(project_id: str, number: int, session: DB, home: Home) -> Response:
    """Show the revision's folder in the file manager."""
    publish.open_folder(home, _revision(session, project_id, number))
    return Response(status_code=204)


@router.get("/{number}/export", response_class=Response)
def export_revision(project_id: str, number: int, session: DB, home: Home) -> Response:
    """The revision's files in one zip, to save wherever the engineer chooses."""
    revision = _revision(session, project_id, number)
    project = project_records.get_project(session, project_id)
    filename = f"{publish.workbooks.file_name(project.name)} - {revision.name}.zip"
    return Response(
        publish.zipped(home, revision),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )
