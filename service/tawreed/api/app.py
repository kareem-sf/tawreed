import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException

from tawreed import __version__, decisions
from tawreed.agent import mcp_endpoint
from tawreed.agent.runtime import Worker
from tawreed.api import ai, projects, revisions, settings, sources, work
from tawreed.core.db import open_database
from tawreed.sources.reader import Reader


def create_app(home: Path, token: str, port: int | None = None) -> FastAPI:
    """Build the service for one data home. Every route except /health needs the launch token. With the port it
    listens on, it also serves Tawreed's tools over MCP to the Codex client, each run with its own token."""

    def require_token(authorization: str = Header(default="")) -> None:
        if not secrets.compare_digest(authorization, f"Bearer {token}"):
            raise HTTPException(status_code=401, detail={"code": "wrong_token"})

    runs = mcp_endpoint.Runs()
    agent_tools, check_tools = mcp_endpoint.agent_server(runs), mcp_endpoint.check_server(runs)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.sessions = open_database(home)
        app.state.worker = Worker(home, app.state.sessions, runs=runs, mcp_url=app.state.mcp_url)
        app.state.reader = Reader(
            home,
            app.state.sessions,
            after_read=lambda session, source: decisions.raise_overlap(session, home, source),
            notify=app.state.worker.wake,
        )
        app.state.reader.start()
        app.state.worker.start()
        async with agent_tools.session_manager.run(), check_tools.session_manager.run():
            yield
        app.state.worker.close()
        app.state.reader.close()
        app.state.sessions.kw["bind"].dispose()

    app = FastAPI(title="Tawreed", version=__version__, lifespan=lifespan)
    app.state.home = home
    app.state.runs = runs
    app.state.mcp_url = f"http://127.0.0.1:{port}/mcp/" if port else None
    app.state.mcp_check_url = f"http://127.0.0.1:{port}/mcp-check/" if port else None
    for path, server in (("/mcp", agent_tools), ("/mcp-check", check_tools)):
        served = server.streamable_http_app(streamable_http_path="/", stateless_http=True, json_response=True)
        app.mount(path, mcp_endpoint.guarded(served, runs))

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
