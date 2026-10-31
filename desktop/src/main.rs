// The desktop window. In development it loads the Vite server, which also starts the local service. Installed, it
// starts the bundled service itself, on a free port with a fresh token, and answers the interface's requests to the
// `api` scheme by forwarding them to the service with that token, so the page never holds it. It answers
// `/desktop/update` itself: whether a newer signed Tawreed is published, and installing it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::http::{HeaderName, HeaderValue, Method, Request, Response, StatusCode, header};
use tauri::{AppHandle, Manager, RunEvent, UriSchemeContext, Url};
use tauri_plugin_updater::UpdaterExt;

/// The running service. Its standard input stays open while Tawreed runs; when Tawreed exits, or crashes, the
/// system closes it and the service stops (it runs with --exit-with-stdin).
struct Service {
    port: u16,
    token: String,
    ready: AtomicBool,
    child: Mutex<Child>,
    agent: ureq::Agent, // one agent for every forwarded request: no proxy, no redirects
    log: PathBuf,
}

/// The service could not be started. The window still opens, and every request says why.
struct Failed(String);

const STARTING: Duration = Duration::from_secs(60); // how long a request waits for the service to come up
const CHECKING: Duration = Duration::from_secs(15); // how long the update check waits for its address
const DOWNLOADING: Duration = Duration::from_secs(30 * 60); // how long the download of an update may take
const STOPPING: Duration = Duration::from_secs(2); // how long the service gets to stop by itself
const LOG_LIMIT: u64 = 1_000_000; // a larger service.log moves to service.prev.log at the next start
static INSTALLING: AtomicBool = AtomicBool::new(false);

/// Where the page may come from: the origins that Tauri gives its own pages (Linux and macOS, Windows).
const APP_ORIGINS: [&str; 3] = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
];

/// Headers that describe the hop between the page and Tawreed, not the request: the service gets its own.
static NOT_FORWARDED: [HeaderName; 10] = [
    header::HOST,
    header::ORIGIN,
    header::AUTHORIZATION,
    header::PROXY_AUTHORIZATION,
    header::CONTENT_LENGTH,
    header::TRANSFER_ENCODING,
    header::CONNECTION,
    header::UPGRADE,
    header::TRAILER,
    header::ACCEPT_ENCODING,
];

