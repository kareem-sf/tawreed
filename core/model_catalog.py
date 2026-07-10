"""Live model-catalog fetcher.

For OpenAI, Anthropic, and Google Gemini, the provider's own
``/models`` endpoint returns the canonical list of currently available
models. We hit it lazily from the Settings page so the dropdown is
always in sync with reality rather than a hand-curated list that goes
stale the moment a new model ships.

Strategy
--------
- For each provider, the request URL and parsing logic is hard-coded
  (the API shapes are stable; chasing SDK defaults adds a dep).
- We use ``httpx.AsyncClient`` with a short timeout (8s) so a slow
  network never freezes the UI.
- The curated list in ``core.ai.PROVIDERS`` is the *fallback* if the
  fetch fails (offline, invalid key, rate-limited). The fallback
  list is still shown — the user just sees a "(curated)" suffix in
  the status label so they know it might be out of date.
- Custom OpenAI-compatible providers are fetched via
  ``{base_url}/models`` (the OpenAI SDK convention); if the endpoint
  doesn't exist, we return the user's typed model unchanged and the
  dropdown is editable.

This module is intentionally import-time side-effect-free — it only
runs when ``fetch_models()`` is called. That matters for tests and
for the splash→main transition where we want a fast cold start.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

import httpx

from core.ai import PROVIDERS
from core.codex_connector import CodexConnectorError, fetch_codex_models

log = logging.getLogger(__name__)


# Default per-request timeout. Kept short — a slow fetch should
# fall through to the curated list, not block the UI.
_TIMEOUT_SECONDS = 8.0


@dataclass
class ModelFetchResult:
    """Outcome of a ``fetch_models()`` call.

    Attributes
    ----------
    provider:
        The provider key the fetch was for. Echoed back so the UI
        doesn't have to remember which request it made.
    models:
        Sorted, de-duplicated list of model IDs. Always non-empty
        — we always fall back to the curated list on failure.
    source:
        Where the list came from. One of:

        - ``"live"`` — the live provider endpoint responded OK.
        - ``"curated"`` — fetch failed or the provider has no list
          endpoint, so we returned the curated list from
          ``core.ai.PROVIDERS``.
        - ``"manual"`` — for the OpenAI-compatible provider when no
          base URL is set, the UI should let the user type freely.
    error:
        Human-readable failure reason, or ``None`` if ``source ==
        "live"``. The Settings page shows this in the status label
        so the user understands why the list is "curated".
    """

    provider: str
    models: list[str] = field(default_factory=list)
    source: str = "curated"
    error: str | None = None
    default_model: str | None = None


def _curated(provider: str) -> list[str]:
    """Return the curated list for ``provider`` (may be empty)."""
    cfg = PROVIDERS.get(provider, {})
    return list(cfg.get("models", []))


def _sort_dedupe(items: list[str]) -> list[str]:
    """Stable sort, case-insensitive, drop empties and duplicates."""
    seen = set()
    out: list[str] = []
    for raw in items:
        s = (raw or "").strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    out.sort(key=str.lower)
    return out


# ---------------------------------------------------------------------------
# Per-provider live fetches
# ---------------------------------------------------------------------------


async def _fetch_openai(api_key: str, base_url: str) -> list[str]:
    """OpenAI / OpenAI-compatible ``GET {base_url}/models``."""
    url = f"{base_url.rstrip('/')}/models"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    items = data.get("data") or data.get("models") or []
    return [m.get("id") or m.get("name") for m in items if isinstance(m, dict)]


async def _fetch_anthropic(api_key: str) -> list[str]:
    """Anthropic ``GET https://api.anthropic.com/v1/models``."""
    url = "https://api.anthropic.com/v1/models"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    items = data.get("data") or []
    return [m.get("id") for m in items if isinstance(m, dict)]


