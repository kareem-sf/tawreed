"""Typed, row-free contracts shared by processing and presentation layers."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class RunPhase(str, Enum):
    EMPTY = "empty"
    READY = "ready"
    INSPECTING = "inspecting"
    STRUCTURING = "structuring"
    CLASSIFYING = "classifying"
    VALIDATING = "validating"
    APPROVAL = "approval"
    EXPORTING = "exporting"
    COMPLETE = "complete"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class RunProgress:
    phase: RunPhase
    message: str
    current: int | None = None
    total: int | None = None
    elapsed_seconds: float = 0.0
    cancellable: bool = False


@dataclass(frozen=True, slots=True)
class ApprovalSummary:
    source_filename: str
    total_items: int
    package_counts: tuple[tuple[str, int], ...]
    warnings: tuple[str, ...]
    provider: str
    model: str


@dataclass(frozen=True, slots=True)
class ApprovalRequest:
    token: str
    summary: ApprovalSummary


__all__ = ["ApprovalRequest", "ApprovalSummary", "RunPhase", "RunProgress"]
