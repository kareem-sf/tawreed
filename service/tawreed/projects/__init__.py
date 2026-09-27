"""Projects: a name and the BOQ files added to it."""

import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import String, select
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from tawreed.core.db import Base, UTCDateTime, now

NAME_LIMIT = 200


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    name: Mapped[str] = mapped_column(String(NAME_LIMIT))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)

    sources = relationship("Source", back_populates="project", order_by="Source.added_at", passive_deletes=True)


def folder(home: Path, project_id: str) -> Path:
    return home / "projects" / project_id


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
