"""Tests for the streaming protocol in core.ai + core.stream_service.

The previous implementation used ``return parsed_data`` from a
generator and consumed it via ``except StopIteration as e: return e.value``.
That pattern is fragile: if the generator raises mid-iteration, the
consumer sees ``RuntimeError("AI analysis finished unexpectedly")``
instead of the actual cause.

These tests pin down the new sentinel-based contract:
  * every code path in analyze_boq_stream ends with a __DONE__ yield
  * the consumer's run_analysis returns the parsed dict (or a
    structured error) — never raises
  * a flat dict response (the model's actual output shape) is
    auto-lifted into the nested items-key schema
"""

from __future__ import annotations

from unittest import mock

# conftest.py handles the project-root sys.path insertion and the
# shared isolation fixtures. See tests/conftest.py.


def _make_stream(chunks: list, error: Exception | None = None):
    """Fake openai streaming response that yields our chunks, then raises."""

    class _Chunk:
        def __init__(self, content):
            self.choices = [
                type(
                    "C",
                    (),
                    {"delta": type("D", (), {"content": content, "reasoning_content": None})()},
                )()
            ]

    class _Resp:
        def __iter__(self):
            for c in chunks:
                yield _Chunk(c)
            if error:
                raise error

    return _Resp()


# ---------------------------------------------------------------------------
# analyze_boq_stream
# ---------------------------------------------------------------------------


def test_stream_yields_done_sentinel_on_success(monkeypatch):
    """Happy path: tokens stream, JSON parses, final yield is __DONE__."""
    from core import ai

    # Valid flat JSON in a single chunk.
    json_text = '{"R1": "Plumbing", "R2": "HVAC", "project_name": "Mall", "date": "2026-06-13"}'
    fake_resp = _make_stream([json_text])
    monkeypatch.setattr(ai.openai.OpenAI, "__init__", lambda self, **kw: None)
    monkeypatch.setattr(ai.openai.OpenAI, "chat", mock.Mock())
    monkeypatch.setattr(
        ai.openai.OpenAI,
        "chat",
        mock.Mock(**{"completions.create.return_value": fake_resp}),
    )

    yields = list(
        ai.analyze_boq_stream(
            api_key="x",
            base_url="https://x",
            model_id="gpt-4.1-mini",
            system_prompt="sp",
            user_prompt="up",
        )
    )
    # Last yield must be the sentinel.
    last = yields[-1]
    assert last[0] == "__DONE__"
    parsed = last[1]
    assert isinstance(parsed, dict)
    # Flat dict is lifted into the items-key schema.
    assert "items" in parsed
    assert parsed["items"]["R1"] == "Plumbing"


def test_stream_yields_done_sentinel_on_api_error(monkeypatch):
    """An openai exception mid-stream still produces a __DONE__ yield
    carrying the error in the dict (the consumer pattern must not
    lose the error to a bare RuntimeError)."""
    from core import ai

    monkeypatch.setattr(ai.openai.OpenAI, "__init__", lambda self, **kw: None)
    monkeypatch.setattr(
        ai.openai.OpenAI,
        "chat",
        mock.Mock(**{"completions.create.side_effect": RuntimeError("upstream exploded")}),
    )

    yields = list(
        ai.analyze_boq_stream(
            api_key="x",
            base_url="https://x",
            model_id="gpt-4.1-mini",
            system_prompt="sp",
            user_prompt="up",
        )
    )
    assert yields[-1][0] == "__DONE__"
    parsed = yields[-1][1]
    assert parsed.get("error") and "upstream exploded" in parsed["error"]
    assert parsed["items"] == {}


def test_stream_yields_done_sentinel_on_unparseable_output(monkeypatch):
    """If the model returns text that doesn't contain a JSON object,
    the consumer should still get a __DONE__ with a clear error."""
    from core import ai

    fake_resp = _make_stream(["just some prose, no json at all"])
    monkeypatch.setattr(ai.openai.OpenAI, "__init__", lambda self, **kw: None)
    monkeypatch.setattr(
        ai.openai.OpenAI,
        "chat",
        mock.Mock(**{"completions.create.return_value": fake_resp}),
    )

    yields = list(
        ai.analyze_boq_stream(
            api_key="x",
            base_url="https://x",
            model_id="gpt-4.1-mini",
            system_prompt="sp",
            user_prompt="up",
        )
    )
    assert yields[-1][0] == "__DONE__"
    parsed = yields[-1][1]
    assert "Could not parse JSON" in (parsed.get("error") or "")


