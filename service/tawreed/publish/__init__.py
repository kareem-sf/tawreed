"""Publishing a revision: all of its workbooks, or none of them.

The workbooks are written into a staging folder, opened again and checked against the ledger, and only then is the
folder renamed into place as `Rev NN` with a manifest of every file's SHA-256. A published revision is never
changed or overwritten; the next one gets the next number."""

import hashlib
import io
import json
import os
import re
import shutil
import uuid
import zipfile
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import openpyxl
from sqlalchemy import JSON, ForeignKey, Integer, String, UniqueConstraint, func, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from tawreed import decisions, ledger, packages
from tawreed.core.db import Base, UTCDateTime, now
from tawreed.core.env import child_env
from tawreed.core.home import long_path
from tawreed.projects import Project, folder
from tawreed.publish import workbooks
from tawreed.sources import Source


class Revision(Base):
    __tablename__ = "revisions"
    __table_args__ = (UniqueConstraint("project_id", "number"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(16))  # "Rev 00", also its folder's name
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    manifest: Mapped[dict[str, Any]] = mapped_column(JSON)


class NotReady(Exception):
    """The project can't be published as it stands: something isn't placed, read or decided."""

    code = "not_ready_to_publish"


def revisions_folder(home: Path, project_id: str) -> Path:
    return folder(home, project_id) / "revisions"


def revisions(session: Session, project_id: str) -> list[Revision]:
    query = select(Revision).where(Revision.project_id == project_id).order_by(Revision.number)
    return list(session.scalars(query))


def get_revision(session: Session, project_id: str, number: int) -> Revision | None:
    query = select(Revision).where(Revision.project_id == project_id, Revision.number == number)
    return session.scalars(query).first()


def latest(session: Session, project_id: str) -> Revision | None:
    query = select(Revision).where(Revision.project_id == project_id).order_by(Revision.number.desc()).limit(1)
    return session.scalars(query).first()


def current(session: Session, project: Project) -> Revision | None:
    """The latest revision, if it holds the project's work as it is now (nothing changed since it was published)."""
    revision = latest(session, project.id)
    return revision if revision and revision.created_at >= project.updated_at else None


def gather(session: Session, project: Project, name: str, published: datetime, prices: bool = True) -> workbooks.Book:
    """Everything the revision is written from, read once from the ledger."""
    coverage = packages.coverage(session, project.id, decisions.waiting_items(session, project.id))
    if not coverage.complete or not coverage.packages:
        raise NotReady()
    placed = packages.assignments(session, project.id)
    items: dict[str, list] = {}
    active = packages.active_items(session, project.id)
    for item in active:  # in file order
        items.setdefault(placed[item.id].package_id, []).append(item)
    files = {s.id: s for s in session.scalars(select(Source).where(Source.project_id == project.id))}
    layouts = session.scalars(
        select(ledger.Layout).where(ledger.Layout.source_id.in_(list(files))).order_by(ledger.Layout.created_at)
    ).all()
    return workbooks.Book(
        project=project,
        name=name,
        published=published,
        language=workbooks.language_of(active),
        packages=packages.packages(session, project.id),
        items=items,
        placed=placed,
        files=files,
        coverage=coverage,
        decisions=decisions.answered(session, project.id),
        rules=packages.rules(session, project.id),
        layouts=list(layouts),
        prices=prices,
    )


def _next_number(session: Session, root: Path, project_id: str) -> int:
    """After every revision recorded and every revision folder on disk, so none is ever overwritten."""
    recorded = session.scalar(select(func.max(Revision.number)).where(Revision.project_id == project_id))
    on_disk = [int(m[1]) for p in root.glob("Rev *") if (m := re.fullmatch(r"Rev (\d+)", p.name))]
    return max([n for n in (recorded, *on_disk) if n is not None], default=-1) + 1


def publish(session: Session, home: Path, project: Project, prices: bool = True) -> Revision:
    """Write the revision's workbooks, check them, and put the revision in place in one step. Without prices, the
    package workbooks leave the rates empty for suppliers to fill; the master always shows them."""
    root = long_path(revisions_folder(home, project.id))
    root.mkdir(parents=True, exist_ok=True)
    number = _next_number(session, root, project.id)
    name = f"Rev {number:02d}"
    published = now()
    book = gather(session, project, name, published, prices)
    staging = root / f".staging-{uuid.uuid4().hex}"
    try:
        staging.mkdir()
        title = workbooks.file_name(project.name)
        # In the order the engineer reads them: the master, each package, then the log and the check.
        written = {f"{title} - Master - {name}.xlsx": workbooks.master(book)}
        package_files = {}
        for package in book.packages:
            package_files[package.id] = f"Packages/{workbooks.package_file(book, package)}"
            written[package_files[package.id]] = workbooks.package_workbook(book, package)
        written[f"Decision log - {name}.xlsx"] = workbooks.decision_log(book)
        written[f"Coverage check - {name}.xlsx"] = workbooks.coverage_check(book)
        for relative, workbook in written.items():
            path = staging / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            workbook.save(path)
        _check(staging, book, f"{title} - Master - {name}.xlsx", package_files)
        manifest = {
            "project": project.name,
            "revision": name,
            "prices": prices,
            "published": published.isoformat(),
            "items": book.coverage.items,
            "packages": [
                {
                    "code": packages.code(c.package),
                    "name": c.package.name,
                    "items": c.items,
                    "amount": str(packages.money(c.amount)),
                }
                for c in book.coverage.packages
            ],
            "files": [_entry(staging, relative) for relative in written],
        }
        (staging / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", "utf-8")
        final = root / name
        if final.exists():
            raise FileExistsError(final)
        os.replace(staging, final)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    revision = Revision(project_id=project.id, number=number, name=name, created_at=published, manifest=manifest)
    session.add(revision)
    session.flush()
    return revision


def _entry(staging: Path, relative: str) -> dict[str, Any]:
    data = (staging / relative).read_bytes()
    return {"path": relative, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _same_number(cell: Any, parsed: str | None, text: str) -> bool:
    """A cell holds the number the source wrote as a number, or else its text."""
    if parsed is None:
        return cell == (workbooks.cell_text(text) or None)
    if isinstance(cell, bool) or not isinstance(cell, int | float):
        return False
    return float(cell) == float(Decimal(parsed))  # Excel keeps numbers as doubles


def _check_sheet(sheet, book: workbooks.Book, package, prices: bool, where: str) -> None:
    """Every item row of a package sheet, read back: code, description, unit, quantity, rate and amount are what the
    ledger holds, in the ledger's order. Only item rows have a source, so headings and totals are passed over."""
    source = workbooks.source_column(book)
    items = book.items.get(package.id, [])
    rows = [
        r for r in sheet.iter_rows(min_row=workbooks.FIRST_ITEM_ROW, max_col=source, values_only=True) if r[source - 1]
    ]
    if len(rows) != len(items):
        raise RuntimeError(f"{where}: the workbook doesn't hold the ledger's items")
    for row, item in zip(rows, items, strict=True):
        text = workbooks.cell_text
        formula = (not prices and workbooks._for_supplier(item)) or (prices and workbooks._reproduces(item))
        if prices and not formula:
            amount_ok = _same_number(row[5], item.amount, item.amount_text)
        elif formula:
            amount_ok = isinstance(row[5], str) and row[5].startswith("=")
        else:
            amount_ok = row[5] is None
        rate_ok = _same_number(row[4], item.rate, item.rate_text) if prices else row[4] is None
        if not (
            row[0] == (text(item.code) or None)
            and row[1] == text(item.description)
            and row[2] == (text(item.unit) or None)
            and _same_number(row[3], item.quantity, item.quantity_text)
            and rate_ok
            and amount_ok
        ):
            raise RuntimeError(f"{where}: item {item.ref} isn't written as the ledger holds it")


def _check(staging: Path, book: workbooks.Book, master: str, package_files: dict[str, str]) -> None:
    """Open the master and every package workbook again and read each package's items back against the ledger. A
    mismatch stops the publish."""
    for package in book.packages:
        name = workbooks.sheet_name(workbooks.package_title(package))
        for relative, prices in ((master, True), (package_files[package.id], book.prices)):
            workbook = openpyxl.load_workbook(staging / relative, read_only=True)
            try:
                _check_sheet(workbook[name], book, package, prices, f"{package.name} ({relative})")
            finally:
                workbook.close()


def open_folder(home: Path, revision: Revision) -> None:
    """Show the revision's folder in the file manager."""
    path = revisions_folder(home, revision.project_id) / revision.name
    if os.name == "nt":
        os.startfile(path)  # noqa: S606  (a folder Tawreed wrote, under its own data home)
    else:
        import subprocess

        program = "open" if os.uname().sysname == "Darwin" else "xdg-open"
        subprocess.Popen([program, str(path)], env=child_env())  # noqa: S603


def zipped(home: Path, revision: Revision) -> bytes:
    """The revision's files in one zip, as its folder holds them."""
    path = long_path(revisions_folder(home, revision.project_id) / revision.name)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(p for p in path.rglob("*") if p.is_file()):
            archive.write(file, f"{revision.name}/{file.relative_to(path).as_posix()}")
    return buffer.getvalue()
