// Anthropic's native Messages API. Every other provider speaks the OpenAI-compatible
// dialect and lives in openai_compat.rs.
use crate::store;
use serde_json::{json, Value};
use std::sync::{atomic::AtomicBool, Arc};
use std::time::Duration;

use super::jobs::{begin_ai_job, finish_ai_job};
use super::retry::send_with_retry;
use super::{output_schema, serialize_capped};

#[tauri::command]
pub async fn llm_complete(request: Value, job_id: String) -> Result<String, String> {
    let cancelled = begin_ai_job(&job_id)?;
    let result = llm_complete_inner(request, cancelled).await;
    finish_ai_job(&job_id);
    result
}

async fn llm_complete_inner(request: Value, cancelled: Arc<AtomicBool>) -> Result<String, String> {
    let key = store::api_key()
        .ok_or("No Anthropic API key configured. Open Settings in Tawreed to add one.")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .https_only(true)
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    // Validate and sanitize the webview request before it ever reaches the API.
    // Only a known-good, minimal shape is forwarded; every other field is dropped.
    const ALLOWED_MODELS: &[&str] = &[
        "claude-sonnet-5",
        "claude-sonnet-4-6",
        "claude-sonnet-4-5-20250929",
        "claude-haiku-4-5-20251001",
    ];
    let model = request
        .get("model")
        .and_then(Value::as_str)
        .ok_or("request.model must be a string")?;
    if !ALLOWED_MODELS.contains(&model) {
        return Err(format!("model '{model}' is not an approved model"));
    }
    let messages = request
        .get("messages")
        .and_then(Value::as_array)
        .ok_or("request.messages must be an array")?;
    if messages.is_empty() {
        return Err("request.messages must not be empty".into());
    }
    let messages = sanitize_messages(messages)?;
    let max_tokens = match request.get("max_tokens").and_then(Value::as_u64) {
        Some(n) => n.min(8192),
        None => 4096,
    };
    let mut sanitized = json!({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
    });
    if let Some(system) = request.get("system").and_then(Value::as_str) {
        sanitized["system"] = json!(system);
    }
    if let Some(temperature) = request.get("temperature").and_then(Value::as_f64) {
        if (0.0..=1.0).contains(&temperature) {
            sanitized["temperature"] = json!(temperature);
        }
    }
    // Constrained decoding against the caller's JSON Schema. Without this the engine's
    // schema was built, sent, and silently dropped here, leaving "Return ONLY valid JSON"
    // in the prompt as the only thing standing between a stray sentence of prose and a
    // whole batch of items falling back to Unclassified.
    if let Some(schema) = output_schema(&request)? {
        sanitized["output_config"] = json!({
            "format": { "type": "json_schema", "schema": schema },
        });
    }
    let body = serialize_capped(&sanitized)?;

    let response = send_with_retry("Anthropic", cancelled, || {
        client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .body(body.clone())
    })
    .await?;

    let status = response.status();
    if !status.is_success() {
        let snippet: String = response
            .text()
            .await
            .unwrap_or_default()
            .chars()
            .take(300)
            .collect();
        return Err(format!("Anthropic API error {status}: {snippet}"));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("parse response: {e}"))?;
    let text = body
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| b.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    if text.is_empty() {
        return Err("Anthropic returned an empty completion".into());
    }
    store::log_line("llm classification batch completed");
    Ok(text)
}

/// Re-serialize webview-supplied chat messages into the only shape forwarded to Anthropic:
/// role is exactly `user` or `assistant`, content is text blocks only. Anything else
/// (other roles, tool blocks, images, extra fields) is rejected, not passed through.
fn sanitize_messages(messages: &[Value]) -> Result<Vec<Value>, String> {
    let mut out = Vec::with_capacity(messages.len());
    for message in messages {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .ok_or("message.role must be a string")?;
        if role != "user" && role != "assistant" {
            return Err(format!("message.role '{role}' is not allowed"));
        }
        let content = message
            .get("content")
            .ok_or("message.content is required")?;
        let blocks = match content {
            Value::String(text) => vec![json!({ "type": "text", "text": text })],
            Value::Array(items) => {
                if items.is_empty() {
                    return Err("message.content must not be an empty array".into());
                }
                let mut blocks = Vec::with_capacity(items.len());
                for item in items {
                    if item.get("type").and_then(Value::as_str) != Some("text") {
                        return Err("only text content blocks are allowed".into());
                    }
                    let text = item
                        .get("text")
                        .and_then(Value::as_str)
                        .ok_or("a text content block requires a string text")?;
                    blocks.push(json!({ "type": "text", "text": text }));
                }
                blocks
            }
            _ => return Err("message.content must be a string or an array of text blocks".into()),
        };
        out.push(json!({ "role": role, "content": blocks }));
    }
    Ok(out)
}

/// Verifies a saved Anthropic key with a minimal live call, so the Settings card can
/// report a real result instead of assuming the key works because it was stored.
#[tauri::command]
pub async fn anthropic_test() -> Result<bool, String> {
    let request = json!({
        "model": "claude-haiku-4-5-20251001",
        "messages": [{ "role": "user", "content": "Reply with OK only." }],
        "max_tokens": 16,
        "temperature": 0
    });
    llm_complete_inner(request, Arc::new(AtomicBool::new(false)))
        .await
        .map(|_| true)
}
