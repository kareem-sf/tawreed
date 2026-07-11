"""Qt signal adapter and compatibility facade for BOQ processing."""

from __future__ import annotations

from PySide6.QtCore import QObject, Signal

from core import db, stream_service
from core.ai import analyze_boq_stream
from core.connection_service import ConnectionCheckResult, check_connection
from core.excel import parse_excel, write_excel
from core.processing_pipeline import BOQProcessingPipeline, _available_output_path


class WorkerSignals(QObject):
    log = Signal(str)
    review_ready = Signal(object)
    progress = Signal(object)
    finished = Signal(str)
    error = Signal(str)


def run_analysis(
    api_key: str,
    base_url: str,
    model_id: str,
    system_prompt: str,
    user_prompt: str,
    signals: WorkerSignals,
    i18n=None,
    provider: str = "OpenAI",
) -> dict:
    """Compatibility wrapper around the UI-independent streaming service."""

    return stream_service.run_analysis(
        api_key,
        base_url,
        model_id,
        system_prompt,
        user_prompt,
        signals,
        i18n,
        provider,
        _stream_factory=analyze_boq_stream,
    )


class BOQProcessor(BOQProcessingPipeline):
    """Backwards-compatible Qt adapter for the application pipeline."""

    def __init__(self, file_path: str, signals: WorkerSignals, i18n=None):
        super().__init__(
            file_path,
            signals,
            i18n,
            parse_excel_fn=parse_excel,
            write_excel_fn=write_excel,
            run_analysis_fn=run_analysis,
            storage=db,
        )


__all__ = [
    "BOQProcessor",
    "ConnectionCheckResult",
    "WorkerSignals",
    "_available_output_path",
    "check_connection",
    "run_analysis",
]
