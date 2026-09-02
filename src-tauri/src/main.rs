#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod codex;
mod commands;
mod error_contract;
mod schema;
mod store;
mod update;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::set_api_key,
            commands::delete_api_key,
            commands::set_compatible_api_key,
            commands::delete_compatible_api_key,
            commands::set_gemini_api_key,
            commands::delete_gemini_api_key,
            commands::set_grok_api_key,
            commands::delete_grok_api_key,
            commands::llm_complete,
            commands::anthropic_test,
            commands::compatible_complete,
            commands::compatible_test,
            commands::gemini_complete,
            commands::gemini_test,
            commands::gemini_models,
            commands::grok_complete,
            commands::grok_test,
            commands::grok_models,
            commands::cancel_ai_job,
            commands::read_input_file,
            commands::reserve_revision,
            commands::write_revision_bundle,
            commands::discard_revision,
            commands::save_classification_memory,
            commands::list_classification_memory,
            commands::record_run,
            commands::list_run_classifications,
            commands::list_runs,
            commands::open_generated_folder,
            commands::open_logs_folder,
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
            update::check_for_update,
            update::open_update_release,
        ])
        .setup(|app| {
            // First-run bootstrap happens eagerly so ~/.tawreed exists before any command fires.
            let info = store::bootstrap_data_dir().map_err(|e| {
                eprintln!("[tawreed] bootstrap failed: {e}");
                e
            })?;
            app.manage(info);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tawreed");
}
