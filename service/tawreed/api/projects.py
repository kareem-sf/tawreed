from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import delete, select

from tawreed import projects as service
from tawreed import publish, sources
from tawreed.api.common import DB, Home, problem
from tawreed.projects import NAME_LIMIT, Project
from tawreed.sources import Source

router = APIRouter(prefix="/projects", tags=["projects"])

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=NAME_LIMIT)]


class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    size: int
    kind: Literal["spreadsheet", "csv", "pdf", "image"]
    added_at: datetime
    status: Literal["added", "reading", "read", "failed"]
    problem: str | None
    page_count: int


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    sources: list[SourceOut]


class ProjectSummary(BaseModel):
    id: str
    name: str
    updated_at: datetime
    files: int
    revision: str | None  # the latest published, "Rev 02"


class ProjectChange(BaseModel):
    name: Name


def _incoming(files: list[UploadFile | str] | None) -> list[sources.Incoming]:
    """The dropped files, still on disk where the upload was spooled. A file part with no name and no bytes is how a
    browser sends a form with nothing chosen: it is not a file."""
    incoming = []
    for upload in files or []:
        if isinstance(upload, str):  # a part with no file name is a plain form field: nothing was chosen
            continue
        if not upload.filename and not upload.size:
            continue
        incoming.append(sources.Incoming(filename=sources.safe_name(upload.filename or ""), file=upload.file))
    return incoming


def _checked(files: list[UploadFile | str] | None) -> list[sources.Incoming]:
    incoming = _incoming(files)
    try:
        sources.check(incoming)
    except sources.Rejected as rejected:
        if rejected.code in ("too_many_files", "drop_too_large"):
            raise problem(413, rejected.code, **rejected.params) from rejected
        raise problem(422, rejected.code, file=rejected.filename) from rejected
    return incoming


@router.get("")
def list_projects(session: DB) -> list[ProjectSummary]:
    summaries = []
    for p in service.list_projects(session):
        latest = publish.latest(session, p.id)
        summaries.append(
            ProjectSummary(
                id=p.id, name=p.name, updated_at=p.updated_at, files=len(p.sources), revision=latest and latest.name
            )
        )
    return summaries


@router.post("", status_code=201)
def start_project(
    request: Request,
    session: DB,
    home: Home,
    files: Annotated[list[UploadFile | str] | None, File()] = None,
    name: Annotated[str | None, Form()] = None,
) -> ProjectOut:
    """Start a project from dropped BOQ files. Without a name, it is named after the first file."""
    incoming = _checked(files)
    title = (name or "").strip()[:NAME_LIMIT] or service.name_from_filename(incoming[0].filename)
    project = service.create_project(session, title)
    sources.add_files(session, home, project, incoming)
    session.commit()
    request.app.state.reader.wake()
    session.refresh(project)
    return ProjectOut.model_validate(project)


@router.get("/{project_id}")
def get_project(project_id: str, session: DB) -> ProjectOut:
    project = service.get_project(session, project_id)
    if project is None:
        raise problem(404, "project_not_found")
    return ProjectOut.model_validate(project)


@router.patch("/{project_id}")
def change_project(project_id: str, body: ProjectChange, session: DB) -> ProjectOut:
    project = service.get_project(session, project_id)
    if project is None:
        raise problem(404, "project_not_found")
    return ProjectOut.model_validate(service.rename_project(session, project, body.name))


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, request: Request, session: DB, home: Home) -> Response:
    """Delete a project and everything Tawreed keeps for it: its copies of the BOQ files, what was read from them,
    the work, the decisions and every revision. Files the engineer exported or saved elsewhere are not touched. A
    project whose step is still running, or whose file is still being read, is stopped first and deleted once that
    has finished."""
    project = service.get_project(session, project_id)
    if project is None:
        raise problem(404, "project_not_found")
    worker = request.app.state.worker
    session.rollback()  # stopping writes through a session of its own: this one must not hold the database
    worker.stop(project_id)
    if worker.running(project_id):
        raise problem(409, "project_busy")
    # One statement, so the reader cannot start on one of its files between a check and the delete
    reading = select(Source.id).where(Source.project_id == project_id, Source.status == "reading").exists()
    deleted = session.execute(delete(Project).where(Project.id == project_id, ~reading)).rowcount
    session.commit()  # the database removes everything that belongs to the project
    if not deleted:
        raise problem(409, "project_busy")
    service.remove_folder(home, project_id)
    return Response(status_code=204)


@router.post("/{project_id}/sources")
def add_sources(
    project_id: str,
    request: Request,
    session: DB,
    home: Home,
    files: Annotated[list[UploadFile | str] | None, File()] = None,
) -> ProjectOut:
    """Add more BOQ files to a project. A file the project already has is ignored."""
    project = service.get_project(session, project_id)
    if project is None:
        raise problem(404, "project_not_found")
    sources.add_files(session, home, project, _checked(files))
    session.commit()
    request.app.state.reader.wake()
    session.refresh(project)
    return ProjectOut.model_validate(project)
