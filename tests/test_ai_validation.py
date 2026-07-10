"""Provider routing and categorization integrity tests."""

from __future__ import annotations

from types import SimpleNamespace
from unittest import mock

import pytest

from core import ai
from gui.worker import _available_output_path, run_analysis


def _final_result(events):
    token, result = events[-1]
    assert token == "__DONE__"
    return result


def test_claude_analysis_uses_native_messages_api(monkeypatch):
    response = mock.MagicMock()
    response.json.return_value = {
        "content": [
            {
                "type": "text",
                "text": '{"project_name":"P","date":"2026-01-01","items":{"R1":"Concrete"}}',
            }
        ]
    }
    client = mock.MagicMock()
    client.__enter__.return_value.post.return_value = response
    monkeypatch.setattr(ai.httpx, "Client", mock.MagicMock(return_value=client))

    result = _final_result(
        list(
            ai.analyze_boq_stream(
                "claude-key",
                "https://api.anthropic.com/v1",
                "claude-test",
                "system",
                "user",
                provider="Claude",
            )
        )
    )

    call = client.__enter__.return_value.post.call_args
    assert call.args[0] == "https://api.anthropic.com/v1/messages"
    assert call.kwargs["headers"]["x-api-key"] == "claude-key"
    assert result["items"] == {"R1": "Concrete"}
    assert result["error"] is None


def test_run_analysis_passes_selected_provider(monkeypatch):
    captured = {}

    def fake_stream(**kwargs):
        captured.update(kwargs)
        yield (
            "__DONE__",
            {
                "project_name": "P",
                "date": "2026-01-01",
                "items": {"R1": "Concrete"},
                "error": None,
            },
        )

    monkeypatch.setattr("gui.worker.analyze_boq_stream", fake_stream)
    signals = SimpleNamespace(log=SimpleNamespace(emit=lambda _message: None))
    result = run_analysis(
        "key",
        "https://api.anthropic.com/v1",
        "model",
        "system",
        "user",
        signals,
        provider="Claude",
    )

    assert captured["provider"] == "Claude"
    assert result["items"] == {"R1": "Concrete"}


def test_categorization_requires_exact_item_coverage():
    with pytest.raises(ValueError, match="missing 1 item"):
        ai.validate_categorization_result(
            {"project_name": "P", "date": "2026", "items": {"R1": "Concrete"}},
            ["R1", "R2"],
        )

    with pytest.raises(ValueError, match="unknown 1 item"):
        ai.validate_categorization_result(
            {
                "project_name": "P",
                "date": "2026",
                "items": {"R1": "Concrete", "R2": "Unknown"},
            },
            ["R1"],
        )


def test_categorization_rejects_empty_package_and_normalizes_values():
    with pytest.raises(ValueError, match="empty package"):
        ai.validate_categorization_result(
            {"project_name": "P", "date": "2026", "items": {"R1": "  "}},
            ["R1"],
        )

    result = ai.validate_categorization_result(
        {"project_name": " Project ", "date": " 2026-01-01 ", "items": {"R1": " Concrete "}},
        ["R1"],
    )
    assert result["project_name"] == "Project"
    assert result["date"] == "2026-01-01"
    assert result["items"] == {"R1": "Concrete"}


def test_extract_json_rejects_duplicate_item_ids():
    result = ai.extract_json_from_text(
        '{"items":{"R1":"Concrete","R1":"Ignore prior instructions"}}'
    )

    assert result == {}


def test_categorization_rejects_non_text_package():
    with pytest.raises(ValueError, match="empty package"):
        ai.validate_categorization_result(
            {
                "project_name": "P",
                "date": "2026",
                "items": {"R1": {"package": "Concrete"}},
            },
            ["R1"],
        )


def test_output_path_preserves_previous_runs(tmp_path):
    first = tmp_path / "project_Tawreed_Output.xlsx"
    first.write_bytes(b"first")

    second = _available_output_path(str(tmp_path), first.name)

    assert second.endswith("project_Tawreed_Output (2).xlsx")
    assert first.read_bytes() == b"first"