fn main() {
    #[cfg(target_os = "linux")]
    work_around_nvidia();

    tauri::Builder::default()
        // First, so that a second Tawreed hands over to the first before it starts anything.
        .plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _directory| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            },
        ))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("navigation-guard")
                .on_navigation(|webview, url| {
                    let dev = tauri::is_dev()
                        .then(|| webview.app_handle().config().build.dev_url.clone())
                        .flatten();
                    is_app_page(url, dev.as_ref())
                })
                .build(),
        )
        .register_asynchronous_uri_scheme_protocol(
            "api",
            |context: UriSchemeContext<'_, _>, request, responder| {
                let app = context.app_handle().clone();
                thread::spawn(move || {
                    let mut response = match (app.try_state::<Service>(), app.try_state::<Failed>())
                    {
                        (Some(service), _) if request.uri().path() == "/desktop/update" => {
                            update(&app, &service, request.method())
                        }
                        (Some(service), _) => forward(&service, &request),
                        (None, Some(failed)) => plain(StatusCode::SERVICE_UNAVAILABLE, &failed.0),
                        (None, None) => plain(
                            StatusCode::SERVICE_UNAVAILABLE,
                            "The Tawreed service isn't running.",
                        ),
                    };
                    cors(&mut response, request.headers().get(header::ORIGIN));
                    responder.respond(response);
                });
            },
        )
        .setup(|app| {
            if !tauri::is_dev() {
                match start_service(app.handle()) {
                    Ok(service) => {
                        app.manage(service);
                    }
                    Err(error) => {
                        let log = app
                            .path()
                            .app_log_dir()
                            .map(|dir| dir.join("service.log"))
                            .unwrap_or_default();
                        app.manage(Failed(format!(
                            "The Tawreed service couldn't start ({error}). Its log is {}.",
                            log.display()
                        )));
                    }
                }
                if signed_updates(app.handle()) {
                    app.handle()
                        .plugin(tauri_plugin_updater::Builder::new().build())?;
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tawreed could not open its window")
        .run(|app, event| {
            // Stop the service and anything it started (the Codex client, for one), so none is left running.
            if let RunEvent::Exit = event
                && let Some(service) = app.try_state::<Service>()
                && let Ok(mut child) = service.child.lock()
            {
                let _ = stop(&mut child);
            }
        });
}

/// NVIDIA's driver under Wayland leaves the web view blank or frozen unless these are set
/// (https://v2.tauri.app/develop/debug/linux-graphics/). A value the user has set stays.
#[cfg(target_os = "linux")]
fn work_around_nvidia() {
    if !std::path::Path::new("/proc/driver/nvidia/version").exists() {
        return;
    }
    for name in [
        "__NV_DISABLE_EXPLICIT_SYNC",
        "WEBKIT_DISABLE_DMABUF_RENDERER",
    ] {
        if std::env::var_os(name).is_none() {
            // SAFETY: this runs first in main, before Tawreed starts a thread, so nothing else reads the environment.
            unsafe { std::env::set_var(name, "1") };
        }
    }
}

/// The pages Tawreed shows: its own origin, and in development the Vite server. A `blob:` made by the page (the
/// download of a revision) counts as the page that made it. Everything else is refused.
fn is_app_page(url: &Url, dev: Option<&Url>) -> bool {
    match (url.scheme(), url.host_str(), url.port()) {
        ("tauri", Some("localhost"), None) | ("http" | "https", Some("tauri.localhost"), None) => {
            true
        }
        ("blob", _, _) => Url::parse(url.path())
            .is_ok_and(|inner| inner.scheme() != "blob" && is_app_page(&inner, dev)),
        _ => dev.is_some_and(|dev| url.origin() == dev.origin()),
    }
}

fn start_service(app: &AppHandle) -> Result<Service, Box<dyn std::error::Error>> {
    let port = TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    let child = spawn_service(app, port, &token)?;
    let agent = ureq::Agent::config_builder()
        .proxy(None)
        .max_redirects(0)
        .http_status_as_error(false)
        .build()
        .into();
    Ok(Service {
        port,
        token,
        ready: AtomicBool::new(false),
        child: Mutex::new(child),
        agent,
        log: log_file(app)?,
    })
}

fn log_file(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let logs = app.path().app_log_dir()?;
    fs::create_dir_all(&logs)?;
    Ok(logs.join("service.log"))
}

fn spawn_service(
    app: &AppHandle,
    port: u16,
    token: &str,
) -> Result<Child, Box<dyn std::error::Error>> {
    let executable = if cfg!(windows) {
        "tawreed-service.exe"
    } else {
        "tawreed-service"
    };
    let program = app.path().resource_dir()?.join("service").join(executable);

    // Each start adds to the log, under a line that says when; a log past the limit is kept once as service.prev.log.
    let path = log_file(app)?;
    if fs::metadata(&path).is_ok_and(|log| log.len() > LOG_LIMIT) {
        let _ = fs::rename(&path, path.with_file_name("service.prev.log"));
    }
    let mut log = OpenOptions::new().create(true).append(true).open(&path)?;
    let started = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs());
    writeln!(
        log,
        "---- Tawreed {} starts the service (unix time {started}) ----",
        env!("CARGO_PKG_VERSION")
    )?;

    let mut command = Command::new(program);
    command
        .args(["--port", &port.to_string(), "--exit-with-stdin"])
        .env("TAWREED_TOKEN", token)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(log);
    #[cfg(target_os = "linux")]
    leave_appimage(&mut command);
    #[cfg(target_os = "macos")]
    {
        if let Some(path) = login_path() {
            command.env("PATH", path);
        }
    }
    #[cfg(unix)]
    {
        // Its own process group, so that stopping it can stop whatever it started too.
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let child = command.spawn()?;
    #[cfg(windows)]
    contain(&child);
    Ok(child)
}

/// The AppImage points GTK at its own copies through the environment. The service and the programs it starts (the
/// browser sign-in of the Codex client, for one) must see the system's.
#[cfg(target_os = "linux")]
fn leave_appimage(command: &mut Command) {
    if std::env::var_os("APPIMAGE").is_none() {
        return;
    }
    for name in [
        "GTK_DATA_PREFIX",
        "GTK_THEME",
        "GSETTINGS_SCHEMA_DIR",
        "GTK_PATH",
        "GIO_MODULE_DIR",
        "GDK_PIXBUF_MODULE_FILE",
        "GTK_EXE_PREFIX",
        "GTK_IM_MODULE_FILE",
        "GI_TYPELIB_PATH",
    ] {
        command.env_remove(name);
    }
    // The AppImage puts its own directory first in XDG_DATA_DIRS and keeps the original after it.
    if let (Some(appdir), Some(dirs)) = (
        std::env::var_os("APPDIR"),
        std::env::var_os("XDG_DATA_DIRS"),
    ) {
        let kept: Vec<_> = std::env::split_paths(&dirs)
            .filter(|dir| !dir.starts_with(&appdir))
            .collect();
        match std::env::join_paths(kept) {
            Ok(dirs) if !dirs.is_empty() => command.env("XDG_DATA_DIRS", dirs),
            _ => command.env_remove("XDG_DATA_DIRS"),
        };
    }
}

/// Launched from Finder, Tawreed has only the system's short PATH, and the Codex client isn't on it. Ask the login
/// shell for the PATH the engineer's terminal has (the same thing fix-path-env does); give up after three seconds.
#[cfg(target_os = "macos")]
fn login_path() -> Option<&'static str> {
    use std::io::Read;
    static PATH: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    PATH.get_or_init(|| {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|shell| !shell.is_empty())
            .unwrap_or_else(|| "/bin/zsh".into());
        let mut child = Command::new(shell)
            .args([
                "-ilc",
                r#"printf '__TAWREED_PATH__%s__TAWREED_END__' "$PATH""#,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let mut output = child.stdout.take()?;
        let (send, receive) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let mut text = String::new();
            let _ = output.read_to_string(&mut text);
            let _ = send.send(text);
        });
        let text = receive.recv_timeout(Duration::from_secs(3));
        if text.is_err() {
            let _ = child.kill();
        }
        let _ = child.wait();
        let text = text.ok()?;
        let path = text
            .split_once("__TAWREED_PATH__")?
            .1
            .split_once("__TAWREED_END__")?
            .0;
        (!path.is_empty()).then(|| path.to_string())
    })
    .as_deref()
}

/// Put the service in a job that ends with Tawreed: when Tawreed exits or crashes, Windows closes the job and
/// ends everything in it. The job is kept open for as long as Tawreed runs.
#[cfg(windows)]
fn contain(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };

    static JOB: OnceLock<isize> = OnceLock::new();
    let job = *JOB.get_or_init(|| {
        // SAFETY: plain Win32 calls with a zeroed struct of the size they are told; the handle is only used here.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return 0;
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let set = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&limits).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if set == 0 {
                CloseHandle(job);
                return 0;
            }
            job as isize
        }
    });
    if job != 0 {
        // SAFETY: both handles are open; the child's belongs to `child`, which outlives the call.
        unsafe { AssignProcessToJobObject(job as HANDLE, child.as_raw_handle() as HANDLE) };
    }
}

