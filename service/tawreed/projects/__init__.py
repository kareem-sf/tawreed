"""Projects: a name, the BOQ files added to it, and the engineer's consent to send its content to an AI service."""

import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import Boolean, ForeignKey, Integer, String, select
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from tawreed.core.db import Base, UTCDateTime, now

NAME_LIMIT = 200


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    name: Mapped[str] = mapped_column(String(NAME_LIMIT))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)  # also when its work last changed
    # Stopped by the engineer, or paused by Tawreed (an AI failure, a long run); a message or an answer resumes it
    agent_paused: Mapped[bool] = mapped_column(Boolean, default=False)
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
