#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod agent;
mod codex;
mod commands;
mod platform_commands;
pub mod runtime;
pub mod storage;
mod store;
mod update;

use tauri::{Emitter, Manager};

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::set_api_key,
            commands::delete_api_key,
            commands::set_compatible_api_key,
            commands::delete_compatible_api_key,
            commands::llm_complete,
            commands::compatible_complete,
            commands::compatible_test,
            commands::cancel_ai_job,
            commands::read_input_file,
            commands::reserve_revision,
            commands::write_revision_bundle,
            commands::discard_revision,
            commands::save_classification_memory,
            commands::list_classification_memory,
            commands::record_run,
            commands::list_runs,
            commands::open_output_folder,
            commands::open_generated_folder,
            commands::open_workbook,
            commands::open_url,
            commands::app_log,
            commands::codex_status,
            commands::codex_install,
            commands::codex_login,
            commands::codex_complete,
            commands::codex_models,
            commands::get_settings,
            commands::set_setting,
            platform_commands::runtime_status,
            platform_commands::runtime_start,
            platform_commands::runtime_retry,
            platform_commands::list_connections,
            platform_commands::save_api_key_connection,
            platform_commands::delete_connection,
            platform_commands::codex_login_chatgpt,
            platform_commands::codex_login_api_key,
            platform_commands::create_project,
            platform_commands::list_projects,
            platform_commands::latest_project_checkpoint,
            platform_commands::agent_health,
            platform_commands::agent_request,
            platform_commands::agent_cancel,
            update::check_for_update,
            update::open_update_release,
        ])
        .setup(|app| {
            // First-run bootstrap happens eagerly so ~/.tawreed exists before any command fires.
            let info = store::bootstrap_data_dir().map_err(|e| {
                eprintln!("[tawreed] bootstrap failed: {e}");
                e
            })?;
            let layout = storage::DataLayout::discover().map_err(|error| {
                eprintln!("[tawreed] runtime layout failed: {error}");
                "runtime_internal_error".to_string()
            })?;
            let runtime_manager =
                runtime::RuntimeManager::new(layout.clone()).map_err(|error| {
                    eprintln!("[tawreed] runtime manager failed: {error}");
                    "runtime_internal_error".to_string()
                })?;
            app.manage(runtime_manager);
            let events_app = app.handle().clone();
            let agent_runtime = runtime::RuntimeManager::new(layout.clone()).map_err(|error| {
                eprintln!("[tawreed] runtime manager failed: {error}");
                "runtime_internal_error".to_string()
            })?;
            let supervisor = agent::AgentSupervisor::new(
                env!("CARGO_PKG_VERSION").to_string(),
                layout.root,
                Box::new(agent::StandardKernelLauncher::new(agent_runtime)),
                std::sync::Arc::new(move |event| {
                    let _ = events_app.emit("agent://event", event);
                }),
            );
            app.manage(supervisor);
            app.manage(info);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tawreed");
}
