from __future__ import annotations

import asyncio
from unittest.mock import Mock

from core.packaging_agent import AgentState, BOQPackagingAgent
from gui.review_dialog import ReviewDialog
from gui.worker import BOQProcessor, WorkerSignals


def _draft():
    agent = BOQPackagingAgent()
    agent.start()
    return agent.prepare_review(
        source_path="boq.xlsx",
        row_mapping={
            "R1": {
                "Nr.": "1",
                "Item Description": "Reinforced concrete",
                "Unit": "m3",
                "Qty": 10,
            },
            "R2": {
                "Nr.": "2",
                "Item Description": "Block wall",
                "Unit": "m2",
                "Qty": 20,
            },
        },
        project_name="Project",
        date="2026-07-10",
        suggested_categories={"R1": "Concrete", "R2": "Masonry"},
    )


def test_review_dialog_exposes_all_items_and_user_edits(qtbot):
    dialog = ReviewDialog(_draft())
    qtbot.addWidget(dialog)

    assert dialog.table.rowCount() == 2
    dialog._package_editors["R1"].setCurrentText("Structural Works")
    assert dialog.reviewed_categories()["R1"] == "Structural Works"

    dialog.filter_input.setText("block")
    assert dialog.table.isRowHidden(0)
    assert not dialog.table.isRowHidden(1)

    dialog.restore_suggestions()
    assert dialog.reviewed_categories()["R1"] == "Concrete"


def test_review_dialog_blocks_empty_assignment(qtbot):
    dialog = ReviewDialog(_draft())
    qtbot.addWidget(dialog)

    dialog._package_editors["R2"].setCurrentText("")
    assert not dialog.export_button.isEnabled()


def test_worker_writes_nothing_until_review_is_approved(monkeypatch, tmp_path, qtbot):
    rows = {
        "R1": {
            "Nr.": "1",
            "Item Description": "Reinforced concrete",
            "Unit": "m3",
            "Qty": 10,
        }
    }
    write_mock = Mock()
    history_mock = Mock()
    monkeypatch.setattr(
        "gui.worker.db.get_settings",
        lambda: {
            "provider": "OpenAI",
            "api_key": "test-key",
            "model": "test-model",
            "base_url": "https://example.test/v1",
        },
    )
    monkeypatch.setattr("gui.worker.db.get_outputs_dir", lambda: str(tmp_path))
    monkeypatch.setattr("gui.worker.db.add_history", history_mock)
    monkeypatch.setattr("gui.worker.parse_excel", lambda *_args: ("markdown", rows, {}))
    monkeypatch.setattr(
        "gui.worker.run_analysis",
        lambda *_args: {
            "project_name": "Project",
            "date": "2026-07-10",
            "items": {"R1": "Concrete"},
        },
    )
    monkeypatch.setattr("gui.worker.write_excel", write_mock)

    signals = WorkerSignals()
    drafts = []
    outputs = []
    signals.review_ready.connect(drafts.append)
    signals.finished.connect(outputs.append)
    processor = BOQProcessor(str(tmp_path / "boq.xlsx"), signals)

    asyncio.run(processor.process())

    assert len(drafts) == 1
    assert processor.agent.state is AgentState.REVIEW_REQUIRED
    write_mock.assert_not_called()
    history_mock.assert_not_called()
    assert outputs == []

    asyncio.run(processor.approve_and_export({"R1": "Structural Works"}))

    assert processor.agent.state is AgentState.COMPLETED
    write_mock.assert_called_once()
    assert write_mock.call_args.args[2] == {"R1": "Structural Works"}
    history_mock.assert_called_once()
    assert len(outputs) == 1
