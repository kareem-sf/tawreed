// The desktop window. In development it loads the Vite server, which also starts the local service. Installed, it
// starts the bundled service itself, on a free port with a fresh token, and answers the interface's requests to the
// `api` scheme by forwarding them to the service with that token, so the page never holds it. It answers
// `/desktop/update` itself: whether a newer signed Tawreed is published, and installing it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use tauri::http::{HeaderValue, Method, Request, Response, StatusCode, header};
use tauri::{AppHandle, Manager, UriSchemeContext};
use tauri_plugin_updater::UpdaterExt;

/// The running service. Its standard input stays open while Tawreed runs; when Tawreed exits, or crashes, the
/// system closes it and the service stops (it runs with --exit-with-stdin).
struct Service {
    port: u16,
    token: String,
    ready: AtomicBool,
    child: Mutex<Child>,
}

const STARTING: Duration = Duration::from_secs(60); // how long a request waits for the service to come up

fn main() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("api", |context: UriSchemeContext<'_, _>, request, responder| {
            let app = context.app_handle().clone();
            thread::spawn(move || {
                let response = match app.try_state::<Service>() {
                    Some(service) if request.uri().path() == "/desktop/update" => update(&app, &service, request.method()),
                    Some(service) => forward(&service, &request),
                    None => plain(StatusCode::SERVICE_UNAVAILABLE, "The Tawreed service isn't running."),
                };
                responder.respond(response);
            });
        })
        .setup(|app| {
            if !tauri::is_dev() {
                let service = start_service(app.handle())?;
                app.manage(service);
                if signed_updates(app.handle()) {
                    app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tawreed could not open its window");
}

fn start_service(app: &AppHandle) -> Result<Service, Box<dyn std::error::Error>> {
    let port = TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    let child = spawn_service(app, port, &token)?;
    Ok(Service { port, token, ready: AtomicBool::new(false), child: Mutex::new(child) })
}

fn spawn_service(app: &AppHandle, port: u16, token: &str) -> Result<Child, Box<dyn std::error::Error>> {
    let executable = if cfg!(windows) { "tawreed-service.exe" } else { "tawreed-service" };
    let program = app.path().resource_dir()?.join("service").join(executable);
    let logs = app.path().app_log_dir()?;
    fs::create_dir_all(&logs)?;

    let mut command = Command::new(program);
    command
        .args(["--port", &port.to_string(), "--exit-with-stdin"])
        .env("TAWREED_TOKEN", token)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(File::create(logs.join("service.log"))?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(command.spawn()?)
}

/// Updates are on once the release configuration carries the public key that their signatures are checked with.
fn signed_updates(app: &AppHandle) -> bool {
    let updater = app.config().plugins.0.get("updater");
    updater.and_then(|updater| updater["pubkey"].as_str()).is_some_and(|key| !key.is_empty())
}

/// GET says which newer version is published, if any. POST downloads it, checks its signature, stops the service
/// so its files can be replaced, and installs it; Tawreed closes and opens again as the new version.
fn update(app: &AppHandle, service: &Service, method: &Method) -> Response<Vec<u8>> {
    if method == Method::OPTIONS {
        return allowed(Response::builder().status(StatusCode::NO_CONTENT).body(Vec::new()));
    }
    let found = match signed_updates(app) {
        true => tauri::async_runtime::block_on(async { app.updater()?.check().await }),
        false => Ok(None),
    };
    if method != Method::POST {
        // Offline, or the address isn't answering: no update to offer, and nothing to report.
        let version = found.ok().flatten().map_or("null".into(), |update| format!(r#""{}""#, update.version));
        let body = format!(r#"{{"version": {version}}}"#).into_bytes();
        return allowed(Response::builder().header(header::CONTENT_TYPE, "application/json").body(body));
    }
    let Ok(Some(update)) = found else {
        return plain(StatusCode::BAD_GATEWAY, "Tawreed couldn't reach its updates.");
    };
    let Ok(installer) = tauri::async_runtime::block_on(update.download(|_, _| {}, || {})) else {
        return plain(StatusCode::BAD_GATEWAY, "Tawreed couldn't download the update.");
    };
    let result = install_with_recovery(
        || {
            let mut child = service.child.lock().map_err(|error| error.to_string())?;
            child.kill().map_err(|error| error.to_string())?;
            child.wait().map_err(|error| error.to_string())?;
            Ok(())
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
        Err(_) => plain(StatusCode::BAD_GATEWAY, "Tawreed couldn't install the update. Try again; if the service isn't answering, reopen Tawreed."),
    }
}

/// Keep a service that survived a stop failure; otherwise replace the stopped process.
fn restore_child(child: &mut Child, spawn: impl FnOnce() -> Result<Child, String>) -> Result<(), String> {
    if child.try_wait().map_err(|error| error.to_string())?.is_none() {
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
/// still starting, the request waits for it.
fn forward(service: &Service, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return allowed(Response::builder().status(StatusCode::NO_CONTENT).body(Vec::new()));
    }
    let path = request.uri().path_and_query().map_or("/", |p| p.as_str());
    let url = format!("http://127.0.0.1:{}{}", service.port, path);
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    let deadline = Instant::now() + STARTING;
    loop {
        let mut outgoing = ureq::http::Request::builder().method(request.method().clone()).uri(&url);
        for (name, value) in request.headers() {
            if name != header::HOST && name != header::ORIGIN && name != header::AUTHORIZATION {
                outgoing = outgoing.header(name, value);
            }
        }
        outgoing = outgoing.header(header::AUTHORIZATION, format!("Bearer {}", service.token));
        let Ok(outgoing) = outgoing.body(request.body().clone()) else {
            return plain(StatusCode::BAD_REQUEST, "Tawreed couldn't pass the request on.");
        };
        match agent.run(outgoing) {
            Ok(mut answer) => {
                service.ready.store(true, Ordering::Relaxed);
                let mut response = Response::builder().status(answer.status());
                for name in [header::CONTENT_TYPE, header::CONTENT_DISPOSITION] {
                    if let Some(value) = answer.headers().get(&name) {
                        response = response.header(name, value);
                    }
                }
                let body = answer.body_mut().with_config().limit(u64::MAX).read_to_vec().unwrap_or_default();
                return allowed(response.body(body));
            }
            Err(_) if !service.ready.load(Ordering::Relaxed) && Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(250)); // still starting
            }
            Err(_) => return plain(StatusCode::BAD_GATEWAY, "The Tawreed service isn't answering."),
        }
    }
}

/// The page comes from Tawreed's own origin and the service answers on the `api` scheme's, so each answer says
/// the page may read it.
fn allowed(response: Result<Response<Vec<u8>>, tauri::http::Error>) -> Response<Vec<u8>> {
    let Ok(mut response) = response else {
        return plain(StatusCode::INTERNAL_SERVER_ERROR, "Tawreed couldn't pass the answer on.");
    };
    let headers = response.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, PATCH, DELETE"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("Content-Type"));
    headers.insert(header::ACCESS_CONTROL_EXPOSE_HEADERS, HeaderValue::from_static("Content-Disposition"));
    response
}

fn plain(status: StatusCode, text: &str) -> Response<Vec<u8>> {
    let body = format!(r#"{{"detail": {{"code": "offline", "reason": "{text}"}}}}"#).into_bytes();
    allowed(Response::builder().status(status).header(header::CONTENT_TYPE, "application/json").body(body))
}


#[cfg(test)]
mod tests {
    use super::{install_with_recovery, restore_child};
    use std::cell::Cell;

    #[test]
    fn failed_install_restores_service_and_cannot_restart() {
        let usable = Cell::new(true);
        let result = install_with_recovery(
            || { usable.set(false); Ok(()) },
            || Err("AppImage location is unwritable".into()),
            || { usable.set(true); Ok(()) },
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
            Command::new("sh").args(["-c", "while read -r line; do echo usable; done"])
                .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().map_err(|error| error.to_string())
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
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut reply).unwrap();
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
            || { assert!(usable.get()); usable.set(true); Ok(()) },
        );
        assert!(result.is_err());
        assert!(usable.get());
    }

    #[test]
    fn successful_install_allows_restart_without_recovery() {
        assert!(install_with_recovery(|| Ok(()), || Ok(()), || panic!("no recovery on success")).is_ok());
    }
}
