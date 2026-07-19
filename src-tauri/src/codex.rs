// Codex CLI provider — uses the user's ChatGPT subscription via the official Codex CLI.
// Auth is OAuth handled by the CLI itself (~/.codex/auth.json); Tawreed never sees tokens.
use crate::store;
use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const EXEC_TIMEOUT_SECS: u64 = 240;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Spawn a process with NO console window — a GUI app must never flash terminals.
pub fn quiet_command<P: AsRef<std::ffi::OsStr>>(program: P) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

// Detection is expensive (probing a 325MB exe) — cache it; explicit status checks bypass.
static DETECT_CACHE: std::sync::Mutex<Option<CodexStatus>> = std::sync::Mutex::new(None);

pub fn invalidate_cache() {
    if let Ok(mut guard) = DETECT_CACHE.lock() {
        *guard = None;
    }
}

#[derive(Serialize, Clone)]
pub struct CodexStatus {
    pub installed: bool,
    pub authenticated: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ModelInfo {
    pub slug: String,
    pub display_name: String,
    pub description: String,
    pub default_reasoning_level: Option<String>,
}

// Model catalog cache — `codex debug models` costs a process spawn + 280KB parse.
static MODELS_CACHE: std::sync::Mutex<Option<(Instant, Vec<ModelInfo>)>> =
    std::sync::Mutex::new(None);
const MODELS_TTL_SECS: u64 = 300;

/// Live model catalog for the signed-in subscription, via the CLI's own debug surface.
pub fn list_models() -> Result<Vec<ModelInfo>, String> {
    if let Ok(guard) = MODELS_CACHE.lock() {
        if let Some((at, models)) = guard.as_ref() {
            if at.elapsed() < Duration::from_secs(MODELS_TTL_SECS) {
                return Ok(models.clone());
            }
        }
    }
    let status = detect(false);
    let exe = status.path.ok_or("Codex CLI not installed")?;
    let out = quiet_command(exe)
        .args(["debug", "models"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("spawn codex debug models: {e}"))?;
    if !out.status.success() {
        return Err("codex debug models failed — is the CLI signed in?".into());
    }
    let parsed: Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("parse model catalog: {e}"))?;
    let mut models: Vec<(i64, ModelInfo)> = parsed
        .get("models")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter(|m| m.get("visibility").and_then(Value::as_str) == Some("list"))
                .filter_map(|m| {
                    Some((
                        m.get("priority").and_then(Value::as_i64).unwrap_or(999),
                        ModelInfo {
                            slug: m.get("slug").and_then(Value::as_str)?.to_string(),
                            display_name: m
                                .get("display_name")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            description: m
                                .get("description")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            default_reasoning_level: m
                                .get("default_reasoning_level")
                                .and_then(Value::as_str)
                                .map(str::to_string),
                        },
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    models.sort_by_key(|(p, _)| *p);
    let out_models: Vec<ModelInfo> = models.into_iter().map(|(_, m)| m).collect();
    if out_models.is_empty() {
        return Err("model catalog was empty".into());
    }
    store::log_line(&format!(
        "model catalog fetched: {} models",
        out_models.len()
    ));
    if let Ok(mut guard) = MODELS_CACHE.lock() {
        *guard = Some((Instant::now(), out_models.clone()));
    }
    Ok(out_models)
}

pub fn managed_bin() -> Result<PathBuf, String> {
    Ok(store::data_dir()?.join("bin").join("codex.exe"))
}

fn candidate_paths() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(p) = managed_bin() {
        v.push(p);
    }
    // npm global installs of the official Codex CLI (@openai/codex)
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let base = PathBuf::from(appdata).join(r"npm\node_modules\@openai");
        if let Ok(vendors) = std::fs::read_dir(&base) {
            for vendor in vendors.flatten() {
                // <pkg>/node_modules/@openai/<platform-pkg>/codex.exe
                let nested = vendor.path().join("node_modules").join("@openai");
                if let Ok(platforms) = std::fs::read_dir(&nested) {
                    for plat in platforms.flatten() {
                        let exe = plat.path().join("codex.exe");
                        if exe.exists() {
                            v.push(exe);
                        }
                    }
                }
                let direct = vendor.path().join("bin").join("codex.exe");
                if direct.exists() {
                    v.push(direct);
                }
            }
        }
    }
    v
}

fn exe_version(path: &PathBuf) -> Option<String> {
    let out = quiet_command(path).arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn auth_json_exists() -> bool {
    dirs::home_dir()
        .map(|h| h.join(".codex").join("auth.json").exists())
        .unwrap_or(false)
}

pub fn detect(force: bool) -> CodexStatus {
    if !force {
        if let Ok(guard) = DETECT_CACHE.lock() {
            if let Some(cached) = guard.clone() {
                return cached;
            }
        }
    }
    let status = detect_uncached();
    if let Ok(mut guard) = DETECT_CACHE.lock() {
        *guard = Some(status.clone());
    }
    status
}

fn detect_uncached() -> CodexStatus {
    for p in candidate_paths() {
        if p.exists() {
            if let Some(ver) = exe_version(&p) {
                return CodexStatus {
                    installed: true,
                    authenticated: auth_json_exists(),
                    version: Some(ver),
                    path: Some(p.to_string_lossy().to_string()),
                };
            }
        }
    }
    // PATH lookup — accept only real .exe entries (skip .cmd shims to avoid shell limits)
    if let Ok(out) = quiet_command("where").arg("codex").output() {
        if out.status.success() {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let p = PathBuf::from(line.trim());
                if p.extension().is_some_and(|e| e == "exe") && p.exists() {
                    if let Some(ver) = exe_version(&p) {
                        return CodexStatus {
                            installed: true,
                            authenticated: auth_json_exists(),
                            version: Some(ver),
                            path: Some(p.to_string_lossy().to_string()),
                        };
                    }
                }
            }
        }
    }
    CodexStatus {
        installed: false,
        authenticated: auth_json_exists(),
        version: None,
        path: None,
    }
}

/// Run one classification prompt through `codex exec` (non-interactive, read-only sandbox).
pub fn complete(prompt: &str, model: Option<&str>) -> Result<String, String> {
    let status = detect(false);
    if !status.installed {
        return Err("Codex CLI not detected. Install it from Settings or add an API key.".into());
    }
    if !status.authenticated {
        return Err(
            "Codex CLI is not signed in. Use Settings → Codex → Sign in with ChatGPT.".into(),
        );
    }
    let exe = status.path.ok_or("Codex path missing")?;
    let tmp = std::env::temp_dir().join(format!("tawreed-codex-{}.txt", std::process::id()));

    let mut args: Vec<String> = vec![
        "exec".into(),
        "--skip-git-repo-check".into(),
        "--sandbox".into(),
        "read-only".into(),
        "--output-last-message".into(),
        tmp.to_string_lossy().to_string(),
    ];
    if let Some(m) = model {
        if !m.trim().is_empty() {
            args.push("-m".into());
            args.push(m.trim().to_string());
        }
    }
    // Read the prompt from stdin so large BOQ batches never hit Windows' command-line limit.
    args.push("-".into());

    let mut child = quiet_command(&exe)
        .args(&args)
        .current_dir(store::data_dir()?)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn codex: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|e| format!("write prompt to codex: {e}"))?;
    }

    // Drain stdout on a reader thread so a chatty CLI can't deadlock on a full pipe.
    let mut stdout_pipe = child.stdout.take().expect("piped");
    let reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout_pipe.read_to_string(&mut buf);
        buf
    });

    let deadline = Instant::now() + Duration::from_secs(EXEC_TIMEOUT_SECS);
    let exit = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) => {
                if Instant::now() > deadline {
                    let _ = child.kill();
                    let _ = std::fs::remove_file(&tmp);
                    return Err(format!("Codex timed out after {EXEC_TIMEOUT_SECS}s"));
                }
                std::thread::sleep(Duration::from_millis(400));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = std::fs::remove_file(&tmp);
                return Err(format!("wait on codex: {e}"));
            }
        }
    };
    let stdout = reader.join().unwrap_or_default();

    // Preferred: the exact final agent message written by --output-last-message.
    let last = std::fs::read_to_string(&tmp).unwrap_or_default();
    let _ = std::fs::remove_file(&tmp);
    let text = if !last.trim().is_empty() {
        last
    } else {
        stdout
    };

    if !exit.success() {
        store::log_line(&format!("codex exec exited with {exit}"));
        let tail: String = text
            .chars()
            .rev()
            .take(300)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        return Err(format!(
            "Codex exec failed ({exit}). {tail}\nIf this mentions auth, sign in again from Settings."
        ));
    }
    store::log_line("codex classification batch completed");
    Ok(text)
}

