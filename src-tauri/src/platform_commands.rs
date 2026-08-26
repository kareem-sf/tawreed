use crate::agent::AgentSupervisor;
use crate::runtime::{RuntimeBootstrapStatus, RuntimeManager};
use crate::storage::connections::{ConnectionStore, ConnectionSummary};
use crate::storage::projects::{Checkpoint, ProjectStore, ProjectSummary};
use crate::storage::DataLayout;
use serde_json::Value;
use tauri::Emitter;

const RUNTIME_PROGRESS_EVENT: &str = "runtime://progress";

#[tauri::command]
pub async fn runtime_status(
    manager: tauri::State<'_, RuntimeManager>,
) -> Result<RuntimeBootstrapStatus, String> {
    Ok(manager.status().await)
}

#[tauri::command]
pub async fn runtime_start(
    app: tauri::AppHandle,
    manager: tauri::State<'_, RuntimeManager>,
) -> Result<RuntimeBootstrapStatus, String> {
    let progress_app = app.clone();
    manager
        .start(move |status| {
            let _ = progress_app.emit(RUNTIME_PROGRESS_EVENT, status);
        })
        .await
}

#[tauri::command]
pub async fn runtime_retry(
    app: tauri::AppHandle,
    manager: tauri::State<'_, RuntimeManager>,
) -> Result<RuntimeBootstrapStatus, String> {
    let progress_app = app.clone();
    manager
        .retry(move |status| {
            let _ = progress_app.emit(RUNTIME_PROGRESS_EVENT, status);
        })
        .await
}

#[tauri::command]
pub fn list_connections() -> Result<Vec<ConnectionSummary>, String> {
    let layout = DataLayout::discover()?;
    ConnectionStore::new(layout.connections).summaries()
}

#[tauri::command]
pub fn save_api_key_connection(provider: String, api_key: String) -> Result<(), String> {
    let layout = DataLayout::discover()?;
    ConnectionStore::new(layout.connections).upsert_api_key(&provider, api_key.trim())
}

#[tauri::command]
pub fn delete_connection(provider: String) -> Result<(), String> {
    let layout = DataLayout::discover()?;
    ConnectionStore::new(layout.connections).remove(&provider)
}

#[tauri::command]
pub fn create_project(name: String) -> Result<ProjectSummary, String> {
    let layout = DataLayout::discover()?;
    ProjectStore::new(layout.projects).create(&name)
}

#[tauri::command]
pub fn list_projects() -> Result<Vec<ProjectSummary>, String> {
    let layout = DataLayout::discover()?;
    ProjectStore::new(layout.projects).list()
}

#[tauri::command]
pub fn latest_project_checkpoint(project_id: String) -> Result<Option<Checkpoint>, String> {
    let layout = DataLayout::discover()?;
    ProjectStore::new(layout.projects).latest_checkpoint(&project_id)
}

#[tauri::command]
pub async fn agent_health(supervisor: tauri::State<'_, AgentSupervisor>) -> Result<Value, String> {
    supervisor.health().await
}

#[tauri::command]
pub async fn agent_request(
    supervisor: tauri::State<'_, AgentSupervisor>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    if !matches!(
        method.as_str(),
        "connections.status" | "sessions.start" | "sessions.resume" | "turns.run"
    ) {
        return Err("agent_method_not_allowed".into());
    }
    supervisor.request(&method, params).await
}

#[tauri::command]
pub async fn agent_cancel(
    supervisor: tauri::State<'_, AgentSupervisor>,
    run_id: String,
) -> Result<Value, String> {
    supervisor.cancel(&run_id).await
}
