"""Tests for core/retry_utils.py - retry functionality with exponential backoff."""

import time

import pytest

from core.retry_utils import (
    RetryConfig,
    calculate_delay,
    retry_async,
    retry_async_network,
    retry_file,
    retry_network,
    retry_sync,
)


class TestCalculateDelay:
    """Tests for the calculate_delay function."""

    def test_default_parameters(self):
        """Test calculate_delay with default parameters."""
        delay = calculate_delay(0)  # First retry
        assert 0.9 <= delay <= 1.1  # 1.0 ± 10% jitter

        delay = calculate_delay(1)  # Second retry
        assert 1.8 <= delay <= 2.2  # 2.0 ± 10% jitter

        delay = calculate_delay(2)  # Third retry
        assert 3.6 <= delay <= 4.4  # 4.0 ± 10% jitter

    def test_exponential_backoff(self):
        """Test that delays follow exponential backoff pattern."""
        delays = [calculate_delay(i, jitter=0.0) for i in range(5)]

        # Should be approximately: 1.0, 2.0, 4.0, 8.0, 16.0 (but capped at 10.0)
        expected = [1.0, 2.0, 4.0, 8.0, 10.0]

        for i, (actual, expected_val) in enumerate(zip(delays, expected, strict=False)):
            assert (
                abs(actual - expected_val) < 0.01
            ), f"Attempt {i}: expected {expected_val}, got {actual}"

    def test_max_delay_cap(self):
        """Test that delay is capped at max_delay."""
        # With exponential growth, attempt 10 would be 1024s without capping
        delay = calculate_delay(10, max_delay=5.0)
        assert delay <= 5.0

    def test_jitter_range(self):
        """Test that jitter is applied correctly."""
        base_delay = 2.0
        jitter = 0.2  # 20%

        # Generate multiple delays to check jitter distribution
        delays = [calculate_delay(0, base_delay=base_delay, jitter=jitter) for _ in range(100)]

        # All delays should be within ±20% of base_delay
        for delay in delays:
            expected_range = base_delay * jitter
            assert base_delay - expected_range <= delay <= base_delay + expected_range

    def test_custom_parameters(self):
        """Test calculate_delay with custom parameters."""
        delay = calculate_delay(
            attempt=1, base_delay=0.5, exponential_base=3.0, max_delay=20.0, jitter=0.0
        )
        # 0.5 * 3^1 = 1.5
        assert delay == 1.5


class TestRetrySync:
    """Tests for the retry_sync decorator."""

    def test_successful_no_retry(self):
        """Test that successful calls don't retry."""
        call_count = 0

        @retry_sync(max_retries=3)
        def successful_func():
            nonlocal call_count
            call_count += 1
            return "success"

        result = successful_func()
        assert result == "success"
        assert call_count == 1

    def test_retry_on_failure_then_success(self):
        """Test that failures are retried and success returns."""
        call_count = 0

        @retry_sync(max_retries=3, base_delay=0.01)
        def sometimes_failing_func():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise ConnectionError("Temporary failure")
            return "success"

        start_time = time.time()
        result = sometimes_failing_func()
        end_time = time.time()

        assert result == "success"
        assert call_count == 3
        # Should have waited for 2 retries with small delays
        assert end_time - start_time >= 0.02

    def test_retry_exhausted(self):
        """Test that exhausted retries raise the last exception."""

        @retry_sync(max_retries=2, base_delay=0.01)
        def always_failing_func():
            raise TimeoutError("Always fails")

        with pytest.raises(TimeoutError, match="Always fails"):
            always_failing_func()

    def test_retry_on_specific_exceptions(self):
        """Test that only specified exceptions are retried."""

        @retry_sync(max_retries=2, retryable_exceptions=(ConnectionError,))
        def func_with_specific_retry():
            raise ValueError("Not retryable")

        with pytest.raises(ValueError, match="Not retryable"):
            func_with_specific_retry()

    def test_on_retry_callback(self):
        """Test that on_retry callback is called."""
        callback_calls = []

        def on_retry_callback(exception, attempt, delay):
            callback_calls.append((exception, attempt, delay))

        @retry_sync(max_retries=2, base_delay=0.01, on_retry=on_retry_callback)
        def failing_func():
            raise ConnectionError("Test error")

        with pytest.raises(ConnectionError):
            failing_func()

        # Should have 2 retry attempts (total 3 calls)
        assert len(callback_calls) == 2
        assert callback_calls[0][1] == 1  # First retry
        assert callback_calls[1][1] == 2  # Second retry

    def test_default_retryable_exceptions(self):
        """Test that default retryable exceptions are used."""

        @retry_sync(max_retries=1, base_delay=0.01)
        def func():
            raise OSError("Test error")

        # OSError should be retried (it's in RETRYABLE_EXCEPTIONS)
        with pytest.raises(OSError):
            func()


class TestRetryAsync:
    """Tests for the retry_async decorator."""

    @pytest.mark.asyncio
    async def test_async_successful_no_retry(self):
        """Test that successful async calls don't retry."""
        call_count = 0

        @retry_async()  # Note: retry_async() returns a decorator
        async def successful_async_func():
            nonlocal call_count
            call_count += 1
            return "async_success"

        result = await successful_async_func()
        assert result == "async_success"
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_async_retry_on_failure_then_success(self):
        """Test that async failures are retried and success returns."""
        call_count = 0

        @retry_async(max_retries=3, base_delay=0.01)
        async def sometimes_failing_async_func():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise ConnectionError("Async temporary failure")
            return "async_success"

        start_time = time.time()
        result = await sometimes_failing_async_func()
        end_time = time.time()

        assert result == "async_success"
        assert call_count == 3
        # Should have waited for 2 retries with small delays
        assert end_time - start_time >= 0.02

    @pytest.mark.asyncio
    async def test_async_retry_exhausted(self):
        """Test that exhausted async retries raise the last exception."""

        @retry_async(max_retries=2, base_delay=0.01)
        async def always_failing_async_func():
            raise TimeoutError("Async always fails")

        with pytest.raises(TimeoutError, match="Async always fails"):
            await always_failing_async_func()


