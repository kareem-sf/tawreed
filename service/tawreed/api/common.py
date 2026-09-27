from collections.abc import Iterator
from pathlib import Path
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from tawreed.core.db import sessions


def _db(request: Request) -> Iterator[Session]:
    yield from sessions(request.app.state.sessions)


def _home(request: Request) -> Path:
    return request.app.state.home


DB = Annotated[Session, Depends(_db)]
Home = Annotated[Path, Depends(_home)]


def problem(status: int, code: str, **params: str) -> HTTPException:
    """An error the interface can say in the engineer's language: a stable code plus its details."""
    return HTTPException(status_code=status, detail={"code": code, **params})
