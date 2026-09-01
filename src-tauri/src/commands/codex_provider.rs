// Codex CLI provider (ChatGPT subscription, no API key) — thin command wrappers
// delegating to crate::codex.
use super::ai::{begin_ai_job, finish_ai_job};
use serde_json::Value;

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
