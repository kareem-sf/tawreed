"""Public, row-free contracts for the Tawreed run experience.

The processor owns every BOQ row and the complete packaging draft.  Widgets
receive only progress metadata and a summary token, so raw BOQ content can
never leak into the desktop UI by accident.
"""

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


@dataclass(frozen=True)
class RunProgress:
    phase: RunPhase
    message: str
    current: int | None = None
    total: int | None = None
    elapsed_seconds: float = 0.0
    cancellable: bool = False


@dataclass(frozen=True)
class ApprovalSummary:
    source_filename: str
    total_items: int
    package_counts: tuple[tuple[str, int], ...]
    warnings: tuple[str, ...]
    provider: str
    model: str


@dataclass(frozen=True)
class ApprovalRequest:
    token: str
    summary: ApprovalSummary