/// Stop the service: close its input, which it exits on, give it a moment, then end it and anything it started.
fn stop(child: &mut Child) -> Result<(), String> {
    drop(child.stdin.take());
    let deadline = Instant::now() + STOPPING;
    while child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_none()
        && Instant::now() < deadline
    {
        thread::sleep(Duration::from_millis(50));
    }
    #[cfg(unix)]
    // SAFETY: killpg only signals the group the service leads (it was started with process_group(0)).
    unsafe {
        libc::killpg(child.id() as libc::pid_t, libc::SIGKILL);
    }
    let _ = child.kill(); // already gone is fine
    child.wait().map_err(|error| error.to_string())?;
    Ok(())
}

/// Updates are on once the release configuration carries the public key that their signatures are checked with.
fn signed_updates(app: &AppHandle) -> bool {
    let updater = app.config().plugins.0.get("updater");
    updater
        .and_then(|updater| updater["pubkey"].as_str())
        .is_some_and(|key| !key.is_empty())
}

/// GET says which newer version is published, if any. POST downloads it, checks its signature, stops the service
/// so its files can be replaced, and installs it; Tawreed closes and opens again as the new version.
fn update(app: &AppHandle, service: &Service, method: &Method) -> Response<Vec<u8>> {
    if method == Method::OPTIONS {
        return built(
            Response::builder()
                .status(StatusCode::NO_CONTENT)
                .body(Vec::new()),
        );
    }
    if method != Method::POST {
        let found = check(app);
        // Offline, or the address isn't answering: no update to offer, and nothing to report.
        let version = found
            .ok()
            .flatten()
            .map_or("null".into(), |update| format!(r#""{}""#, update.version));
        let body = format!(r#"{{"version": {version}}}"#).into_bytes();
        return built(
            Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(body),
        );
    }
    // A second click while one install runs would stop the service twice.
    if INSTALLING.swap(true, Ordering::AcqRel) {
        return plain(
            StatusCode::CONFLICT,
            "Tawreed is already installing the update.",
        );
    }
    let response = install(app, service);
    INSTALLING.store(false, Ordering::Release);
    response
}

fn check(app: &AppHandle) -> tauri_plugin_updater::Result<Option<tauri_plugin_updater::Update>> {
    if !signed_updates(app) {
        return Ok(None);
    }
    tauri::async_runtime::block_on(async {
        app.updater_builder()
            .timeout(CHECKING)
            .build()?
            .check()
            .await
    })
}

fn install(app: &AppHandle, service: &Service) -> Response<Vec<u8>> {
    let Ok(Some(mut update)) = check(app) else {
        return plain(
            StatusCode::BAD_GATEWAY,
            "Tawreed couldn't reach its updates.",
        );
    };
    update.timeout = Some(DOWNLOADING); // the check's timeout doesn't carry over to the download
    let Ok(installer) = tauri::async_runtime::block_on(update.download(|_, _| {}, || {})) else {
        return plain(
            StatusCode::BAD_GATEWAY,
            "Tawreed couldn't download the update.",
        );
    };
    let result = install_with_recovery(
        || {
            let mut child = service.child.lock().map_err(|error| error.to_string())?;
            stop(&mut child)
        },
        || update.install(installer).map_err(|error| error.to_string()),
        || {
            let mut child = service.child.lock().map_err(|error| error.to_string())?;
            restore_child(&mut child, || {
                spawn_service(app, service.port, &service.token).map_err(|error| error.to_string())
            })?;
            service.ready.store(false, Ordering::Relaxed);
            Ok(())
        },
    );
    match result {
        Ok(()) => app.restart(),
        Err(_) => plain(
            StatusCode::BAD_GATEWAY,
            "Tawreed couldn't install the update. Try again; if the service isn't answering, reopen Tawreed.",
        ),
    }
}

/// Keep a service that survived a stop failure; otherwise replace the stopped process.
fn restore_child(
    child: &mut Child,
    spawn: impl FnOnce() -> Result<Child, String>,
) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_none()
    {
        return Ok(());
    }
    *child = spawn()?;
    Ok(())
}

/// Only a completed install may restart the app. If stopping or installation fails, restore the service first.
fn install_with_recovery(
    stop: impl FnOnce() -> Result<(), String>,
    install: impl FnOnce() -> Result<(), String>,
    recover: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let result = stop().and_then(|()| install());
    if let Err(error) = result {
        recover().map_err(|recovery| format!("{error}; service recovery failed: {recovery}"))?;
        return Err(error);
    }
    Ok(())
}

/// Send the interface's request to the service with the token, and hand back its answer. While the service is
/// still starting, the request waits for it; if it has stopped, the request says so at once.
fn forward(service: &Service, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return built(
            Response::builder()
                .status(StatusCode::NO_CONTENT)
                .body(Vec::new()),
        );
    }
    // The web view can hand over a body that stopped early. Forwarding it would save a cut file as if it were whole.
    if let Some(declared) = request.headers().get(header::CONTENT_LENGTH) {
        let declared = declared
            .to_str()
            .ok()
            .and_then(|length| length.trim().parse::<usize>().ok());
        if declared != Some(request.body().len()) {
            let body = br#"{"detail":{"code":"upload_incomplete"}}"#.to_vec();
            let response = Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .header(header::CONTENT_TYPE, "application/json");
            return built(response.body(body));
        }
    }
    let path = request.uri().path_and_query().map_or("/", |p| p.as_str());
    let url = format!("http://127.0.0.1:{}{}", service.port, path);
    let deadline = Instant::now() + STARTING;
    loop {
        let mut outgoing = ureq::http::Request::builder()
            .method(request.method().clone())
            .uri(&url);
        for (name, value) in request.headers() {
            if !NOT_FORWARDED.contains(name) {
                outgoing = outgoing.header(name, value);
            }
        }
        outgoing = outgoing.header(header::AUTHORIZATION, format!("Bearer {}", service.token));
        let Ok(outgoing) = outgoing.body(request.body().as_slice()) else {
            return plain(
                StatusCode::BAD_REQUEST,
                "Tawreed couldn't pass the request on.",
            );
        };
        match service.agent.run(outgoing) {
            Ok(mut answer) => {
                service.ready.store(true, Ordering::Relaxed);
                let mut response = Response::builder().status(answer.status());
                for name in [header::CONTENT_TYPE, header::CONTENT_DISPOSITION] {
                    if let Some(value) = answer.headers().get(&name) {
                        response = response.header(name, value);
                    }
                }
                let Ok(body) = answer
                    .body_mut()
                    .with_config()
                    .limit(u64::MAX)
                    .read_to_vec()
                else {
                    return plain(
                        StatusCode::BAD_GATEWAY,
                        "The Tawreed service's answer was cut short.",
                    );
                };
                return built(response.body(body));
            }
            Err(_) => {
                if let Ok(Some(status)) = service
                    .child
                    .lock()
                    .map(|mut child| child.try_wait().ok().flatten())
                {
                    let text = format!(
                        "The Tawreed service stopped ({status}). Its log is {}.",
                        service.log.display()
                    );
                    return plain(StatusCode::SERVICE_UNAVAILABLE, &text);
                }
                if service.ready.load(Ordering::Relaxed) || Instant::now() >= deadline {
                    return plain(
                        StatusCode::BAD_GATEWAY,
                        "The Tawreed service isn't answering.",
                    );
                }
                thread::sleep(Duration::from_millis(250)); // still starting
            }
        }
    }
}

/// The page comes from Tawreed's own origin and the service answers on the `api` scheme's, so each answer says
/// the page may read it. Only Tawreed's own origins are named; any other page gets no permission.
fn cors(response: &mut Response<Vec<u8>>, origin: Option<&HeaderValue>) {
    let headers = response.headers_mut();
    if let Some(origin) = origin.filter(|origin| {
        origin
            .to_str()
            .is_ok_and(|origin| APP_ORIGINS.contains(&origin))
    }) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.clone());
    }
    headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type"),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Disposition"),
    );
}

