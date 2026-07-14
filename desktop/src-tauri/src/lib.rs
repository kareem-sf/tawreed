use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::{
    ShellExt,
    process::{CommandChild, CommandEvent},
};
use tokio::sync::Mutex;

const ENGINE_EVENT: &str = "tawreed://engine-event";
const MAX_COMMAND_BYTES: usize = 64 * 1024;
const EMBEDDED_ENGINE: &[u8] = include_bytes!(env!("TAWREED_ENGINE_BINARY"));
#[cfg(windows)]
const ENGINE_FILE_NAME: &str = "tawreed-engine.exe";
#[cfg(not(windows))]
const ENGINE_FILE_NAME: &str = "tawreed-engine";
const ALLOWED_COMMANDS: &[&str] = &[
    "health",
    "get_settings",
    "save_settings",
    "set_api_key",
    "get_history",
    "delete_history",
    "refresh_models",
    "test_connection",
    "start_run",
    "approve_run",
    "cancel_run",
    "shutdown",
];

struct ManagedEngine {
    child: CommandChild,
    extraction_dir: PathBuf,
}

#[derive(Clone, Default)]
struct EngineState {
    child: Arc<Mutex<Option<ManagedEngine>>>,
    generation: Arc<AtomicU64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineCommand {
    version: u8,
    #[serde(rename = "type")]
    kind: String,
    request_id: String,
    payload: Value,
}

fn emit_engine_value(app: &AppHandle, value: Value) {
    if let Err(error) = app.emit(ENGINE_EVENT, value) {
        eprintln!("could not emit Tawreed engine event: {error}");
    }
}

fn cleanup_engine_dir(path: &Path) {
    if let Err(error) = fs::remove_dir_all(path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            eprintln!("could not clean portable Tawreed engine files: {error}");
        }
    }
}

async fn cleanup_engine_dir_after_kill(path: PathBuf) {
    for attempt in 0..10 {
        match fs::remove_dir_all(&path) {
            Ok(()) => return,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) if attempt == 9 => {
                eprintln!("could not clean portable Tawreed engine files: {error}");
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
        }
    }
}

fn materialize_engine() -> Result<(PathBuf, PathBuf), String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let extraction_dir = std::env::temp_dir()
        .join("Tawreed")
        .join(format!("engine-{}-{nonce}", std::process::id()));
    fs::create_dir_all(&extraction_dir)
        .map_err(|error| format!("Could not create the portable engine directory: {error}"))?;

    #[cfg(unix)]
    if let Err(error) = fs::set_permissions(&extraction_dir, fs::Permissions::from_mode(0o700)) {
        cleanup_engine_dir(&extraction_dir);
        return Err(format!(
            "Could not secure the portable engine directory: {error}"
        ));
    }

    let engine_path = extraction_dir.join(ENGINE_FILE_NAME);
    if let Err(error) = fs::write(&engine_path, EMBEDDED_ENGINE) {
        cleanup_engine_dir(&extraction_dir);
        return Err(format!(
            "Could not unpack the portable Tawreed engine: {error}"
        ));
    }

    #[cfg(unix)]
    if let Err(error) = fs::set_permissions(&engine_path, fs::Permissions::from_mode(0o700)) {
        cleanup_engine_dir(&extraction_dir);
        return Err(format!(
            "Could not make the portable engine executable: {error}"
        ));
    }

    Ok((engine_path, extraction_dir))
}

