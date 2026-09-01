// Tauri commands — the only bridge between the webview and the host OS.
// The API key is read here, attached to the HTTP request here, and never crosses into JS.
//
// Split by domain into submodules; every #[tauri::command] function keeps its original
// name and is re-exported here unchanged so `commands::function_name` paths in main.rs
// continue to work without modification. Glob re-exports are required (not explicit
// named ones) because the `#[tauri::command]` macro attaches hidden sibling items
// (e.g. `__cmd__foo`) next to each function that `tauri::generate_handler!` also needs
// to resolve at `commands::foo`.
mod ai;
mod codex_provider;
mod credentials;
mod history;
mod revisions;
mod system;

pub use ai::*;
pub use codex_provider::*;
pub use credentials::*;
pub use history::*;
pub use revisions::*;
pub use system::*;
