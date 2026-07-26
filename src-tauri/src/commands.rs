// Tauri commands — the only bridge between the webview and the host OS.
// The API key is read here, attached to the HTTP request here, and never crosses into JS.
use crate::store;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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

fn begin_ai_job(job_id: &str) -> Result<Arc<AtomicBool>, String> {
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

fn finish_ai_job(job_id: &str) {
    let mut guard = ACTIVE_AI_JOBS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if let Some(jobs) = guard.as_mut() {
        jobs.remove(job_id);
    }
}

async fn wait_for_cancellation(cancelled: Arc<AtomicBool>) {
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

#[tauri::command]
pub fn bootstrap() -> Result<store::BootstrapInfo, String> {
    store::bootstrap_data_dir()
}

#[tauri::command]
pub fn set_api_key(key: String) -> Result<bool, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Empty API key".into());
    }
    store::write_env_key(Some(trimmed))?;
    store::log_line("api key updated via settings");
    Ok(true)
}

#[tauri::command]
pub fn delete_api_key() -> Result<bool, String> {
    store::write_env_key(None)?;
    store::log_line("api key removed");
    Ok(true)
}

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
    let body = serialize_capped(&sanitized)?;

    let mut last_err = String::new();
    for attempt in 0..2 {
        if cancelled.load(Ordering::Relaxed) {
            return Err("AI job cancelled".into());
        }
        if attempt > 0 {
            tokio::select! {
                _ = tokio_sleep(2_000) => {}
                _ = wait_for_cancellation(cancelled.clone()) => {
                    return Err("AI job cancelled".into());
                }
            }
        }
        let request = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .body(body.clone())
            .send();
        let result = tokio::select! {
            response = request => response,
            _ = wait_for_cancellation(cancelled.clone()) => {
                return Err("AI job cancelled".into());
            }
        };
        match result {
            Ok(res) if res.status().is_success() => {
                let body: Value = res
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
                return Ok(text);
            }
            Ok(res) => {
                let status = res.status();
                let snippet: String = res
                    .text()
                    .await
                    .unwrap_or_default()
                    .chars()
                    .take(300)
                    .collect();
                last_err = format!("Anthropic API error {status}: {snippet}");
                let retryable = status.as_u16() == 429 || status.is_server_error();
                store::log_line(&format!("llm call failed ({status}) retryable={retryable}"));
                if !retryable {
                    return Err(last_err);
                }
            }
            Err(e) => {
                last_err = format!("network error: {e}");
                store::log_line(&format!("llm network error (attempt {})", attempt + 1));
            }
        }
    }
    Err(last_err)
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

/// Ceiling on the serialized request body. Classification batches are KiB-scale and every
/// byte goes out under the user's API key, so an oversized payload is a bug, not a prompt.
const MAX_LLM_REQUEST_BYTES: usize = 256 * 1024;

fn serialize_capped(payload: &Value) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(payload).map_err(|e| format!("serialize request: {e}"))?;
    if body.len() > MAX_LLM_REQUEST_BYTES {
        return Err("The request exceeds the 256 KB limit — split the batch and retry".into());
    }
    Ok(body)
}

