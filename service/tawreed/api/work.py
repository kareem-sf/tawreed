"""The agent's work on a project as the engineer sees it: the step, what waits for them, the conversation and the
packages; and what the engineer does about it: write, stop, answer, and edit the packages directly."""

from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from tawreed import decisions, packages, publish
from tawreed import projects as project_records
from tawreed.agent import records
from tawreed.agent.runtime import chosen
from tawreed.api.common import DB, Home, problem
from tawreed.api.revisions import RevisionOut, revision_out
from tawreed.ledger import Item
from tawreed.projects import Project
from tawreed.sources import Source

router = APIRouter(prefix="/projects/{project_id}", tags=["work"])
rules_router = APIRouter(prefix="/rules", tags=["work"])

Stage = Literal["read", "plan", "place", "check", "publish", "published"]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=packages.NAME_LIMIT)]


class PackageRef(BaseModel):
    id: str
    code: str
    name: str


class PackageOut(PackageRef):
    scope: str
    reason: str
    items: int
    amount: str  # the sum of its items' amounts, computed by Tawreed
    without_amount: int


class ItemOut(BaseModel):
    id: str
    ref: int
    code: str
    description: str
    unit: str
    quantity_text: str
    rate_text: str
    amount_text: str
    comment: str
    headings: list[str]
    source_id: str
    file: str
    page: int
    provenance: dict[str, Any]
    origin: Literal["cell", "text", "image"]
    verify: bool
    package_id: str | None
    decided_by: str | None


class PlannedOut(BaseModel):
    name: str
    scope: str
    reason: str
    keeps: list[PackageRef]  # current packages it continues: one to keep, several to merge


class DecisionOut(BaseModel):
    """What the engineer is asked. Only the fields for its kind are set."""

    id: str
    kind: Literal["consent", "overlap", "plan", "uncertain", "question", "publish"]
    raised_by: Literal["agent", "tawreed"]
    created_at: datetime
    answered_at: datetime | None = None
    answer: dict[str, Any] | None = None
    provider: str | None = None  # consent: where the project would go
    host: str | None = None  # consent: the address of an OpenAI-compatible service
    file: str | None = None  # overlap: the new file
    earlier: str | None = None  # overlap: the file it overlaps
    share: float | None = None  # overlap: how much of the smaller file the other repeats
    recommended: str | None = None  # overlap: a relation; uncertain: a package id
    packages: list[PlannedOut] | None = None  # plan
    removed: list[PackageRef] | None = None  # plan: current packages it drops; their items are placed again
    note: str | None = None  # plan: the agent's thinking
    item: ItemOut | None = None  # uncertain
    candidates: list[PackageRef] | None = None  # uncertain
    reason: str | None = None  # uncertain
    question: str | None = None
    options: list[str] | None = None
    summary: str | None = None  # publish


class MessageOut(BaseModel):
    id: int
    sender: Literal["agent", "engineer", "tawreed"]
    text: str
    notice: str | None
    params: dict[str, Any] | None
    created_at: datetime


class CoverageOut(BaseModel):
    items: int
    placed: int
    unplaced: int
    waiting: int
    pages_left: int
    pending_files: int


class WorkOut(BaseModel):
    stage: Stage
    agent: Literal["working", "idle", "paused", "no_ai"]
    decisions: list[DecisionOut]  # waiting, oldest first
    answered: list[DecisionOut]  # the latest the engineer answered, oldest first
    messages: list[MessageOut]
    coverage: CoverageOut
    packages: list[PackageOut]
    published: RevisionOut | None  # the latest revision


class MessageIn(BaseModel):
    text: Text


class ItemsPage(BaseModel):
    items: list[ItemOut]
    total: int


class PackageIn(BaseModel):
    name: Name
    scope: str = Field(default="", max_length=1000)


class PackageChange(BaseModel):
    name: Name | None = None
    scope: str | None = Field(default=None, max_length=1000)


class Merge(BaseModel):
    package_ids: list[str] = Field(min_length=1)


class Placement(BaseModel):
    item_ids: list[str] = Field(min_length=1, max_length=5000)
    package_id: str


class RuleOut(BaseModel):
    id: str
    text: str
    created_at: datetime


# Building the view ----------------------------------------------------------------------------------------------


def _project(session: Session, project_id: str) -> Project:
    project = project_records.get_project(session, project_id)
    if project is None:
        raise problem(404, "project_not_found")
    return project


def _ref(package: packages.Package) -> PackageRef:
    return PackageRef(id=package.id, code=packages.code(package), name=package.name)


def _item(item: Item, file: str, assignment: packages.Assignment | None) -> ItemOut:
    return ItemOut(
        id=item.id,
        ref=item.ref,
        code=item.code,
        description=item.description,
        unit=item.unit,
        quantity_text=item.quantity_text,
        rate_text=item.rate_text,
        amount_text=item.amount_text,
        comment=item.comment,
        headings=item.headings,
        source_id=item.source_id,
        file=file,
        page=item.page,
        provenance=item.provenance,
        origin=item.origin,
        verify=item.verify,
        package_id=assignment.package_id if assignment else None,
        decided_by=assignment.decided_by if assignment else None,
    )


