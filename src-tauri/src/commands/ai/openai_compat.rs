// Every provider speaking the OpenAI chat-completions dialect: Gemini and Grok behind
// fixed official base URLs, plus a user-supplied compatible endpoint.
use crate::store;
use serde_json::{json, Value};
use std::sync::{atomic::AtomicBool, Arc};
use std::time::Duration;

use super::jobs::{begin_ai_job, finish_ai_job, wait_for_cancellation};
use super::retry::send_with_retry;
use super::serialize_capped;

/// Google's OpenAI-compatible `/models` route lists ids in the native `models/<id>` form,
/// but its `/chat/completions` route accepts only the bare id. Strip the prefix both when
/// the catalog is read (so the picker stores bare ids) and when a model is read back from
/// settings (so a configuration already saved with the prefix keeps working).
fn bare_model_id(model: &str) -> &str {
    model.strip_prefix("models/").unwrap_or(model)
}

fn compatible_endpoint(base_url: &str) -> Result<reqwest::Url, String> {
    let mut url =
        reqwest::Url::parse(base_url.trim()).map_err(|_| "Enter a valid HTTPS service URL")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "The service URL must use HTTPS and cannot contain credentials, a query, or a fragment"
                .into(),
        );
    }
    let endpoint = format!("{}/v1/chat/completions", url.path().trim_end_matches('/'));
    url.set_path(&endpoint);
    Ok(url)
}

fn sanitize_compatible_messages(request: &Value) -> Result<Vec<Value>, String> {
    let mut output = Vec::new();
    if let Some(system) = request.get("system").and_then(Value::as_str) {
        output.push(json!({ "role": "system", "content": system }));
    }
    let messages = request
        .get("messages")
        .and_then(Value::as_array)
        .ok_or("request.messages must be an array")?;
    if messages.is_empty() {
        return Err("request.messages must not be empty".into());
    }
    for message in messages {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .ok_or("message.role must be a string")?;
        if role != "user" && role != "assistant" {
            return Err(format!("message.role '{role}' is not allowed"));
        }
        let content = match message.get("content") {
            Some(Value::String(text)) => text.clone(),
            Some(Value::Array(blocks)) if !blocks.is_empty() => {
                let mut text = String::new();
                for block in blocks {
                    if block.get("type").and_then(Value::as_str) != Some("text") {
                        return Err("only text content blocks are allowed".into());
                    }
                    let part = block
                        .get("text")
                        .and_then(Value::as_str)
                        .ok_or("a text content block requires text")?;
                    text.push_str(part);
                }
                text
            }
            _ => return Err("message.content must be text".into()),
        };
        output.push(json!({ "role": role, "content": content }));
    }
    Ok(output)
}

/// Official OpenAI-compatible chat-completions endpoints for named providers (no
/// user-editable base URL — eliminates typo/malicious-URL risk for these two).
/// Gemini: https://ai.google.dev/gemini-api/docs/openai
/// Grok: https://docs.x.ai
fn named_provider_endpoint(provider: &str) -> Option<&'static str> {
    match provider {
        "gemini" => {
            Some("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions")
        }
        "grok" => Some("https://api.x.ai/v1/chat/completions"),
        _ => None,
    }
}

fn named_provider_models_endpoint(provider: &str) -> Option<&'static str> {
    match provider {
        "gemini" => Some("https://generativelanguage.googleapis.com/v1beta/openai/models"),
        "grok" => Some("https://api.x.ai/v1/models"),
        _ => None,
    }
}

fn named_provider_api_key(provider: &str) -> Option<String> {
    match provider {
        "gemini" => store::gemini_api_key(),
        "grok" => store::grok_api_key(),
        _ => None,
    }
}

async fn compatible_complete_inner(
    request: Value,
    cancelled: Arc<AtomicBool>,
) -> Result<String, String> {
    provider_complete_inner("compatible", request, cancelled).await
}

