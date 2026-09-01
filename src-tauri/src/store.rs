// Local state: ~/.tawreed — created on first run, reused forever after.
// Layout:
//   OS credential store        Anthropic API key (preferred)
//   ~/.tawreed/.env            owner-only fallback/legacy key storage
//   ~/.tawreed/settings.json   non-secret app settings
//   ~/.tawreed/history.sqlite  run history
//   ~/.tawreed/output/         generated work-package workbooks
//   ~/.tawreed/logs/app.log    diagnostic log
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use ts_rs::TS;

#[derive(Serialize, Clone, TS)]
#[ts(export, export_to = "../../src/bridge-types/")]
pub struct BootstrapInfo {
    pub first_run: bool,
    pub onboarding_required: bool,
    pub onboarding_step: String,
    pub data_dir: String,
    pub has_api_key: bool,
    pub has_compatible_key: bool,
    pub has_gemini_key: bool,
    pub has_grok_key: bool,
    // ts-rs maps i64 to bigint for precision, but Tauri serializes it as a JSON number
    // and a run count will never approach 2^53, so the webview sees a plain number.
    #[ts(type = "number")]
    pub run_count: i64,
    pub version: String,
    /// "codex" | "anthropic" | "compatible" | "gemini" | "grok" | "none" — resolved AI provider for this session.
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

fn env_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(".env"))
}

fn db_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("history.sqlite"))
}

pub fn log_path() -> Result<PathBuf, String> {
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
    let has_gemini_key = gemini_api_key().is_some();
    let has_grok_key = grok_api_key().is_some();
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
        .filter(|value| {
            matches!(
                *value,
                "codex" | "anthropic" | "compatible" | "gemini" | "grok"
            )
        })
        .unwrap_or("codex")
        .to_string();
    let provider = match provider_preference.as_str() {
        _ if processing_mode == "offline" => "none",
        "codex" if codex.installed && codex.authenticated => "codex",
        "anthropic" if has_key => "anthropic",
        "compatible" if has_compatible_key => "compatible",
        "gemini" if has_gemini_key => "gemini",
        "grok" if has_grok_key => "grok",
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
        has_gemini_key,
        has_grok_key,
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

const KEYRING_SERVICE: &str = "com.tawreed.desktop";
const KEYRING_ACCOUNT: &str = "anthropic-api-key";
const COMPATIBLE_KEYRING_ACCOUNT: &str = "compatible-provider-api-key";
const GEMINI_KEYRING_ACCOUNT: &str = "gemini-api-key";
const GROK_KEYRING_ACCOUNT: &str = "grok-api-key";

fn credential_entry_for(account: &str) -> Result<keyring::v1::Entry, String> {
    keyring::v1::Entry::new(KEYRING_SERVICE, account)
        .map_err(|error| format!("open operating system credential store: {error}"))
}

fn credential_entry() -> Result<keyring::v1::Entry, String> {
    credential_entry_for(KEYRING_ACCOUNT)
}

fn legacy_file_api_key() -> Option<String> {
    let path = env_path().ok()?;
    let iter = dotenvy::from_path_iter(path).ok()?;
    for pair in iter.flatten() {
        if pair.0 == "ANTHROPIC_API_KEY" && !pair.1.trim().is_empty() {
            return Some(pair.1.trim().to_string());
        }
    }
    None
}

/// API key resolution order: process env -> OS credential store -> legacy private file.
/// A legacy file key is migrated into secure storage opportunistically.
pub fn api_key() -> Option<String> {
    if let Ok(k) = std::env::var("ANTHROPIC_API_KEY") {
        if !k.trim().is_empty() {
            return Some(k.trim().to_string());
        }
    }
    if let Ok(entry) = credential_entry() {
        match entry.get_password() {
            Ok(key) if !key.trim().is_empty() => return Some(key.trim().to_string()),
            Ok(_) | Err(keyring::v1::Error::NoEntry) => {}
            Err(error) => {
                log_line(&format!("credential store read unavailable: {error}"));
            }
        }
    }
    let legacy = legacy_file_api_key()?;
    if let Ok(entry) = credential_entry() {
        if entry.set_password(&legacy).is_ok() && write_env_file_key(None).is_ok() {
            log_line("migrated Anthropic API key to operating system credential store");
        }
    }
    Some(legacy)
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
    "gemini",
    "grok",
];

/// Pure validation, split out from `set_setting` so it's testable without touching disk.
fn validate_setting(key: &str, value: &serde_json::Value) -> Result<(), String> {
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
            if !matches!(
                value.as_str(),
                Some("codex" | "anthropic" | "compatible" | "gemini" | "grok")
            ) =>
        {
            return Err(
                "activeProvider must be codex, anthropic, compatible, gemini, or grok".into(),
            );
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
        "gemini" | "grok" => {
            let model = value.get("model").and_then(serde_json::Value::as_str);
            if model.is_none_or(|text| text.len() > 160) {
                return Err(format!("invalid {key} settings"));
            }
        }
        _ => {}
    }
    Ok(())
}

/// Merge one key into settings.json.
pub fn set_setting(key: &str, value: serde_json::Value) -> Result<(), String> {
    validate_setting(key, &value)?;
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

/// Rewrite .env content, replacing the ANTHROPIC_API_KEY line with the canonical
/// `ANTHROPIC_API_KEY=value` form. An optional leading `export ` is tolerated (dotenvy
/// honors it too) so a pasted shell-style line is rewritten in place instead of ending
/// up duplicated by an appended canonical line.
fn rewrite_env_key(content: &str, value: Option<&str>) -> String {
    let mut replaced = false;
    let mut lines: Vec<String> = content
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            let entry = trimmed.strip_prefix("export ").unwrap_or(trimmed);
            if entry.starts_with("ANTHROPIC_API_KEY=") {
                replaced = true;
                format!("ANTHROPIC_API_KEY={}", value.unwrap_or(""))
            } else {
                line.to_string()
            }
        })
        .collect();
    if !replaced {
        lines.push(format!("ANTHROPIC_API_KEY={}", value.unwrap_or("")));
    }
    lines.join("\n") + "\n"
}

/// Read-modify-write ~/.tawreed/.env, preserving unrelated lines and comments.
fn write_env_file_key(value: Option<&str>) -> Result<(), String> {
    let path = env_path()?;
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let content = rewrite_env_key(&existing, value);
    // The .env holds the API key — on Unix it must never be world-readable. mode(0o600)
    // covers a freshly created file; set_private_permissions fixes one created earlier
    // with looser permissions (mode() is a no-op unless the file is being created).
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .and_then(|mut f| std::io::Write::write_all(&mut f, content.as_bytes()))
            .map_err(|e| format!("write .env: {e}"))?;
        set_private_permissions(&path);
    }
    #[cfg(not(unix))]
    {
        fs::write(&path, &content).map_err(|e| format!("write .env: {e}"))?;
    }
    Ok(())
}

