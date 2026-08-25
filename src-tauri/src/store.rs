// Local state: ~/.tawreed — created on first run, reused forever after.
// Layout:
//   ~/.tawreed/connections.json plaintext provider connections
//   ~/.tawreed/.env            legacy configuration (migration is handled separately)
//   ~/.tawreed/settings.json   non-secret app settings
//   ~/.tawreed/history.sqlite  run history
//   ~/.tawreed/output/         generated work-package workbooks
//   ~/.tawreed/logs/app.log    diagnostic log
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Clone)]
pub struct BootstrapInfo {
    pub first_run: bool,
    pub onboarding_required: bool,
    pub onboarding_step: String,
    pub data_dir: String,
    pub has_api_key: bool,
    pub has_compatible_key: bool,
    pub run_count: i64,
    pub version: String,
    /// "codex" | "anthropic" | "none" — resolved AI provider for this session.
    pub provider: String,
    pub provider_preference: String,
    pub codex_installed: bool,
    pub codex_authenticated: bool,
}

pub fn data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not resolve the user home directory")?;
    Ok(home.join(".tawreed"))
}

pub fn output_dir() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("output"))
}

fn db_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("history.sqlite"))
}

fn log_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("logs").join("app.log"))
}

pub fn bootstrap_data_dir() -> Result<BootstrapInfo, String> {
    let dir = data_dir()?;
    let data_dir_existed = dir.exists();
    fs::create_dir_all(dir.join("output")).map_err(|e| format!("create output dir: {e}"))?;
    fs::create_dir_all(dir.join("logs")).map_err(|e| format!("create logs dir: {e}"))?;
    // Interrupted generations remain hidden temp directories; remove them on the next launch.
    if let Ok(projects) = fs::read_dir(dir.join("output")) {
        for project in projects.flatten().filter(|entry| entry.path().is_dir()) {
            if let Ok(entries) = fs::read_dir(project.path()) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if entry.path().is_dir()
                        && name.starts_with(".tawreed-rev-")
                        && name.ends_with(".tmp")
                    {
                        let _ = fs::remove_dir_all(entry.path());
                    }
                }
            }
        }
    }

    let env_file = dir.join(".env");
    if !env_file.exists() {
        fs::write(
            &env_file,
            "# Tawreed local fallback configuration — this file stays on your machine.\n\
             # Keys saved in Settings use the operating system credential store when available.\n\
             # A manually supplied or compatibility fallback key can be placed here:\n\
             ANTHROPIC_API_KEY=\n",
        )
        .map_err(|e| format!("create .env template: {e}"))?;
        #[cfg(unix)]
        set_private_permissions(&env_file);
    }
    let settings = dir.join("settings.json");
    let settings_existed = settings.exists();
    let current_settings = fs::read_to_string(&settings)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let migrated_settings = migrate_settings(current_settings.clone(), !settings_existed);
    if !settings_existed || migrated_settings != current_settings {
        write_settings(&settings, &migrated_settings)
            .map_err(|e| format!("create or migrate settings: {e}"))?;
    }

    let conn = open_db()?;
    let run_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM runs", [], |r| r.get(0))
        .unwrap_or(0);

    let codex = crate::codex::detect(false);
    let has_key = api_key().is_some();
    let has_compatible_key = compatible_api_key().is_some();
    let settings_value = get_settings();
    let onboarding_step = settings_value
        .pointer("/onboarding/step")
        .and_then(serde_json::Value::as_str)
        .filter(|value| matches!(*value, "language" | "video" | "connection" | "complete"))
        .unwrap_or("complete")
        .to_string();
    let onboarding_required = onboarding_step != "complete";
    let processing_mode = settings_value
        .get("processingMode")
        .and_then(serde_json::Value::as_str)
        .filter(|value| matches!(*value, "ask" | "online" | "offline"))
        .unwrap_or("ask");
    let provider_preference = settings_value
        .get("activeProvider")
        .and_then(serde_json::Value::as_str)
        .filter(|value| matches!(*value, "codex" | "anthropic" | "compatible"))
        .unwrap_or("codex")
        .to_string();
    let provider = match provider_preference.as_str() {
        _ if processing_mode == "offline" => "none",
        "codex" if codex.installed && codex.authenticated => "codex",
        "anthropic" if has_key => "anthropic",
        "compatible" if has_compatible_key => "compatible",
        _ => "none",
    };

    log_line(if !data_dir_existed {
        "first run — data directory initialized"
    } else {
        "app started"
    });
    log_line(&format!(
        "provider resolved: {provider} (codex installed={}, authed={}, api key={has_key})",
        codex.installed, codex.authenticated
    ));

    Ok(BootstrapInfo {
        first_run: onboarding_required,
        onboarding_required,
        onboarding_step,
        data_dir: dir.to_string_lossy().to_string(),
        has_api_key: has_key,
        has_compatible_key,
        run_count,
        version: env!("CARGO_PKG_VERSION").to_string(),
        provider: provider.to_string(),
        provider_preference,
        codex_installed: codex.installed,
        codex_authenticated: codex.authenticated,
    })
}

