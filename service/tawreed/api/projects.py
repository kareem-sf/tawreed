from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Request, UploadFile
from pydantic import BaseModel, ConfigDict, StringConstraints

from tawreed import projects as service
from tawreed import publish, sources
from tawreed.api.common import DB, Home, problem
from tawreed.projects import NAME_LIMIT

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


def _incoming(files: list[UploadFile]) -> list[sources.Incoming]:
    incoming = []
    for upload in files:
        data = upload.file.read(sources.SIZE_LIMIT + 1)  # one byte over is enough to know it's too large
        incoming.append(sources.Incoming(filename=upload.filename or "", data=data))
    return incoming


def _checked(files: list[UploadFile]) -> list[sources.Incoming]:
    incoming = _incoming(files)
    try:
        sources.check(incoming)
    except sources.Rejected as rejected:
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
    files: Annotated[list[UploadFile], File()],
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


@router.post("/{project_id}/sources")
def add_sources(
    project_id: str, request: Request, session: DB, home: Home, files: Annotated[list[UploadFile], File()]
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