async fn provider_complete_inner(
    provider: &str,
    request: Value,
    cancelled: Arc<AtomicBool>,
) -> Result<String, String> {
    let provider_label = if provider == "compatible" {
        "Compatible provider"
    } else {
        provider
    };
    let (endpoint, key, model) = if provider == "compatible" {
        let settings = store::get_settings();
        let compatible = settings
            .get("compatible")
            .ok_or("Compatible provider is not configured")?;
        let base_url = compatible
            .get("baseUrl")
            .and_then(Value::as_str)
            .ok_or("Compatible provider URL is not configured")?;
        let model = compatible
            .get("model")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.len() <= 160)
            .ok_or("Compatible provider model is not configured")?
            .to_string();
        let endpoint = compatible_endpoint(base_url)?;
        let key = store::compatible_api_key().ok_or(
            "No compatible provider key is saved. Open Settings and add the service API key.",
        )?;
        (endpoint, key, model)
    } else {
        let endpoint_str = named_provider_endpoint(provider).ok_or("Unknown AI provider")?;
        let endpoint = reqwest::Url::parse(endpoint_str)
            .map_err(|e| format!("invalid provider endpoint: {e}"))?;
        let key = named_provider_api_key(provider)
            .ok_or_else(|| format!("No {provider} key is saved. Open Settings and add it."))?;
        let settings = store::get_settings();
        let model = settings
            .pointer(&format!("/{provider}/model"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.len() <= 160)
            .map(bare_model_id)
            .ok_or_else(|| format!("Choose a {provider} model in Settings"))?
            .to_string();
        (endpoint, key, model)
    };
    let messages = sanitize_compatible_messages(&request)?;
    let max_tokens = request
        .get("max_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(4096)
        .min(8192);
    let mut payload = json!({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": request
            .get("temperature")
            .and_then(Value::as_f64)
            .filter(|value| (0.0..=1.0).contains(value))
            .unwrap_or(0.0),
    });
    // Gemini 3.x spends output tokens on internal reasoning before writing any text, so a
    // full thinking budget can return an empty completion. Grouping BOQ lines is
    // structured extraction rather than a reasoning task, so keep thinking minimal. Only
    // Gemini gets the field — an arbitrary compatible endpoint may reject an unknown key.
    if provider == "gemini" {
        payload["reasoning_effort"] = json!("low");
    }
    let body = serialize_capped(&payload)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let response = send_with_retry(provider_label, cancelled.clone(), || {
        client
            .post(endpoint.clone())
            .bearer_auth(&key)
            .header("content-type", "application/json")
            .body(body.clone())
    })
    .await?;
    if response.status().is_redirection() {
        return Err(format!("{provider_label} attempted an unsafe redirect"));
    }
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|length| length > 10 * 1024 * 1024)
    {
        return Err(format!(
            "{provider_label} response exceeded the 10 MB limit"
        ));
    }
    let bytes = tokio::select! {
        result = response.bytes() => {
            result.map_err(|e| format!("read {provider_label} response: {e}"))?
        }
        _ = wait_for_cancellation(cancelled) => return Err("AI job cancelled".into()),
    };
    if bytes.len() > 10 * 1024 * 1024 {
        return Err(format!(
            "{provider_label} response exceeded the 10 MB limit"
        ));
    }
    let response_body: Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("parse provider response: {e}"))?;
    if !status.is_success() {
        let message: String = response_body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("The service rejected the request")
            .chars()
            .take(300)
            .collect();
        return Err(format!("{provider_label} error {status}: {message}"));
    }
    let text = response_body
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty());
    let Some(text) = text else {
        // A thinking model that spends its whole budget on reasoning returns 200 with no
        // content and finish_reason "length". That needs a bigger budget, not a new key,
        // so say which of the two happened rather than reporting a bare empty reply.
        let truncated = response_body
            .pointer("/choices/0/finish_reason")
            .and_then(Value::as_str)
            .is_some_and(|reason| reason.eq_ignore_ascii_case("length"));
        return Err(if truncated {
            format!(
                "{provider_label} used its entire output budget before answering. \
                 Choose a model with a smaller reasoning step, or raise the token limit."
            )
        } else {
            format!("{provider_label} returned an empty response")
        });
    };
    store::log_line(&format!("{provider_label} classification batch completed"));
    Ok(text.to_string())
}

#[tauri::command]
pub async fn compatible_complete(request: Value, job_id: String) -> Result<String, String> {
    let cancelled = begin_ai_job(&job_id)?;
    let result = compatible_complete_inner(request, cancelled).await;
    finish_ai_job(&job_id);
    result
}

#[tauri::command]
pub async fn compatible_test() -> Result<bool, String> {
    let request = json!({
        "messages": [{ "role": "user", "content": "Reply with OK only." }],
        "max_tokens": 16,
        "temperature": 0
    });
    compatible_complete_inner(request, Arc::new(AtomicBool::new(false)))
        .await
        .map(|_| true)
}

#[tauri::command]
pub async fn gemini_complete(request: Value, job_id: String) -> Result<String, String> {
    let cancelled = begin_ai_job(&job_id)?;
    let result = provider_complete_inner("gemini", request, cancelled).await;
    finish_ai_job(&job_id);
    result
}

#[tauri::command]
pub async fn grok_complete(request: Value, job_id: String) -> Result<String, String> {
    let cancelled = begin_ai_job(&job_id)?;
    let result = provider_complete_inner("grok", request, cancelled).await;
    finish_ai_job(&job_id);
    result
}

