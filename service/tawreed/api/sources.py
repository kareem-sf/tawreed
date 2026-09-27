from typing import Annotated, Literal

from fastapi import APIRouter, Query
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from tawreed import sources
from tawreed.api.common import DB, Home, problem
from tawreed.api.projects import SourceOut
from tawreed.sources import readers

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


class SourceDetail(SourceOut):
    pages: list[PageOut]


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
    return SourceDetail.model_validate(_source(session, project_id, source_id))


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
    cached = sources.pages_folder(home, source) / f"{number}.png"
    if not cached.exists():
        cached.write_bytes(readers.render(sources.copy_of(home, source), source.kind, number))
    return Response(cached.read_bytes(), media_type="image/png")
