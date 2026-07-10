"""Bounded workflow state for BOQ work-package generation.

The agent is intentionally narrow: it may prepare a review draft and, only
after explicit user approval, authorize an export. It has no shell, network,
or arbitrary file-system tools.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from enum import Enum
from typing import Any

WORK_PACKAGE_TAXONOMY = (
    "General Requirements",
    "Demolition",
    "Concrete Works",
    "Masonry",
    "Metals",
    "Carpentry & Joinery",
    "Waterproofing",
    "Doors & Windows",
    "Finishes",
    "HVAC",
    "Plumbing",
    "Fire Fighting",
    "Electrical",
    "Low Current",
    "External Works",
    "Landscaping",
    "Other",
)

_AI_PACKAGE_ALIASES = {
    "preliminaries": "General Requirements",
    "preliminaries & general requirements": "General Requirements",
    "general": "General Requirements",
    "demolition & strip-out": "Demolition",
    "demolition and strip-out": "Demolition",
    "concrete": "Concrete Works",
    "doors, windows & architectural hardware": "Doors & Windows",
    "doors, windows and architectural hardware": "Doors & Windows",
    "sanitaryware": "Plumbing",
    "plumbing fixtures & sanitaryware": "Plumbing",
}


class AgentState(str, Enum):
    IDLE = "idle"
    ANALYZING = "analyzing"
    REVIEW_REQUIRED = "review_required"
    APPROVED = "approved"
    EXPORTING = "exporting"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


class InvalidAgentTransition(RuntimeError):
    """Raised when a caller attempts an out-of-order workflow action."""


@dataclass(frozen=True)
class ReviewItem:
    item_id: str
    item_number: str
    description: str
    unit: str
    quantity: Any
    suggested_package: str


@dataclass(frozen=True)
class PackagingPolicy:
    max_items: int = 5_000
    max_items_per_batch: int = 80
    max_prompt_chars_per_batch: int = 24_000
    max_batches: int = 100
    max_description_chars: int = 4_000


@dataclass(frozen=True)
class PromptBatch:
    index: int
    item_ids: tuple[str, ...]
    json_payload: str


@dataclass(frozen=True)
class PackagingDraft:
    source_path: str
    project_name: str
    date: str
    items: tuple[ReviewItem, ...]
    row_mapping: dict[str, dict]

    @property
    def suggested_categories(self) -> dict[str, str]:
        return {item.item_id: item.suggested_package for item in self.items}

    @property
    def package_names(self) -> tuple[str, ...]:
        suggestions = {item.suggested_package for item in self.items}
        extras = sorted(suggestions.difference(WORK_PACKAGE_TAXONOMY), key=str.casefold)
        return (*WORK_PACKAGE_TAXONOMY, *extras)


@dataclass(frozen=True)
class ApprovedPackaging:
    draft: PackagingDraft
    item_categories: dict[str, str]


def _normalise_package_name(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Every BOQ item must have a text work-package name.")
    package = " ".join(value.split())
    if not package:
        raise ValueError("Work-package names cannot be empty.")
    if len(package) > 120:
        raise ValueError("Work-package names must be 120 characters or fewer.")
    if any(ord(character) < 32 for character in package):
        raise ValueError("Work-package names cannot contain control characters.")
    return package


def canonicalise_ai_package_name(value: object) -> str:
    """Map small model wording variations onto the closed Tawreed taxonomy."""
    package = _normalise_package_name(value)
    canonical = {name.casefold(): name for name in WORK_PACKAGE_TAXONOMY}
    canonical.update(_AI_PACKAGE_ALIASES)
    try:
        return canonical[package.casefold()]
    except KeyError as exc:
        raise ValueError(f"AI returned an unsupported work package: {package}") from exc


class BOQPackagingAgent:
    """State machine enforcing review-before-export for one BOQ run."""

    def __init__(self, policy: PackagingPolicy | None = None) -> None:
        self.policy = policy or PackagingPolicy()
        self.state = AgentState.IDLE
        self.draft: PackagingDraft | None = None
        self.approved: ApprovedPackaging | None = None
        self.output_path: str | None = None
        self.error: str | None = None

    def start(self) -> None:
        self._require(AgentState.IDLE)
        self.state = AgentState.ANALYZING

    def plan_batches(self, row_mapping: Mapping[str, Mapping[str, Any]]) -> tuple[PromptBatch, ...]:
        """Create deterministic, size-bounded JSON batches from normalized rows."""
        self._require(AgentState.ANALYZING)
        if not row_mapping:
            raise ValueError("The BOQ does not contain any categorizable items.")
        if len(row_mapping) > self.policy.max_items:
            raise ValueError(
                f"This BOQ has {len(row_mapping)} items; the safe limit is {self.policy.max_items}."
            )

        batches: list[PromptBatch] = []
        current: list[dict[str, str]] = []

        def serialise(items: list[dict[str, str]]) -> str:
            return json.dumps({"items": items}, ensure_ascii=False, separators=(",", ":"))

        def append_batch(items: list[dict[str, str]]) -> None:
            payload = serialise(items)
            if len(payload) > self.policy.max_prompt_chars_per_batch:
                raise ValueError("A BOQ item exceeds the safe AI prompt-size limit.")
            batches.append(
                PromptBatch(
                    index=len(batches) + 1,
                    item_ids=tuple(item["id"] for item in items),
                    json_payload=payload,
                )
            )
            if len(batches) > self.policy.max_batches:
                raise ValueError("The BOQ requires more AI batches than the safe run limit.")

        for item_id, row in row_mapping.items():
            classification_text = row.get("classification_text") or row.get("Item Description", "")
            payload_item = {
                "id": str(item_id),
                "number": str(row.get("Nr.", "") or "")[:200],
                "description": str(classification_text or "")[: self.policy.max_description_chars],
                "unit": str(row.get("Unit", "") or "")[:100],
                "sheet": str(row.get("sheet_name", "") or "")[:100],
                "source_row": str(row.get("source_row", "") or "")[:20],
            }
            candidate = [*current, payload_item]
            candidate_too_large = len(serialise(candidate)) > self.policy.max_prompt_chars_per_batch
            if current and (len(current) >= self.policy.max_items_per_batch or candidate_too_large):
                append_batch(current)
                current = [payload_item]
            else:
                current = candidate

        if current:
            append_batch(current)
        return tuple(batches)

    def prepare_review(
        self,
        *,
        source_path: str,
        row_mapping: Mapping[str, Mapping[str, Any]],
        project_name: str,
        date: str,
        suggested_categories: Mapping[str, str],
    ) -> PackagingDraft:
        self._require(AgentState.ANALYZING)
        expected = set(row_mapping)
        actual = set(suggested_categories)
        if actual != expected:
            missing = sorted(expected - actual)
            extra = sorted(actual - expected)
            raise ValueError(
                f"Categorization coverage mismatch (missing={missing}, extra={extra})."
            )

        copied_rows = deepcopy(dict(row_mapping))
        items = []
        for item_id, row in copied_rows.items():
            items.append(
                ReviewItem(
                    item_id=item_id,
                    item_number=str(row.get("Nr.", "") or ""),
                    description=str(row.get("Item Description", "") or ""),
                    unit=str(row.get("Unit", "") or ""),
                    quantity=row.get("Qty", ""),
                    suggested_package=_normalise_package_name(suggested_categories[item_id]),
                )
            )

        self.draft = PackagingDraft(
            source_path=source_path,
            project_name=str(project_name),
            date=str(date),
            items=tuple(items),
            row_mapping=copied_rows,
        )
        self.state = AgentState.REVIEW_REQUIRED
        return self.draft

    def approve(self, reviewed_categories: Mapping[str, str]) -> ApprovedPackaging:
        self._require(AgentState.REVIEW_REQUIRED)
        if self.draft is None:
            raise InvalidAgentTransition("No review draft is available.")

        expected = {item.item_id for item in self.draft.items}
        actual = set(reviewed_categories)
        if actual != expected:
            missing = sorted(expected - actual)
            extra = sorted(actual - expected)
            raise ValueError(f"Review coverage mismatch (missing={missing}, extra={extra}).")

        categories = {
            item.item_id: _normalise_package_name(reviewed_categories[item.item_id])
            for item in self.draft.items
        }
        self.approved = ApprovedPackaging(self.draft, categories)
        self.state = AgentState.APPROVED
        return self.approved

    def begin_export(self) -> ApprovedPackaging:
        self._require(AgentState.APPROVED)
        if self.approved is None:
            raise InvalidAgentTransition("The reviewed draft has not been approved.")
        self.state = AgentState.EXPORTING
        return self.approved

    def complete(self, output_path: str) -> None:
        self._require(AgentState.EXPORTING)
        if not output_path:
            raise ValueError("An output path is required to complete the run.")
        self.output_path = output_path
        self.state = AgentState.COMPLETED

    def cancel(self) -> None:
        if self.state not in {AgentState.ANALYZING, AgentState.REVIEW_REQUIRED}:
            raise InvalidAgentTransition(f"Cannot cancel an agent in state '{self.state.value}'.")
        self.state = AgentState.CANCELLED

    def fail(self, error: object) -> None:
        if self.state in {AgentState.COMPLETED, AgentState.CANCELLED}:
            return
        self.error = str(error)
        self.state = AgentState.FAILED

    def _require(self, expected: AgentState) -> None:
        if self.state is not expected:
            raise InvalidAgentTransition(
                f"Expected agent state '{expected.value}', found '{self.state.value}'."
            )
