// Cancellation tracking shared by every AI provider: the webview mints a job id, Rust
// maps it to a flag, and cancel_ai_job flips it so an in-flight call unwinds promptly.
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

static ACTIVE_AI_JOBS: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);

fn valid_job_id(job_id: &str) -> bool {
    !job_id.is_empty()
        && job_id.len() <= 80
        && job_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

pub(crate) fn begin_ai_job(job_id: &str) -> Result<Arc<AtomicBool>, String> {
    if !valid_job_id(job_id) {
        return Err("Invalid AI job identifier".into());
    }
    let mut guard = ACTIVE_AI_JOBS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let jobs = guard.get_or_insert_with(HashMap::new);
    if jobs.contains_key(job_id) {
        return Err("AI job identifier is already active".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    jobs.insert(job_id.to_string(), cancelled.clone());
    Ok(cancelled)
}

pub(crate) fn finish_ai_job(job_id: &str) {
    let mut guard = ACTIVE_AI_JOBS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if let Some(jobs) = guard.as_mut() {
        jobs.remove(job_id);
    }
}

pub(super) async fn wait_for_cancellation(cancelled: Arc<AtomicBool>) {
    while !cancelled.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(75)).await;
    }
}

#[tauri::command]
pub fn cancel_ai_job(job_id: String) -> Result<bool, String> {
    if !valid_job_id(&job_id) {
        return Err("Invalid AI job identifier".into());
    }
    let guard = ACTIVE_AI_JOBS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let Some(cancelled) = guard.as_ref().and_then(|jobs| jobs.get(&job_id)) else {
        return Ok(false);
    };
    cancelled.store(true, Ordering::Relaxed);
    Ok(true)
}
