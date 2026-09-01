// Codex CLI provider. Authentication remains owned by the official Codex CLI;
// Tawreed never reads or transports Codex credentials.
use crate::store;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use ts_rs::TS;

const EXEC_TIMEOUT_SECS: u64 = 240;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Spawn a process without flashing a console window from the desktop app.
pub fn quiet_command<P: AsRef<std::ffi::OsStr>>(program: P) -> Command {
    #[cfg(windows)]
    {
        let mut command = Command::new(program);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(windows))]
    {
        Command::new(program)
    }
}

static DETECT_CACHE: std::sync::Mutex<Option<CodexStatus>> = std::sync::Mutex::new(None);
static MODELS_CACHE: std::sync::Mutex<Option<(Instant, Vec<ModelInfo>)>> =
    std::sync::Mutex::new(None);
const MODELS_TTL_SECS: u64 = 300;

pub fn invalidate_cache() {
    if let Ok(mut guard) = DETECT_CACHE.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = MODELS_CACHE.lock() {
        *guard = None;
    }
}

#[derive(Serialize, Clone, TS)]
#[ts(export, export_to = "../../src/bridge-types/")]
pub struct CodexStatus {
    pub installed: bool,
    pub authenticated: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub source: Option<String>,
}

#[derive(Serialize, Clone, TS)]
#[ts(export, export_to = "../../src/bridge-types/")]
pub struct ModelInfo {
    pub slug: String,
    pub display_name: String,
    pub description: String,
    pub default_reasoning_level: Option<String>,
}

fn bounded_tail(value: &str, max_chars: usize) -> String {
    value
        .chars()
        .rev()
        .take(max_chars)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}

/// Drain a child-process pipe fully to avoid deadlock while retaining bounded diagnostics.
fn drain_pipe<R: Read>(mut reader: R, max_bytes: usize) -> String {
    let mut retained = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                if retained.len() < max_bytes {
                    let keep = read.min(max_bytes - retained.len());
                    retained.extend_from_slice(&chunk[..keep]);
                }
            }
        }
    }
    String::from_utf8_lossy(&retained).into_owned()
}

