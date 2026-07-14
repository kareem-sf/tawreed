from __future__ import annotations

import asyncio
from unittest.mock import Mock

from core.packaging_agent import AgentState
from core.processing_pipeline import BOQProcessingPipeline
from core.run_contracts import ApprovalRequest


class Signal:
    def __init__(self) -> None:
        self.values: list[object] = []

    def emit(self, value: object) -> None:
        self.values.append(value)


class Signals:
    def __init__(self) -> None:
        self.log = Signal()
        self.review_ready = Signal()
        self.progress = Signal()
        self.finished = Signal()
        self.error = Signal()


class Storage:
    def __init__(self, output_dir, history_writer: Mock) -> None:
        self.output_dir = output_dir
        self.add_history = history_writer

    def get_settings(self):
        return {
            "provider": "OpenAI",
            "api_key": "test-key",
            "model": "test-model",
            "base_url": "https://example.test/v1",
            "language": "en",
        }

    def get_outputs_dir(self):
        return str(self.output_dir)


def make_pipeline(tmp_path, *, writer: Mock | None = None, history_writer: Mock | None = None):
    rows = {
        "R1": {
            "Nr.": "1",
            "Item Description": "Reinforced concrete",
            "Unit": "m3",
            "Qty": 10,
        }
    }
    signals = Signals()
    writer = writer or Mock()
    history_writer = history_writer or Mock()
    pipeline = BOQProcessingPipeline(
        str(tmp_path / "boq.xlsx"),
        signals,
        parse_excel_fn=lambda *_args: ("markdown", rows, {}),
        run_analysis_fn=lambda *_args: {"items": {"R1": "Concrete"}},
        write_excel_fn=writer,
        storage=Storage(tmp_path, history_writer),
    )
    asyncio.run(pipeline.process())
    return pipeline, signals, writer, history_writer


def test_approval_request_is_summary_only(tmp_path):
    _pipeline, signals, _writer, _history = make_pipeline(tmp_path)

    assert len(signals.review_ready.values) == 1
    request = signals.review_ready.values[0]
    assert isinstance(request, ApprovalRequest)
    assert request.summary.total_items == 1
    assert request.summary.package_counts == (("Concrete Works", 1),)
    assert not hasattr(request, "items")
    assert not hasattr(request.summary, "row_mapping")


def test_invalid_approval_token_never_exports(tmp_path):
    pipeline, signals, writer, _history = make_pipeline(tmp_path)

    asyncio.run(pipeline.approve_and_export("not-the-issued-token"))

    writer.assert_not_called()
    assert signals.error.values
    assert pipeline.agent.state is AgentState.FAILED


def test_pipeline_writes_nothing_until_summary_is_approved(tmp_path):
    pipeline, signals, writer, history = make_pipeline(tmp_path)

    assert pipeline.agent.state is AgentState.REVIEW_REQUIRED
    writer.assert_not_called()
    history.assert_not_called()

    approval = signals.review_ready.values[0]
    asyncio.run(pipeline.approve_and_export(approval.token))

    assert pipeline.agent.state is AgentState.COMPLETED
    writer.assert_called_once()
    assert writer.call_args.args[2] == {"R1": "Concrete Works"}
    history.assert_called_once()
    assert len(signals.finished.values) == 1
