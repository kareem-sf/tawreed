"""Retry utilities for API calls and other operations.

Provides exponential backoff retry functionality for transient failures.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from functools import wraps
from typing import Any, Callable, TypeVar

log = logging.getLogger(__name__)

T = TypeVar('T')

# Default retry configuration
DEFAULT_MAX_RETRIES = 3
DEFAULT_BASE_DELAY = 1.0  # seconds
DEFAULT_MAX_DELAY = 10.0  # seconds
DEFAULT_EXPONENTIAL_BASE = 2.0
DEFAULT_JITTER = 0.1  # 10% jitter

# Retryable exceptions (can be extended)
RETRYABLE_EXCEPTIONS = (
    ConnectionError,
    TimeoutError,
    OSError,
)


def calculate_delay(attempt: int, base_delay: float = DEFAULT_BASE_DELAY,
                   exponential_base: float = DEFAULT_EXPONENTIAL_BASE,
                   max_delay: float = DEFAULT_MAX_DELAY,
                   jitter: float = DEFAULT_JITTER) -> float:
    """Calculate delay for a retry attempt using exponential backoff with jitter.
    
    Args:
        attempt: The current attempt number (0-indexed)
        base_delay: Base delay in seconds
        exponential_base: Base for exponential calculation
        max_delay: Maximum delay in seconds
        jitter: Jitter factor (0-1)
    
    Returns:
        Delay in seconds before next retry
    """
    # Exponential backoff: base_delay * (exponential_base ^ attempt)
    delay = base_delay * (exponential_base ** attempt)
    
    # Add jitter to prevent thundering herd
    jitter_range = delay * jitter
    delay = delay + random.uniform(-jitter_range, jitter_range)
    
    # Cap at max_delay
    return min(delay, max_delay)


def retry_sync(
    max_retries: int = DEFAULT_MAX_RETRIES,
    base_delay: float = DEFAULT_BASE_DELAY,
    max_delay: float = DEFAULT_MAX_DELAY,
    exponential_base: float = DEFAULT_EXPONENTIAL_BASE,
    jitter: float = DEFAULT_JITTER,
    retryable_exceptions: tuple[type[Exception], ...] | None = None,
    on_retry: Callable[[Exception, int, float], None] | None = None,
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Decorator for retrying synchronous functions with exponential backoff.
    
    Args:
        max_retries: Maximum number of retry attempts
        base_delay: Base delay in seconds
        max_delay: Maximum delay in seconds
        exponential_base: Base for exponential calculation
        jitter: Jitter factor (0-1)
        retryable_exceptions: Tuple of exception types to retry on (default: RETRYABLE_EXCEPTIONS)
        on_retry: Optional callback called before each retry (exception, attempt, delay)
    
    Returns:
        Decorated function
    
    Example:
        @retry_sync(max_retries=3, base_delay=1.0)
        def fetch_data():
            # ... code that might fail transiently
            pass
    """
    if retryable_exceptions is None:
        retryable_exceptions = RETRYABLE_EXCEPTIONS
    
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            last_exception: Exception | None = None
            
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except retryable_exceptions as e:
                    last_exception = e
                    
                    if attempt >= max_retries:
                        # No more retries, re-raise
                        log.warning(
                            "Retry failed after %d attempts for %s: %s",
                            max_retries + 1, func.__name__, e
                        )
                        raise
                    
                    # Calculate delay for next retry
                    delay = calculate_delay(
                        attempt, base_delay, exponential_base, max_delay, jitter
                    )
                    
                    log.info(
                        "Retry %d/%d for %s after %.2fs: %s",
                        attempt + 1, max_retries, func.__name__, delay, e
                    )
                    
                    # Call on_retry callback if provided
                    if on_retry:
                        try:
                            on_retry(e, attempt + 1, delay)
                        except Exception:
                            pass
                    
                    # Wait before retrying
                    time.sleep(delay)
            
            # This should never be reached, but just in case
            if last_exception:
                raise last_exception
            raise RuntimeError("Unexpected state in retry logic")
        
        return wrapper
    
    return decorator


