"""The BOQ files of a project. Tawreed keeps an unchanged copy of each, named by its content hash, and reads it
into pages: one per sheet, PDF page or image frame."""

import hashlib
import json
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PureWindowsPath
from typing import Any, BinaryIO

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, UniqueConstraint, select
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from tawreed.core.db import Base, UTCDateTime, now
from tawreed.projects import Project, folder
from tawreed.sources import readers

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
FILES_MOST = 50  # files in one drop
DROP_LIMIT_MB = 500  # megabytes in one drop
NAME_MOST = 260  # characters of a file name kept
CHUNK = 1024 * 1024


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
    status: Mapped[str] = mapped_column(String(16), default="added")  # added | reading | read | failed
    problem: Mapped[str | None] = mapped_column(String(40))  # why reading failed, as a code
    # Against an earlier file it overlaps: pending (waiting for the engineer) | addition | replacement | revision
    relation: Mapped[str | None] = mapped_column(String(16))
    replaces_id: Mapped[str | None] = mapped_column(String(32))  # the earlier file a replacement or revision sets aside
    active: Mapped[bool] = mapped_column(Boolean, default=True)  # False once a newer file replaces or revises it

    project = relationship(Project, back_populates="sources")
    pages = relationship("SourcePage", order_by="SourcePage.number", passive_deletes=True)

    @property
    def page_count(self) -> int:
        return len(self.pages)


class SourcePage(Base):
    """One sheet, PDF page or image frame. Its content (cells or positioned text) is kept in a JSON file."""

    __tablename__ = "source_pages"
    __table_args__ = (UniqueConstraint("source_id", "number"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)  # from 1, in file order
    kind: Mapped[str] = mapped_column(String(8))  # sheet | page | image
    name: Mapped[str] = mapped_column(String(100), default="")  # the sheet's name
    has_text: Mapped[bool] = mapped_column(Boolean)  # False for scans and images: read from the image instead
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)  # a hidden sheet
    rows: Mapped[int | None] = mapped_column(Integer)
    cols: Mapped[int | None] = mapped_column(Integer)
    width: Mapped[float | None] = mapped_column(Float)
    height: Mapped[float | None] = mapped_column(Float)


def safe_name(filename: str) -> str:
    """A file name as Tawreed keeps it: the part after any folder (Windows or not), without control characters,
    at most NAME_MOST characters with its extension kept."""
    name = re.sub(r"[\x00-\x1f]", "", PureWindowsPath(filename).name).strip()
    if len(name) > NAME_MOST:
        suffix = Path(name).suffix[:20]
        name = name[: NAME_MOST - len(suffix)] + suffix
    return name


@dataclass(frozen=True)
class Incoming:
    """A dropped file: its name and its bytes, read in chunks from `file` (an upload already spooled to disk) or
    given whole as `data`."""

    filename: str
    data: bytes = b""
    file: BinaryIO | None = None

    @property
    def size(self) -> int:
        if self.file is None:
            return len(self.data)
        here = self.file.tell()
        end = self.file.seek(0, os.SEEK_END)
        self.file.seek(here)
        return end

    def chunks(self):
        if self.file is None:
            yield self.data
            return
        self.file.seek(0)
        while chunk := self.file.read(CHUNK):
            yield chunk


class Rejected(Exception):
    """A file Tawreed won't take, with the reason as a stable code the interface translates."""

    def __init__(self, code: str, filename: str, **params: int):
        super().__init__(f"{code}: {filename}")
        self.code = code
        self.filename = filename
        self.params = params


def check(files: list[Incoming]) -> None:
    """Refuse the whole batch if any file is unusable, so a drop never half-succeeds."""
    if not files:
        raise Rejected("no_files", "")
    if len(files) > FILES_MOST:
        raise Rejected("too_many_files", "", limit=FILES_MOST)
    if sum(f.size for f in files) > DROP_LIMIT_MB * 1024 * 1024:
        raise Rejected("drop_too_large", "", limit_mb=DROP_LIMIT_MB)
    for file in files:
        if Path(file.filename).suffix.lower() not in KINDS:
            raise Rejected("unsupported_file", file.filename)
        if not file.size:
            raise Rejected("empty_file", file.filename)
        if file.size > SIZE_LIMIT:
            raise Rejected("file_too_large", file.filename)


def _hash_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def write_atomically(path: Path, write) -> None:
    """Write through a temporary file in the same folder, then rename it into place: a crash or a full disk never
    leaves half a file under the real name. `write` gets the open temporary file."""
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("wb") as handle:
            write(handle)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def add_files(session: Session, home: Path, project: Project, files: list[Incoming]) -> list[Source]:
    """Keep a copy of each file and record it. The same file twice in a project is kept once."""
    check(files)
    known = set(session.scalars(select(Source.sha256).where(Source.project_id == project.id)))
    store = folder(home, project.id) / "sources"
    store.mkdir(parents=True, exist_ok=True)
    added = []
    for file in files:
        digest = hashlib.sha256()
        for chunk in file.chunks():
            digest.update(chunk)
        sha = digest.hexdigest()
        if sha in known:
            continue
        suffix = Path(file.filename).suffix.lower()
        copy = store / f"{sha}{suffix}"
        if not copy.exists() or _hash_of(copy) != sha:  # a copy that was damaged is written again
            write_atomically(copy, lambda handle, file=file: [handle.write(c) for c in file.chunks()])
        source = Source(
            project_id=project.id,
            filename=safe_name(file.filename),
            sha256=sha,
            size=file.size,
            kind=KINDS[suffix],
        )
        session.add(source)
        known.add(sha)
        added.append(source)
    project.updated_at = now()
    return added


def copy_of(home: Path, source: Source) -> Path:
    """Tawreed's unchanged copy of the file."""
    return folder(home, source.project_id) / "sources" / f"{source.sha256}{Path(source.filename).suffix.lower()}"


def pages_folder(home: Path, source: Source) -> Path:
    return folder(home, source.project_id) / "pages" / source.id


def page_content(home: Path, source: Source, number: int) -> dict[str, Any]:
    return json.loads((pages_folder(home, source) / f"{number}.json").read_text(encoding="utf-8"))


def page_image(home: Path, source: Source, number: int) -> bytes:
    """A PNG of a PDF page or an image; drawn once, then kept beside the page's content."""
    cached = pages_folder(home, source) / f"{number}.png"
    if not cached.exists():
        png = readers.render(copy_of(home, source), source.kind, number)
        cached.parent.mkdir(parents=True, exist_ok=True)
        write_atomically(cached, lambda handle: handle.write(png))
    return cached.read_bytes()


def get_source(session: Session, project_id: str, source_id: str) -> Source | None:
    source = session.get(Source, source_id)
    return source if source and source.project_id == project_id else None