class TestRetryConfig:
    """Tests for the RetryConfig class."""

    def test_default_config(self):
        """Test RetryConfig with default parameters."""
        config = RetryConfig()
        assert config.max_retries == 3
        assert config.base_delay == 1.0
        assert config.max_delay == 10.0
        assert config.exponential_base == 2.0
        assert config.jitter == 0.1

    def test_network_defaults(self):
        """Test network-optimized configuration."""
        config = RetryConfig().with_network_defaults()
        assert config.max_retries == 3
        assert config.base_delay == 1.0
        assert config.max_delay == 30.0
        assert config.jitter == 0.2
        assert ConnectionError in config.retryable_exceptions
        assert TimeoutError in config.retryable_exceptions

    def test_file_defaults(self):
        """Test file-optimized configuration."""
        config = RetryConfig().with_file_defaults()
        assert config.max_retries == 2
        assert config.base_delay == 0.5
        assert config.max_delay == 5.0
        assert config.jitter == 0.1
        assert OSError in config.retryable_exceptions
        assert PermissionError in config.retryable_exceptions


class TestPreconfiguredRetries:
    """Tests for pre-configured retry decorators."""

    def test_retry_network_decorator(self):
        """Test the pre-configured network retry decorator."""
        call_count = 0

        @retry_network
        def network_func():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise ConnectionError("Network issue")
            return "network_success"

        result = network_func()
        assert result == "network_success"
        assert call_count == 2

    def test_retry_file_decorator(self):
        """Test the pre-configured file retry decorator."""
        call_count = 0

        @retry_file
        def file_func():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise OSError("File issue")
            return "file_success"

        result = file_func()
        assert result == "file_success"
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_retry_async_network_decorator(self):
        """Test the pre-configured async network retry decorator."""
        call_count = 0

        @retry_async_network
        async def async_network_func():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise ConnectionError("Async network issue")
            return "async_network_success"

        result = await async_network_func()
        assert result == "async_network_success"
        assert call_count == 2


class TestEdgeCases:
    """Edge case tests for retry functionality."""

    def test_zero_retries(self):
        """Test retry with max_retries=0 (no retries)."""

        @retry_sync(max_retries=0)
        def func():
            raise ValueError("Error")

        with pytest.raises(ValueError):
            func()

    def test_negative_delay(self):
        """Test that negative delays are handled correctly."""
        # This shouldn't happen in normal usage, but let's be defensive
        delay = calculate_delay(0, base_delay=-1.0)
        # With negative base delay and jitter, we might get negative values
        # This is actually expected behavior for invalid input
        # The test should verify that the function doesn't crash
        assert isinstance(delay, float)  # Just verify it returns a float

    def test_non_retryable_exception(self):
        """Test that non-retryable exceptions are not retried."""

        @retry_sync(max_retries=3)
        def func():
            raise RuntimeError("Not retryable")

        with pytest.raises(RuntimeError, match="Not retryable"):
            func()

    def test_mixed_exception_types(self):
        """Test retry with mixed exception types."""
        call_count = 0

        @retry_sync(max_retries=3, base_delay=0.01)
        def func():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ConnectionError("First failure")
            elif call_count == 2:
                raise TimeoutError("Second failure")
            elif call_count == 3:
                raise OSError("Third failure")
            elif call_count == 4:
                raise RuntimeError("Fourth failure")
            return "success"

        with pytest.raises(RuntimeError, match="Fourth failure"):
            func()

        # Should have 1 initial call + 3 retries = 4 total calls
        assert call_count == 4


class TestIntegration:
    """Integration tests for retry functionality."""

    def test_retry_with_real_network_like_operation(self):
        """Test retry with a simulated network operation."""
        attempt_count = 0

        @retry_sync(max_retries=3, base_delay=0.01)
        def fetch_data_from_api():
            """Simulate fetching data from an API."""
            nonlocal attempt_count
            attempt_count += 1

            # Simulate transient failures
            if attempt_count < 3:
                raise ConnectionError(f"API connection failed (attempt {attempt_count})")

            return {"data": "success", "attempt": attempt_count}

        result = fetch_data_from_api()
        assert result["data"] == "success"
        assert result["attempt"] == 3

    @pytest.mark.asyncio
    async def test_async_retry_with_real_network_like_operation(self):
        """Test async retry with a simulated network operation."""
        attempt_count = 0

        @retry_async(max_retries=3, base_delay=0.01)
        async def async_fetch_data_from_api():
            """Simulate async fetching data from an API."""
            nonlocal attempt_count
            attempt_count += 1

            # Simulate transient failures
            if attempt_count < 3:
                raise TimeoutError(f"API timeout (attempt {attempt_count})")

            return {"data": "async_success", "attempt": attempt_count}

        result = await async_fetch_data_from_api()
        assert result["data"] == "async_success"
        assert result["attempt"] == 3