fn migrate_settings(value: serde_json::Value, new_install: bool) -> serde_json::Value {
    let mut object = value.as_object().cloned().unwrap_or_default();
    let schema_version = object
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    if schema_version < 2 {
        let legacy_provider = object
            .get("provider")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("auto");
        let processing_mode = if legacy_provider == "offline" {
            "offline"
        } else {
            "ask"
        };
        let active_provider = match legacy_provider {
            "anthropic" => "anthropic",
            "codex" => "codex",
            _ => "codex",
        };
        object.insert("schemaVersion".into(), serde_json::json!(2));
        object.insert("processingMode".into(), serde_json::json!(processing_mode));
        object.insert("activeProvider".into(), serde_json::json!(active_provider));
        object.insert(
            "onboarding".into(),
            serde_json::json!({
                "version": 1,
                "step": if new_install { "language" } else { "complete" }
            }),
        );
        object.insert(
            "compatible".into(),
            serde_json::json!({ "baseUrl": "", "model": "" }),
        );
        object.remove("provider");
    }
    object
        .entry("language")
        .or_insert_with(|| serde_json::json!("en"));
    object
        .entry("theme")
        .or_insert_with(|| serde_json::json!("auto"));
    serde_json::Value::Object(object)
}

fn write_settings(path: &std::path::Path, settings: &serde_json::Value) -> Result<(), String> {
    let serialized =
        serde_json::to_string_pretty(settings).map_err(|e| format!("serialize settings: {e}"))?;
    let tmp = path.with_file_name("settings.json.tmp");
    std::fs::write(&tmp, serialized).map_err(|e| format!("write settings: {e}"))?;
    replace_file(&tmp, path).map_err(|e| format!("replace settings: {e}"))
}