async def _fetch_google(api_key: str) -> list[str]:
    """Google Gemini ``GET .../v1beta/models?key=...``."""
    url = "https://generativelanguage.googleapis.com/v1beta/models"
    params = {"key": api_key}
    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
    items = data.get("models") or []
    # Gemini returns names like "models/gemini-1.5-pro" — strip prefix.
    out: list[str] = []
    for m in items:
        if not isinstance(m, dict):
            continue
        name = m.get("name") or ""
        if name.startswith("models/"):
            name = name[len("models/") :]
        if name:
            out.append(name)
    return out


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def fetch_models(
    provider: str,
    api_key: str = "",
    base_url: str = "",
) -> ModelFetchResult:
    """Fetch the live model list for ``provider``.

    Always returns a ``ModelFetchResult`` — never raises. On any
    failure (network, auth, parse), ``source`` is set to ``"curated"``
    and ``models`` is the curated fallback, so the dropdown is never
    empty.
    """
    curated = _sort_dedupe(_curated(provider))

    if provider not in PROVIDERS:
        return ModelFetchResult(
            provider=provider,
            models=curated,
            source="curated",
            error=f"Unknown provider: {provider!r}",
        )

    if PROVIDERS[provider].get("transport") == "codex_cli":
        try:
            catalog = await asyncio.to_thread(fetch_codex_models)
        except CodexConnectorError as exc:
            return ModelFetchResult(
                provider=provider,
                models=[],
                source="error",
                error=str(exc),
            )
        except Exception as exc:
            log.warning("fetch_models: unexpected Codex error: %s", exc)
            return ModelFetchResult(
                provider=provider,
                models=[],
                source="error",
                error="Could not fetch the Codex model catalog.",
            )
        return ModelFetchResult(
            provider=provider,
            models=[model.model_id for model in catalog.models],
            source="live",
            error=None,
            default_model=catalog.default_model,
        )

    if not api_key:
        return ModelFetchResult(
            provider=provider,
            models=curated,
            source="curated",
            error="No API key — showing curated list.",
        )

    # Custom OpenAI-compatible needs a base URL.
    if provider == "OpenAI Compatible" and not base_url.strip():
        return ModelFetchResult(
            provider=provider,
            models=curated,
            source="manual",
            error="Enter a base URL and refresh to fetch live models.",
        )

    try:
        if provider in ("OpenAI", "OpenAI Compatible"):
            effective_base = base_url or PROVIDERS[provider]["base_url"]
            raw = await _fetch_openai(api_key, effective_base)
        elif provider == "Claude":
            raw = await _fetch_anthropic(api_key)
        elif provider == "Google":
            raw = await _fetch_google(api_key)
        else:
            return ModelFetchResult(
                provider=provider,
                models=curated,
                source="curated",
                error=f"No live fetcher for provider: {provider!r}",
            )
    except httpx.HTTPStatusError as e:
        return ModelFetchResult(
            provider=provider,
            models=curated,
            source="curated",
            error=f"HTTP {e.response.status_code} from provider.",
        )
    except (httpx.RequestError, httpx.TimeoutException) as e:
        return ModelFetchResult(
            provider=provider,
            models=curated,
            source="curated",
            error=f"Network error: {e.__class__.__name__}.",
        )
    except Exception as e:  # parse errors, JSON shape changes, etc.
        log.warning("fetch_models: unexpected error for %s: %s", provider, e)
        return ModelFetchResult(
            provider=provider,
            models=curated,
            source="curated",
            error=f"Parse error: {e}",
        )

    live = _sort_dedupe([m for m in raw if isinstance(m, str)])

    if not live:
        # Provider responded but returned nothing usable; show curated
        # so the dropdown isn't empty.
        return ModelFetchResult(
            provider=provider,
            models=curated,
            source="curated",
            error="Provider returned no models — showing curated list.",
        )

    # Merge: live first (source of truth), then curated (in case the
    # user's saved model is older and was removed from the catalog).
    # The user's saved model will be re-selected by the UI from this
    # combined list.
    merged = live + [m for m in curated if m.lower() not in {x.lower() for x in live}]
    return ModelFetchResult(
        provider=provider,
        models=_sort_dedupe(merged),
        source="live",
    )
