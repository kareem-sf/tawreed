"""Streaming categorization adapter independent from Qt widgets."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any, Protocol

from core.ai import analyze_boq_stream


class _Emitter(Protocol):
    def emit(self, value: str) -> None: ...


class AnalysisSignals(Protocol):
    log: _Emitter


def run_analysis(
    api_key: str,
    base_url: str,
    model_id: str,
    system_prompt: str,
    user_prompt: str,
    signals: AnalysisSignals,
    i18n=None,
    provider: str = "OpenAI",
    *,
    _stream_factory: Callable[..., Iterator[tuple[str, Any]]] = analyze_boq_stream,
) -> dict:
    """Drive the streaming LLM call and forward tokens to the UI.

    The consumer contract with ``analyze_boq_stream`` is:

    * Incremental yields are ``(text, is_thought)`` â€” forward to the
      live console verbatim, bracketed by ``[Thinking]`` markers
      when ``is_thought`` is true.
    * The final yield is the sentinel ``("__DONE__", parsed_dict)``.
      Anything else (a missing sentinel, a ``StopIteration``, a
      generator exception) is treated as a failure and surfaced
      in the returned dict under ``error`` so the caller can show
      it in the error dialog.

    Returns the parsed result dict. Always returns; never raises.
    """
    gen = _stream_factory(
        api_key=api_key,
        base_url=base_url,
        model_id=model_id,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        i18n=i18n,
        provider=provider,
    )
    last_was_thought: bool | None = None
    parsed: dict = {}
    try:
        for token, is_thought in gen:
            # Terminal sentinel â€” the result is in ``token``.
            if token == "__DONE__":
                parsed = is_thought if isinstance(is_thought, dict) else {}
                break

            if is_thought:
                if last_was_thought is not True:
                    signals.log.emit(
                        "\n[" + (i18n.tr("thinking_marker") if i18n else "Thinking") + "] "
                    )
                    last_was_thought = True
                signals.log.emit(token)
            else:
                if last_was_thought is True:
                    signals.log.emit("\n")
                last_was_thought = False
                signals.log.emit(token)
    except Exception as e:
        # The generator raised mid-iteration. Wrap into a structured
        # error so the caller can show it; don't crash the worker.
        error_msg = (
            i18n.tr("stream_consumer_error").format(
                error_type=type(e).__name__, error_message=str(e)
            )
            if i18n
            else f"Stream consumer error: {type(e).__name__}: {e}"
        )
        return {
            "project_name": i18n.tr("default_project_name") if i18n else "Tawreed Project",
            "date": "",
            "items": {},
            "error": error_msg,
        }

    if not parsed:
        # Generator ended without emitting the sentinel (e.g. the
        # user closed the console mid-run, or the upstream call
        # returned an empty stream). Surface a clean error rather
        # than letting the workspace show the old generic message.
        error_msg = (
            i18n.tr("stream_ended_without_sentinel")
            if i18n
            else "AI stream ended without a __DONE__ sentinel. The model may have disconnected mid-response."
        )
        return {
            "project_name": i18n.tr("default_project_name") if i18n else "Tawreed Project",
            "date": "",
            "items": {},
            "error": error_msg,
        }
    return parsed


__all__ = ["AnalysisSignals", "run_analysis"]
