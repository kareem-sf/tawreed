"""Tests for core.model_catalog — the live model-list fetcher.

We mock httpx so no real network calls happen. The goal is to cover
the merge logic, the curated fallback, and the per-provider URL
routing — not to integration-test Anthropic / OpenAI / Google.
"""

from __future__ import annotations

import httpx
import pytest

from core import model_catalog

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeAsyncClient:
    """Drop-in replacement for httpx.AsyncClient for tests.

    Records the URL it was asked to GET and returns a canned response.
    """

    def __init__(self, *, status: int = 200, json_body: dict | Exception = None):
        self.status = status
        self.json_body = json_body or {}
        self.calls: list[tuple[str, dict]] = []
        self._entered = False

    async def __aenter__(self):
        self._entered = True
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, *, headers=None, params=None):
        self.calls.append((url, {"headers": headers, "params": params}))
        if isinstance(self.json_body, Exception):
            raise self.json_body
        # Use a real Response so raise_for_status / .json() work.
        req = httpx.Request("GET", url)
        resp = httpx.Response(self.status, json=self.json_body, request=req)
        return resp


def _patch_async_client(monkeypatch, fake: _FakeAsyncClient):
    monkeypatch.setattr(model_catalog.httpx, "AsyncClient", lambda *a, **kw: fake)


# ---------------------------------------------------------------------------
# Sort/dedupe helper
# ---------------------------------------------------------------------------


def test_sort_dedupe_drops_empty_and_duplicates():
    out = model_catalog._sort_dedupe(["B", "", "  A  ", "a", "C", "b"])
    # Case-insensitive de-dupe + trim + sort.
    assert out == ["A", "B", "C"]


def test_sort_dedupe_stable():
    """Same input twice → same output (function is pure)."""
    a = model_catalog._sort_dedupe(["z", "a", "m"])
    b = model_catalog._sort_dedupe(["z", "a", "m"])
    assert a == b == ["a", "m", "z"]


# ---------------------------------------------------------------------------
# Per-provider success paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_openai_uses_bearer_header(monkeypatch):
    fake = _FakeAsyncClient(json_body={"data": [{"id": "gpt-4o"}, {"id": "gpt-4o-mini"}]})
    _patch_async_client(monkeypatch, fake)

    result = await model_catalog.fetch_models("OpenAI", api_key="placeholder-openai-key")
    assert result.source == "live"
    assert "gpt-4o" in result.models
    assert "gpt-4o-mini" in result.models
    # Bearer header was sent.
    (url, kwargs) = fake.calls[0]
    assert kwargs["headers"]["Authorization"] == "Bearer placeholder-openai-key"
    assert url.endswith("/v1/models")


@pytest.mark.asyncio
async def test_fetch_anthropic_uses_x_api_key_header(monkeypatch):
    fake = _FakeAsyncClient(json_body={"data": [{"id": "claude-3-5-sonnet-20241022"}]})
    _patch_async_client(monkeypatch, fake)

    result = await model_catalog.fetch_models("Claude", api_key="placeholder-anthropic-key")
    assert result.source == "live"
    assert "claude-3-5-sonnet-20241022" in result.models
    (url, kwargs) = fake.calls[0]
    assert "anthropic.com" in url
    assert kwargs["headers"]["x-api-key"] == "placeholder-anthropic-key"
    assert kwargs["headers"]["anthropic-version"] == "2023-06-01"


@pytest.mark.asyncio
async def test_fetch_google_strips_models_prefix(monkeypatch):
    fake = _FakeAsyncClient(
        json_body={
            "models": [
                {"name": "models/gemini-1.5-pro"},
                {"name": "models/gemini-1.5-flash"},
            ],
        }
    )
    _patch_async_client(monkeypatch, fake)

    result = await model_catalog.fetch_models("Google", api_key="placeholder-google-key")
    assert result.source == "live"
    assert "gemini-1.5-pro" in result.models
    assert "gemini-1.5-flash" in result.models


# ---------------------------------------------------------------------------
# Fallback behaviour
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_provider_returns_curated():
    result = await model_catalog.fetch_models("NotARealProvider", api_key="x")
    assert result.source == "curated"
    assert result.error is not None
    assert "Unknown provider" in result.error


@pytest.mark.asyncio
async def test_missing_api_key_returns_curated():
    result = await model_catalog.fetch_models("OpenAI", api_key="")
    assert result.source == "curated"
    assert "No API key" in result.error


@pytest.mark.asyncio
async def test_http_error_returns_curated(monkeypatch):
    fake = _FakeAsyncClient(
        status=401,
        json_body={"error": {"message": "invalid key"}},
    )
    _patch_async_client(monkeypatch, fake)

    result = await model_catalog.fetch_models("OpenAI", api_key="bad")
    assert result.source == "curated"
    # Curated list still shown.
    assert len(result.models) > 0
    assert "HTTP 401" in result.error


@pytest.mark.asyncio
async def test_network_error_returns_curated(monkeypatch):
    fake = _FakeAsyncClient(json_body=httpx.ConnectError("offline"))
    _patch_async_client(monkeypatch, fake)

    result = await model_catalog.fetch_models("Claude", api_key="x")
    assert result.source == "curated"
    assert "Network error" in result.error


@pytest.mark.asyncio
async def test_empty_response_returns_curated(monkeypatch):
    fake = _FakeAsyncClient(json_body={"data": []})
    _patch_async_client(monkeypatch, fake)

    result = await model_catalog.fetch_models("OpenAI", api_key="x")
    assert result.source == "curated"
    assert "no models" in result.error.lower()


@pytest.mark.asyncio
async def test_compatible_needs_base_url(monkeypatch):
    fake = _FakeAsyncClient()
    _patch_async_client(monkeypatch, fake)

    result = await model_catalog.fetch_models("OpenAI Compatible", api_key="x", base_url="")
    assert result.source == "manual"
    assert "base url" in result.error.lower()
    # No HTTP call should have been made.
    assert fake.calls == []


# ---------------------------------------------------------------------------
# Merge logic
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_live_list_merged_with_curated_for_unknown_saved_model(monkeypatch):
    """If the user has a model that's no longer in the live list,
    it should still appear in the merged dropdown."""
    # Live returns only the new models.
    fake = _FakeAsyncClient(json_body={"data": [{"id": "new-model-2026"}]})
    _patch_async_client(monkeypatch, fake)

    # The curated list for OpenAI includes a known model — the user's
    # saved value from a previous build. Make sure it survives the
    # merge even though it's no longer in the live response.
    from core.ai import PROVIDERS

    curated_models = PROVIDERS["OpenAI"]["models"]
    assert curated_models  # must have at least one curated entry
    preserved = curated_models[0]

    result = await model_catalog.fetch_models("OpenAI", api_key="x")
    # Both the live and the curated entries are present.
    assert "new-model-2026" in result.models
    assert preserved in result.models
    # The curated entry is preserved (no longer in live) — verify it
    # survived by checking index is within bounds.
    live_only = "new-model-2026"
    assert result.models.index(live_only) < len(result.models)
