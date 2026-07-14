"""Async command service around the established Tawreed Python engine."""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path
from typing import Any, Protocol

from core import db
from core.codex_connector import cancel_active_codex_processes
from core.connection_service import check_connection
from core.model_catalog import fetch_models
from core.processing_pipeline import BOQProcessingPipeline
from tawreed_engine.protocol import error_response, event, response

log = logging.getLogger(__name__)


class MessageWriter(Protocol):
    def __call__(self, message: dict[str, Any]) -> None: ...


class _EventSignal:
    def __init__(self, writer: MessageWriter, kind: str) -> None:
        self._writer = writer
        self._kind = kind

    def emit(self, value: object) -> None:
        self._writer(event(self._kind, value))


class EngineSignals:
    """Signal facade consumed by ``BOQProcessingPipeline``."""

    def __init__(self, writer: MessageWriter) -> None:
        self.log = _EventSignal(writer, "log")
        self.review_ready = _EventSignal(writer, "approval_required")
        self.progress = _EventSignal(writer, "progress")
        self.finished = _EventSignal(writer, "completed")
        self.error = _EventSignal(writer, "run_error")


def _public_settings(settings: dict[str, Any]) -> dict[str, Any]:
    """Return settings safe to expose to the webview."""
    clean = {key: value for key, value in settings.items() if key != "api_key"}
    clean["has_api_key"] = bool(settings.get("api_key"))
    return clean