/// Use the stable app-server `model/list` JSON-RPC method documented for rich clients.
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
    if !status.authenticated {
        return Err("Codex CLI is not signed in".into());
    }

    let mut child = quiet_command(exe)
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn Codex app server: {e}"))?;

    let stderr_pipe = child
        .stderr
        .take()
        .ok_or("Codex app server stderr unavailable")?;
    let stderr_reader = std::thread::spawn(move || drain_pipe(stderr_pipe, 1024 * 1024));

    let stdout_pipe = child
        .stdout
        .take()
        .ok_or("Codex app server stdout unavailable")?;
    let (line_tx, line_rx) = mpsc::channel::<String>();
    let stdout_reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout_pipe).lines().map_while(Result::ok) {
            if line_tx.send(line).is_err() {
                break;
            }
        }
    });

    let request_result = (|| -> Result<Value, String> {
        let mut stdin = child
            .stdin
            .take()
            .ok_or("Codex app server stdin unavailable")?;
        let mut send = |message: &Value| -> Result<(), String> {
            serde_json::to_writer(&mut stdin, message)
                .map_err(|e| format!("serialize Codex app-server request: {e}"))?;
            stdin
                .write_all(b"\n")
                .and_then(|_| stdin.flush())
                .map_err(|e| format!("write Codex app-server request: {e}"))
        };
        send(&serde_json::json!({
            "method": "initialize",
            "id": 0,
            "params": {
                "clientInfo": {
                    "name": "tawreed",
                    "title": "Tawreed",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        }))?;

        let deadline = Instant::now() + Duration::from_secs(30);
        let mut initialized = false;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("Codex model catalog timed out after 30s".into());
            }
            match line_rx.recv_timeout(remaining.min(Duration::from_millis(500))) {
                Ok(line) => {
                    let message: Value = serde_json::from_str(&line)
                        .map_err(|e| format!("parse Codex app-server response: {e}"))?;
                    let id = message.get("id").and_then(Value::as_i64);
                    if id == Some(0) && !initialized {
                        if let Some(error) = message.get("error") {
                            return Err(format!("Codex app-server initialization error: {error}"));
                        }
                        send(&serde_json::json!({"method": "initialized", "params": {}}))?;
                        send(&serde_json::json!({
                            "method": "model/list",
                            "id": 1,
                            "params": {"limit": 100, "includeHidden": false}
                        }))?;
                        initialized = true;
                        continue;
                    }
                    if id != Some(1) {
                        continue;
                    }
                    if let Some(error) = message.get("error") {
                        return Err(format!("Codex model catalog error: {error}"));
                    }
                    return message
                        .get("result")
                        .cloned()
                        .ok_or("Codex model catalog response had no result".into());
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if let Ok(Some(exit)) = child.try_wait() {
                        return Err(format!(
                            "Codex app server exited before returning models ({exit})"
                        ));
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("Codex app server closed before returning the model catalog".into());
                }
            }
        }
    })();

    let _ = child.kill();
    let _ = child.wait();
    drop(line_rx);
    let _ = stdout_reader.join();
    let stderr = stderr_reader.join().unwrap_or_default();
    let parsed = request_result.map_err(|error| {
        let detail = bounded_tail(&stderr, 400);
        if detail.is_empty() {
            error
        } else {
            format!("{error}. {detail}")
        }
    })?;

    let mut models: Vec<(bool, ModelInfo)> = parsed
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|model| model.get("hidden").and_then(Value::as_bool) != Some(true))
                .filter_map(|model| {
                    Some((
                        model
                            .get("isDefault")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        ModelInfo {
                            slug: model.get("model").and_then(Value::as_str)?.to_string(),
                            display_name: model
                                .get("displayName")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            description: model
                                .get("description")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            default_reasoning_level: model
                                .get("defaultReasoningEffort")
                                .and_then(Value::as_str)
                                .map(str::to_string),
                        },
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    // Stable sort keeps the server's catalog order while placing its default first.
    models.sort_by_key(|(is_default, _)| !*is_default);
    let models: Vec<ModelInfo> = models.into_iter().map(|(_, model)| model).collect();
    if models.is_empty() {
        return Err("Codex model catalog was empty".into());
    }
    store::log_line(&format!("model catalog fetched: {} models", models.len()));
    if let Ok(mut guard) = MODELS_CACHE.lock() {
        *guard = Some((Instant::now(), models.clone()));
    }
    Ok(models)
}

pub fn managed_bin() -> Result<PathBuf, String> {
    let binary = if cfg!(windows) { "codex.exe" } else { "codex" };
    Ok(store::data_dir()?.join("bin").join(binary))
}

#[derive(Clone, Debug)]
struct CodexCandidate {
    path: PathBuf,
    source: &'static str,
}

#[cfg(any(windows, test))]
fn npm_vendor_candidates(appdata: &Path) -> Vec<CodexCandidate> {
    let package = appdata.join(r"npm\node_modules\@openai\codex");
    [
        (
            package.join(
                r"node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe",
            ),
            "npm (Windows x64)",
        ),
        (
            package.join(
                r"node_modules\@openai\codex-win32-arm64\vendor\aarch64-pc-windows-msvc\bin\codex.exe",
            ),
            "npm (Windows arm64)",
        ),
        (package.join(r"bin\codex.exe"), "npm"),
    ]
    .into_iter()
    .map(|(path, source)| CodexCandidate { path, source })
    .collect()
}

#[cfg(windows)]
fn appx_candidates() -> Vec<CodexCandidate> {
    let output = quiet_command("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue).InstallLocation",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|location| CodexCandidate {
            path: PathBuf::from(location).join(r"app\resources\codex.exe"),
            source: "Codex desktop app",
        })
        .collect()
}

fn candidate_paths() -> Vec<CodexCandidate> {
    let mut candidates = Vec::new();
    if let Ok(path) = managed_bin() {
        candidates.push(CodexCandidate {
            path,
            source: "Tawreed managed",
        });
    }

    #[cfg(windows)]
    {
        if let Some(local_appdata) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(CodexCandidate {
                path: PathBuf::from(local_appdata).join(r"Programs\OpenAI\Codex\bin\codex.exe"),
                source: "Codex standalone",
            });
        }
        if let Some(appdata) = std::env::var_os("APPDATA") {
            candidates.extend(npm_vendor_candidates(&PathBuf::from(appdata)));
        }
    }

    if let Some(path) = std::env::var_os("PATH") {
        let binary = if cfg!(windows) { "codex.exe" } else { "codex" };
        for directory in std::env::split_paths(&path) {
            let candidate = directory.join(binary);
            candidates.push(CodexCandidate {
                path: candidate,
                source: "system PATH",
            });
        }
    }

    #[cfg(windows)]
    candidates.extend(appx_candidates());

    let mut seen = HashSet::new();
    candidates.retain(|candidate| {
        let normalized = candidate
            .path
            .canonicalize()
            .unwrap_or_else(|_| candidate.path.clone())
            .to_string_lossy()
            .to_ascii_lowercase();
        seen.insert(normalized)
    });
    candidates
}

fn wait_with_timeout(child: &mut std::process::Child, timeout: Duration) -> Option<bool> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status.success()),
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Err(_) => return None,
        }
    }
}

