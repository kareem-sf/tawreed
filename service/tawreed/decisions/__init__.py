"""What waits for the engineer, and what their answer does.

The AI's step tools and Tawreed only raise decisions; nothing they propose takes effect until the engineer answers
here. The kinds: consent (may this project go to this AI service?), overlap (is a new file an addition, a replacement
or a revision?), plan (the packages), uncertain (which package an item belongs in) and publish (write the
revision)."""

import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field
from sqlalchemy import JSON, ForeignKey, String, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from tawreed import packages
from tawreed.core.db import Base, UTCDateTime, now
from tawreed.ledger import Item
from tawreed.projects import Consent, Project
from tawreed.sources import Source, overlap, pages_folder

OVERLAP_SHARE = 0.3  # a new file sharing this much of its text with an earlier one needs the engineer's decision
REVISION_SHARE = 0.6  # above this, the new file is most likely a revision of the earlier one


class Decision(Base):
    __tablename__ = "decisions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(12))  # consent | overlap | plan | uncertain | publish
    raised_by: Mapped[str] = mapped_column(String(8))  # agent | tawreed
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)  # what the engineer is asked, by kind
    status: Mapped[str] = mapped_column(String(10), default="waiting")  # waiting | answered | withdrawn
    answer: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    answered_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class PlanEntry(BaseModel):
    """One package of a plan as the engineer edited it."""

    name: str = Field(min_length=1, max_length=packages.NAME_LIMIT)
    scope: str = Field(default="", max_length=1000)
    reason: str = Field(default="", max_length=1000)
    keeps: list[str] = Field(default_factory=list)  # the current packages it continues, by id


class Answer(BaseModel):
    """The engineer's answer. Which fields count depends on the kind of decision."""

    approve: bool | None = None  # consent, plan, publish
    relation: Literal["addition", "replacement", "revision"] | None = None  # overlap
    package_id: str | None = None  # uncertain
    # uncertain: how far the choice applies; the project if unsaid
    scope: Literal["item", "project", "all"] | None = None
    # plan: the plan as the engineer edited it, to apply instead of the proposal
    packages: list[PlanEntry] | None = Field(default=None, max_length=packages.PACKAGES_MOST)
    # plan, when not approved: what to change, for the plan to be proposed again
    note: str | None = Field(default=None, max_length=4000)
    # publish: whether the package workbooks show rates and amounts; they do unless said
    prices: bool | None = None