#[tauri::command]
pub async fn gemini_test() -> Result<bool, String> {
    named_provider_test("gemini").await
}

#[tauri::command]
pub async fn grok_test() -> Result<bool, String> {
    named_provider_test("grok").await
}

async fn named_provider_test(provider: &str) -> Result<bool, String> {
    // The budget has to survive a thinking model's reasoning preamble: on Gemini 3.x a
    // 16-token cap is consumed entirely by thoughts, and the probe comes back 200 OK with
    // empty content — a working key reported as a failure.
    let request = json!({
        "messages": [{ "role": "user", "content": "Reply with OK only." }],
        "max_tokens": 256,
        "temperature": 0
    });
    provider_complete_inner(provider, request, Arc::new(AtomicBool::new(false)))
        .await
        .map(|_| true)
}

/// Fetch the provider's real, live `/models` list (the official OpenAI-compatible model
/// catalog shape: `{"data": [{"id": "..."}, ...]}`) so the UI never hardcodes model slugs
/// that can go stale — mirrors how the Codex card fetches its model catalog.
async fn named_provider_models(provider: &str) -> Result<Vec<String>, String> {
    let endpoint = named_provider_models_endpoint(provider).ok_or("Unknown AI provider")?;
    let key = named_provider_api_key(provider)
        .ok_or_else(|| format!("No {provider} key is saved. Open Settings and add it."))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let response = client
        .get(endpoint)
        .bearer_auth(key)
        .send()
        .await
        .map_err(|e| format!("{provider} network error: {e}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("read {provider} model list: {e}"))?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(format!("{provider} model list exceeded the 2 MB limit"));
    }
    let body: Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("parse {provider} model list: {e}"))?;
    if !status.is_success() {
        let message = body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("The service rejected the request");
        return Err(format!("{provider} error {status}: {message}"));
    }
    let mut models: Vec<String> = body
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .map(|id| bare_model_id(id).to_string())
                .collect()
        })
        .unwrap_or_default();
    models.sort();
    if models.is_empty() {
        return Err(format!("{provider} returned an empty model list"));
    }
    Ok(models)
}

#[tauri::command]
pub async fn gemini_models() -> Result<Vec<String>, String> {
    named_provider_models("gemini").await
}

#[tauri::command]
pub async fn grok_models() -> Result<Vec<String>, String> {
    named_provider_models("grok").await
}

#[cfg(test)]
mod model_id_tests {
    use super::bare_model_id;

    #[test]
    fn strips_the_google_catalog_prefix() {
        assert_eq!(bare_model_id("models/gemini-3.7-flash"), "gemini-3.7-flash");
    }

    #[test]
    fn leaves_a_bare_id_untouched() {
        assert_eq!(bare_model_id("gemini-3.7-flash"), "gemini-3.7-flash");
        assert_eq!(bare_model_id("grok-4"), "grok-4");
    }

    #[test]
    fn only_strips_a_leading_prefix() {
        // "models/" mid-string is part of the id, not a catalog prefix.
        assert_eq!(bare_model_id("vendor/models/thing"), "vendor/models/thing");
        assert_eq!(bare_model_id("a-models/x"), "a-models/x");
    }

    #[test]
    fn strips_only_one_level() {
        assert_eq!(bare_model_id("models/models/x"), "models/x");
    }
}

#[cfg(test)]
mod compatible_provider_tests {
    use super::{compatible_endpoint, sanitize_compatible_messages};
    use serde_json::json;

    #[test]
    fn endpoint_accepts_https_and_appends_fixed_chat_path() {
        let endpoint = compatible_endpoint("https://provider.example/api").unwrap();
        assert_eq!(
            endpoint.as_str(),
            "https://provider.example/api/v1/chat/completions"
        );
    }

    #[test]
    fn endpoint_rejects_credentials_queries_fragments_and_http() {
        for value in [
            "http://provider.example",
            "https://user:secret@provider.example",
            "https://provider.example?next=https://evil.example",
            "https://provider.example/#fragment",
        ] {
            assert!(compatible_endpoint(value).is_err(), "{value}");
        }
    }

    #[test]
    fn compatible_messages_drop_extra_fields_and_reject_tools() {
        let messages = sanitize_compatible_messages(&json!({
            "system": "Group construction BOQ items.",
            "messages": [{
                "role": "user",
                "content": "Concrete works",
                "tool_call": { "url": "https://evil.example" }
            }]
        }))
        .unwrap();
        assert_eq!(messages.len(), 2);
        assert!(messages[1].get("tool_call").is_none());

        assert!(sanitize_compatible_messages(&json!({
            "messages": [{
                "role": "user",
                "content": [{ "type": "image", "url": "https://evil.example" }]
            }]
        }))
        .is_err());
    }
}