class EngineService:
    """Own one active BOQ workflow and dispatch versioned host commands."""

    def __init__(
        self,
        writer: MessageWriter,
        *,
        storage: Any = db,
        pipeline_factory: Callable[..., BOQProcessingPipeline] = BOQProcessingPipeline,
        model_fetcher: Callable[..., Any] = fetch_models,
        connection_checker: Callable[..., Any] = check_connection,
    ) -> None:
        self._writer = writer
        self._storage = storage
        self._pipeline_factory = pipeline_factory
        self._model_fetcher = model_fetcher
        self._connection_checker = connection_checker
        self._pipeline: BOQProcessingPipeline | None = None
        self._run_task: asyncio.Task[Any] | None = None
        self._command_lock = asyncio.Lock()
        self.stopping = asyncio.Event()

    def initialize(self) -> None:
        self._storage.init_db()
        self._writer(
            event(
                "ready",
                {
                    "engine": "python",
                    "pid": os.getpid(),
                    "capabilities": [
                        "settings",
                        "credentials",
                        "history",
                        "model_catalog",
                        "connection_test",
                        "boq_workflow",
                    ],
                },
            )
        )

    async def handle(self, command: dict[str, Any]) -> None:
        request_id = command.get("requestId") or ""
        command_type = command["type"]
        payload = command.get("payload", {})
        try:
            handler = getattr(self, f"_handle_{command_type}", None)
            if handler is None:
                raise ValueError(f"Unsupported command: {command_type}.")
            result = await handler(payload)
            if request_id:
                self._writer(response(request_id, result))
        except asyncio.CancelledError:
            if request_id:
                self._writer(error_response(request_id, "Command was cancelled.", "cancelled"))
            raise
        except (OSError, RuntimeError, ValueError) as exc:
            log.warning("Engine command %s failed: %s", command_type, exc)
            self._writer(error_response(request_id or None, str(exc), "command_failed"))
        except Exception:
            log.exception("Unexpected engine command failure: %s", command_type)
            self._writer(
                error_response(
                    request_id or None,
                    "The engine could not complete that command.",
                    "internal_error",
                )
            )

    async def _handle_health(self, _payload: dict[str, Any]) -> dict[str, Any]:
        return {"status": "ok", "activeRun": self._run_is_active()}

    async def _handle_get_settings(self, _payload: dict[str, Any]) -> dict[str, Any]:
        settings = await asyncio.to_thread(self._storage.get_settings)
        return _public_settings(settings)

    async def _handle_save_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        settings = payload.get("settings")
        if not isinstance(settings, dict):
            raise ValueError("settings must be an object.")
        if "api_key" in settings:
            raise ValueError("Secrets must be stored by the credential command.")
        current = await asyncio.to_thread(self._storage.get_settings)
        merged = {**current, **settings}
        merged.pop("api_key", None)
        await asyncio.to_thread(self._storage.save_settings, merged)
        return _public_settings(await asyncio.to_thread(self._storage.get_settings))

    async def _handle_set_api_key(self, payload: dict[str, Any]) -> dict[str, bool]:
        provider = payload.get("provider")
        api_key = payload.get("api_key")
        if not isinstance(provider, str) or not provider:
            raise ValueError("A provider is required.")
        if not isinstance(api_key, str):
            raise ValueError("api_key must be a string.")
        await asyncio.to_thread(self._storage.set_api_key, provider, api_key)
        stored = await asyncio.to_thread(self._storage.get_api_key, provider)
        return {"has_api_key": bool(stored)}

    async def _handle_get_history(self, _payload: dict[str, Any]) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._storage.get_history)

    async def _handle_delete_history(self, payload: dict[str, Any]) -> dict[str, bool]:
        entry_id = payload.get("id")
        if not isinstance(entry_id, int) or entry_id < 1:
            raise ValueError("A valid history id is required.")
        deleted = await asyncio.to_thread(self._storage.delete_history_entry, entry_id)
        return {"deleted": bool(deleted)}

    async def _handle_refresh_models(self, payload: dict[str, Any]) -> dict[str, Any]:
        settings = await asyncio.to_thread(self._storage.get_settings)
        provider = str(payload.get("provider") or settings["provider"])
        base_url = str(payload.get("base_url") or settings.get("base_url") or "")
        result = await self._model_fetcher(provider, settings.get("api_key", ""), base_url)
        return asdict(result)

    async def _handle_test_connection(self, payload: dict[str, Any]) -> dict[str, Any]:
        settings = await asyncio.to_thread(self._storage.get_settings)
        provider = str(payload.get("provider") or settings["provider"])
        base_url = str(payload.get("base_url") or settings.get("base_url") or "")
        model = str(payload.get("model") or settings.get("model") or "")
        result = await asyncio.to_thread(
            self._connection_checker,
            provider,
            settings.get("api_key", ""),
            base_url,
            model,
        )
        return {"success": result.success, "message": result.message}

    async def _handle_start_run(self, payload: dict[str, Any]) -> dict[str, Any]:
        async with self._command_lock:
            if self._run_is_active() or self._pipeline is not None:
                raise RuntimeError("A Tawreed run is already active.")
            raw_path = payload.get("file_path")
            if not isinstance(raw_path, str) or not raw_path:
                raise ValueError("An Excel workbook path is required.")
            path = Path(raw_path).expanduser().resolve()
            if not path.is_file() or path.suffix.casefold() != ".xlsx":
                raise ValueError("Select an existing .xlsx workbook.")
            signals = EngineSignals(self._writer)
            self._pipeline = self._pipeline_factory(str(path), signals)
            self._run_task = asyncio.create_task(self._pipeline.process())
            self._run_task.add_done_callback(self._on_run_task_done)
            return {"accepted": True, "source_filename": path.name}

    async def _handle_approve_run(self, payload: dict[str, Any]) -> dict[str, bool]:
        token = payload.get("token")
        if not isinstance(token, str) or not token:
            raise ValueError("An approval token is required.")
        async with self._command_lock:
            if self._pipeline is None:
                raise RuntimeError("No run is waiting for approval.")
            self._run_task = asyncio.create_task(self._pipeline.approve_and_export(token))
            self._run_task.add_done_callback(self._on_run_task_done)
        return {"accepted": True}

    async def _handle_cancel_run(self, _payload: dict[str, Any]) -> dict[str, bool]:
        async with self._command_lock:
            if self._pipeline is not None:
                try:
                    self._pipeline.cancel()
                except RuntimeError:
                    pass
            if self._run_task is not None and not self._run_task.done():
                self._run_task.cancel()
            await asyncio.to_thread(cancel_active_codex_processes)
            self._pipeline = None
            self._run_task = None
        self._writer(event("cancelled", {}))
        return {"cancelled": True, "hostMustTerminateProcess": True}

    async def _handle_shutdown(self, _payload: dict[str, Any]) -> dict[str, bool]:
        if self._pipeline is not None:
            try:
                self._pipeline.cancel()
            except RuntimeError:
                pass
        if self._run_task is not None and not self._run_task.done():
            self._run_task.cancel()
        self.stopping.set()
        return {"stopping": True}

    def _run_is_active(self) -> bool:
        return self._run_task is not None and not self._run_task.done()

    def _on_run_task_done(self, task: asyncio.Task[Any]) -> None:
        if task.cancelled():
            return
        try:
            task.result()
        except Exception:
            log.exception("Unhandled processing task failure")
            self._writer(event("run_error", "The processing engine stopped unexpectedly."))
        finally:
            state = getattr(getattr(self._pipeline, "agent", None), "state", None)
            state_value = getattr(state, "value", state)
            if state_value in {"completed", "failed", "cancelled"}:
                self._pipeline = None
            if self._run_task is task:
                self._run_task = None


class ThreadSafeWriter:
    """Serialize complete protocol messages to stdout without interleaving."""

    def __init__(self, stream: Any) -> None:
        self._stream = stream
        self._lock = threading.Lock()

    def __call__(self, message: dict[str, Any]) -> None:
        from tawreed_engine.protocol import dumps

        with self._lock:
            self._stream.write(dumps(message) + "\n")
            self._stream.flush()


__all__ = ["EngineService", "EngineSignals", "ThreadSafeWriter"]
