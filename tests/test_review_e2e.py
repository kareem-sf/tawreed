from __future__ import annotations

import asyncio

import openpyxl

from core import db
from gui.worker import BOQProcessor, WorkerSignals


def test_parse_review_edit_export_and_history_end_to_end(isolated_tawreed_dir, monkeypatch, qtbot):
    db.init_db()
    db.save_settings(
        {
            "provider": "OpenAI",
            "api_key": "test-key",
            "model": "test-model",
            "base_url": "https://example.test/v1",
            "language": "en",
            "theme": "dark",
        }
    )
    source = isolated_tawreed_dir / "Pilot BOQ.xlsx"
    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.append(["Nr.", "Item Description", "Unit", "Qty", "Rate", "Amount"])
    worksheet.append(["1", "Reinforced concrete", "m3", 10, 20, 200])
    worksheet.append(["2", "Block wall", "m2", 30, 4, 120])
    workbook.save(source)
    workbook.close()

    monkeypatch.setattr(
        "gui.worker.run_analysis",
        lambda *_args: {
            "project_name": "Ignored batch metadata",
            "date": "2026-07-10",
            "items": {"R1": "Concrete Works", "R2": "Masonry"},
        },
    )
    monkeypatch.setattr(
        "gui.worker.db.get_settings",
        lambda: {
            "provider": "OpenAI",
            "api_key": "test-key",
            "model": "test-model",
            "base_url": "https://example.test/v1",
        },
    )
    signals = WorkerSignals()
    drafts = []
    outputs = []
    errors = []
    signals.review_ready.connect(drafts.append)
    signals.finished.connect(outputs.append)
    signals.error.connect(errors.append)
    processor = BOQProcessor(str(source), signals)

    asyncio.run(processor.process())
    assert len(drafts) == 1, errors
    assert not outputs
    assert db.get_history() == []

    approval = drafts[0]
    assert not hasattr(approval, "items")
    assert approval.summary.total_items == 2
    asyncio.run(processor.approve_and_export(approval.token))

    assert len(outputs) == 1
    output = outputs[0]
    exported = openpyxl.load_workbook(output, data_only=False)
    try:
        master = exported["Master"]
        headers = [cell.value for cell in master[1]]
        package_column = headers.index("Package") + 1
        id_column = headers.index("Global ID") + 1
        exported_assignments = {
            master.cell(row=row, column=id_column).value: master.cell(
                row=row, column=package_column
            ).value
            for row in range(2, master.max_row + 1)
        }
    finally:
        exported.close()

    assert exported_assignments == {"R1": "Concrete Works", "R2": "Masonry"}
    history = db.get_history()
    assert len(history) == 1
    assert history[0]["output_path"] == output
