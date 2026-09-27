// The desktop window. In development it loads the Vite server, which also starts the local service.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Tawreed could not open its window");
}
