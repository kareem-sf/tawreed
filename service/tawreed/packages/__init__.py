"""Packages and the items placed in them.

An item has at most one assignment row (the item is its key), so it can never sit in two packages. The agent
proposes a plan and placements; the engineer's direct edits and answers go through the same checked operations
here. Every count and total is computed from the ledger, never taken from the model."""

import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import ForeignKey, Integer, String, Text, delete, func, select, update
from sqlalchemy.orm import Mapped, Session, mapped_column

from tawreed.core.db import Base, UTCDateTime, now
from tawreed.ledger import Item, Layout, handled_pages
from tawreed.ledger.numbers import parse_number
from tawreed.projects import Project
from tawreed.sources import Source

NAME_LIMIT = 120
PACKAGES_MOST = 60


class Package(Base):
    __tablename__ = "packages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)  # its code within the project: 1 → "01"
    position: Mapped[int] = mapped_column(Integer)  # the order the plan lists it in
    name: Mapped[str] = mapped_column(String(NAME_LIMIT))
    scope: Mapped[str] = mapped_column(Text, default="")
    reason: Mapped[str] = mapped_column(Text, default="")  # why it is a package of its own
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class Assignment(Base):
    __tablename__ = "assignments"

    item_id: Mapped[str] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), primary_key=True)
    package_id: Mapped[str] = mapped_column(ForeignKey("packages.id", ondelete="CASCADE"), index=True)
    # agent; engineer, whose placement the agent never overrides; or revision: carried over by Tawreed from the
    # earlier file a revision replaced
    decided_by: Mapped[str] = mapped_column(String(8))
    reason: Mapped[str] = mapped_column(Text, default="")
    decided_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class Rule(Base):
    """A placement the engineer decided, remembered for this project or, when they chose so, for every project."""

    __tablename__ = "rules"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class Refused(ValueError):
    """An operation that would break the packages, with a stable code and a plain reason for the agent."""

    def __init__(self, code: str, reason: str):
        super().__init__(reason)
        self.code = code


# Reading ------------------------------------------------------------------------------------------------------


def packages(session: Session, project_id: str) -> list[Package]:
    return list(session.scalars(select(Package).where(Package.project_id == project_id).order_by(Package.position)))


def get_package(session: Session, project_id: str, package_id: str) -> Package:
    package = session.get(Package, package_id)
    if package is None or package.project_id != project_id:
        raise Refused("package_not_found", "There is no such package in this project.")
    return package


def package_by_number(session: Session, project_id: str, number: int) -> Package:
    package = session.scalars(select(Package).where(Package.project_id == project_id, Package.number == number)).first()
    if package is None:
        raise Refused("package_not_found", f"There is no package {number:02d}. The packages are listed above.")
    return package


def code(package: Package) -> str:
    return f"{package.number:02d}"


def active_items(session: Session, project_id: str) -> list[Item]:
    """Items that count: from files that are in use and not waiting for the engineer's overlap decision."""
    query = (
        select(Item)
        .join(Source, Source.id == Item.source_id)
        .where(Item.project_id == project_id, Source.active.is_(True))
        .where((Source.relation.is_(None)) | (Source.relation != "pending"))
        .order_by(Item.ref)
    )
    return list(session.scalars(query))


def assignments(session: Session, project_id: str) -> dict[str, Assignment]:
    """Each placed item's assignment, by item id."""
    query = (
        select(Assignment).join(Package, Package.id == Assignment.package_id).where(Package.project_id == project_id)
    )
    return {a.item_id: a for a in session.scalars(query)}


def rules(session: Session, project_id: str) -> list[Rule]:
    query = select(Rule).where((Rule.project_id == project_id) | Rule.project_id.is_(None)).order_by(Rule.created_at)
    return list(session.scalars(query))


def global_rules(session: Session) -> list[Rule]:
    return list(session.scalars(select(Rule).where(Rule.project_id.is_(None)).order_by(Rule.created_at)))


# The plan -----------------------------------------------------------------------------------------------------


def check_plan(session: Session, project_id: str, proposed: list[dict[str, Any]]) -> None:
    """A plan Tawreed can apply: 1 to PACKAGES_MOST packages, each with its own name, keeping only current ones."""
    if not 1 <= len(proposed) <= PACKAGES_MOST:
        raise Refused("plan_size", f"Propose between 1 and {PACKAGES_MOST} packages.")
    names = Counter(entry["name"].strip().casefold() for entry in proposed)
    if any(not name for name in names) or any(n > 1 for n in names.values()):
        raise Refused("package_name_taken", "Each package needs its own name.")
    current = {p.id for p in packages(session, project_id)}
    if any(i not in current for entry in proposed for i in entry["keeps"]):
        raise Refused("package_not_found", "The plan keeps a package that isn't in the project.")