/// Persist the API key in the native OS credential store. Headless Linux systems may
/// have no Secret Service; in that case retain the owner-only file fallback.
pub fn write_env_key(value: Option<&str>) -> Result<(), String> {
    match value {
        Some(secret) => match credential_entry().and_then(|entry| {
            entry.set_password(secret).map_err(|error| {
                format!("save API key in operating system credential store: {error}")
            })
        }) {
            Ok(()) => {
                write_env_file_key(None)?;
                log_line("Anthropic API key stored in operating system credential store");
                Ok(())
            }
            Err(error) => {
                log_line(&format!(
                    "credential store unavailable; using private file fallback: {error}"
                ));
                write_env_file_key(Some(secret))
            }
        },
        None => {
            // Always clear the fallback file even if the platform store is currently locked.
            write_env_file_key(None)?;
            match credential_entry() {
                Ok(entry) => match entry.delete_credential() {
                    Ok(()) | Err(keyring::v1::Error::NoEntry) => Ok(()),
                    Err(error) => Err(format!(
                        "remove API key from operating system credential store: {error}"
                    )),
                },
                Err(error) => {
                    log_line(&format!(
                        "credential store unavailable during key removal: {error}"
                    ));
                    Ok(())
                }
            }
        }
    }
}

pub fn compatible_api_key() -> Option<String> {
    if let Ok(key) = std::env::var("TAWREED_COMPATIBLE_API_KEY") {
        if !key.trim().is_empty() {
            return Some(key.trim().to_string());
        }
    }
    let entry = credential_entry_for(COMPATIBLE_KEYRING_ACCOUNT).ok()?;
    entry
        .get_password()
        .ok()
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
}

