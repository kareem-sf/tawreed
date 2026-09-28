"""The work on a project as the engineer sees it: the step and what runs now, what waits for them, and the packages;
and what the engineer does about it: stop, continue, answer, redo a step with a note, and edit the packages."""

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from tawreed import decisions, ledger, packages, publish
from tawreed import projects as project_records
from tawreed.api.common import DB, Home, problem
from tawreed.api.revisions import RevisionOut, revision_out
from tawreed.ledger import Item
from tawreed.projects import Project
from tawreed.sources import Source
from tawreed.workflow.runner import ask_to_publish, chosen

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
    kind: Literal["consent", "overlap", "plan", "uncertain", "publish"]
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
    note: str | None = None  # plan: the thinking behind it
    item: ItemOut | None = None  # uncertain
    candidates: list[PackageRef] | None = None  # uncertain
    reason: str | None = None  # uncertain


class CoverageOut(BaseModel):
    items: int
    placed: int
    unplaced: int
    waiting: int
    pages_left: int
    pending_files: int
    amount: str  # all packages' amounts, computed by Tawreed
    totals_differ: int  # sheets or pages whose stated totals differ from their items' own amounts


class RunOut(BaseModel):
    """What the workflow is doing on the project now."""

    state: Literal["running", "paused", "idle", "no_ai"]
    step: Literal["read", "plan", "place"] | None = None  # running
    file: str | None = None  # running read: the file
    done: int | None = None  # running read: pages handled; place: items placed
    total: int | None = None  # of how many
    problem: dict[str, Any] | None = None  # paused: {code, ...details}


class WorkOut(BaseModel):
    stage: Stage
    run: RunOut
    decisions: list[DecisionOut]  # waiting, oldest first
    answered: list[DecisionOut]  # the latest the engineer answered, oldest first
    coverage: CoverageOut
    packages: list[PackageOut]
    published: RevisionOut | None  # the latest revision


class Redo(BaseModel):
    """Run a step again, with the engineer's note for the AI."""

    step: Literal["read", "place"]
    source_id: str | None = None  # read: the file
    page: int | None = None  # read: one page, or the whole file
    package_id: str | None = None  # place: one package's items, or everything the AI placed
    note: Text | None = None


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


def _run(session: Session, request: Request, home, project: Project, coverage: packages.Coverage) -> RunOut:
    running = request.app.state.worker.running(project.id)
    if running and running.name == "read":
        source = session.get(Source, running.source_id)
        handled = ledger.handled_pages(session, source.id)
        return RunOut(state="running", step="read", file=source.filename, done=len(handled), total=len(source.pages))
    if running and running.name == "place":
        return RunOut(state="running", step="place", done=coverage.placed, total=coverage.items)
    if running:
        return RunOut(state="running", step=running.name)
    if project.paused:
        return RunOut(state="paused", problem=project.pause_reason)
    return RunOut(state="idle" if chosen(home) else "no_ai")


@router.get("/work")
def get_work(project_id: str, request: Request, session: DB, home: Home) -> WorkOut:
    project = _project(session, project_id)
    waiting = decisions.waiting(session, project_id)
    coverage = packages.coverage(session, project_id, decisions.waiting_items(session, project_id))
    latest = publish.latest(session, project_id)
    return WorkOut(
        stage=stage(session, project, waiting, coverage),
        run=_run(session, request, home, project, coverage),
        published=revision_out(latest) if latest else None,
        decisions=[_decision(session, d) for d in waiting],
        answered=[_decision(session, d) for d in decisions.answered(session, project_id)[-30:]],
        coverage=CoverageOut(
            items=coverage.items,
            placed=coverage.placed,
            unplaced=coverage.unplaced,
            waiting=coverage.waiting,
            pages_left=coverage.pages_left,
            pending_files=coverage.pending_files,
            amount=str(packages.money(sum((c.amount for c in coverage.packages), Decimal(0)))),
            totals_differ=sum(1 for t in coverage.totals if packages.money(t["difference"]) != 0),
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


@router.post("/stop", status_code=204)
def stop(project_id: str, request: Request, session: DB) -> Response:
    """Stop the running step; the project waits until the engineer continues."""
    _project(session, project_id)
    request.app.state.worker.stop(project_id)
    return Response(status_code=204)


def _carry_on(session: Session, request: Request, project: Project) -> None:
    project.paused, project.pause_reason = False, None
    session.commit()
    request.app.state.worker.carry_on(project.id)


@router.post("/continue", status_code=204)
def carry_on(project_id: str, request: Request, session: DB) -> Response:
    """A stopped or paused project carries on from where it is."""
    _carry_on(session, request, _project(session, project_id))
    return Response(status_code=204)


@router.post("/redo", status_code=204)
def redo(project_id: str, body: Redo, request: Request, session: DB) -> Response:
    """Run a step again with the engineer's note: read a file (or one page) again, or place again what the AI
    placed (in one package, or everywhere). The engineer's own placements stay."""
    project = _project(session, project_id)
    if body.step == "read":
        source = session.get(Source, body.source_id or "")
        if source is None or source.project_id != project_id or source.status != "read":
            raise problem(404, "source_not_found")
        pages = [body.page] if body.page is not None else [p.number for p in source.pages]
        ledger.clear_pages(session, source, pages)
        decisions.withdraw_gone(session, project_id)
        project.redo = {"step": "read", "source_id": source.id, "note": body.note}
    else:
        placed = packages.assignments(session, project_id)
        again = [
            session.get(Item, item_id)
            for item_id, a in placed.items()
            if a.decided_by == "agent" and (body.package_id is None or a.package_id == body.package_id)
        ]
        packages.unplace(session, project, again)
        if body.package_id is None:
            for decision in decisions.waiting(session, project_id, "uncertain"):
                decisions.withdraw(decision)
        project.redo = {"step": "place", "note": body.note}
    packages.touch(project)
    _carry_on(session, request, project)
    return Response(status_code=204)


@router.post("/publish", status_code=204)
def ask_again(project_id: str, session: DB) -> Response:
    """Show the publish card again, to publish the current work (again, for instance without rates)."""
    project = _project(session, project_id)
    coverage = packages.coverage(session, project_id, decisions.waiting_items(session, project_id))
    if not (coverage.complete and coverage.packages) or decisions.waiting(session, project_id):
        raise problem(409, "not_ready_to_publish")
    ask_to_publish(session, project)
    session.commit()
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
            revision = publish.publish(session, home, project, prices=body.prices is not False)
        decisions.answer(session, project, decision, body)
    except decisions.Unanswerable as error:
        session.rollback()
        raise problem(409, error.code) from error
    except publish.NotReady as error:
        session.rollback()
        raise problem(409, error.code) from error
    if revision:
        decision.answer = {**decision.answer, "revision": revision.name, "prices": revision.manifest["prices"]}
    session.commit()
    request.app.state.worker.carry_on(project_id)
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
    """The engineer puts items in a package. It settles any question raised about them."""
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
