"""The BOQ files of a project. Tawreed keeps an unchanged copy of each, named by its content hash."""

import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, select
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from tawreed.core.db import Base, UTCDateTime, now
from tawreed.projects import Project, folder

KINDS = {
    ".xlsx": "spreadsheet",
    ".xlsm": "spreadsheet",
    ".xls": "spreadsheet",
    ".ods": "spreadsheet",
    ".csv": "csv",
    ".pdf": "pdf",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".tif": "image",
    ".tiff": "image",
    ".webp": "image",
}
SIZE_LIMIT = 100 * 1024 * 1024  # bytes per file


class Source(Base):
    __tablename__ = "sources"
    __table_args__ = (UniqueConstraint("project_id", "sha256"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(260))
    sha256: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(16))
    added_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)

    project = relationship(Project, back_populates="sources")


@dataclass(frozen=True)
class Incoming:
    filename: str
    data: bytes


class Rejected(Exception):
    """A file Tawreed won't take, with the reason as a stable code the interface translates."""

    def __init__(self, code: str, filename: str):
        super().__init__(f"{code}: {filename}")
        self.code = code
        self.filename = filename


def check(files: list[Incoming]) -> None:
    """Refuse the whole batch if any file is unusable, so a drop never half-succeeds."""
    if not files:
        raise Rejected("no_files", "")
    for file in files:
        if Path(file.filename).suffix.lower() not in KINDS:
            raise Rejected("unsupported_file", file.filename)
        if not file.data:
            raise Rejected("empty_file", file.filename)
        if len(file.data) > SIZE_LIMIT:
            raise Rejected("file_too_large", file.filename)


def add_files(session: Session, home: Path, project: Project, files: list[Incoming]) -> list[Source]:
    """Keep a copy of each file and record it. The same file twice in a project is kept once."""
    check(files)
    known = set(session.scalars(select(Source.sha256).where(Source.project_id == project.id)))
    store = folder(home, project.id) / "sources"
    store.mkdir(parents=True, exist_ok=True)
    added = []
    for file in files:
        digest = hashlib.sha256(file.data).hexdigest()
        if digest in known:
            continue
        suffix = Path(file.filename).suffix.lower()
        copy = store / f"{digest}{suffix}"
        if not copy.exists():
            copy.write_bytes(file.data)
        source = Source(
            project_id=project.id,
            filename=Path(file.filename).name,
            sha256=digest,
            size=len(file.data),
            kind=KINDS[suffix],
        )
        session.add(source)
        known.add(digest)
        added.append(source)
    project.updated_at = now()
    return added
