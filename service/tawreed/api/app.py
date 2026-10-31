import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from tawreed import __version__, decisions
from tawreed.api import ai, projects, revisions, settings, sources, work
from tawreed.core.db import open_database
from tawreed.projects import remove_leftovers
from tawreed.sources.reader import Reader
from tawreed.workflow import mcp_endpoint
from tawreed.workflow.runner import Worker


def create_app(home: Path, token: str, port: int | None = None) -> FastAPI:
    """Build the service for one data home. Every route except /health needs the launch token. With the port it
    listens on, it also serves the workflow's step tools over MCP to the Codex client, each run with its own token."""

    def require_token(authorization: str = Header(default="")) -> None:
        if not secrets.compare_digest(authorization, f"Bearer {token}"):
            raise HTTPException(status_code=401, detail={"code": "wrong_token"})

    runs = mcp_endpoint.Runs()
    step_tools, check_tools = mcp_endpoint.step_server(runs), mcp_endpoint.check_server(runs)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.sessions = open_database(home)
        with app.state.sessions() as session:
            remove_leftovers(session, home)
        app.state.worker = Worker(home, app.state.sessions, runs=runs, mcp_url=app.state.mcp_url)
        app.state.reader = Reader(
            home,
            app.state.sessions,
            after_read=lambda session, source: decisions.raise_overlap(session, home, source),
            notify=app.state.worker.wake,
        )
        app.state.reader.start()
        app.state.worker.start()
        async with step_tools.session_manager.run(), check_tools.session_manager.run():
            yield
        app.state.worker.close()
        app.state.reader.close()
        app.state.sessions.kw["bind"].dispose()

    app = FastAPI(title="Tawreed", version=__version__, lifespan=lifespan)
    app.state.home = home
    app.state.runs = runs
    app.state.mcp_url = f"http://127.0.0.1:{port}/mcp/" if port else None
    app.state.mcp_check_url = f"http://127.0.0.1:{port}/mcp-check/" if port else None
    for path, server in (("/mcp", step_tools), ("/mcp-check", check_tools)):
        served = server.streamable_http_app(streamable_http_path="/", stateless_http=True, json_response=True)
        app.mount(path, mcp_endpoint.guarded(served, runs))

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, error: RequestValidationError) -> JSONResponse:
        """Every request the shape of which is wrong, in the one form the interface maps: the field that is wrong."""
        location = error.errors()[0]["loc"] if error.errors() else ()
        field = ".".join(str(part) for part in location if part != "body")
        return JSONResponse(status_code=422, content={"detail": {"code": "invalid_request", "field": field}})

    @app.exception_handler(StarletteHTTPException)
    async def http_problem(_request: Request, error: StarletteHTTPException) -> JSONResponse:
        """A problem with a code passes through; Starlette's own plain-text ones (an unparsable body) get one."""
        detail = error.detail
        if not isinstance(detail, dict):
            detail = {"code": "wrong_token" if error.status_code == 401 else "bad_request"}
        return JSONResponse(status_code=error.status_code, content={"detail": detail}, headers=error.headers)

    @app.get("/health", tags=["service"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    routers = (
        projects.router,
        sources.router,
        work.router,
        work.rules_router,
        revisions.router,
        settings.router,
        ai.router,
    )
    for router in routers:
        app.include_router(router, dependencies=[Depends(require_token)])
    return app
