from typing import Annotated, Any
from urllib.parse import urlparse

import anyio
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, StringConstraints, model_validator

from tawreed import settings
from tawreed.ai import check, codex, connections, providers
from tawreed.api.common import Home, problem

router = APIRouter(prefix="/ai", tags=["ai"])
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ModelCheck(BaseModel):
    ok: bool
    problem: str | None
    sees_images: bool
    checked_at: str


class ConnectionOut(BaseModel):
    id: str
    provider: providers.Provider
    label: str
    base_url: str | None
    key_hint: str
    checks: dict[str, ModelCheck]


class ConnectionCreate(BaseModel):
    provider: providers.Provider
    api_key: str = ""  # every provider but Codex, which signs in through its own client
    base_url: str | None = None

    @model_validator(mode="after")
    def needs_key_and_address(self) -> "ConnectionCreate":
        self.api_key = self.api_key.strip()
        if self.provider != "codex" and not self.api_key:
            raise ValueError("An API key is needed.")
        if self.provider == "openai_compatible" and not (self.base_url or "").startswith(("http://", "https://")):
            raise ValueError("An OpenAI-compatible service needs its address, starting with https://")
        return self


class CodexStatus(BaseModel):
    installed: bool
    version: str | None
    signed_in: bool


class CheckRequest(BaseModel):
    model: Text


def _out(connection: dict[str, Any]) -> ConnectionOut:
    return ConnectionOut(**connection, key_hint=connection["api_key"][-4:])


def _connection(home, connection_id: str) -> dict[str, Any]:
    connection = connections.get(home, connection_id)
    if connection is None:
        raise problem(404, "connection_not_found")
    return connection


def _failed(error: Exception):
    code, params = providers.explain(error)
    return problem(400, code, **params)


@router.get("/connections")
def list_connections(home: Home) -> list[ConnectionOut]:
    return [_out(c) for c in connections.all_connections(home)]


@router.post("/connections", status_code=201)
async def add_connection(body: ConnectionCreate, home: Home) -> ConnectionOut:
    """Keep a key only once it works. An OpenAI-compatible service may not list its models; for those, the model
    check proves the key. Codex is kept once it is installed and signed in; there is only ever one."""
    if body.provider == "codex":
        state = await anyio.to_thread.run_sync(codex.status)
        if not state["installed"]:
            raise problem(400, "codex_missing")
        if not state["signed_in"]:
            raise problem(400, "codex_signed_out")
        existing = next((c for c in connections.all_connections(home) if c["provider"] == "codex"), None)
        return _out(existing or connections.add(home, "codex", codex.LABEL, "", None))
    try:
        await providers.list_models(body.provider, body.api_key, body.base_url)
    except Exception as error:
        if body.provider != "openai_compatible" or providers.explain(error)[0] != "model_missing":
            raise _failed(error) from error
    label = urlparse(body.base_url).hostname if body.base_url else providers.LABELS[body.provider]
    return _out(connections.add(home, body.provider, label or body.provider, body.api_key, body.base_url))


@router.delete("/connections/{connection_id}", status_code=204)
def remove_connection(connection_id: str, home: Home) -> None:
    _connection(home, connection_id)
    connections.remove(home, connection_id)
    chosen = settings.load(home)["ai"]
    if chosen and chosen["connection_id"] == connection_id:
        settings.save(home, ai=None)


@router.get("/connections/{connection_id}/models")
async def list_models(connection_id: str, home: Home) -> list[str]:
    c = _connection(home, connection_id)
    if c["provider"] == "codex":
        return await anyio.to_thread.run_sync(codex.models)
    try:
        return await providers.list_models(c["provider"], c["api_key"], c["base_url"])
    except Exception as error:
        if c["provider"] == "openai_compatible":
            return []  # the engineer types the model name instead
        raise _failed(error) from error


@router.post("/connections/{connection_id}/checks")
async def check_model(connection_id: str, body: CheckRequest, request: Request, home: Home) -> ConnectionOut:
    c = _connection(home, connection_id)
    if c["provider"] == "codex":
        url = request.app.state.mcp_check_url
        if url is None:
            raise problem(400, "codex_failed")
        ok, issue, sees_images = await codex.check(body.model, url, request.app.state.runs)
    else:
        model = providers.build_model(c["provider"], body.model, c["api_key"], c["base_url"])
        ok, issue, sees_images = await check.check_model(model)
    connections.record_check(home, connection_id, body.model, ok, issue, sees_images)
    return _out(_connection(home, connection_id))


@router.get("/codex")
def codex_status() -> CodexStatus:
    """Whether the Codex client is installed and signed in, as it reports itself."""
    return CodexStatus(**codex.status())


@router.post("/codex/sign-in", status_code=204)
def codex_sign_in() -> Response:
    """Open Codex's own sign-in; Tawreed never sees the credentials."""
    try:
        codex.sign_in()
    except FileNotFoundError as error:
        raise problem(400, "codex_missing") from error
    return Response(status_code=204)