fn exe_version(path: &Path) -> Option<String> {
    let mut child = quiet_command(path)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    if wait_with_timeout(&mut child, Duration::from_secs(10)) != Some(true) {
        return None;
    }
    let mut stdout = String::new();
    child.stdout.take()?.read_to_string(&mut stdout).ok()?;
    let version = stdout.trim();
    let mut parts = version.split_whitespace();
    let product = parts.next()?;
    let number = parts.next()?;
    let valid_product = matches!(product, "codex" | "codex-cli");
    let valid_number = number.split('.').count() >= 3
        && number
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'));
    if !valid_product || !valid_number || parts.next().is_some() || version.len() > 80 {
        return None;
    }
    Some(version.to_string())
}

fn authenticated(path: &Path) -> bool {
    let Ok(mut child) = quiet_command(path)
        .args(["login", "status"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    wait_with_timeout(&mut child, Duration::from_secs(10)) == Some(true)
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
    for candidate in candidate_paths() {
        if let Some(version) = exe_version(&candidate.path) {
            return CodexStatus {
                installed: true,
                authenticated: authenticated(&candidate.path),
                version: Some(version),
                path: Some(candidate.path.to_string_lossy().to_string()),
                source: Some(candidate.source.to_string()),
            };
        }
    }
    CodexStatus {
        installed: false,
        authenticated: false,
        version: None,
        path: None,
        source: None,
    }
}

fn create_request_dir() -> Result<PathBuf, String> {
    let base = std::env::temp_dir();
    for sequence in 0..8u8 {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = base.join(format!(
            "tawreed-codex-{}-{stamp}-{sequence}",
            std::process::id()
        ));
        match std::fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("create isolated Codex directory: {error}")),
        }
    }
    Err("Could not allocate an isolated Codex directory".into())
}

fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 160
        && model
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
}