def apply_plan(session: Session, project: Project, proposed: list[dict[str, Any]]) -> list[Package]:
    """Make the packages what the approved plan says. Each proposed package lists the current packages it keeps:
    one it alone keeps is the same package (renamed if the name changed); several it keeps are merged into it; a
    package that two proposed packages keep is split, and its items are placed again; a package no one keeps is
    removed, and its items are placed again."""
    existing = {p.id: p for p in packages(session, project.id)}
    kept_by = Counter(package_id for entry in proposed for package_id in entry["keeps"] if package_id in existing)
    result: list[Package] = []
    survivors: set[str] = set()
    for position, entry in enumerate(proposed, start=1):
        whole = [existing[i] for i in entry["keeps"] if i in existing and kept_by[i] == 1]
        if whole:
            package = whole[0]
        else:
            package = Package(project_id=project.id, number=_next_number(project))
            session.add(package)
        package.position, package.name = position, entry["name"]
        package.scope, package.reason = entry.get("scope", ""), entry.get("reason", "")
        session.flush()
        for merged in whole[1:]:  # their items move into this package, keeping who placed them and why
            session.execute(update(Assignment).where(Assignment.package_id == merged.id).values(package_id=package.id))
        survivors.add(package.id)
        result.append(package)
    for package in existing.values():
        if package.id not in survivors:
            session.execute(delete(Assignment).where(Assignment.package_id == package.id))
            session.delete(package)
    touch(project)
    session.flush()
    return result


# Operations -----------------------------------------------------------------------------------------------------


def place(session: Session, project: Project, items: list[Item], package: Package, by: str, reason: str = "") -> int:
    """Put items in a package. The agent can't move what the engineer placed; the engineer can move anything."""
    if package.project_id != project.id:
        raise Refused("package_not_found", "There is no such package in this project.")
    placed = assignments(session, project.id)
    active = {i.id for i in active_items(session, project.id)}
    for item in items:
        if item.project_id != project.id or item.id not in active:
            raise Refused(
                "item_not_active", f"Item {item.ref} isn't in use: its file was set aside or awaits a decision."
            )
        current = placed.get(item.id)
        if by == "agent" and current and current.decided_by == "engineer" and current.package_id != package.id:
            raise Refused(
                "decided_by_engineer",
                f"Item {item.ref} was placed by the engineer (or their rule); ask them before moving it.",
            )
    for item in items:
        current = placed.get(item.id)
        if current:
            if current.package_id == package.id and by == "agent" and current.decided_by == "engineer":
                continue  # already where the engineer put it
            current.package_id, current.decided_by, current.reason, current.decided_at = package.id, by, reason, now()
        else:
            session.add(Assignment(item_id=item.id, package_id=package.id, decided_by=by, reason=reason))
    touch(project)
    session.flush()
    return len(items)


def unplace(session: Session, project: Project, items: list[Item]) -> None:
    session.execute(delete(Assignment).where(Assignment.item_id.in_([i.id for i in items])))
    touch(project)


def create_package(session: Session, project: Project, name: str, scope: str = "") -> Package:
    _unique_name(session, project.id, name)
    position = session.scalar(select(func.max(Package.position)).where(Package.project_id == project.id)) or 0
    package = Package(
        project_id=project.id, number=_next_number(project), position=position + 1, name=name, scope=scope
    )
    session.add(package)
    touch(project)
    session.flush()
    return package


def change_package(session: Session, project: Project, package: Package, name: str | None, scope: str | None) -> None:
    if name is not None and name != package.name:
        _unique_name(session, project.id, name)
        package.name = name
    if scope is not None:
        package.scope = scope
    touch(project)


def remove_package(session: Session, project: Project, package: Package) -> None:
    """Remove a package; its items wait to be placed again."""
    session.execute(delete(Assignment).where(Assignment.package_id == package.id))
    session.delete(package)
    touch(project)


def merge_packages(session: Session, project: Project, into: Package, merged: list[Package]) -> None:
    for package in merged:
        if package.id == into.id:
            continue
        session.execute(update(Assignment).where(Assignment.package_id == package.id).values(package_id=into.id))
        session.delete(package)
    touch(project)


def carry_over(session: Session, project: Project, source: Source) -> int:
    """A revision's items that match an item of the file it revises (same code, description and unit) go where
    that item was placed. The rest are placed as new."""
    if source.relation != "revision" or not source.replaces_id:
        return 0
    placed = assignments(session, project.id)
    earlier = {
        _key(item): placed[item.id]
        for item in session.scalars(select(Item).where(Item.source_id == source.replaces_id))
        if item.id in placed
    }
    carried = 0
    for item in session.scalars(select(Item).where(Item.source_id == source.id)):
        match = earlier.get(_key(item))
        if match and item.id not in placed:
            by = "engineer" if match.decided_by == "engineer" else "revision"  # the engineer's word carries over too
            session.add(Assignment(item_id=item.id, package_id=match.package_id, decided_by=by, reason=match.reason))
            carried += 1
    if carried:
        touch(project)
        session.flush()
    return carried


Kept = dict[tuple[str, str, str, str], list[tuple[str, str, str]]]


