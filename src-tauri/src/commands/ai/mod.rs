// AI completion commands, split by protocol. Job cancellation and the retry policy are
// shared; each provider family owns its own request shaping and response parsing.
mod anthropic;
mod jobs;
mod openai_compat;
mod retry;

pub use anthropic::*;
pub use jobs::*;
pub use openai_compat::*;

use serde_json::Value;

const MAX_LLM_REQUEST_BYTES: usize = 256 * 1024;

pub(super) fn serialize_capped(payload: &Value) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(payload).map_err(|e| format!("serialize request: {e}"))?;
    if body.len() > MAX_LLM_REQUEST_BYTES {
        return Err("The request exceeds the 256 KB limit — split the batch and retry".into());
    }
    Ok(body)
}