class Unanswerable(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def get(session: Session, project_id: str, decision_id: str) -> Decision | None:
    decision = session.get(Decision, decision_id)
    return decision if decision and decision.project_id == project_id else None


def waiting(session: Session, project_id: str, kind: str | None = None) -> list[Decision]:
    query = select(Decision).where(Decision.project_id == project_id, Decision.status == "waiting")
    if kind:
        query = query.where(Decision.kind == kind)
    return list(session.scalars(query.order_by(Decision.created_at)))


def answered(session: Session, project_id: str) -> list[Decision]:
    query = select(Decision).where(Decision.project_id == project_id, Decision.status == "answered")
    return list(session.scalars(query.order_by(Decision.answered_at)))


def waiting_items(session: Session, project_id: str) -> set[str]:
    """Items in an uncertain-assignment decision the engineer hasn't answered."""
    return {d.payload["item_id"] for d in waiting(session, project_id, "uncertain")}


def raise_decision(session: Session, project_id: str, kind: str, payload: dict[str, Any], by: str) -> Decision:
    decision = Decision(project_id=project_id, kind=kind, payload=payload, raised_by=by)
    session.add(decision)
    session.flush()
    return decision


def withdraw(decision: Decision) -> None:
    decision.status, decision.answered_at = "withdrawn", now()


def withdraw_gone(session: Session, project_id: str) -> None:
    """Withdraw the questions about items that are no longer there, once their page was read again."""
    for decision in waiting(session, project_id, "uncertain"):
        if session.get(Item, decision.payload["item_id"]) is None:
            withdraw(decision)


# Raised by Tawreed ---------------------------------------------------------------------------------------------


def raise_overlap(session: Session, home: Path, source: Source) -> Decision | None:
    """A new file that shares much of its text with an earlier file in use waits for the engineer to say what it
    is. Its items don't count until they do."""
    mine = overlap.load(pages_folder(home, source))
    earlier = session.scalars(
        select(Source).where(
            Source.project_id == source.project_id,
            Source.id != source.id,
            Source.status == "read",
            Source.active.is_(True),
            Source.added_at <= source.added_at,
        )
    ).all()
    best, best_share = None, 0.0
    for other in earlier:
        if other.relation == "pending":
            continue
        share = overlap.share(mine, overlap.load(pages_folder(home, other)))
        if share > best_share:
            best, best_share = other, share
    if best is None or best_share < OVERLAP_SHARE:
        return None
    source.relation = "pending"
    payload = {
        "source_id": source.id,
        "earlier_id": best.id,
        "share": round(best_share, 2),
        "recommended": "revision" if best_share >= REVISION_SHARE else "addition",
    }
    return raise_decision(session, source.project_id, "overlap", payload, "tawreed")


def needs_consent(session: Session, project_id: str, connection_id: str) -> bool:
    return session.get(Consent, (project_id, connection_id)) is None


def ask_consent(session: Session, project_id: str, connection: dict[str, Any]) -> Decision:
    """Before anything from this project goes to a connection's service for the first time. The engineer is told
    the provider and, for a compatible service, its address."""
    for decision in waiting(session, project_id, "consent"):
        if decision.payload["connection_id"] == connection["id"]:
            return decision
        withdraw(decision)  # the engineer chose another AI since
    host = (
        urlparse(connection.get("base_url") or "").hostname if connection["provider"] == "openai_compatible" else None
    )
    payload = {"connection_id": connection["id"], "provider": connection["provider"], "host": host}
    return raise_decision(session, project_id, "consent", payload, "tawreed")


# The engineer's answer -----------------------------------------------------------------------------------------


def answer(session: Session, project: Project, decision: Decision, body: Answer) -> None:
    """Carry out the engineer's answer. Raises Unanswerable when the answer doesn't fit the decision."""
    if decision.status != "waiting":
        raise Unanswerable("decision_closed")
    kind, payload = decision.kind, decision.payload
    if kind in ("consent", "plan", "publish") and body.approve is None:
        raise Unanswerable("answer_missing")
    if kind == "consent":
        if body.approve:
            session.merge(Consent(project_id=project.id, connection_id=payload["connection_id"]))
        record = {"approve": body.approve}
    elif kind == "overlap":
        if body.relation is None:
            raise Unanswerable("answer_missing")
        _settle_overlap(session, project, payload, body.relation)
        record = {"relation": body.relation}
    elif kind == "plan":
        record = _settle_plan(session, project, payload, body)
    elif kind == "uncertain":
        record = _settle_uncertain(session, project, payload, body)
    else:  # publish: the revision is written by the route before the answer is kept
        record = {"approve": body.approve}
    decision.status, decision.answer, decision.answered_at = "answered", record, now()
    # The engineer is here and has answered, so the work carries on; unless they just declined to send it to the AI.
    declined = kind == "consent" and not body.approve
    project.paused, project.pause_reason = declined, {"code": "no_consent"} if declined else None
    session.flush()


def _settle_plan(session: Session, project: Project, payload: dict[str, Any], body: Answer) -> dict[str, Any]:
    """Approved: the plan (as the engineer edited it, if they did) becomes the packages. Not approved: with a note,
    or with no packages yet, the plan is proposed again; otherwise the current packages stay."""
    if not body.approve:
        if body.note or not packages.packages(session, project.id):
            project.redo = {"step": "plan", "note": body.note}
        return {"approve": False, "note": body.note}
    proposed = [entry.model_dump() for entry in body.packages] if body.packages is not None else payload["packages"]
    try:
        packages.check_plan(session, project.id, proposed)
        packages.apply_plan(session, project, proposed)
    except packages.Refused as refused:
        raise Unanswerable(refused.code) from refused
    for stale in waiting(session, project.id, "uncertain"):  # placed again against the new plan
        withdraw(stale)
    project.redo = None
    return {"approve": True, "edited": [e["name"] for e in proposed] if body.packages is not None else None}


def _settle_overlap(session: Session, project: Project, payload: dict[str, Any], relation: str) -> None:
    source, earlier = session.get(Source, payload["source_id"]), session.get(Source, payload["earlier_id"])
    if source is None:
        raise Unanswerable("source_not_found")
    source.relation = relation
    if relation in ("replacement", "revision") and earlier is not None:
        earlier.active = False
        source.replaces_id = earlier.id
    packages.touch(project)
    session.flush()
    packages.carry_over(session, project, source)


def _settle_uncertain(session: Session, project: Project, payload: dict[str, Any], body: Answer) -> dict[str, Any]:
    if not body.package_id:
        raise Unanswerable("answer_missing")
    item = session.get(Item, payload["item_id"])
    try:
        package = packages.get_package(session, project.id, body.package_id)
        if item is None:
            raise Unanswerable("item_not_found")
        packages.place(session, project, [item], package, "engineer", "The engineer chose this package.")
    except packages.Refused as refused:
        raise Unanswerable(refused.code) from refused
    scope = body.scope or "project"
    if scope != "item":
        text = f"“{item.description[:200]}”" + (f" ({item.unit})" if item.unit else "") + f" belongs in {package.name}."
        session.add(packages.Rule(project_id=project.id if scope == "project" else None, text=text))
    return {"package_id": package.id, "package": package.name, "scope": scope}