def _decision(session: Session, decision: decisions.Decision) -> DecisionOut:
    p = decision.payload
    out = DecisionOut(
        id=decision.id,
        kind=decision.kind,
        raised_by=decision.raised_by,
        created_at=decision.created_at,
        answered_at=decision.answered_at,
        answer=decision.answer,
    )
    current = {pk.id: pk for pk in packages.packages(session, decision.project_id)}
    if decision.kind == "consent":
        out.provider, out.host = p["provider"], p["host"]
    elif decision.kind == "overlap":
        new, earlier = session.get(Source, p["source_id"]), session.get(Source, p["earlier_id"])
        out.file, out.earlier = new and new.filename, earlier and earlier.filename
        out.share, out.recommended = p["share"], p["recommended"]
    elif decision.kind == "plan":
        out.packages = [
            PlannedOut(
                name=e["name"],
                scope=e["scope"],
                reason=e["reason"],
                keeps=[_ref(current[i]) for i in e["keeps"] if i in current],
            )
            for e in p["packages"]
        ]
        kept = {i for e in p["packages"] for i in e["keeps"]}
        out.removed = [_ref(pk) for pk in current.values() if pk.id not in kept] if decision.status == "waiting" else []
        out.note = p.get("note")
    elif decision.kind == "uncertain":
        item = session.get(Item, p["item_id"])
        if item is not None:
            source = session.get(Source, item.source_id)
            out.item = _item(item, source.filename, packages.assignments(session, decision.project_id).get(item.id))
        out.candidates = [_ref(current[i]) for i in p["candidates"] if i in current]
        out.recommended, out.reason = p["recommended"], p["reason"]
    elif decision.kind == "question":
        out.question, out.options = p["question"], p["options"]
    else:
        out.summary = p.get("summary")
    return out


def stage(
    session: Session,
    project: Project,
    waiting: list[decisions.Decision],
    coverage: packages.Coverage,
) -> str:
    """Where the project is on the five-step line: published once its latest revision holds its current work."""
    reading = session.scalars(
        select(Source.id).where(Source.project_id == project.id, Source.status.in_(("added", "reading")))
    ).first()
    if reading or coverage.pages_left or coverage.pending_files or not coverage.items:
        return "read"
    if not coverage.packages:
        return "plan"
    if coverage.unplaced or coverage.waiting:
        return "place"
    if any(d.kind == "publish" for d in waiting):
        return "publish"
    if publish.current(session, project):
        return "published"
    return "check"


# Routes ---------------------------------------------------------------------------------------------------------


@router.get("/work")
def get_work(project_id: str, request: Request, session: DB, home: Home) -> WorkOut:
    project = _project(session, project_id)
    waiting = decisions.waiting(session, project_id)
    coverage = packages.coverage(session, project_id, decisions.waiting_items(session, project_id))
    agent = request.app.state.worker.status(project_id) if chosen(home) else "no_ai"
    latest = publish.latest(session, project_id)
    return WorkOut(
        stage=stage(session, project, waiting, coverage),
        published=revision_out(latest) if latest else None,
        agent=agent,
        decisions=[_decision(session, d) for d in waiting],
        answered=[_decision(session, d) for d in decisions.answered(session, project_id)[-30:]],
        messages=[
            MessageOut.model_validate(m, from_attributes=True) for m in records.messages(session, project_id, 200)
        ],
        coverage=CoverageOut(
            items=coverage.items,
            placed=coverage.placed,
            unplaced=coverage.unplaced,
            waiting=coverage.waiting,
            pages_left=coverage.pages_left,
            pending_files=coverage.pending_files,
        ),
        packages=[
            PackageOut(
                **_ref(c.package).model_dump(),
                scope=c.package.scope,
                reason=c.package.reason,
                items=c.items,
                amount=str(packages.money(c.amount)),
                without_amount=c.without_amount,
            )
            for c in coverage.packages
        ],
    )


@router.post("/messages", status_code=201)
def write(project_id: str, body: MessageIn, request: Request, session: DB) -> MessageOut:
    """The engineer writes to the agent. A stopped or paused agent carries on."""
    project = _project(session, project_id)
    message = records.say(session, project_id, "engineer", body.text)
    project.agent_paused = False
    session.commit()
    request.app.state.worker.resume(project_id)
    return MessageOut.model_validate(message, from_attributes=True)


@router.post("/stop", status_code=204)
def stop(project_id: str, request: Request, session: DB) -> Response:
    _project(session, project_id)
    request.app.state.worker.stop(project_id)
    return Response(status_code=204)


