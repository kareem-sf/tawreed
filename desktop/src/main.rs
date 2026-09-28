// The desktop window. In development it loads the Vite server, which also starts the local service. Installed, it
// starts the bundled service itself, on a free port with a fresh token, and answers the interface's requests to the
// `api` scheme by forwarding them to the service with that token, so the page never holds it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use tauri::http::{HeaderValue, Method, Request, Response, StatusCode, header};
use tauri::webview::NewWindowResponse;
use tauri::{Manager, UriSchemeContext, WebviewWindowBuilder};

/// The running service. Its standard input stays open while Tawreed runs; when Tawreed exits, or crashes, the
/// system closes it and the service stops (it runs with --exit-with-stdin).
struct Service {
    port: u16,
    token: String,
    ready: AtomicBool,
    _child: Mutex<Child>,
}

const STARTING: Duration = Duration::from_secs(60); // how long a request waits for the service to come up

fn main() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("api", |context: UriSchemeContext<'_, _>, request, responder| {
            let app = context.app_handle().clone();
            thread::spawn(move || {
                let response = match app.try_state::<Service>() {
                    Some(service) => forward(&service, &request),
                    None => plain(StatusCode::SERVICE_UNAVAILABLE, "The Tawreed service isn't running."),
                };
                responder.respond(response);
            });
        })
        .setup(|app| {
            // The window is made here rather than from the config alone, so a link that asks for a new window (the
            // About page's website) opens in the default browser. Tawreed's own window never leaves Tawreed.
            WebviewWindowBuilder::from_config(app.handle(), &app.config().app.windows[0])?
                .on_new_window(|url, _| {
                    if matches!(url.scheme(), "http" | "https") {
                        let _ = open::that_detached(url.as_str());
                    }
                    NewWindowResponse::Deny
                })
                .build()?;
            if !tauri::is_dev() {
                let service = start_service(app)?;
                app.manage(service);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tawreed could not open its window");
}

fn start_service(app: &tauri::App) -> Result<Service, Box<dyn std::error::Error>> {
    let program = app.path().resource_dir()?.join("service").join("tawreed-service.exe");
    let port = TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    let logs = app.path().app_log_dir()?;
    fs::create_dir_all(&logs)?;

    let mut command = Command::new(program);
    command
        .args(["--port", &port.to_string(), "--exit-with-stdin"])
        .env("TAWREED_TOKEN", &token)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(File::create(logs.join("service.log"))?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let child = command.spawn()?;
    Ok(Service { port, token, ready: AtomicBool::new(false), _child: Mutex::new(child) })
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