async fn tokio_sleep(ms: u64) {
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

fn safe_component(raw: &str, max_chars: usize) -> String {
    let mut value = String::with_capacity(raw.len());
    let mut previous_space = false;
    for ch in raw.chars() {
        let invalid =
            ch < ' ' || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
        let next = if invalid { ' ' } else { ch };
        if next.is_whitespace() {
            if !previous_space {
                value.push(' ');
            }
            previous_space = true;
        } else {
            value.push(next);
            previous_space = false;
        }
    }
    value = value
        .trim()
        .trim_end_matches(['.', ' '])
        .chars()
        .take(max_chars)
        .collect();
    value = value.trim_end_matches(['.', ' ']).to_string();
    if value.is_empty() {
        value = "Untitled Project".into();
    }
    let lower = value.to_lowercase();
    let reserved = matches!(lower.as_str(), "con" | "prn" | "aux" | "nul")
        || (lower.len() == 4
            && (lower.starts_with("com") || lower.starts_with("lpt"))
            && lower[3..].parse::<u8>().is_ok_and(|n| (1..=9).contains(&n)));
    if reserved {
        format!("Project {value}")
    } else {
        value
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionReservation {
    project_name: String,
    revision: u32,
    revision_label: String,
    session: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionArtifact {
    relative_path: String,
    bytes_b64: String,
    kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionOutput {
    project_name: String,
    revision: u32,
    revision_label: String,
    master_path: String,
    package_folder: String,
    revision_folder: String,
    files: Vec<String>,
}

/// Process-wide guard against two generations of the same project running at once — both
/// could otherwise reserve the same `Rev NN` and the loser would fail only after doing all
/// the work. Acquired by reserve_revision, released by write_revision_bundle and
/// discard_revision on every exit path. These commands are synchronous, so the lock is
/// only held for a map insert/remove at a time — never across an .await.
static ACTIVE_GENERATIONS: std::sync::Mutex<Option<std::collections::HashSet<String>>> =
    std::sync::Mutex::new(None);

fn acquire_generation(project: &str) -> bool {
    let mut guard = ACTIVE_GENERATIONS.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .get_or_insert_with(std::collections::HashSet::new)
        .insert(project.to_string())
}

fn release_generation(project: &str) {
    let mut guard = ACTIVE_GENERATIONS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(active) = guard.as_mut() {
        active.remove(project);
    }
}

#[tauri::command]
pub fn reserve_revision(project_name: String) -> Result<RevisionReservation, String> {
    let project_name = safe_component(&project_name, 100);
    if !acquire_generation(&project_name) {
        return Err(format!(
            "A generation is already running for {project_name} — wait for it to finish or discard it"
        ));
    }
    let reservation = reserve_revision_inner(&project_name);
    if reservation.is_err() {
        release_generation(&project_name);
    }
    reservation
}

fn reserve_revision_inner(project_name: &str) -> Result<RevisionReservation, String> {
    let project_dir = store::output_dir()?.join(project_name);
    std::fs::create_dir_all(&project_dir)
        .map_err(|e| format!("create project output directory: {e}"))?;
    let revision = (1..10_000u32)
        .find(|revision| !project_dir.join(format!("Rev {revision:02}")).exists())
        .ok_or("Could not allocate another project revision")?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let session = format!(
        ".tawreed-rev-{revision:02}-{stamp}-{}.tmp",
        std::process::id()
    );
    let temp = project_dir.join(&session);
    std::fs::create_dir_all(temp.join("Packages"))
        .map_err(|e| format!("reserve revision directory: {e}"))?;
    Ok(RevisionReservation {
        project_name: project_name.to_string(),
        revision,
        revision_label: format!("Rev {revision:02}"),
        session,
    })
}

fn safe_artifact_path(
    root: &std::path::Path,
    relative: &str,
) -> Result<std::path::PathBuf, String> {
    let normalized = relative.replace('\\', "/");
    let parts: Vec<&str> = normalized.split('/').collect();
    if parts.is_empty() || parts.len() > 2 || (parts.len() == 2 && parts[0] != "Packages") {
        return Err("Invalid generated artifact path".into());
    }
    let name = parts.last().copied().unwrap_or("");
    if name != safe_component(name, 220) || !name.to_lowercase().ends_with(".xlsx") {
        return Err("Invalid generated workbook filename".into());
    }
    Ok(if parts.len() == 2 {
        root.join("Packages").join(name)
    } else {
        root.join(name)
    })
}

#[tauri::command]
pub fn write_revision_bundle(
    project_name: String,
    session: String,
    revision: u32,
    artifacts: Vec<RevisionArtifact>,
) -> Result<RevisionOutput, String> {
    // Release the per-project generation guard on every exit path, success or failure.
    let project_name = safe_component(&project_name, 100);
    let result = write_revision_bundle_inner(&project_name, session, revision, artifacts);
    release_generation(&project_name);
    result
}

fn write_revision_bundle_inner(
    project_name: &str,
    session: String,
    revision: u32,
    artifacts: Vec<RevisionArtifact>,
) -> Result<RevisionOutput, String> {
    if artifacts.is_empty()
        || session.contains(['/', '\\'])
        || !session.starts_with(".tawreed-rev-")
        || !session.ends_with(".tmp")
    {
        return Err("Invalid revision session".into());
    }
    let project_dir = store::output_dir()?.join(project_name);
    let temp = project_dir.join(&session);
    if !temp.is_dir() {
        return Err("Revision reservation no longer exists".into());
    }
    let final_dir = project_dir.join(format!("Rev {revision:02}"));
    if final_dir.exists() {
        return Err(format!("Rev {revision:02} already exists"));
    }

    // Fail fast before any file of the bundle is written: the full target path
    // (<output>/<project>/Rev NN/Packages/<name>.xlsx) must fit under Windows' 260-char
    // MAX_PATH with margin, otherwise the write would die halfway through the bundle.
    for artifact in &artifacts {
        let target = safe_artifact_path(&final_dir, &artifact.relative_path)?;
        if target.to_string_lossy().chars().count() > 240 {
            return Err(format!(
                "'{}' would exceed the maximum Windows path length — use a shorter project name",
                artifact.relative_path
            ));
        }
    }

    let mut files = Vec::new();
    let mut master_relative: Option<String> = None;
    let write_result = (|| -> Result<(), String> {
        for artifact in artifacts {
            if artifact.bytes_b64.len() > 268_435_456 {
                let _ = std::fs::remove_dir_all(&temp);
                return Err("Artifact exceeds the 200 MB limit".into());
            }
            let path = safe_artifact_path(&temp, &artifact.relative_path)?;
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("create package directory: {e}"))?;
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&artifact.bytes_b64)
                .map_err(|e| format!("decode generated workbook: {e}"))?;
            let tmp_file = path.with_extension("xlsx.tmp");
            std::fs::write(&tmp_file, &bytes)
                .map_err(|e| format!("write generated workbook: {e}"))?;
            store::replace_file(&tmp_file, &path)
                .map_err(|e| format!("publish generated workbook: {e}"))?;
            if artifact.kind == "master" {
                master_relative = Some(artifact.relative_path.clone());
            }
            files.push(artifact.relative_path);
        }
        if master_relative.is_none() {
            return Err("Generated bundle has no master workbook".into());
        }
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_dir_all(&temp);
        return Err(error);
    }

    // Publish. On Windows this rename fails while anything holds a handle inside the
    // folder (Explorer, antivirus, an open workbook) — keep the temp dir so the completed
    // generation survives and the user can retry instead of losing the work.
    if let Err(e) = std::fs::rename(&temp, &final_dir) {
        return Err(format!(
            "Could not publish the revision ({e}). The generated files are preserved at {} — close whatever is using them and try again.",
            temp.to_string_lossy()
        ));
    }

    let master = final_dir.join(master_relative.unwrap());
    let absolute_files = files
        .iter()
        .map(|relative| final_dir.join(relative).to_string_lossy().to_string())
        .collect();
    store::log_line(&format!(
        "revision published: {project_name} Rev {revision:02} ({} files)",
        files.len()
    ));
    Ok(RevisionOutput {
        project_name: project_name.to_string(),
        revision,
        revision_label: format!("Rev {revision:02}"),
        master_path: master.to_string_lossy().to_string(),
        package_folder: final_dir.join("Packages").to_string_lossy().to_string(),
        revision_folder: final_dir.to_string_lossy().to_string(),
        files: absolute_files,
    })
}

#[tauri::command]
pub fn discard_revision(project_name: String, session: String) -> Result<(), String> {
    let project_name = safe_component(&project_name, 100);
    let result = (|| -> Result<(), String> {
        if session.contains(['/', '\\']) || !session.starts_with(".tawreed-rev-") {
            return Err("Invalid revision session".into());
        }
        if !session.ends_with(".tmp") {
            return Err("Invalid session directory name".into());
        }
        let temp = store::output_dir()?.join(&project_name).join(session);
        if temp.exists() {
            std::fs::remove_dir_all(temp).map_err(|e| format!("discard revision: {e}"))?;
        }
        Ok(())
    })();
    // A malformed or already-missing reservation must not permanently strand the
    // process-wide project guard.
    release_generation(&project_name);
    result
}

#[tauri::command]
pub fn read_input_file(path: String) -> Result<Value, String> {
    let path = std::path::Path::new(&path);
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_lowercase)
        .ok_or("The input file has no extension")?;
    if !matches!(extension.as_str(), "xlsx" | "xls" | "csv" | "ods" | "pdf") {
        return Err("Only .xlsx, .xls, .csv, .ods, and .pdf inputs are supported".into());
    }
    let metadata = std::fs::metadata(path).map_err(|e| format!("read workbook metadata: {e}"))?;
    if !metadata.is_file() {
        return Err("The dropped path is not a file".into());
    }
    if metadata.len() > 100 * 1024 * 1024 {
        return Err("The input file is larger than the 100 MB limit".into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("read input file: {e}"))?;
    let valid = match extension.as_str() {
        "pdf" => bytes.starts_with(b"%PDF-"),
        "xlsx" | "ods" => {
            bytes.len() >= 4
                && bytes[0] == 0x50
                && bytes[1] == 0x4b
                && matches!(bytes[2], 0x03 | 0x05 | 0x07)
        }
        "xls" => bytes.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        // Text files have no reliable magic number. Reject empty and obviously
        // binary payloads while retaining UTF-8 and legacy Windows/Arabic encodings.
        "csv" => !bytes.is_empty() && bytes.iter().filter(|byte| **byte == 0).count() < 4,
        _ => false,
    };
    if !valid {
        return Err(format!(
            "The selected .{extension} file has an invalid file signature"
        ));
    }
    Ok(json!({
        "bytes": base64::engine::general_purpose::STANDARD.encode(bytes),
        "name": path.file_name().and_then(|name| name.to_str()).unwrap_or("input").to_string(),
        "mime": match extension.as_str() {
            "pdf" => "application/pdf",
            "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "xls" => "application/vnd.ms-excel",
            "ods" => "application/vnd.oasis.opendocument.spreadsheet",
            "csv" => "text/csv",
            _ => "application/octet-stream",
        },
    }))
}

#[tauri::command]
pub fn record_run(entry: Value) -> Result<i64, String> {
    let provider = entry
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("offline");
    if !matches!(provider, "offline" | "codex" | "anthropic") {
        return Err("Invalid run provider".into());
    }
    let model = entry.get("model").and_then(Value::as_str).unwrap_or("");
    if model.chars().count() > 160 {
        return Err("Run model identifier is too long".into());
    }
    let empty_trace = json!([]);
    let trace_json = serde_json::to_string(
        entry
            .get("trace")
            .filter(|trace| trace.is_array())
            .unwrap_or(&empty_trace),
    )
    .map_err(|e| format!("serialize run trace: {e}"))?;
    if trace_json.len() > 256 * 1024 {
        return Err("Run trace exceeds the 256 KB limit".into());
    }
    let conn = store::open_db()?;
    conn.execute(
        "INSERT INTO runs (started_at, file_name, file_hash, item_count, package_count,
                           error_count, warning_count, output_file, duration_ms, llm_used,
                           project_name, revision, package_folder, source_kind, ocr_used,
                           provider, model, trace_json, memory_applied)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
        rusqlite::params![
            entry.get("startedAt").and_then(Value::as_str).unwrap_or(""),
            entry.get("fileName").and_then(Value::as_str).unwrap_or(""),
            entry.get("fileHash").and_then(Value::as_str).unwrap_or(""),
            entry.get("itemCount").and_then(Value::as_i64).unwrap_or(0),
            entry
                .get("packageCount")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            entry.get("errorCount").and_then(Value::as_i64).unwrap_or(0),
            entry
                .get("warningCount")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            entry
                .get("outputFile")
                .and_then(Value::as_str)
                .unwrap_or(""),
            entry.get("durationMs").and_then(Value::as_i64).unwrap_or(0),
            entry
                .get("llmUsed")
                .and_then(Value::as_bool)
                .unwrap_or(false) as i64,
            entry
                .get("projectName")
                .and_then(Value::as_str)
                .unwrap_or(""),
            entry.get("revision").and_then(Value::as_i64).unwrap_or(0),
            entry
                .get("packageFolder")
                .and_then(Value::as_str)
                .unwrap_or(""),
            entry
                .get("sourceKind")
                .and_then(Value::as_str)
                .unwrap_or("xlsx"),
            entry
                .get("ocrUsed")
                .and_then(Value::as_bool)
                .unwrap_or(false) as i64,
            provider,
            model,
            trace_json,
            entry
                .get("memoryApplied")
                .and_then(Value::as_i64)
                .unwrap_or(0),
        ],
    )
    .map_err(|e| format!("insert run: {e}"))?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn list_runs() -> Result<Vec<Value>, String> {
    let conn = store::open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, started_at, file_name, file_hash, item_count, package_count,
                    error_count, warning_count, output_file, duration_ms, llm_used,
                    project_name, revision, package_folder, source_kind, ocr_used,
                    provider, model, trace_json, memory_applied
             FROM runs ORDER BY id DESC LIMIT 100",
        )
        .map_err(|e| format!("prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "startedAt": r.get::<_, String>(1)?,
                "fileName": r.get::<_, String>(2)?,
                "fileHash": r.get::<_, String>(3)?,
                "itemCount": r.get::<_, i64>(4)?,
                "packageCount": r.get::<_, i64>(5)?,
                "errorCount": r.get::<_, i64>(6)?,
                "warningCount": r.get::<_, i64>(7)?,
                "outputFile": r.get::<_, String>(8)?,
                "durationMs": r.get::<_, i64>(9)?,
                "llmUsed": r.get::<_, i64>(10)? == 1,
                "projectName": r.get::<_, String>(11)?,
                "revision": r.get::<_, i64>(12)?,
                "packageFolder": r.get::<_, String>(13)?,
                "sourceKind": r.get::<_, String>(14)?,
                "ocrUsed": r.get::<_, i64>(15)? == 1,
                "provider": r.get::<_, String>(16)?,
                "model": r.get::<_, String>(17)?,
                "trace": serde_json::from_str::<Value>(&r.get::<_, String>(18)?)
                    .unwrap_or_else(|_| json!([])),
                "memoryApplied": r.get::<_, i64>(19)?,
            }))
        })
        .map_err(|e| format!("query runs: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("row: {e}"))?);
    }
    Ok(out)
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationMemoryEntry {
    description_key: String,
    package_code: String,
    package_name_en: String,
    package_name_ar: String,
    updated_at: String,
}

fn valid_package_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 32
        && code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[tauri::command]
pub fn save_classification_memory(
    project_name: String,
    entries: Vec<ClassificationMemoryEntry>,
) -> Result<usize, String> {
    let project_name = safe_component(&project_name, 100);
    if entries.len() > 20_000 {
        return Err("Too many classification memory entries".into());
    }
    let mut conn = store::open_db()?;
    let transaction = conn
        .transaction()
        .map_err(|e| format!("start memory transaction: {e}"))?;
    let mut saved = 0usize;
    for entry in entries {
        let description_key = entry.description_key.trim();
        if description_key.is_empty()
            || description_key.chars().count() > 1_000
            || !valid_package_code(entry.package_code.trim())
            || entry.package_name_en.trim().is_empty()
            || entry.package_name_en.chars().count() > 240
            || entry.package_name_ar.chars().count() > 240
            || entry.updated_at.trim().is_empty()
            || entry.updated_at.chars().count() > 64
        {
            return Err("Invalid classification memory entry".into());
        }
        transaction
            .execute(
                "INSERT INTO classification_memory (
                    project_name, description_key, package_code, package_name_en,
                    package_name_ar, updated_at
                 ) VALUES (?1,?2,?3,?4,?5,?6)
                 ON CONFLICT(project_name, description_key) DO UPDATE SET
                    package_code=excluded.package_code,
                    package_name_en=excluded.package_name_en,
                    package_name_ar=excluded.package_name_ar,
                    updated_at=excluded.updated_at",
                rusqlite::params![
                    &project_name,
                    description_key,
                    entry.package_code.trim(),
                    entry.package_name_en.trim(),
                    entry.package_name_ar.trim(),
                    entry.updated_at,
                ],
            )
            .map_err(|e| format!("save classification memory: {e}"))?;
        saved += 1;
    }
    transaction
        .commit()
        .map_err(|e| format!("commit classification memory: {e}"))?;
    Ok(saved)
}

#[tauri::command]
pub fn list_classification_memory(
    project_name: String,
) -> Result<Vec<ClassificationMemoryEntry>, String> {
    let project_name = safe_component(&project_name, 100);
    let conn = store::open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT description_key, package_code, package_name_en, package_name_ar, updated_at
             FROM classification_memory
             WHERE project_name = ?1
             ORDER BY updated_at DESC
             LIMIT 20000",
        )
        .map_err(|e| format!("prepare classification memory: {e}"))?;
    let entries = stmt
        .query_map([project_name], |row| {
            Ok(ClassificationMemoryEntry {
                description_key: row.get(0)?,
                package_code: row.get(1)?,
                package_name_en: row.get(2)?,
                package_name_ar: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("read classification memory: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("read classification memory: {e}"))?;
    Ok(entries)
}

#[tauri::command]
pub fn open_output_folder() -> Result<(), String> {
    let dir = store::output_dir()?;
    #[cfg(target_os = "windows")]
    crate::codex::quiet_command("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("open folder: {e}"))?;
    #[cfg(target_os = "macos")]
    crate::codex::quiet_command("open")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("open folder: {e}"))?;
    #[cfg(all(unix, not(target_os = "macos")))]
    crate::codex::quiet_command("xdg-open")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("open folder: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_generated_folder(path: String) -> Result<(), String> {
    let output = std::fs::canonicalize(store::output_dir()?)
        .map_err(|e| format!("resolve output directory: {e}"))?;
    let folder =
        std::fs::canonicalize(path).map_err(|e| format!("resolve generated folder: {e}"))?;
    if !folder.starts_with(output) || !folder.is_dir() {
        return Err("Only generated Tawreed folders can be opened".into());
    }
    #[cfg(target_os = "windows")]
    crate::codex::quiet_command("explorer")
        .arg(&folder)
        .spawn()
        .map_err(|e| format!("open generated folder: {e}"))?;
    #[cfg(target_os = "macos")]
    crate::codex::quiet_command("open")
        .arg(&folder)
        .spawn()
        .map_err(|e| format!("open generated folder: {e}"))?;
    #[cfg(all(unix, not(target_os = "macos")))]
    crate::codex::quiet_command("xdg-open")
        .arg(&folder)
        .spawn()
        .map_err(|e| format!("open generated folder: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_workbook(path: String) -> Result<(), String> {
    let output_dir = std::fs::canonicalize(store::output_dir()?)
        .map_err(|e| format!("resolve output directory: {e}"))?;
    let workbook = std::fs::canonicalize(&path).map_err(|e| format!("resolve workbook: {e}"))?;
    if !workbook.starts_with(&output_dir)
        || workbook
            .extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_lowercase)
            .as_deref()
            != Some("xlsx")
    {
        return Err("Only generated Tawreed workbooks can be opened".into());
    }
    #[cfg(target_os = "windows")]
    crate::codex::quiet_command("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(&workbook)
        .spawn()
        .map_err(|e| format!("open workbook: {e}"))?;
    #[cfg(target_os = "macos")]
    crate::codex::quiet_command("open")
        .arg(&workbook)
        .spawn()
        .map_err(|e| format!("open workbook: {e}"))?;
    #[cfg(all(unix, not(target_os = "macos")))]
    crate::codex::quiet_command("xdg-open")
        .arg(&workbook)
        .spawn()
        .map_err(|e| format!("open workbook: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn app_log(message: String) -> Result<(), String> {
    store::log_line(&message);
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    approved_external_url(&url)?;
    #[cfg(target_os = "windows")]
    crate::codex::quiet_command("explorer")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("open url: {e}"))?;
    #[cfg(target_os = "macos")]
    crate::codex::quiet_command("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("open url: {e}"))?;
    #[cfg(all(unix, not(target_os = "macos")))]
    crate::codex::quiet_command("xdg-open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("open url: {e}"))?;
    Ok(())
}

fn approved_external_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "invalid URL")?;
    let approved_host = matches!(
        parsed.host_str(),
        Some("github.com") | Some("kareemsafwat.com") | Some("www.kareemsafwat.com")
    );
    if parsed.scheme() != "https"
        || !approved_host
        || parsed.username() != ""
        || parsed.password().is_some()
    {
        return Err("only approved HTTPS URLs can be opened".into());
    }
    Ok(())
}

#[cfg(test)]
mod external_url_tests {
    use super::approved_external_url;

    #[test]
    fn permits_only_approved_https_hosts_without_credentials() {
        for url in [
            "https://github.com/kareem-sf/tawreed",
            "https://kareemsafwat.com",
            "https://www.kareemsafwat.com/work",
        ] {
            assert!(approved_external_url(url).is_ok());
        }
        for url in [
            "http://github.com/kareem-sf/tawreed",
            "https://github.com.evil.example/kareem-sf/tawreed",
            "https://user:password@github.com/kareem-sf/tawreed",
            "file:///C:/Windows/System32/calc.exe",
        ] {
            assert!(approved_external_url(url).is_err());
        }
    }
}

// ── Codex CLI provider (ChatGPT subscription, no API key) ───────────────────

#[tauri::command]
pub fn codex_status() -> crate::codex::CodexStatus {
    crate::codex::detect(true) // explicit user-facing check — always fresh
}

#[tauri::command]
pub async fn codex_install() -> Result<String, String> {
    crate::codex::install().await
}

#[tauri::command]
pub fn codex_login() -> Result<(), String> {
    crate::codex::login()
}

#[tauri::command]
pub async fn codex_complete(
    prompt: String,
    model: Option<String>,
    output_schema: Option<Value>,
    job_id: String,
) -> Result<String, String> {
    let cancelled = begin_ai_job(&job_id)?;
    // Codex is a long-running subprocess. Never block Tauri's UI thread while waiting for it.
    let worker = tauri::async_runtime::spawn_blocking(move || {
        crate::codex::complete(&prompt, model.as_deref(), output_schema.as_ref(), cancelled)
    })
    .await;
    finish_ai_job(&job_id);
    match worker {
        Ok(result) => result,
        Err(error) => Err(format!("codex worker failed: {error}")),
    }
}

#[tauri::command]
pub async fn codex_models() -> Result<Vec<crate::codex::ModelInfo>, String> {
    tauri::async_runtime::spawn_blocking(crate::codex::list_models)
        .await
        .map_err(|e| format!("model catalog worker failed: {e}"))?
}

#[tauri::command]
pub fn get_settings() -> Value {
    store::get_settings()
}

#[tauri::command]
pub fn set_setting(key: String, value: Value) -> Result<(), String> {
    store::set_setting(&key, value)
}
