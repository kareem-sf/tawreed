"""Projects: a name, the BOQ files added to it, and the engineer's consent to send its content to an AI service."""

import logging
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, select
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from tawreed.core.db import Base, UTCDateTime, now
from tawreed.core.home import long_path

log = logging.getLogger("tawreed.projects")

NAME_LIMIT = 200


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    name: Mapped[str] = mapped_column(String(NAME_LIMIT))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)  # also when its work last changed
    # Stopped by the engineer, or paused by Tawreed (an AI failure, a step that got nowhere); Continue carries on
    paused: Mapped[bool] = mapped_column(Boolean, default=False)
    pause_reason: Mapped[dict[str, Any] | None] = mapped_column(JSON)  # {code, ...details}
    # The engineer's Redo waiting for its step: {step, note, source_id?}, cleared once the step has run
    redo: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    # The highest package number given, so a removed package's number (its code, "03") is never given again
    package_numbers: Mapped[int] = mapped_column(Integer, default=0)

    sources = relationship("Source", back_populates="project", order_by="Source.added_at", passive_deletes=True)


class Consent(Base):
    """The engineer allowed this project's content to go to this connection's service."""

    __tablename__ = "consents"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    connection_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    granted_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


def folder(home: Path, project_id: str) -> Path:
    return home / "projects" / project_id


def remove_folder(home: Path, project_id: str) -> None:
    """Remove a deleted project's folder. A file open in another program (a workbook open in Excel) can keep part
    of it; what is left is removed when Tawreed next starts."""
    path = long_path(folder(home, project_id))
    shutil.rmtree(path, ignore_errors=True)
    if path.exists():
        log.warning("Part of deleted project %s is still in use; it is removed at the next start", project_id)


def remove_leftovers(session: Session, home: Path) -> None:
    """Remove the folders of projects that no longer exist. Run at start, before anything else uses the folders."""
    root = home / "projects"
    if not root.is_dir():
        return
    kept = set(session.scalars(select(Project.id)))
    for path in root.iterdir():
        if path.is_dir() and path.name not in kept:
            remove_folder(home, path.name)


def name_from_filename(filename: str) -> str:
    """A first name for a project started by dropping a file: the file's name without its extension."""
    base = Path(filename).name
    stem = base.rsplit(".", 1)[0] if "." in base else base  # ".xlsx" has no name, only an extension
    return " ".join(stem.replace("_", " ").split())[:NAME_LIMIT] or "Untitled project"


def create_project(session: Session, name: str) -> Project:
    project = Project(name=name)
    session.add(project)
    session.flush()
    return project


def list_projects(session: Session) -> list[Project]:
    return list(session.scalars(select(Project).order_by(Project.updated_at.desc())))


def get_project(session: Session, project_id: str) -> Project | None:
    return session.get(Project, project_id)


def rename_project(session: Session, project: Project, name: str) -> Project:
    project.name = name
    project.updated_at = now()
    session.commit()
    return project