/// Run a schema-constrained, ephemeral one-shot classification. The empty working
/// directory and ignored user config/rules prevent project files, `.env`, or personal
/// instructions from becoming implicit model context.
pub fn complete(
    prompt: &str,
    model: Option<&str>,
    output_schema: Option<&Value>,
    cancelled: Arc<AtomicBool>,
) -> Result<String, String> {
    if prompt.is_empty() || prompt.len() > 512 * 1024 {
        return Err("Codex prompt must be between 1 byte and 512 KB".into());
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err("AI job cancelled".into());
    }
    let status = detect(false);
    if !status.installed {
        return Err("Codex CLI not detected. Install it from Settings or add an API key.".into());
    }
    if !status.authenticated {
        return Err(
            "Codex CLI is not signed in. Use Settings -> Codex -> Sign in with ChatGPT.".into(),
        );
    }
    let exe = status.path.ok_or("Codex path missing")?;
    let work_dir = create_request_dir()?;
    let result_path = work_dir.join("response.json");
    let schema_path = work_dir.join("output-schema.json");

    let result = (|| -> Result<String, String> {
        let mut args: Vec<String> = vec![
            "exec".into(),
            "--ephemeral".into(),
            "--ignore-user-config".into(),
            "--ignore-rules".into(),
            "--skip-git-repo-check".into(),
            "--sandbox".into(),
            "read-only".into(),
            "--color".into(),
            "never".into(),
            "--cd".into(),
            work_dir.to_string_lossy().to_string(),
            "--output-last-message".into(),
            result_path.to_string_lossy().to_string(),
            "-c".into(),
            "shell_environment_policy.inherit=\"none\"".into(),
        ];

        if let Some(schema) = output_schema {
            if !schema.is_object() {
                return Err("Codex output schema must be a JSON object".into());
            }
            let bytes = serde_json::to_vec(schema)
                .map_err(|e| format!("serialize Codex output schema: {e}"))?;
            if bytes.len() > 128 * 1024 {
                return Err("Codex output schema exceeds the 128 KB limit".into());
            }
            std::fs::write(&schema_path, bytes)
                .map_err(|e| format!("write Codex output schema: {e}"))?;
            args.push("--output-schema".into());
            args.push(schema_path.to_string_lossy().to_string());
        }
        if let Some(model) = model.map(str::trim).filter(|model| !model.is_empty()) {
            if !valid_model(model) {
                return Err("Invalid Codex model identifier".into());
            }
            args.push("--model".into());
            args.push(model.to_string());
        }
        args.push("-".into());

        let mut command = quiet_command(&exe);
        command
            .args(&args)
            .current_dir(&work_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("NO_COLOR", "1");
        for secret in [
            "ANTHROPIC_API_KEY",
            "OPENAI_API_KEY",
            "AZURE_OPENAI_API_KEY",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_SESSION_TOKEN",
            "GITHUB_TOKEN",
            "GH_TOKEN",
            "GOOGLE_API_KEY",
        ] {
            command.env_remove(secret);
        }
        let mut child = command.spawn().map_err(|e| format!("spawn Codex: {e}"))?;

        if let Some(mut stdin) = child.stdin.take() {
            if let Err(error) = stdin.write_all(prompt.as_bytes()) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("write Codex stdin: {error}"));
            }
        }

        let stdout_pipe = child.stdout.take().ok_or("Codex stdout unavailable")?;
        let stderr_pipe = child.stderr.take().ok_or("Codex stderr unavailable")?;
        let stdout_reader = std::thread::spawn(move || drain_pipe(stdout_pipe, 10 * 1024 * 1024));
        let stderr_reader = std::thread::spawn(move || drain_pipe(stderr_pipe, 2 * 1024 * 1024));

        let deadline = Instant::now() + Duration::from_secs(EXEC_TIMEOUT_SECS);
        let mut was_cancelled = false;
        let exit = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if cancelled.load(Ordering::Relaxed) => {
                    was_cancelled = true;
                    let _ = child.kill();
                    break child
                        .wait()
                        .map_err(|e| format!("wait for cancelled Codex process: {e}"))?;
                }
                Ok(None) if Instant::now() > deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    return Err(format!("Codex timed out after {EXEC_TIMEOUT_SECS}s"));
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    return Err(format!("wait on Codex: {error}"));
                }
            }
        };

        let stdout = stdout_reader.join().unwrap_or_default();
        let stderr = stderr_reader.join().unwrap_or_default();
        if was_cancelled {
            return Err("AI job cancelled".into());
        }

        let last = std::fs::read_to_string(&result_path).unwrap_or_default();
        let text = if last.trim().is_empty() { stdout } else { last };
        if !exit.success() {
            store::log_line(&format!("codex exec exited with {exit}"));
            let detail = bounded_tail(
                if stderr.trim().is_empty() {
                    &text
                } else {
                    &stderr
                },
                500,
            );
            return Err(format!(
                "Codex exec failed ({exit}). {detail}\nIf this mentions authentication, sign in again from Settings."
            ));
        }
        if text.trim().is_empty() {
            return Err("Codex returned an empty completion".into());
        }
        if output_schema.is_some() {
            serde_json::from_str::<Value>(&text)
                .map_err(|e| format!("Codex returned invalid structured JSON: {e}"))?;
        }
        store::log_line("codex classification batch completed");
        Ok(text)
    })();

    let _ = std::fs::remove_dir_all(&work_dir);
    result
}

