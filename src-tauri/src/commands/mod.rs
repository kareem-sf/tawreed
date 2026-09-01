// Tauri commands — the only bridge between the webview and the host OS.
// The API key is read here, attached to the HTTP request here, and never crosses into JS.
//
// Split by domain into submodules; every #[tauri::command] function keeps its original
// name and is re-exported here unchanged so `commands::function_name` paths in main.rs
// continue to work without modification.
mod ai;
mod codex_provider;
mod credentials;
mod history;
mod revisions;
mod system;

pub use ai::{
    cancel_ai_job, compatible_complete, compatible_test, gemini_complete, gemini_models,
    gemini_test, grok_complete, grok_models, grok_test, llm_complete,
};
pub use codex_provider::{
    codex_complete, codex_install, codex_login, codex_models, codex_status,
};
pub use credentials::{
    delete_api_key, delete_compatible_api_key, delete_gemini_api_key, delete_grok_api_key,
    set_api_key, set_compatible_api_key, set_gemini_api_key, set_grok_api_key,
};
pub use history::{
    list_classification_memory, list_runs, record_run, save_classification_memory,
    ClassificationMemoryEntry,
};
pub use revisions::{
    discard_revision, reserve_revision, write_revision_bundle, RevisionArtifact,
    RevisionOutput, RevisionReservation,
};
pub use system::{
    app_log, bootstrap, get_settings, open_generated_folder, open_logs_folder,
    open_output_folder, open_url, open_workbook, read_input_file, set_setting,
};