async def retry_async(
    max_retries: int = DEFAULT_MAX_RETRIES,
    base_delay: float = DEFAULT_BASE_DELAY,
    max_delay: float = DEFAULT_MAX_DELAY,
    exponential_base: float = DEFAULT_EXPONENTIAL_BASE,
    jitter: float = DEFAULT_JITTER,
    retryable_exceptions: tuple[type[Exception], ...] | None = None,
    on_retry: Callable[[Exception, int, float], None] | None = None,
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Decorator for retrying async functions with exponential backoff.
    
    Args:
        max_retries: Maximum number of retry attempts
        base_delay: Base delay in seconds
        max_delay: Maximum delay in seconds
        exponential_base: Base for exponential calculation
        jitter: Jitter factor (0-1)
        retryable_exceptions: Tuple of exception types to retry on
        on_retry: Optional callback called before each retry
    
    Returns:
        Decorated async function
    
    Example:
        @retry_async(max_retries=3, base_delay=1.0)
        async def fetch_data():
            # ... async code that might fail transiently
            pass
    """
    if retryable_exceptions is None:
        retryable_exceptions = RETRYABLE_EXCEPTIONS
    
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> T:
            last_exception: Exception | None = None
            
            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except retryable_exceptions as e:
                    last_exception = e
                    
                    if attempt >= max_retries:
                        # No more retries, re-raise
                        log.warning(
                            "Async retry failed after %d attempts for %s: %s",
                            max_retries + 1, func.__name__, e
                        )
                        raise
                    
                    # Calculate delay for next retry
                    delay = calculate_delay(
                        attempt, base_delay, exponential_base, max_delay, jitter
                    )
                    
                    log.info(
                        "Async retry %d/%d for %s after %.2fs: %s",
                        attempt + 1, max_retries, func.__name__, delay, e
                    )
                    
                    # Call on_retry callback if provided
                    if on_retry:
                        try:
                            on_retry(e, attempt + 1, delay)
                        except Exception:
                            pass
                    
                    # Wait before retrying
                    await asyncio.sleep(delay)
            
            # This should never be reached, but just in case
            if last_exception:
                raise last_exception
            raise RuntimeError("Unexpected state in async retry logic")
        
        return wrapper
    
    return decorator


class RetryConfig:
    """Configuration for retry behavior."""
    
    def __init__(
        self,
        max_retries: int = DEFAULT_MAX_RETRIES,
        base_delay: float = DEFAULT_BASE_DELAY,
        max_delay: float = DEFAULT_MAX_DELAY,
        exponential_base: float = DEFAULT_EXPONENTIAL_BASE,
        jitter: float = DEFAULT_JITTER,
        retryable_exceptions: tuple[type[Exception], ...] | None = None,
    ):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.exponential_base = exponential_base
        self.jitter = jitter
        self.retryable_exceptions = retryable_exceptions or RETRYABLE_EXCEPTIONS
    
    def with_network_defaults(self) -> 'RetryConfig':
        """Return a config optimized for network operations."""
        return RetryConfig(
            max_retries=3,
            base_delay=1.0,
            max_delay=30.0,
            exponential_base=2.0,
            jitter=0.2,
            retryable_exceptions=(
                ConnectionError,
                TimeoutError,
                OSError,
            ),
        )
    
    def with_file_defaults(self) -> 'RetryConfig':
        """Return a config optimized for file operations."""
        return RetryConfig(
            max_retries=2,
            base_delay=0.5,
            max_delay=5.0,
            exponential_base=2.0,
            jitter=0.1,
            retryable_exceptions=(OSError, PermissionError),
        )


# Pre-configured retry decorators for common use cases
retry_network = retry_sync(
    max_retries=3,
    base_delay=1.0,
    max_delay=30.0,
    jitter=0.2,
)

retry_file = retry_sync(
    max_retries=2,
    base_delay=0.5,
    max_delay=5.0,
    jitter=0.1,
    retryable_exceptions=(OSError, PermissionError),
)

retry_async_network = retry_async(
    max_retries=3,
    base_delay=1.0,
    max_delay=30.0,
    jitter=0.2,
)