/// Spawn `codex login`; the browser OAuth flow and credential storage remain CLI-owned.
pub fn login() -> Result<(), String> {
    let status = detect(false);
    let exe = status.path.ok_or("Codex CLI not installed")?;
    quiet_command(exe)
        .arg("login")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn Codex login: {e}"))?;
    invalidate_cache();
    store::log_line("codex login spawned");
    Ok(())
}

/// Download and verify the official Windows CLI release into Tawreed's managed bin.
#[cfg(windows)]
pub async fn install() -> Result<String, String> {
    use sha2::{Digest, Sha256};

    let client = reqwest::Client::builder()
        .user_agent("tawreed-app")
        .timeout(Duration::from_secs(300))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let release_response = client
        .get("https://api.github.com/repos/openai/codex/releases/latest")
        .send()
        .await
        .map_err(|e| format!("query Codex releases: {e}"))?;
    if !release_response.status().is_success() {
        return Err(format!(
            "query Codex releases failed with HTTP {}",
            release_response.status()
        ));
    }
    let release: Value = release_response
        .json()
        .await
        .map_err(|e| format!("parse Codex release: {e}"))?;
    let assets = release
        .get("assets")
        .and_then(Value::as_array)
        .ok_or("no assets in latest Codex release")?;
    let asset = assets
        .iter()
        .find(|asset| {
            asset.get("name").and_then(Value::as_str)
                == Some("codex-x86_64-pc-windows-msvc.exe.zip")
        })
        .ok_or("Windows Codex CLI archive not found in latest release")?;
    let url = asset
        .get("browser_download_url")
        .and_then(Value::as_str)
        .ok_or("Codex release asset has no download URL")?;
    let expected_digest = asset
        .get("digest")
        .and_then(Value::as_str)
        .and_then(|digest| digest.strip_prefix("sha256:"))
        .filter(|digest| digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or("Codex release asset has no valid SHA-256 digest")?
        .to_ascii_lowercase();
    let declared_size = asset.get("size").and_then(Value::as_u64);

    store::log_line("downloading signed Codex CLI release asset");
    const MAX_DOWNLOAD: usize = 500 * 1024 * 1024;
    let mut current_url =
        reqwest::Url::parse(url).map_err(|e| format!("invalid Codex asset URL: {e}"))?;
    let mut response = None;
    for _ in 0..=3 {
        let candidate = client
            .get(current_url.clone())
            .send()
            .await
            .map_err(|e| format!("download Codex: {e}"))?;
        if candidate.status().is_redirection() {
            let location = candidate
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or("Codex download redirect has no Location header")?;
            let next = current_url
                .join(location)
                .map_err(|e| format!("invalid Codex redirect URL: {e}"))?;
            let host = next.host_str().unwrap_or_default();
            let trusted = host == "github.com"
                || host.ends_with(".github.com")
                || host.ends_with(".githubusercontent.com");
            if next.scheme() != "https" || !trusted {
                return Err(format!("refusing Codex download redirect to {host}"));
            }
            store::log_line("following approved GitHub download redirect");
            current_url = next;
            continue;
        }
        response = Some(candidate);
        break;
    }
    let mut response = response.ok_or("too many redirects while downloading Codex")?;
    if !response.status().is_success() {
        return Err(format!(
            "Codex download failed with HTTP {}",
            response.status()
        ));
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("read Codex bytes: {e}"))?
    {
        if bytes.len() + chunk.len() > MAX_DOWNLOAD {
            return Err("Codex download exceeded the 500 MB limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if declared_size.is_some_and(|size| size != bytes.len() as u64) {
        return Err("Codex release asset size did not match its signed metadata".into());
    }
    let actual_digest = format!("{:x}", Sha256::digest(&bytes));
    if actual_digest != expected_digest {
        return Err("Codex release asset failed SHA-256 verification".into());
    }

    let destination = managed_bin()?;
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create Codex bin dir: {e}"))?;
    }
    let temporary = destination.with_file_name("codex.installing.exe");
    let _ = std::fs::remove_file(&temporary);
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("unzip: {e}"))?;
    let mut chosen = None;
    for index in 0..archive.len() {
        let name = archive
            .by_index(index)
            .map_err(|e| format!("read Codex zip entry: {e}"))?
            .name()
            .to_ascii_lowercase();
        if name == "codex-x86_64-pc-windows-msvc.exe" {
            chosen = Some(index);
            break;
        }
    }
    let index = chosen.ok_or("Codex CLI binary not found in verified archive")?;
    let mut source = archive
        .by_index(index)
        .map_err(|e| format!("read Codex zip entry: {e}"))?;
    let extraction = (|| -> Result<(), String> {
        let mut limited = (&mut source).take(MAX_DOWNLOAD as u64 + 1);
        let mut output = std::fs::File::create(&temporary)
            .map_err(|e| format!("create Codex temporary executable: {e}"))?;
        let copied = std::io::copy(&mut limited, &mut output)
            .map_err(|e| format!("extract Codex executable: {e}"))?;
        if copied > MAX_DOWNLOAD as u64 {
            return Err("Codex executable exceeds the 500 MB limit".into());
        }
        output
            .sync_all()
            .map_err(|e| format!("flush Codex executable: {e}"))
    })();
    if let Err(error) = extraction {
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }
    if exe_version(&temporary).is_none() {
        let _ = std::fs::remove_file(&temporary);
        return Err("Verified archive did not contain a valid Codex CLI executable".into());
    }
    store::replace_file(&temporary, &destination).map_err(|e| {
        let _ = std::fs::remove_file(&temporary);
        format!("install Codex executable: {e}")
    })?;

    store::log_line("Codex CLI installed to managed bin after SHA-256 verification");
    invalidate_cache();
    Ok(destination.to_string_lossy().to_string())
}

#[cfg(not(windows))]
pub async fn install() -> Result<String, String> {
    Err("Automatic Codex installation is available on Windows only. Install the official CLI with `npm install -g @openai/codex`, then restart Tawreed.".into())
}

#[cfg(test)]
mod detection_tests {
    use super::*;

    #[test]
    fn includes_current_npm_vendor_layouts() {
        let appdata = PathBuf::from(r"C:\Users\engineer\AppData\Roaming");
        let candidates = npm_vendor_candidates(&appdata);
        let paths: Vec<String> = candidates
            .iter()
            .map(|candidate| candidate.path.to_string_lossy().replace('\\', "/"))
            .collect();

        assert!(paths.iter().any(|path| path.ends_with(
            "npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe"
        )));
        assert!(paths.iter().any(|path| path.ends_with(
            "npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-arm64/vendor/aarch64-pc-windows-msvc/bin/codex.exe"
        )));
    }

    #[test]
    fn duplicate_candidates_are_removed_case_insensitively() {
        let mut candidates = vec![
            CodexCandidate {
                path: PathBuf::from(r"C:\Tools\codex.exe"),
                source: "one",
            },
            CodexCandidate {
                path: PathBuf::from(r"c:\tools\CODEX.EXE"),
                source: "two",
            },
        ];
        let mut seen = HashSet::new();
        candidates
            .retain(|candidate| seen.insert(candidate.path.to_string_lossy().to_ascii_lowercase()));
        assert_eq!(candidates.len(), 1);
    }
}
