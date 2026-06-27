"""Context-aware logging helpers for Tawreed.

Provides structured logging with additional context (file sizes, row counts,
timing information) to make debugging easier.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable
from functools import wraps
from typing import TypeVar

log = logging.getLogger(__name__)

T = TypeVar("T")


def log_file_operation(func: Callable[..., T]) -> Callable[..., T]:
    """Decorator to log file operations with context."""

    @wraps(func)
    def wrapper(*args, **kwargs):
        start_time = time.time()
        file_path = kwargs.get("file_path") or (args[0] if args else None)

        if file_path:
            try:
                file_size = os.path.getsize(file_path)
                file_size_mb = file_size / (1024 * 1024)
                log.debug(
                    "Starting %s: file=%s, size=%.2f MB", func.__name__, file_path, file_size_mb
                )
            except (OSError, TypeError):
                log.debug("Starting %s: file=%s", func.__name__, file_path)
        else:
            log.debug("Starting %s", func.__name__)

        try:
            result = func(*args, **kwargs)
            elapsed = time.time() - start_time

            if file_path:
                log.debug("Completed %s: file=%s, elapsed=%.2fs", func.__name__, file_path, elapsed)
            else:
                log.debug("Completed %s: elapsed=%.2fs", func.__name__, elapsed)

            return result
        except Exception as e:
            elapsed = time.time() - start_time
            log.error("Failed %s after %.2fs: %s", func.__name__, elapsed, e)
            raise

    return wrapper


def log_with_context(message: str, **context) -> None:
    """Log a message with additional context.

    Example:
        log_with_context("Processing BOQ", file_path=path, row_count=1000)
    """
    context_str = ", ".join(f"{k}={v}" for k, v in context.items())
    log.info(f"{message} [{context_str}]")


def log_excel_stats(
    file_path: str, sheet_count: int = 0, row_count: int = 0, column_count: int = 0
) -> None:
    """Log Excel file statistics."""
    try:
        file_size = os.path.getsize(file_path)
        file_size_mb = file_size / (1024 * 1024)
        log.info(
            "Excel stats: file=%s, size=%.2f MB, sheets=%d, rows=%d, cols=%d",
            os.path.basename(file_path),
            file_size_mb,
            sheet_count,
            row_count,
            column_count,
        )
    except (OSError, TypeError):
        log.info(
            "Excel stats: file=%s, sheets=%d, rows=%d, cols=%d",
            os.path.basename(file_path),
            sheet_count,
            row_count,
            column_count,
        )


def log_ai_request(
    provider: str, model: str, token_count: int = 0, temperature: float = 0.0
) -> None:
    """Log AI request details."""
    log.info(
        "AI request: provider=%s, model=%s, tokens=%d, temperature=%.2f",
        provider,
        model,
        token_count,
        temperature,
    )


def log_processing_start(file_path: str, item_count: int = 0) -> None:
    """Log processing start with file info."""
    try:
        file_size = os.path.getsize(file_path)
        file_size_mb = file_size / (1024 * 1024)
        log.info(
            "Processing start: file=%s, size=%.2f MB, items=%d",
            os.path.basename(file_path),
            file_size_mb,
            item_count,
        )
    except (OSError, TypeError):
        log.info("Processing start: file=%s, items=%d", os.path.basename(file_path), item_count)


def log_processing_complete(
    file_path: str, output_path: str, item_count: int = 0, package_count: int = 0
) -> None:
    """Log processing completion with statistics."""
    try:
        input_size = os.path.getsize(file_path) / (1024 * 1024)
        output_size = os.path.getsize(output_path) / (1024 * 1024)
        log.info(
            "Processing complete: input=%s (%.2f MB), output=%s (%.2f MB), "
            "items=%d, packages=%d",
            os.path.basename(file_path),
            input_size,
            os.path.basename(output_path),
            output_size,
            item_count,
            package_count,
        )
    except (OSError, TypeError):
        log.info(
            "Processing complete: input=%s, output=%s, items=%d, packages=%d",
            os.path.basename(file_path),
            os.path.basename(output_path),
            item_count,
            package_count,
        )


def timed(func: Callable[..., T]) -> Callable[..., T]:
    """Decorator to time function execution and log duration."""

    @wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            result = func(*args, **kwargs)
            elapsed = time.perf_counter() - start
            log.debug("%s: %.3fs", func.__name__, elapsed)
            return result
        except Exception:
            elapsed = time.perf_counter() - start
            log.error("%s failed after %.3fs", func.__name__, elapsed)
            raise

    return wrapper
