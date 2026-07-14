"""Run the Tawreed engine as a versioned JSON-lines sidecar."""

from __future__ import annotations

import asyncio
import logging
import sys

from core.logging_setup import install_crash_hook, setup_logging
from tawreed_engine.protocol import ProtocolError, error_response, parse_command
from tawreed_engine.service import EngineService, ThreadSafeWriter


def _reconfigure_text_stream(stream, *, errors: str) -> None:
    """Use UTF-8 for a standard text stream when it supports reconfiguration."""
    if stream is None:
        return
    reconfigure = getattr(stream, "reconfigure", None)
    if callable(reconfigure):
        reconfigure(encoding="utf-8", errors=errors)


def _configure_standard_streams() -> None:
    """Make the JSON-lines protocol independent of the Windows code page."""
    _reconfigure_text_stream(sys.stdin, errors="strict")
    _reconfigure_text_stream(sys.stdout, errors="strict")
    _reconfigure_text_stream(sys.stderr, errors="backslashreplace")


async def _run() -> int:
    writer = ThreadSafeWriter(sys.stdout)
    service = EngineService(writer)
    try:
        service.initialize()
    except Exception:
        logging.exception("Tawreed engine initialization failed")
        writer(error_response(None, "The Tawreed engine could not initialize.", "startup_failed"))
        return 1

    pending: set[asyncio.Task[None]] = set()
    while not service.stopping.is_set():
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:
            break
        try:
            command = parse_command(line)
        except ProtocolError as exc:
            writer(error_response(None, str(exc), "invalid_command"))
            continue
        task = asyncio.create_task(service.handle(command))
        pending.add(task)
        task.add_done_callback(pending.discard)
        if command["type"] == "shutdown":
            await task
            break

    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    return 0


def main() -> int:
    _configure_standard_streams()
    install_crash_hook()
    setup_logging()
    return asyncio.run(_run())


if __name__ == "__main__":
    raise SystemExit(main())
