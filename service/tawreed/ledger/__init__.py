"""The item ledger: every BOQ item exactly as its source states it, with where it came from.

Items are only ever written from a page by the extractor (or, for a scan, from what the AI read on the page image,
marked for checking). Nothing else changes an item's code, description, unit, quantity, rate, amount or comment."""

import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text, UniqueConstraint, delete, func, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from tawreed.core.db import Base, UTCDateTime, now
from tawreed.ledger.extract import (
    Draft,
    PdfLayout,
    Report,
    SheetLayout,
    TranscribedRow,
    extract_pdf,
    extract_sheet,
    transcribed,
)
from tawreed.sources import Source, page_content


class Item(Base):
    __tablename__ = "items"
    __table_args__ = (UniqueConstraint("project_id", "ref"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    ref: Mapped[int] = mapped_column(Integer)  # a short number within the project, never reused while it exists
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    page: Mapped[int] = mapped_column(Integer)
    position: Mapped[int] = mapped_column(Integer)  # order within the page
    code: Mapped[str] = mapped_column(String(80), default="")
    description: Mapped[str] = mapped_column(Text)
    unit: Mapped[str] = mapped_column(String(40), default="")
    quantity: Mapped[str | None] = mapped_column(String(40))  # a decimal, as text so nothing is rounded
    quantity_text: Mapped[str] = mapped_column(String(80), default="")  # as the source wrote it
    rate: Mapped[str | None] = mapped_column(String(40))
    rate_text: Mapped[str] = mapped_column(String(80), default="")
    amount: Mapped[str | None] = mapped_column(String(40))
    amount_text: Mapped[str] = mapped_column(String(80), default="")
    comment: Mapped[str] = mapped_column(Text, default="")
    headings: Mapped[list[str]] = mapped_column(JSON, default=list)  # the nearest headings above it
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON)  # sheet, row and cells; or page, lines and box
    origin: Mapped[str] = mapped_column(String(8))  # cell | text | image
    verify: Mapped[bool] = mapped_column(Boolean, default=False)  # read from an image: check against the page


class Layout(Base):
    """The layout an extraction used, and what it found: kept so every item can be traced to how it was read."""

    __tablename__ = "layouts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    pages: Mapped[list[int]] = mapped_column(JSON)
    spec: Mapped[dict[str, Any]] = mapped_column(JSON)
    report: Mapped[dict[str, Any]] = mapped_column(JSON)
    decided_by: Mapped[str] = mapped_column(String(16))  # agent | engineer
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class NotReadable(Exception):
    """The page can't be laid out this way (wrong kind of page, or not read yet)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def lay_out_sheet(
    session: Session, home: Path, source: Source, page: int, layout: SheetLayout, by: str
) -> dict[str, Any]:
    content = content_of(home, source, page, "sheet")
    drafts, report = extract_sheet(content, page, layout)
    return _replace(session, source, [page], drafts, layout.model_dump(), report, by)


def lay_out_pdf(session: Session, home: Path, source: Source, layout: PdfLayout, by: str) -> dict[str, Any]:
    contents = {page: content_of(home, source, page, "page") for page in layout.pages}
    drafts, report = extract_pdf(contents, layout)
    return _replace(session, source, layout.pages, drafts, layout.model_dump(), report, by)


def record_transcription(
    session: Session, home: Path, source: Source, page: int, rows: list[TranscribedRow], by: str
) -> dict[str, Any]:
    page_of(source, page)
    drafts, report = transcribed(page, rows)
    spec = {"transcribed": [r.model_dump() for r in rows]}
    return _replace(session, source, [page], drafts, spec, report, by)


def skip_pages(session: Session, source: Source, pages: list[int], reason: str, by: str) -> None:
    """Pages that hold no items (a cover, a summary, a rates sheet): handled, with the reason kept."""
    for number in pages:
        page_of(source, number)
    _replace(session, source, pages, [], {"skip": reason}, Report(), by)


def clear_pages(session: Session, source: Source, pages: list[int]) -> list[int]:
    """Forget how pages were read, so they are read again: the layouts that covered them go, and with them the
    items found on every page those layouts covered. Returns the pages cleared."""
    cleared = set(pages)
    for layout in session.scalars(select(Layout).where(Layout.source_id == source.id)):
        if set(layout.pages) & set(pages):
            cleared |= set(layout.pages)
            session.delete(layout)
    session.execute(delete(Item).where(Item.source_id == source.id, Item.page.in_(cleared)))
    session.flush()
    return sorted(cleared)


def handled_pages(session: Session, source_id: str) -> set[int]:
    """Pages a layout has covered, whether it found items on them or set them aside."""
    return {
        page for layout in session.scalars(select(Layout).where(Layout.source_id == source_id)) for page in layout.pages
    }


def source_items(session: Session, source_id: str) -> list[Item]:
    return list(session.scalars(select(Item).where(Item.source_id == source_id).order_by(Item.page, Item.position)))


def project_items(session: Session, project_id: str) -> list[Item]:
    query = select(Item).where(Item.project_id == project_id).order_by(Item.source_id, Item.page, Item.position)
    return list(session.scalars(query))


def page_of(source: Source, number: int):
    if source.status != "read":
        raise NotReadable("source_not_read")
    page = next((p for p in source.pages if p.number == number), None)
    if page is None:
        raise NotReadable("page_not_found")
    return page


def content_of(home: Path, source: Source, number: int, kind: str) -> dict[str, Any]:
    page = page_of(source, number)
    if page.kind != kind:
        raise NotReadable("wrong_page_kind")
    return page_content(home, source, number)


def _replace(
    session: Session,
    source: Source,
    pages: list[int],
    drafts: list[Draft],
    spec: dict[str, Any],
    report: Report,
    by: str,
) -> dict[str, Any]:
    """Put the new items in place of whatever an earlier layout found on the same pages."""
    last = session.scalar(select(func.max(Item.ref)).where(Item.project_id == source.project_id)) or 0
    session.execute(delete(Item).where(Item.source_id == source.id, Item.page.in_(pages)))
    for old in session.scalars(select(Layout).where(Layout.source_id == source.id)):
        if set(old.pages) & set(pages):
            session.delete(old)
    positions: dict[int, int] = {}
    for ref, draft in enumerate(drafts, start=last + 1):
        positions[draft.page] = positions.get(draft.page, 0) + 1
        session.add(
            Item(
                project_id=source.project_id,
                ref=ref,
                source_id=source.id,
                page=draft.page,
                position=positions[draft.page],
                code=draft.code,
                description=draft.description,
                unit=draft.unit,
                quantity=_text(draft.quantity),
                quantity_text=draft.quantity_text,
                rate=_text(draft.rate),
                rate_text=draft.rate_text,
                amount=_text(draft.amount),
                amount_text=draft.amount_text,
                comment=draft.comment,
                headings=draft.headings,
                provenance=draft.provenance,
                origin=draft.origin,
                verify=draft.origin == "image",
            )
        )
    summary = report.as_dict()
    session.add(Layout(source_id=source.id, pages=pages, spec=spec, report=summary, decided_by=by))
    session.flush()
    return summary


def _text(number) -> str | None:
    return None if number is None else str(number)