def test_stream_yields_done_sentinel_on_empty_response(monkeypatch):
    from core import ai

    fake_resp = _make_stream([""])  # one empty chunk, no content
    monkeypatch.setattr(ai.openai.OpenAI, "__init__", lambda self, **kw: None)
    monkeypatch.setattr(
        ai.openai.OpenAI,
        "chat",
        mock.Mock(**{"completions.create.return_value": fake_resp}),
    )

    yields = list(
        ai.analyze_boq_stream(
            api_key="x",
            base_url="https://x",
            model_id="gpt-4.1-mini",
            system_prompt="sp",
            user_prompt="up",
        )
    )
    assert yields[-1][0] == "__DONE__"
    parsed = yields[-1][1]
    assert "empty response" in (parsed.get("error") or "").lower()


# ---------------------------------------------------------------------------
# core.stream_service.run_analysis
# ---------------------------------------------------------------------------


def test_run_analysis_returns_parsed_dict_on_success(monkeypatch):
    """The consumer must return the parsed dict, never raise."""
    from core.stream_service import run_analysis

    captured: list[str] = []

    class _LogSignal:
        def emit(self, msg):
            captured.append(msg)

    class FakeSignals:
        def __init__(self):
            self.log = _LogSignal()
            self.finished = mock.Mock()
            self.error = mock.Mock()

    monkeypatch.setattr(
        "core.stream_service.analyze_boq_stream",
        mock.Mock(
            return_value=iter(
                [
                    ("R1", "Plumbing"),
                    ("R2", "HVAC"),
                    (
                        "__DONE__",
                        {
                            "project_name": "Mall",
                            "date": "2026-06-13",
                            "items": {"R1": "Plumbing", "R2": "HVAC"},
                            "error": None,
                        },
                    ),
                ]
            )
        ),
    )

    result = run_analysis(
        api_key="x",
        base_url="https://x",
        model_id="gpt-4.1-mini",
        system_prompt="sp",
        user_prompt="up",
        signals=FakeSignals(),
    )
    assert result["project_name"] == "Mall"
    assert result["items"]["R2"] == "HVAC"
    # Tokens were forwarded to the UI.
    assert "R1" in "".join(captured)


def test_run_analysis_returns_structured_error_when_sentinel_missing(monkeypatch):
    """If the generator ends without a __DONE__, the consumer returns
    a structured error dict (does NOT raise)."""
    from core.stream_service import run_analysis

    class FakeSignals:
        def __init__(self):
            self.log = mock.Mock()
            self.finished = mock.Mock()
            self.error = mock.Mock()

    monkeypatch.setattr(
        "core.stream_service.analyze_boq_stream",
        mock.Mock(
            return_value=iter(
                [
                    ("R1", "Plumbing"),  # no __DONE__ yield
                ]
            )
        ),
    )

    result = run_analysis(
        api_key="x",
        base_url="https://x",
        model_id="gpt-4.1-mini",
        system_prompt="sp",
        user_prompt="up",
        signals=FakeSignals(),
    )
    assert "error" in result
    assert "__DONE__" in result["error"] or "sentinel" in result["error"]


def test_run_analysis_returns_structured_error_on_generator_exception(monkeypatch):
    """If the generator raises mid-iteration, the consumer returns
    a structured error dict (does NOT raise)."""
    from core.stream_service import run_analysis

    class FakeSignals:
        def __init__(self):
            self.log = mock.Mock()
            self.finished = mock.Mock()
            self.error = mock.Mock()

    def _boom():
        yield ("R1", "Plumbing")
        raise RuntimeError("connection reset")

    monkeypatch.setattr("core.stream_service.analyze_boq_stream", mock.Mock(return_value=_boom()))

    result = run_analysis(
        api_key="x",
        base_url="https://x",
        model_id="gpt-4.1-mini",
        system_prompt="sp",
        user_prompt="up",
        signals=FakeSignals(),
    )
    assert "error" in result
    assert "connection reset" in result["error"]


def test_run_analysis_threads_error_through_to_consumer(monkeypatch):
    """The end-to-end contract: an error embedded in the __DONE__ dict
    is visible in the consumer's result, not silently swallowed."""
    from core.stream_service import run_analysis

    class FakeSignals:
        def __init__(self):
            self.log = mock.Mock()
            self.finished = mock.Mock()
            self.error = mock.Mock()

    monkeypatch.setattr(
        "core.stream_service.analyze_boq_stream",
        mock.Mock(
            return_value=iter(
                [
                    (
                        "__DONE__",
                        {
                            "project_name": "Tawreed Project",
                            "date": "",
                            "items": {},
                            "error": "Could not parse JSON from the model output (0 chars).",
                        },
                    ),
                ]
            )
        ),
    )

    result = run_analysis(
        api_key="x",
        base_url="https://x",
        model_id="gpt-4.1-mini",
        system_prompt="sp",
        user_prompt="up",
        signals=FakeSignals(),
    )
    assert "Could not parse JSON" in result["error"]
    assert result["items"] == {}
