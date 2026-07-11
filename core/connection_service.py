"""Provider connection checks independent from the desktop UI."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from core.ai import test_connection as _test_connection
from core.codex_connector import CodexConnectorError, fetch_codex_models

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ConnectionCheckResult:
    success: bool
    message: str

    def __bool__(self) -> bool:
        return self.success


def check_connection(
    provider: str, api_key: str, base_url: str, model_id: str
) -> ConnectionCheckResult:
    """Synchronous wrapper for the settings-page "Test Connection" button.

    Delegates to ``core.ai.test_connection`` so that all four
    providers (OpenAI, Anthropic Claude, Google Gemini, OpenAI-
    Compatible) are handled with the correct auth header and URL
    path. The previous version of this function only knew how to
    hit an OpenAI-style /chat/completions endpoint, which silently
    401'd on every Claude call.

    ``provider`` is the PROVIDERS dict key (e.g. "OpenAI",
    "Claude", "Google", "OpenAI Compatible"). ``base_url`` is the
    user-entered endpoint; for the named providers, the canonical
    URL is taken from PROVIDERS unless the user overrode it
    (e.g. a self-hosted OpenAI-compatible service).
    """
    if provider == "Codex":
        try:
            catalog = fetch_codex_models()
        except CodexConnectorError as exc:
            return ConnectionCheckResult(False, str(exc))
        except Exception:
            log.exception("Codex connection check failed")
            return ConnectionCheckResult(False, "Could not verify the Codex ChatGPT connection.")
        selected = model_id or catalog.default_model
        if selected and selected not in {item.model_id for item in catalog.models}:
            return ConnectionCheckResult(
                False,
                f"Codex is connected, but model '{selected}' is not available to this account.",
            )
        return ConnectionCheckResult(True, catalog.message)

    try:
        # The async function in core.ai handles every provider's
        # auth scheme, endpoint path, and error envelope. We
        # run it to completion in a fresh event loop so the
        # caller (which is itself a background thread) doesn't
        # have to deal with asyncio.
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # We're inside an existing event loop (qasync).
                # Schedule and wait synchronously via to_thread is
                # awkward; instead just create a one-shot loop in
                # a new thread.
                import concurrent.futures

                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                    success = ex.submit(
                        asyncio.run,
                        _test_connection(provider, api_key, model_id, base_url),
                    ).result(timeout=15.0)
                    return ConnectionCheckResult(
                        bool(success),
                        "Connection successful."
                        if success
                        else "Could not reach the provider. Check the key, URL, and model.",
                    )
        except RuntimeError:
            pass
        success = asyncio.run(_test_connection(provider, api_key, model_id, base_url))
        return ConnectionCheckResult(
            bool(success),
            "Connection successful."
            if success
            else "Could not reach the provider. Check the key, URL, and model.",
        )
    except Exception as exc:
        log.exception("Connection check failed")
        return ConnectionCheckResult(False, f"Connection check failed: {type(exc).__name__}.")


__all__ = ["ConnectionCheckResult", "check_connection"]
