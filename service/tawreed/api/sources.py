from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from tawreed import decisions, ledger, packages, sources
from tawreed.api.common import DB, Home, problem
from tawreed.api.projects import SourceOut
from tawreed.ledger.extract import SheetLayout
from tawreed.projects import Project

router = APIRouter(prefix="/projects/{project_id}/sources", tags=["sources"])

Cell = str | int | float | bool | None


class PageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    number: int
    kind: Literal["sheet", "page", "image"]
    name: str
    has_text: bool
    hidden: bool
    rows: int | None
    cols: int | None
    width: float | None
    height: float | None


class Handled(BaseModel):
    """How a page was read: laid out (a sheet's columns, when it is a sheet) or set aside, and by whom."""

    by: Literal["agent", "engineer"]
    set_aside: str | None  # the reason, when set aside
    sheet: SheetLayout | None  # a sheet's layout, to edit
    items: int


class HandledPage(PageOut):
    handled: Handled | None


class SourceDetail(SourceOut):
    pages: list[HandledPage]


class SetAside(BaseModel):
    reason: str = Field(min_length=1, max_length=300)


class SheetView(BaseModel):
    kind: Literal["sheet"]
    name: str
    first_row: int  # the row number of rows[0]
    rows: list[list[Cell]]
    total_rows: int
    merged: list[list[int]]


class TextLine(BaseModel):
    top: float
    bottom: float
    text: str


class TextView(BaseModel):
    kind: Literal["page"]
    width: float
    height: float
    lines: list[TextLine]


class ImageView(BaseModel):
    kind: Literal["image"]
    width: int
    height: int


def _source(session, project_id: str, source_id: str) -> sources.Source:
    source = sources.get_source(session, project_id, source_id)
    if source is None:
        raise problem(404, "source_not_found")
    return source


def _page(source: sources.Source, number: int) -> sources.SourcePage:
    page = next((p for p in source.pages if p.number == number), None)
    if page is None:
        raise problem(404, "page_not_found")
    return page


@router.get("/{source_id}")
def get_source(project_id: str, source_id: str, session: DB) -> SourceDetail:
    source = _source(session, project_id, source_id)
    counts = dict(
        session.execute(
            select(ledger.Item.page, func.count()).where(ledger.Item.source_id == source.id).group_by(ledger.Item.page)
        ).all()
    )
    how = {}
    for layout in session.scalars(select(ledger.Layout).where(ledger.Layout.source_id == source.id)):
        for number in layout.pages:
            how[number] = Handled(
                by=layout.decided_by,
                set_aside=layout.spec.get("skip"),
                sheet=SheetLayout(**layout.spec) if "first_row" in layout.spec else None,
                items=counts.get(number, 0),
            )
    return SourceDetail(
        **SourceOut.model_validate(source).model_dump(),
        pages=[
            HandledPage(**PageOut.model_validate(page).model_dump(), handled=how.get(page.number))
            for page in source.pages
        ],
    )


def _changed(session, request: Request, source: sources.Source) -> None:
    """After the engineer's own layout: earlier placements carry over, questions about items gone are withdrawn."""
    project = session.get(Project, source.project_id)
    packages.carry_over(session, project, source)
    packages.touch(project)
    decisions.withdraw_gone(session, project.id)
    session.commit()
    request.app.state.worker.wake()


@router.put("/{source_id}/pages/{number}/layout", status_code=204)
def lay_out_sheet(
    project_id: str, source_id: str, number: int, body: SheetLayout, request: Request, session: DB, home: Home
) -> Response:
    """The engineer sets a sheet's columns. Its items are read again from the cells; the AI leaves it as it is."""
    source = _source(session, project_id, source_id)
    try:
        ledger.lay_out_sheet(session, home, source, number, body, "engineer")
    except ledger.NotReadable as error:
        session.rollback()
        raise problem(409, error.code) from error
    _changed(session, request, source)
    return Response(status_code=204)


@router.post("/{source_id}/pages/{number}/set-aside", status_code=204)
def set_aside(project_id: str, source_id: str, number: int, body: SetAside, request: Request, session: DB) -> Response:
    """The engineer says a page lists no items."""
    source = _source(session, project_id, source_id)
    try:
        ledger.skip_pages(session, source, [number], body.reason, "engineer")
    except ledger.NotReadable as error:
        session.rollback()
        raise problem(409, error.code) from error
    _changed(session, request, source)
    return Response(status_code=204)


@router.get("/{source_id}/pages/{number}")
def get_page(
    project_id: str,
    source_id: str,
    number: int,
    session: DB,
    home: Home,
    start: Annotated[int, Query(ge=1)] = 1,
    count: Annotated[int, Query(ge=1, le=1000)] = 200,
) -> SheetView | TextView | ImageView:
    """A page's content. Sheets come a window of rows at a time, from row `start`."""
    source = _source(session, project_id, source_id)
    _page(source, number)
    content = sources.page_content(home, source, number)
    if content["kind"] == "sheet":
        rows = content["rows"]
        return SheetView(
            kind="sheet",
            name=content["name"],
            first_row=start,
            rows=rows[start - 1 : start - 1 + count],
            total_rows=len(rows),
            merged=content["merged"],
        )
    if content["kind"] == "page":
        return TextView(
            kind="page",
            width=content["width"],
            height=content["height"],
            lines=[TextLine(top=line["top"], bottom=line["bottom"], text=line["text"]) for line in content["lines"]],
        )
    return ImageView(kind="image", width=content["width"], height=content["height"])


@router.get("/{source_id}/pages/{number}/image", response_class=Response)
def page_image(project_id: str, source_id: str, number: int, session: DB, home: Home) -> Response:
    """A PNG of a PDF page or an image; drawn once, then kept beside the page's content."""
    source = _source(session, project_id, source_id)
    page = _page(source, number)
    if page.kind == "sheet":
        raise problem(404, "no_page_image")
    return Response(sources.page_image(home, source, number), media_type="image/png")