pub fn open_db() -> Result<rusqlite::Connection, String> {
    let conn =
        rusqlite::Connection::open(db_path()?).map_err(|e| format!("open history db: {e}"))?;
    // A fresh connection is opened per call — wait on locks instead of surfacing
    // SQLITE_BUSY under concurrent commands, and let readers proceed during a write.
    conn.execute_batch("PRAGMA busy_timeout = 3000; PRAGMA journal_mode = WAL;")
        .map_err(|e| format!("configure history db: {e}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT NOT NULL,
            file_name TEXT NOT NULL,
            file_hash TEXT NOT NULL,
            item_count INTEGER NOT NULL,
            package_count INTEGER NOT NULL,
            error_count INTEGER NOT NULL,
            warning_count INTEGER NOT NULL,
            output_file TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            llm_used INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS classification_memory (
            project_name TEXT NOT NULL,
            description_key TEXT NOT NULL,
            package_code TEXT NOT NULL,
            package_name_en TEXT NOT NULL,
            package_name_ar TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (project_name, description_key)
        );",
    )
    .map_err(|e| format!("init history db: {e}"))?;
    migrate_runs_table(&conn)?;
    Ok(conn)
}

/// Additive migrations for installations created before project revisions and PDF support.
/// Inspect the schema itself instead of matching ALTER TABLE error strings — a genuine
/// failure must surface here, not be logged away while later INSERTs break opaquely.
fn migrate_runs_table(conn: &rusqlite::Connection) -> Result<(), String> {
    let existing: std::collections::HashSet<String> = {
        let mut stmt = conn
            .prepare("PRAGMA table_info(runs)")
            .map_err(|e| format!("inspect history db schema: {e}"))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| format!("inspect history db schema: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("inspect history db schema: {e}"))?;
        rows
    };
    for (column, migration) in [
        (
            "project_name",
            "ALTER TABLE runs ADD COLUMN project_name TEXT NOT NULL DEFAULT ''",
        ),
        (
            "revision",
            "ALTER TABLE runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "package_folder",
            "ALTER TABLE runs ADD COLUMN package_folder TEXT NOT NULL DEFAULT ''",
        ),
        (
            "source_kind",
            "ALTER TABLE runs ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'xlsx'",
        ),
        (
            "ocr_used",
            "ALTER TABLE runs ADD COLUMN ocr_used INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "provider",
            "ALTER TABLE runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'offline'",
        ),
        (
            "model",
            "ALTER TABLE runs ADD COLUMN model TEXT NOT NULL DEFAULT ''",
        ),
        (
            "trace_json",
            "ALTER TABLE runs ADD COLUMN trace_json TEXT NOT NULL DEFAULT '[]'",
        ),
        (
            "memory_applied",
            "ALTER TABLE runs ADD COLUMN memory_applied INTEGER NOT NULL DEFAULT 0",
        ),
    ] {
        if !existing.contains(column) {
            conn.execute(migration, [])
                .map_err(|e| format!("migrate history db ({column}): {e}"))?;
        }
    }
    Ok(())
}

pub fn api_key() -> Option<String> {
    let layout = crate::storage::DataLayout::discover().ok()?;
    crate::storage::connections::ConnectionStore::new(layout.connections)
        .secret("claude")
        .ok()
        .flatten()
}

/// Read settings.json (tolerant of absence/corruption).
pub fn get_settings() -> serde_json::Value {
    let path = match data_dir() {
        Ok(d) => d.join("settings.json"),
        Err(_) => return serde_json::json!({}),
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

/// Keys the frontend is allowed to persist. Anything else is rejected so a compromised
/// renderer can't scribble arbitrary entries into settings.json.
const ALLOWED_SETTINGS: &[&str] = &[
    "language",
    "model",
    "theme",
    "processingMode",
    "activeProvider",
    "onboarding",
    "compatible",
];

/// Merge one key into settings.json.
pub fn set_setting(key: &str, value: serde_json::Value) -> Result<(), String> {
    if !ALLOWED_SETTINGS.contains(&key) {
        return Err(format!("unknown setting: {key}"));
    }
    match key {
        "language" if !matches!(value.as_str(), Some("en" | "ar")) => {
            return Err("language must be 'en' or 'ar'".into());
        }
        "theme" if !matches!(value.as_str(), Some("auto" | "light" | "dark")) => {
            return Err("theme must be auto, light, or dark".into());
        }
        "processingMode" if !matches!(value.as_str(), Some("ask" | "online" | "offline")) => {
            return Err("processingMode must be ask, online, or offline".into());
        }
        "activeProvider"
            if !matches!(value.as_str(), Some("codex" | "anthropic" | "compatible")) =>
        {
            return Err("activeProvider must be codex, anthropic, or compatible".into());
        }
        "onboarding" => {
            let version = value.get("version").and_then(serde_json::Value::as_u64);
            let step = value.get("step").and_then(serde_json::Value::as_str);
            if version != Some(1)
                || !matches!(step, Some("language" | "video" | "connection" | "complete"))
            {
                return Err("invalid onboarding state".into());
            }
        }
        "compatible" => {
            let base_url = value.get("baseUrl").and_then(serde_json::Value::as_str);
            let model = value.get("model").and_then(serde_json::Value::as_str);
            if base_url.is_none_or(|text| text.len() > 2048)
                || model.is_none_or(|text| text.len() > 160)
            {
                return Err("invalid compatible provider settings".into());
            }
        }
        "model" if value.as_str().is_none_or(|text| text.len() > 160) => {
            return Err("invalid model setting".into());
        }
        _ => {}
    }
    let path = data_dir()?.join("settings.json");
    let mut settings = get_settings();
    if !settings.is_object() {
        settings = serde_json::json!({});
    }
    settings[key] = value;
    write_settings(&path, &settings)
}

/// Atomically replace a file where the platform supports it. Windows' standard
/// `rename` does not replace an existing destination, so use MoveFileExW with
/// REPLACE_EXISTING and WRITE_THROUGH for settings and managed binaries.
pub fn replace_file(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };

        let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        let moved = unsafe {
            MoveFileExW(
                from_wide.as_ptr(),
                to_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if moved == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
    #[cfg(not(windows))]
    {
        std::fs::rename(from, to)
    }
}

/// The .env holds the API key — it must be owner-only on Unix. `OpenOptions::mode` only
/// applies when a file is first created, so permissions are (re)applied explicitly here.
#[cfg(unix)]
fn set_private_permissions(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

pub fn write_env_key(value: Option<&str>) -> Result<(), String> {
    let layout = crate::storage::DataLayout::discover()?;
    let store = crate::storage::connections::ConnectionStore::new(layout.connections);
    match value {
        Some(secret) => store.upsert_api_key("claude", secret),
        None => store.remove("claude"),
    }
}

pub fn compatible_api_key() -> Option<String> {
    let layout = crate::storage::DataLayout::discover().ok()?;
    crate::storage::connections::ConnectionStore::new(layout.connections)
        .secret("compatible")
        .ok()
        .flatten()
}

pub fn write_compatible_api_key(value: Option<&str>) -> Result<(), String> {
    let layout = crate::storage::DataLayout::discover()?;
    let store = crate::storage::connections::ConnectionStore::new(layout.connections);
    match value {
        Some(secret) if !secret.trim().is_empty() => {
            store.upsert_api_key("compatible", secret.trim())
        }
        Some(_) => Err("Empty compatible provider key".into()),
        None => store.remove("compatible"),
    }
}

pub fn log_line(message: &str) {
    // Strip newlines so a caller-supplied message can't forge extra log lines.
    let sanitized = message.replace(['\n', '\r'], " ");
    if let Ok(path) = log_path() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if let Ok(meta) = std::fs::metadata(&path) {
            if meta.len() > 10 * 1024 * 1024 {
                let _ = std::fs::write(&path, ""); // truncate
            }
        }
        let _ = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map(|mut f| {
                use std::io::Write;
                let _ = writeln!(f, "[{stamp}] {sanitized}");
            });
    }
}

#[cfg(test)]
mod tests {
    use super::{migrate_runs_table, migrate_settings};

    #[test]
    fn migrations_add_only_missing_columns_and_are_idempotent() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT NOT NULL
            );",
        )
        .unwrap();
        migrate_runs_table(&conn).unwrap();
        // A second run must not trip over the columns it added the first time.
        migrate_runs_table(&conn).unwrap();
        let has_revision: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('runs') WHERE name = 'revision'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count == 1)
            .unwrap();
        assert!(has_revision);
    }

    #[test]
    fn new_install_starts_at_language_before_any_provider_setup() {
        let settings = migrate_settings(serde_json::json!({}), true);
        assert_eq!(settings["schemaVersion"], 2);
        assert_eq!(settings["onboarding"]["step"], "language");
        assert_eq!(settings["processingMode"], "ask");
    }

    #[test]
    fn existing_install_migrates_without_forcing_onboarding() {
        let settings = migrate_settings(
            serde_json::json!({
                "language": "ar",
                "provider": "offline"
            }),
            false,
        );
        assert_eq!(settings["language"], "ar");
        assert_eq!(settings["onboarding"]["step"], "complete");
        assert_eq!(settings["processingMode"], "offline");
    }

    #[test]
    fn interrupted_v2_onboarding_is_preserved() {
        let input = serde_json::json!({
            "schemaVersion": 2,
            "language": "en",
            "onboarding": { "version": 1, "step": "video" }
        });
        let migrated = migrate_settings(input, false);
        assert_eq!(migrated["onboarding"]["step"], "video");
        assert_eq!(migrated["theme"], "auto");
    }
}