async fn spawn_engine(app: &AppHandle, state: &EngineState) -> Result<(), String> {
    let mut guard = state.child.lock().await;
    if guard.is_some() {
        return Ok(());
    }

    let (engine_path, extraction_dir) = materialize_engine()?;
    let spawned = app.shell().command(&engine_path).spawn();
    let (mut receiver, child) = match spawned {
        Ok(value) => value,
        Err(error) => {
            cleanup_engine_dir(&extraction_dir);
            return Err(format!("Could not start the Tawreed engine: {error}"));
        }
    };
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *guard = Some(ManagedEngine {
        child,
        extraction_dir,
    });
    drop(guard);

    let event_app = app.clone();
    let event_state = state.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => match serde_json::from_slice::<Value>(&bytes) {
                    Ok(value) => emit_engine_value(&event_app, value),
                    Err(error) => eprintln!("discarded invalid engine output: {error}"),
                },
                CommandEvent::Stderr(bytes) => {
                    let message = String::from_utf8_lossy(&bytes);
                    eprintln!("Tawreed engine: {message}");
                }
                CommandEvent::Terminated(payload) => {
                    if event_state.generation.load(Ordering::SeqCst) == generation {
                        if let Some(engine) = event_state.child.lock().await.take() {
                            cleanup_engine_dir(&engine.extraction_dir);
                        }
                        emit_engine_value(
                            &event_app,
                            json!({
                                "version": 1,
                                "kind": "engine_stopped",
                                "payload": { "code": payload.code, "signal": payload.signal }
                            }),
                        );
                    }
                    break;
                }
                CommandEvent::Error(error) => {
                    eprintln!("Tawreed engine process error: {error}");
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn engine_start(app: AppHandle, state: State<'_, EngineState>) -> Result<(), String> {
    spawn_engine(&app, state.inner()).await
}

#[tauri::command]
async fn engine_send(
    app: AppHandle,
    state: State<'_, EngineState>,
    command: EngineCommand,
) -> Result<(), String> {
    if command.version != 1 {
        return Err("Unsupported Tawreed engine protocol version.".into());
    }
    if !ALLOWED_COMMANDS.contains(&command.kind.as_str()) {
        return Err("That engine command is not permitted.".into());
    }
    if command.request_id.is_empty() || command.request_id.len() > 128 {
        return Err("Invalid engine request id.".into());
    }
    let mut bytes = serde_json::to_vec(&command)
        .map_err(|error| format!("Could not encode the engine command: {error}"))?;
    if bytes.len() > MAX_COMMAND_BYTES {
        return Err("The engine command exceeds the safe size limit.".into());
    }
    bytes.push(b'\n');

    spawn_engine(&app, state.inner()).await?;
    let mut guard = state.child.lock().await;
    let child = guard
        .as_mut()
        .ok_or_else(|| "The Tawreed engine is not running.".to_string())?;
    child
        .child
        .write(&bytes)
        .map_err(|error| format!("Could not send the engine command: {error}"))
}

#[tauri::command]
async fn engine_cancel(app: AppHandle, state: State<'_, EngineState>) -> Result<(), String> {
    state.generation.fetch_add(1, Ordering::SeqCst);
    let child = state.child.lock().await.take();
    if let Some(mut engine) = child {
        let cancel = json!({
            "version": 1,
            "type": "cancel_run",
            "requestId": "native-host-cancel",
            "payload": {}
        });
        let mut bytes = serde_json::to_vec(&cancel).map_err(|error| error.to_string())?;
        bytes.push(b'\n');
        let _ = engine.child.write(&bytes);
        tokio::time::sleep(Duration::from_millis(350)).await;
        let kill_result = engine.child.kill();
        cleanup_engine_dir_after_kill(engine.extraction_dir).await;
        kill_result.map_err(|error| format!("Could not terminate the Tawreed engine: {error}"))?;
    }

    emit_engine_value(
        &app,
        json!({ "version": 1, "kind": "cancelled", "payload": {} }),
    );
    spawn_engine(&app, state.inner()).await
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(EngineState::default())
        .invoke_handler(tauri::generate_handler![
            engine_start,
            engine_send,
            engine_cancel
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<EngineState>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(engine) = state.child.lock().await.take() {
                        let _ = engine.child.kill();
                        cleanup_engine_dir_after_kill(engine.extraction_dir).await;
                    }
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Tawreed");
}
