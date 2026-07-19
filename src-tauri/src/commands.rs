// Tauri commands — the only bridge between the webview and the host OS.
// The API key is read here, attached to the HTTP request here, and never crosses into JS.
use crate::store;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

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
pub async fn llm_complete(request: Value) -> Result<String, String> {
    let key = store::api_key()
        .ok_or("No Anthropic API key configured. Open Settings in Tawreed to add one.")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let mut last_err = String::new();
    for attempt in 0..2 {
        if attempt > 0 {
            tokio_sleep(2_000).await;
        }
        let result = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await;
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

async fn tokio_sleep(ms: u64) {
    // Avoid a direct tokio dependency: Tauri's async runtime provides one.
    tauri::async_runtime::spawn(async move {
        std::thread::sleep(Duration::from_millis(ms));
    })
    .await
    .ok();
}

#[tauri::command]
pub fn write_workbook(bytes_b64: String, filename: String) -> Result<String, String> {
    // Sanitize: file name only, must be .xlsx
    let name = std::path::Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid file name")?
        .to_string();
    if !name.to_lowercase().ends_with(".xlsx") {
        return Err("Output file must be an .xlsx workbook".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_b64)
        .map_err(|e| format!("decode workbook bytes: {e}"))?;

    let dir = store::output_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create output dir: {e}"))?;
    let requested = std::path::Path::new(&name);
    let stem = requested
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Tawreed-output");
    let extension = requested
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("xlsx");
    let mut final_path = dir.join(&name);
    for suffix in 1.. {
        if !final_path.exists() {
            break;
        }
        final_path = dir.join(format!("{stem}-{suffix}.{extension}"));
    }
    let final_name = final_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&name);
    let tmp_path = dir.join(format!(".{final_name}.tmp"));

    // Atomic-ish write: complete file to temp, then rename into place.
    std::fs::write(&tmp_path, &bytes).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp_path, &final_path).map_err(|e| format!("rename into place: {e}"))?;
    store::log_line(&format!(
        "workbook written: {final_name} ({} bytes)",
        bytes.len()
    ));
    Ok(final_path.to_string_lossy().to_string())
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

#[tauri::command]
pub fn reserve_revision(project_name: String) -> Result<RevisionReservation, String> {
    let project_name = safe_component(&project_name, 100);
    let project_dir = store::output_dir()?.join(&project_name);
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
        project_name,
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
    if artifacts.is_empty()
        || session.contains(['/', '\\'])
        || !session.starts_with(".tawreed-rev-")
        || !session.ends_with(".tmp")
    {
        return Err("Invalid revision session".into());
    }
    let project_name = safe_component(&project_name, 100);
    let project_dir = store::output_dir()?.join(&project_name);
    let temp = project_dir.join(&session);
    if !temp.is_dir() {
        return Err("Revision reservation no longer exists".into());
    }
    let final_dir = project_dir.join(format!("Rev {revision:02}"));
    if final_dir.exists() {
        return Err(format!("Rev {revision:02} already exists"));
    }

    let mut files = Vec::new();
    let mut master_relative: Option<String> = None;
    let write_result = (|| -> Result<(), String> {
        for artifact in artifacts {
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
            std::fs::rename(&tmp_file, &path)
                .map_err(|e| format!("publish generated workbook: {e}"))?;
            if artifact.kind == "master" {
                master_relative = Some(artifact.relative_path.clone());
            }
            files.push(artifact.relative_path);
        }
        if master_relative.is_none() {
            return Err("Generated bundle has no master workbook".into());
        }
        std::fs::rename(&temp, &final_dir).map_err(|e| format!("publish revision: {e}"))?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_dir_all(&temp);
        return Err(error);
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
        project_name,
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
    if session.contains(['/', '\\']) || !session.starts_with(".tawreed-rev-") {
        return Err("Invalid revision session".into());
    }
    let temp = store::output_dir()?
        .join(safe_component(&project_name, 100))
        .join(session);
    if temp.exists() {
        std::fs::remove_dir_all(temp).map_err(|e| format!("discard revision: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_input_file(path: String) -> Result<Value, String> {
    let path = std::path::Path::new(&path);
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_lowercase)
        .ok_or("The input file has no extension")?;
    if extension != "xlsx" && extension != "pdf" {
        return Err("Only .xlsx workbooks and PDF documents are supported".into());
    }
    let metadata = std::fs::metadata(path).map_err(|e| format!("read workbook metadata: {e}"))?;
    if !metadata.is_file() {
        return Err("The dropped path is not a file".into());
    }
    if metadata.len() > 100 * 1024 * 1024 {
        return Err("The input file is larger than the 100 MB limit".into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("read input file: {e}"))?;
    let valid = if extension == "pdf" {
        bytes.starts_with(b"%PDF-")
    } else {
        bytes.len() >= 4
            && bytes[0] == 0x50
            && bytes[1] == 0x4b
            && matches!(bytes[2], 0x03 | 0x05 | 0x07)
    };
    if !valid {
        return Err(format!(
            "The selected .{extension} file has an invalid file signature"
        ));
    }
    Ok(json!({
        "bytes": base64::engine::general_purpose::STANDARD.encode(bytes),
        "name": path.file_name().and_then(|name| name.to_str()).unwrap_or("input").to_string(),
        "mime": if extension == "pdf" { "application/pdf" } else { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    }))
}

#[tauri::command]
pub fn record_run(entry: Value) -> Result<i64, String> {
    let conn = store::open_db()?;
    conn.execute(
        "INSERT INTO runs (started_at, file_name, file_hash, item_count, package_count,
                           error_count, warning_count, output_file, duration_ms, llm_used,
                           project_name, revision, package_folder, source_kind, ocr_used)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
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
                    project_name, revision, package_folder, source_kind, ocr_used
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
            }))
        })
        .map_err(|e| format!("query runs: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("row: {e}"))?);
    }
    Ok(out)
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
            "https://github.com/sfkareem/tawreed",
            "https://kareemsafwat.com",
            "https://www.kareemsafwat.com/work",
        ] {
            assert!(approved_external_url(url).is_ok());
        }
        for url in [
            "http://github.com/sfkareem/tawreed",
            "https://github.com.evil.example/sfkareem/tawreed",
            "https://user:password@github.com/sfkareem/tawreed",
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
pub async fn codex_complete(prompt: String, model: Option<String>) -> Result<String, String> {
    // Codex is a long-running subprocess. Never block Tauri's UI thread while waiting for it.
    tauri::async_runtime::spawn_blocking(move || crate::codex::complete(&prompt, model.as_deref()))
        .await
        .map_err(|e| format!("codex worker failed: {e}"))?
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
