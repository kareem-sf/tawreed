import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException

from tawreed import __version__
from tawreed.api import ai, projects, settings
from tawreed.core.db import open_database


def create_app(home: Path, token: str) -> FastAPI:
    """Build the service for one data home. Every route except /health needs the launch token."""

    def require_token(authorization: str = Header(default="")) -> None:
        if not secrets.compare_digest(authorization, f"Bearer {token}"):
            raise HTTPException(status_code=401, detail={"code": "wrong_token"})

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.sessions = open_database(home)
        yield
        app.state.sessions.kw["bind"].dispose()

    app = FastAPI(title="Tawreed", version=__version__, lifespan=lifespan)
    app.state.home = home

    @app.get("/health", tags=["service"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(projects.router, dependencies=[Depends(require_token)])
    app.include_router(settings.router, dependencies=[Depends(require_token)])
    app.include_router(ai.router, dependencies=[Depends(require_token)])
    return app
