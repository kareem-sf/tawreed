from __future__ import annotations

import asyncio
from unittest.mock import Mock

from core.packaging_agent import AgentState
from gui.run_contracts import ApprovalRequest
from gui.worker import BOQProcessor, WorkerSignals


def _processor_with_one_row(monkeypatch, tmp_path):
    rows = {
        "R1": {
            "Nr.": "1",
            "Item Description": "Reinforced concrete",
            "Unit": "m3",
            "Qty": 10,
        }
    }
    monkeypatch.setattr(
        "gui.worker.db.get_settings",
        lambda: {
            "provider": "OpenAI",
            "api_key": "test-key",
            "model": "test-model",
            "base_url": "https://example.test/v1",
        },
    )
    monkeypatch.setattr("gui.worker.parse_excel", lambda *_args: ("markdown", rows, {}))
    monkeypatch.setattr(
        "gui.worker.run_analysis",
        lambda *_args: {"items": {"R1": "Concrete"}},
    )
    signals = WorkerSignals()
    approvals = []
    signals.review_ready.connect(approvals.append)
    processor = BOQProcessor(str(tmp_path / "boq.xlsx"), signals)
    asyncio.run(processor.process())
    return processor, signals, approvals


def test_approval_request_is_summary_only(monkeypatch, tmp_path):
    _processor, _signals, approvals = _processor_with_one_row(monkeypatch, tmp_path)

    assert len(approvals) == 1
    request = approvals[0]
    assert isinstance(request, ApprovalRequest)
    assert request.summary.total_items == 1
    assert request.summary.package_counts == (("Concrete Works", 1),)
    assert not hasattr(request, "items")
    assert not hasattr(request.summary, "row_mapping")


def test_invalid_approval_token_never_exports(monkeypatch, tmp_path):
    processor, signals, _approvals = _processor_with_one_row(monkeypatch, tmp_path)
    write_mock = Mock()
    errors = []
    signals.error.connect(errors.append)
    monkeypatch.setattr("gui.worker.write_excel", write_mock)

    asyncio.run(processor.approve_and_export("not-the-issued-token"))

    write_mock.assert_not_called()
    assert errors
    assert processor.agent.state is AgentState.FAILED


def test_worker_writes_nothing_until_summary_is_approved(monkeypatch, tmp_path):
    write_mock = Mock()
    history_mock = Mock()
    monkeypatch.setattr("gui.worker.db.get_outputs_dir", lambda: str(tmp_path))
    monkeypatch.setattr("gui.worker.db.add_history", history_mock)
    monkeypatch.setattr("gui.worker.write_excel", write_mock)
    processor, signals, approvals = _processor_with_one_row(monkeypatch, tmp_path)
    outputs = []
    signals.finished.connect(outputs.append)

    assert processor.agent.state is AgentState.REVIEW_REQUIRED
    write_mock.assert_not_called()
    history_mock.assert_not_called()

    asyncio.run(processor.approve_and_export(approvals[0].token))

    assert processor.agent.state is AgentState.COMPLETED
    write_mock.assert_called_once()
    assert write_mock.call_args.args[2] == {"R1": "Concrete Works"}
    history_mock.assert_called_once()
    assert len(outputs) == 1