/// Spawn `codex login` detached — the browser OAuth flow belongs to the CLI.
pub fn login() -> Result<(), String> {
    let status = detect(false);
    let exe = status.path.ok_or("Codex CLI not installed")?;
    quiet_command(exe)
        .arg("login")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn codex login: {e}"))?;
    invalidate_cache(); // auth state is about to change
    store::log_line("codex login spawned");
    Ok(())
}

/// Download the official Codex CLI binary (latest GitHub release) into ~/.tawreed/bin.
pub async fn install() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("tawreed-app")
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let release: Value = client
        .get("https://api.github.com/repos/openai/codex/releases/latest")
        .send()
        .await
        .map_err(|e| format!("query releases: {e}"))?
        .json()
        .await
        .map_err(|e| format!("parse release: {e}"))?;

    let assets = release
        .get("assets")
        .and_then(Value::as_array)
        .ok_or("no assets in latest Codex release")?;
    // Exact match required: the release also ships app-server / lint / proxy binaries
    // with similar names — picking the first fuzzy match would grab the wrong tool.
    let asset = assets
        .iter()
        .find(|a| {
            a.get("name").and_then(Value::as_str) == Some("codex-x86_64-pc-windows-msvc.exe.zip")
        })
        .ok_or("codex-x86_64-pc-windows-msvc.exe.zip not found in latest Codex release")?;
    let url = asset
        .get("browser_download_url")
        .and_then(Value::as_str)
        .ok_or("asset has no download URL")?;

    store::log_line(&format!("downloading codex from {url}"));
    let bytes = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download codex: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("read codex bytes: {e}"))?;

    let dest = managed_bin()?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create bin dir: {e}"))?;
    }
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("unzip: {e}"))?;
    // The archive ships several tools: codex-command-runner.exe,
    // codex-windows-sandbox-setup.exe, codex-x86_64-pc-windows-msvc.exe (the CLI we want).
    let mut chosen: Option<usize> = None;
    for i in 0..archive.len() {
        let name = archive
            .by_index(i)
            .map_err(|e| format!("zip entry: {e}"))?
            .name()
            .to_string();
        let lower = name.to_lowercase();
        if lower == "codex-x86_64-pc-windows-msvc.exe" {
            chosen = Some(i);
            break;
        }
        // Fallback: the main CLI binary, never helper tools.
        if lower.starts_with("codex-")
            && lower.ends_with(".exe")
            && lower.contains("windows-msvc")
            && !lower.contains("runner")
            && !lower.contains("setup")
        {
            chosen = chosen.or(Some(i));
        }
    }
    let i = chosen.ok_or("codex CLI binary not found inside the downloaded archive")?;
    let mut file = archive.by_index(i).map_err(|e| format!("zip entry: {e}"))?;
    store::log_line(&format!(
        "extracting codex binary from archive entry: {}",
        file.name()
    ));
    let mut out = std::fs::File::create(&dest).map_err(|e| format!("create codex.exe: {e}"))?;
    std::io::copy(&mut file, &mut out).map_err(|e| format!("extract codex.exe: {e}"))?;
    store::log_line("codex cli installed to managed bin");
    invalidate_cache();
    Ok(dest.to_string_lossy().to_string())
}