fn built(response: Result<Response<Vec<u8>>, tauri::http::Error>) -> Response<Vec<u8>> {
    response.unwrap_or_else(|_| {
        plain(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Tawreed couldn't pass the answer on.",
        )
    })
}

fn plain(status: StatusCode, text: &str) -> Response<Vec<u8>> {
    let body = serde_json::json!({ "detail": { "code": "offline", "reason": text } })
        .to_string()
        .into_bytes();
    let mut response = Response::new(body);
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::{install_with_recovery, restore_child};
    use std::cell::Cell;

    #[test]
    fn failed_install_restores_service_and_cannot_restart() {
        let usable = Cell::new(true);
        let result = install_with_recovery(
            || {
                usable.set(false);
                Ok(())
            },
            || Err("AppImage location is unwritable".into()),
            || {
                usable.set(true);
                Ok(())
            },
        );
        assert!(result.is_err(), "only Ok may enter the restart path");
        assert!(usable.get(), "service must be usable after recovery");
    }

    #[cfg(unix)]
    #[test]
    fn failed_install_restores_a_process_that_answers_requests() {
        use std::cell::RefCell;
        use std::io::{BufRead, BufReader, Write};
        use std::process::{Command, Stdio};

        // Synthetic service: an open stdin keeps it alive and each request gets a reply.
        let spawn = || {
            Command::new("sh")
                .args(["-c", "while read -r line; do echo usable; done"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .map_err(|error| error.to_string())
        };
        let child = RefCell::new(spawn().unwrap());
        let result = install_with_recovery(
            || {
                let mut child = child.borrow_mut();
                child.kill().map_err(|error| error.to_string())?;
                child.wait().map_err(|error| error.to_string())?;
                Ok(())
            },
            || Err("AppImage replacement failed".into()),
            || restore_child(&mut child.borrow_mut(), spawn),
        );
        assert!(result.is_err());
        let mut child = child.into_inner();
        writeln!(child.stdin.as_mut().unwrap(), "request").unwrap();
        let mut reply = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut reply)
            .unwrap();
        assert_eq!(reply, "usable\n");
        child.stdin.take();
        assert!(child.wait().unwrap().success());
    }

    #[test]
    fn failed_stop_never_installs() {
        let usable = Cell::new(true);
        let result = install_with_recovery(
            || Err("service stop failed".into()),
            || panic!("must not install with locked service files"),
            || {
                assert!(usable.get());
                usable.set(true);
                Ok(())
            },
        );
        assert!(result.is_err());
        assert!(usable.get());
    }

    #[test]
    fn successful_install_allows_restart_without_recovery() {
        assert!(
            install_with_recovery(|| Ok(()), || Ok(()), || panic!("no recovery on success"))
                .is_ok()
        );
    }
}