def placed_on(session: Session, source_id: str, pages: list[int]) -> Kept:
    """Where the items on these pages are placed, by what they are, so a page read again keeps its placements."""
    kept: Kept = {}
    query = (
        select(Item, Assignment)
        .join(Assignment, Assignment.item_id == Item.id)
        .where(Item.source_id == source_id, Item.page.in_(pages))
        .order_by(Item.page, Item.position)
    )
    for item, a in session.execute(query):
        kept.setdefault((*_key(item), item.quantity_text), []).append((a.package_id, a.decided_by, a.reason))
    return kept


def place_back(session: Session, source_id: str, pages: list[int], kept: Kept) -> int:
    """Items read again from these pages that are the same as before (code, description, unit and quantity, in
    order) go back where they were placed, by whoever placed them."""
    back = 0
    query = select(Item).where(Item.source_id == source_id, Item.page.in_(pages)).order_by(Item.page, Item.position)
    for item in session.scalars(query):
        same = kept.get((*_key(item), item.quantity_text))
        if same:
            package_id, by, reason = same.pop(0)
            session.add(Assignment(item_id=item.id, package_id=package_id, decided_by=by, reason=reason))
            back += 1
    session.flush()
    return back


def _key(item: Item) -> tuple[str, str, str]:
    return item.code.strip().casefold(), " ".join(item.description.split()).casefold(), item.unit.strip().casefold()


def _next_number(project: Project) -> int:
    project.package_numbers += 1
    return project.package_numbers


def _unique_name(session: Session, project_id: str, name: str) -> None:
    taken = {p.name.casefold() for p in packages(session, project_id)}
    if name.casefold() in taken:
        raise Refused("package_name_taken", f"There is already a package called {name}.")


def touch(project: Project) -> None:
    """The project's work changed: what was published before no longer matches it."""
    project.updated_at = now()


# Checks ---------------------------------------------------------------------------------------------------------


@dataclass
class PackageCount:
    package: Package
    items: int = 0
    amount: Decimal = Decimal(0)
    without_amount: int = 0


@dataclass
class Coverage:
    items: int = 0  # active items
    placed: int = 0
    unplaced: int = 0
    waiting: int = 0  # in an uncertain-assignment decision
    pages_left: int = 0  # read pages no layout has covered yet
    pending_files: int = 0  # files waiting for the engineer's overlap decision
    packages: list[PackageCount] = field(default_factory=list)
    totals: list[dict[str, Any]] = field(default_factory=list)  # per layout: its stated totals added up, its items' sum

    @property
    def complete(self) -> bool:
        return self.items > 0 and not (self.unplaced or self.waiting or self.pages_left or self.pending_files)


def coverage(session: Session, project_id: str, waiting_items: set[str]) -> Coverage:
    """Where every active item is, computed from the ledger: each once, in one package, or waiting on the engineer."""
    result = Coverage()
    counts = {p.id: PackageCount(p) for p in packages(session, project_id)}
    placed = assignments(session, project_id)
    for item in active_items(session, project_id):
        result.items += 1
        assignment = placed.get(item.id)
        if assignment:
            result.placed += 1
            count = counts[assignment.package_id]
            count.items += 1
            if item.amount is None:
                count.without_amount += 1
            else:
                count.amount += Decimal(item.amount)
        elif item.id in waiting_items:
            result.waiting += 1
        else:
            result.unplaced += 1
    result.packages = list(counts.values())
    files = session.scalars(select(Source).where(Source.project_id == project_id, Source.active.is_(True))).all()
    for source in files:
        if source.relation == "pending":
            result.pending_files += 1
        if source.status != "read":
            continue
        result.pages_left += len({p.number for p in source.pages} - handled_pages(session, source.id))
        names = {p.number: p.name for p in source.pages}
        for layout in session.scalars(select(Layout).where(Layout.source_id == source.id)):
            if layout.report.get("totals"):
                result.totals.append(reconcile(source.filename, layout, names))
    return result


def money(amount: Decimal) -> Decimal:
    """A computed amount as it is shown: to the cent. Excel's float noise (261016.92999999993) doesn't show."""
    return amount.quantize(Decimal("0.01")) + 0  # + 0: a difference of a trillionth shows as 0.00, not -0.00


def reconcile(file: str, layout: Layout, names: dict[int, str]) -> dict[str, Any]:
    """The totals one layout's pages state, added up, beside its items' own sum. A sheet with a total per section
    reconciles when the section totals together equal its items."""
    stated = [parse_number(t.get("amount")) for t in layout.report["totals"]]
    stated_sum = sum((s for s in stated if s is not None), Decimal(0))
    items_sum = Decimal(layout.report["amount_sum"]) if layout.report.get("amount_sum") else Decimal(0)
    pages = layout.pages
    where = ", ".join(names.get(p) or str(p) for p in pages) if any(names.get(p) for p in pages) else f"pages {pages}"
    return {
        "file": file,
        "where": where,
        "count": len(stated),
        "stated_sum": stated_sum,
        "items_sum": items_sum,
        "difference": stated_sum - items_sum,
    }
