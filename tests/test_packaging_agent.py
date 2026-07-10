from __future__ import annotations

import json

import pytest

from core.packaging_agent import (
    WORK_PACKAGE_TAXONOMY,
    AgentState,
    BOQPackagingAgent,
    InvalidAgentTransition,
    PackagingPolicy,
    canonicalise_ai_package_name,
)


def _rows():
    return {
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
            "Qty": 25,
        },
    }


def _draft(agent: BOQPackagingAgent):
    agent.start()
    return agent.prepare_review(
        source_path="boq.xlsx",
        row_mapping=_rows(),
        project_name="Project",
        date="2026-07-10",
        suggested_categories={"R1": "Concrete Works", "R2": "Masonry"},
    )


def test_agent_requires_explicit_review_before_export():
    agent = BOQPackagingAgent()
    _draft(agent)

    with pytest.raises(InvalidAgentTransition):
        agent.begin_export()

    approved = agent.approve({"R1": "Structure", "R2": "Masonry"})
    assert approved.item_categories["R1"] == "Structure"
    assert agent.begin_export() is approved
    agent.complete("output.xlsx")

    assert agent.state is AgentState.COMPLETED
    assert agent.output_path == "output.xlsx"


def test_agent_requires_exact_review_coverage():
    agent = BOQPackagingAgent()
    _draft(agent)

    with pytest.raises(ValueError, match="missing=.*R2"):
        agent.approve({"R1": "Concrete"})

    assert agent.state is AgentState.REVIEW_REQUIRED


def test_agent_normalises_package_names_and_copies_input_rows():
    rows = _rows()
    agent = BOQPackagingAgent()
    agent.start()
    draft = agent.prepare_review(
        source_path="boq.xlsx",
        row_mapping=rows,
        project_name="Project",
        date="2026-07-10",
        suggested_categories={"R1": "  Concrete   Works ", "R2": "Masonry"},
    )
    rows["R1"]["Item Description"] = "Changed later"

    assert draft.items[0].suggested_package == "Concrete Works"
    assert draft.row_mapping["R1"]["Item Description"] == "Reinforced concrete"


def test_cancelled_review_can_never_export():
    agent = BOQPackagingAgent()
    _draft(agent)
    agent.cancel()

    assert agent.state is AgentState.CANCELLED
    with pytest.raises(InvalidAgentTransition):
        agent.approve({"R1": "Concrete", "R2": "Masonry"})


def test_agent_batches_large_boq_with_minimal_json_payload():
    rows = {
        f"R{index}": {
            "Nr.": str(index),
            "Item Description": f"Item {index}",
            "Unit": "m2",
            "Qty": 10,
            "Rate": 99,
            "Amount": 990,
        }
        for index in range(1, 202)
    }
    agent = BOQPackagingAgent(PackagingPolicy(max_items_per_batch=80))
    agent.start()

    batches = agent.plan_batches(rows)

    assert [len(batch.item_ids) for batch in batches] == [80, 80, 41]
    assert all(len(batch.json_payload) <= 24_000 for batch in batches)
    assert all('"Rate"' not in batch.json_payload for batch in batches)
    assert all('"Amount"' not in batch.json_payload for batch in batches)


def test_agent_uses_classification_context_and_source_metadata():
    rows = {
        "R1": {
            "Nr.": "1",
            "Item Description": "Walls thick=250mm",
            "classification_text": "Item: Walls thick=250mm\nBOQ context: Selective Demolition",
            "Unit": "m2",
            "sheet_name": "B02",
            "source_row": 17,
        }
    }
    agent = BOQPackagingAgent()
    agent.start()

    payload = json.loads(agent.plan_batches(rows)[0].json_payload)

    assert payload["items"][0]["description"].endswith("Selective Demolition")
    assert payload["items"][0]["sheet"] == "B02"
    assert payload["items"][0]["source_row"] == "17"


def test_ai_package_names_are_bounded_but_review_list_is_complete():
    assert canonicalise_ai_package_name(" Concrete ") == "Concrete Works"
    assert canonicalise_ai_package_name("Demolition & Strip-Out") == "Demolition"
    with pytest.raises(ValueError, match="unsupported work package"):
        canonicalise_ai_package_name("Invented micro package")

    draft = _draft(BOQPackagingAgent())
    assert draft.package_names[: len(WORK_PACKAGE_TAXONOMY)] == WORK_PACKAGE_TAXONOMY
