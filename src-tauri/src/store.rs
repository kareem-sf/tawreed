// Local state: ~/.tawreed — created on first run, reused forever after.
// Layout:
//   ~/.tawreed/.env            API keys (user-managed; ANTHROPIC_API_KEY=...)
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
    pub data_dir: String,
    pub has_api_key: bool,
    pub run_count: i64,
    pub version: String,
    /// "codex" | "anthropic" | "none" — resolved AI provider for this session.
    pub provider: String,
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

fn log_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("logs").join("app.log"))
}

pub fn bootstrap_data_dir() -> Result<BootstrapInfo, String> {
    let dir = data_dir()?;
    let first_run = !dir.exists();
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
            "# Tawreed local configuration — this file stays on your machine.\n\
             # Get a key at https://console.anthropic.com/ then save via the app Settings,\n\
             # or paste it here directly:\n\
             ANTHROPIC_API_KEY=\n",
        )
        .map_err(|e| format!("create .env template: {e}"))?;
    }
    let settings = dir.join("settings.json");
    if !settings.exists() {
        fs::write(&settings, "{\n  \"locale\": \"en\"\n}\n")
            .map_err(|e| format!("create settings: {e}"))?;
    }

    let conn = open_db()?;
    let run_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM runs", [], |r| r.get(0))
        .unwrap_or(0);

    let codex = crate::codex::detect(false);
    let has_key = api_key().is_some();
    let provider = if codex.installed && codex.authenticated {
        "codex"
    } else if has_key {
        "anthropic"
    } else {
        "none"
    };

    log_line(if first_run {
        "first run — data directory initialized"
    } else {
        "app started"
    });
    log_line(&format!(
        "provider resolved: {provider} (codex installed={}, authed={}, api key={has_key})",
        codex.installed, codex.authenticated
    ));

    Ok(BootstrapInfo {
        first_run,
        data_dir: dir.to_string_lossy().to_string(),
        has_api_key: has_key,
        run_count,
        version: env!("CARGO_PKG_VERSION").to_string(),
        provider: provider.to_string(),
        codex_installed: codex.installed,
        codex_authenticated: codex.authenticated,
    })
}

pub fn open_db() -> Result<rusqlite::Connection, String> {
    let conn =
        rusqlite::Connection::open(db_path()?).map_err(|e| format!("open history db: {e}"))?;
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
        );",
    )
    .map_err(|e| format!("init history db: {e}"))?;
    // Additive migration for installations created before project revisions and PDF support.
    for migration in [
        "ALTER TABLE runs ADD COLUMN project_name TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE runs ADD COLUMN package_folder TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE runs ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'xlsx'",
        "ALTER TABLE runs ADD COLUMN ocr_used INTEGER NOT NULL DEFAULT 0",
    ] {
        let _ = conn.execute(migration, []);
    }
    Ok(conn)
}

/// API key resolution order: process env → ~/.tawreed/.env
pub fn api_key() -> Option<String> {
    if let Ok(k) = std::env::var("ANTHROPIC_API_KEY") {
        if !k.trim().is_empty() {
            return Some(k.trim().to_string());
        }
    }
    let path = env_path().ok()?;
    let iter = dotenvy::from_path_iter(path).ok()?;
    for pair in iter.flatten() {
        if pair.0 == "ANTHROPIC_API_KEY" && !pair.1.trim().is_empty() {
            return Some(pair.1.trim().to_string());
        }
    }
    None
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

/// Merge one key into settings.json.
pub fn set_setting(key: &str, value: serde_json::Value) -> Result<(), String> {
    let path = data_dir()?.join("settings.json");
    let mut settings = get_settings();
    if !settings.is_object() {
        settings = serde_json::json!({});
    }
    settings[key] = value;
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&settings).unwrap_or_else(|_| "{}".into()),
    )
    .map_err(|e| format!("write settings: {e}"))
}

/// Read-modify-write ~/.tawreed/.env, preserving unrelated lines and comments.
pub fn write_env_key(value: Option<&str>) -> Result<(), String> {
    let path = env_path()?;
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mut replaced = false;
    let mut lines: Vec<String> = existing
        .lines()
        .map(|line| {
            if line.starts_with("ANTHROPIC_API_KEY=") {
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
    fs::write(&path, lines.join("\n") + "\n").map_err(|e| format!("write .env: {e}"))
}

pub fn log_line(message: &str) {
    if let Ok(path) = log_path() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map(|mut f| {
                use std::io::Write;
                let _ = writeln!(f, "[{stamp}] {message}");
            });
    }
}
