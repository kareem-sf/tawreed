// One retry policy for every HTTP provider: 429 and 5xx only, the server's Retry-After
// preferred over local exponential backoff with jitter, and cancellation racing every
// sleep and send so a cancel during a long backoff still takes effect immediately.
use crate::store;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use super::jobs::wait_for_cancellation;

const MAX_ATTEMPTS: u32 = 4;
const RETRY_BUDGET: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(20);

/// Only the delta-seconds form is honoured. The HTTP-date form is rare on these APIs and
/// a skewed client clock would turn it into an unbounded wait.
fn parse_retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let seconds: u64 = headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()?;
    Some(Duration::from_secs(seconds.min(RETRY_BUDGET.as_secs())))
}

/// Exponential backoff with jitter. The jitter comes from the wall clock rather than a
/// PRNG to keep the crate dependency-free — it only has to de-correlate concurrent
/// retries, not resist prediction.
fn backoff_delay(attempt: u32) -> Duration {
    let base = Duration::from_secs(1u64 << attempt.min(4));
    let jitter = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| Duration::from_nanos(u64::from(elapsed.subsec_nanos())))
        .unwrap_or_default();
    (base + jitter).min(MAX_BACKOFF)
}

fn retryable(status: reqwest::StatusCode) -> bool {
    status.as_u16() == 429 || status.is_server_error()
}

/// Sends `build()` until it yields a non-retryable response or the retry budget is spent.
/// Retries 429 and 5xx only, preferring the server's `Retry-After` over local backoff.
/// Cancellation is checked before every attempt and races both the sleep and the send, so
/// a cancel during a long backoff still takes effect immediately.
pub(super) async fn send_with_retry<F>(
    label: &str,
    cancelled: Arc<AtomicBool>,
    mut build: F,
) -> Result<reqwest::Response, String>
where
    F: FnMut() -> reqwest::RequestBuilder,
{
    let started = std::time::Instant::now();
    let mut pending_delay: Option<Duration> = None;
    let mut last_err = format!("{label} request failed");

    for attempt in 0..MAX_ATTEMPTS {
        if cancelled.load(Ordering::Relaxed) {
            return Err("AI job cancelled".into());
        }
        if let Some(delay) = pending_delay.take() {
            if started.elapsed() + delay > RETRY_BUDGET {
                break;
            }
            tokio::select! {
                _ = tokio::time::sleep(delay) => {}
                _ = wait_for_cancellation(cancelled.clone()) => {
                    return Err("AI job cancelled".into());
                }
            }
        }
        let send = build().send();
        let outcome = tokio::select! {
            response = send => response,
            _ = wait_for_cancellation(cancelled.clone()) => {
                return Err("AI job cancelled".into());
            }
        };
        match outcome {
            Ok(response) => {
                let status = response.status();
                if !retryable(status) {
                    return Ok(response);
                }
                last_err = format!("{label} API error {status}");
                pending_delay = Some(
                    parse_retry_after(response.headers()).unwrap_or_else(|| backoff_delay(attempt)),
                );
                store::log_line(&format!(
                    "{label} call failed ({status}) attempt {}/{MAX_ATTEMPTS}",
                    attempt + 1
                ));
            }
            Err(error) => {
                last_err = format!("{label} network error: {error}");
                pending_delay = Some(backoff_delay(attempt));
                store::log_line(&format!(
                    "{label} network error attempt {}/{MAX_ATTEMPTS}",
                    attempt + 1
                ));
            }
        }
    }
    Err(last_err)
}

#[cfg(test)]
mod retry_tests {
    use super::{backoff_delay, parse_retry_after, retryable, MAX_BACKOFF, RETRY_BUDGET};
    use reqwest::header::{HeaderMap, HeaderValue, RETRY_AFTER};
    use std::time::Duration;

    fn headers_with(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, HeaderValue::from_str(value).unwrap());
        headers
    }

    #[test]
    fn retry_after_reads_delta_seconds_and_clamps_to_the_budget() {
        assert_eq!(
            parse_retry_after(&headers_with("7")),
            Some(Duration::from_secs(7))
        );
        assert_eq!(
            parse_retry_after(&headers_with(" 3 ")),
            Some(Duration::from_secs(3))
        );
        assert_eq!(
            parse_retry_after(&headers_with("99999")),
            Some(RETRY_BUDGET)
        );
    }

    #[test]
    fn retry_after_ignores_absent_and_http_date_forms() {
        assert_eq!(parse_retry_after(&HeaderMap::new()), None);
        assert_eq!(
            parse_retry_after(&headers_with("Wed, 21 Oct 2026 07:28:00 GMT")),
            None
        );
    }

    #[test]
    fn backoff_grows_exponentially_and_stays_within_bounds() {
        for attempt in 0..6 {
            let delay = backoff_delay(attempt);
            let floor = Duration::from_secs(1u64 << attempt.min(4));
            assert!(delay >= floor.min(MAX_BACKOFF), "attempt {attempt}");
            assert!(delay <= MAX_BACKOFF, "attempt {attempt}");
            // Jitter never contributes a whole second on top of the base.
            assert!(delay < floor + Duration::from_secs(1) || delay == MAX_BACKOFF);
        }
    }

    #[test]
    fn only_429_and_server_errors_are_retried() {
        for code in [429, 500, 502, 503, 504] {
            assert!(
                retryable(reqwest::StatusCode::from_u16(code).unwrap()),
                "{code}"
            );
        }
        for code in [200, 201, 400, 401, 403, 404, 422] {
            assert!(
                !retryable(reqwest::StatusCode::from_u16(code).unwrap()),
                "{code}"
            );
        }
    }
}