@router.post("/decisions/{decision_id}", status_code=204)
def answer(
    project_id: str, decision_id: str, body: decisions.Answer, request: Request, session: DB, home: Home
) -> Response:
    """Carry out the engineer's answer. Approving publishing writes the revision before the answer is kept."""
    project = _project(session, project_id)
    decision = decisions.get(session, project_id, decision_id)
    if decision is None:
        raise problem(404, "decision_not_found")
    revision = None
    try:
        if decision.kind == "publish" and body.approve and decision.status == "waiting":
            revision = publish.publish(session, home, project)
        decisions.answer(session, project, decision, body)
    except decisions.Unanswerable as error:
        session.rollback()
        raise problem(409, error.code) from error
    except publish.NotReady as error:
        session.rollback()
        raise problem(409, error.code) from error
    if revision:
        decision.answer = {**decision.answer, "revision": revision.name}
    session.commit()
    request.app.state.worker.resume(project_id)
    return Response(status_code=204)


@router.get("/items")
def list_items(
    project_id: str,
    session: DB,
    package_id: str | None = None,
    unplaced: bool = False,
    start: Annotated[int, Query(ge=0)] = 0,
    count: Annotated[int, Query(ge=1, le=1000)] = 200,
) -> ItemsPage:
    """Items in use, in file order: all of them, one package's, or those not placed yet."""
    _project(session, project_id)
    placed = packages.assignments(session, project_id)
    names = dict(session.execute(select(Source.id, Source.filename).where(Source.project_id == project_id)).all())
    chosen_items = [
        i
        for i in packages.active_items(session, project_id)
        if (package_id is None or (i.id in placed and placed[i.id].package_id == package_id))
        and (not unplaced or i.id not in placed)
    ]
    window = chosen_items[start : start + count]
    return ItemsPage(items=[_item(i, names[i.source_id], placed.get(i.id)) for i in window], total=len(chosen_items))


def _refused(session: Session, error: packages.Refused):
    session.rollback()
    return problem(409, error.code)


@router.post("/packages", status_code=201)
def create_package(project_id: str, body: PackageIn, request: Request, session: DB) -> PackageRef:
    project = _project(session, project_id)
    try:
        package = packages.create_package(session, project, body.name, body.scope)
    except packages.Refused as error:
        raise _refused(session, error) from error
    session.commit()
    request.app.state.worker.wake()
    return _ref(package)


@router.patch("/packages/{package_id}")
def change_package(project_id: str, package_id: str, body: PackageChange, request: Request, session: DB) -> PackageRef:
    project = _project(session, project_id)
    try:
        package = packages.get_package(session, project_id, package_id)
        packages.change_package(session, project, package, body.name, body.scope)
    except packages.Refused as error:
        raise _refused(session, error) from error
    session.commit()
    request.app.state.worker.wake()
    return _ref(package)


@router.delete("/packages/{package_id}", status_code=204)
def remove_package(project_id: str, package_id: str, request: Request, session: DB) -> Response:
    """Remove a package; its items wait to be placed again."""
    project = _project(session, project_id)
    try:
        packages.remove_package(session, project, packages.get_package(session, project_id, package_id))
    except packages.Refused as error:
        raise _refused(session, error) from error
    session.commit()
    request.app.state.worker.wake()
    return Response(status_code=204)


@router.post("/packages/{package_id}/merge", status_code=204)
def merge_packages(project_id: str, package_id: str, body: Merge, request: Request, session: DB) -> Response:
    """Merge other packages into this one; their items keep their placement reasons."""
    project = _project(session, project_id)
    try:
        into = packages.get_package(session, project_id, package_id)
        merged = [packages.get_package(session, project_id, i) for i in body.package_ids]
        packages.merge_packages(session, project, into, merged)
    except packages.Refused as error:
        raise _refused(session, error) from error
    session.commit()
    request.app.state.worker.wake()
    return Response(status_code=204)


@router.post("/placements", status_code=204)
def place(project_id: str, body: Placement, request: Request, session: DB) -> Response:
    """The engineer puts items in a package. It settles any question the agent asked about them."""
    project = _project(session, project_id)
    try:
        package = packages.get_package(session, project_id, body.package_id)
        items = [session.get(Item, i) for i in dict.fromkeys(body.item_ids)]
        if any(i is None or i.project_id != project_id for i in items):
            raise packages.Refused("item_not_found", "")
        packages.place(session, project, items, package, "engineer", "The engineer moved it here.")
    except packages.Refused as error:
        raise _refused(session, error) from error
    moved = {i.id for i in items}
    for decision in decisions.waiting(session, project_id, "uncertain"):
        if decision.payload["item_id"] in moved:
            decisions.withdraw(decision)
    session.commit()
    request.app.state.worker.wake()
    return Response(status_code=204)


@rules_router.get("")
def global_rules(session: DB) -> list[RuleOut]:
    """Rules the engineer chose to apply to every project."""
    return [RuleOut.model_validate(r, from_attributes=True) for r in packages.global_rules(session)]


@rules_router.delete("/{rule_id}", status_code=204)
def forget_rule(rule_id: str, session: DB) -> Response:
    rule = session.get(packages.Rule, rule_id)
    if rule is None:
        raise problem(404, "rule_not_found")
    session.delete(rule)
    session.commit()
    return Response(status_code=204)