pub fn write_compatible_api_key(value: Option<&str>) -> Result<(), String> {
    let entry = credential_entry_for(COMPATIBLE_KEYRING_ACCOUNT)?;
    match value {
        Some(secret) if !secret.trim().is_empty() => entry
            .set_password(secret.trim())
            .map_err(|error| format!("save compatible provider key: {error}")),
        Some(_) => Err("Empty compatible provider key".into()),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::v1::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("remove compatible provider key: {error}")),
        },
    }
}

fn named_api_key(account: &str, env_var: &str) -> Option<String> {
    if let Ok(key) = std::env::var(env_var) {
        if !key.trim().is_empty() {
            return Some(key.trim().to_string());
        }
    }
    let entry = credential_entry_for(account).ok()?;
    entry
        .get_password()
        .ok()
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
}

fn write_named_api_key(account: &str, label: &str, value: Option<&str>) -> Result<(), String> {
    let entry = credential_entry_for(account)?;
    match value {
        Some(secret) if !secret.trim().is_empty() => entry
            .set_password(secret.trim())
            .map_err(|error| format!("save {label} key: {error}")),
        Some(_) => Err(format!("Empty {label} key")),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::v1::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("remove {label} key: {error}")),
        },
    }
}

pub fn gemini_api_key() -> Option<String> {
    named_api_key(GEMINI_KEYRING_ACCOUNT, "TAWREED_GEMINI_API_KEY")
}

pub fn write_gemini_api_key(value: Option<&str>) -> Result<(), String> {
    write_named_api_key(GEMINI_KEYRING_ACCOUNT, "Gemini", value)
}

pub fn grok_api_key() -> Option<String> {
    named_api_key(GROK_KEYRING_ACCOUNT, "TAWREED_GROK_API_KEY")
}

pub fn write_grok_api_key(value: Option<&str>) -> Result<(), String> {
    write_named_api_key(GROK_KEYRING_ACCOUNT, "Grok", value)
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
                // Rotate instead of truncating so a crash right after the threshold
                // doesn't wipe the evidence needed to diagnose it.
                let rotated = path.with_extension("log.1");
                let _ = std::fs::rename(&path, &rotated);
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
    use super::{migrate_runs_table, migrate_settings, rewrite_env_key, validate_setting};

    #[test]
    fn every_provider_can_be_saved_as_the_active_provider() {
        for provider in ["codex", "anthropic", "compatible", "gemini", "grok"] {
            assert!(
                validate_setting("activeProvider", &serde_json::json!(provider)).is_ok(),
                "activeProvider should accept {provider}",
            );
        }
        assert!(validate_setting("activeProvider", &serde_json::json!("bogus")).is_err());
    }

    #[test]
    fn every_named_provider_settings_key_is_allowed_and_validated() {
        for provider in ["gemini", "grok"] {
            assert!(
                validate_setting(provider, &serde_json::json!({ "model": "some-model" })).is_ok(),
                "{provider} settings should be accepted",
            );
            assert!(
                validate_setting(provider, &serde_json::json!({ "model": "x".repeat(161) }))
                    .is_err(),
                "{provider} should reject an overlong model name",
            );
        }
    }

    #[test]
    fn rewrite_env_key_rewrites_plain_and_export_lines_in_canonical_form() {
        let out = rewrite_env_key(
            "# comment\nANTHROPIC_API_KEY=old\nexport ANTHROPIC_API_KEY=older\nOTHER=1\n",
            Some("new"),
        );
        assert_eq!(
            out,
            "# comment\nANTHROPIC_API_KEY=new\nANTHROPIC_API_KEY=new\nOTHER=1\n"
        );
    }

    #[test]
    fn rewrite_env_key_ignores_comments_and_appends_when_missing() {
        let out = rewrite_env_key("# ANTHROPIC_API_KEY=commented\n", None);
        assert_eq!(out, "# ANTHROPIC_API_KEY=commented\nANTHROPIC_API_KEY=\n");
    }

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
