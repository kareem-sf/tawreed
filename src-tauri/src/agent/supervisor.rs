use serde_json::{json, Value};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};
use std::time::Duration;

use super::protocol::{
    AgentRequest, JsonRpcRouter, PendingReply, RouterOutput, JSONRPC_VERSION, KERNEL_HEALTH_METHOD,
    KERNEL_INITIALIZE_METHOD, KERNEL_PROTOCOL_VERSION, MAX_SAFE_REQUEST_ID,
};
use crate::runtime::{PinnedChild, PinnedRuntimeCommand, RuntimeManager};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
// The kernel cancels active turns on stdin EOF within a two-second grace; the outer
// kill deadline stays comfortably above it.
const STOP_KILL_DEADLINE: Duration = Duration::from_secs(5);
const MAX_STDOUT_LINE_BYTES: usize = 16 * 1024 * 1024;
const MAX_STDERR_LINE_BYTES: usize = 64 * 1024;
const STDERR_TAIL_LINES: usize = 40;
const STDERR_TAIL_LINE_CHARACTERS: usize = 400;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

type SharedProcess = tokio::sync::Mutex<Option<AgentProcess>>;
type EventSink = dyn Fn(Value) + Send + Sync;

/// Launches a configured kernel child process speaking JSON-RPC v1 over stdio.
#[async_trait::async_trait]
pub trait KernelLauncher: Send + Sync + 'static {
    async fn spawn_kernel(&self, spec: &KernelSpawnSpec) -> Result<KernelChild, String>;
}

/// Cleared child environment plus an explicit variable allowlist.
pub struct KernelSpawnSpec {
    variables: Vec<(std::ffi::OsString, std::ffi::OsString)>,
}

impl KernelSpawnSpec {
    const ALLOWED_INHERITED_VARIABLES: [&'static str; 7] = [
        "PATH",
        "SYSTEMROOT",
        "TEMP",
        "TMP",
        "HOME",
        "USERPROFILE",
        "CODEX_HOME",
    ];

    fn for_data_directory(data_directory: &Path) -> Self {
        let mut variables: Vec<(std::ffi::OsString, std::ffi::OsString)> =
            Self::ALLOWED_INHERITED_VARIABLES
                .iter()
                .filter_map(|name| std::env::var_os(name).map(|value| ((*name).into(), value)))
                .collect();
        variables.push((
            "TAWREED_DATA_DIR".into(),
            data_directory.as_os_str().to_os_string(),
        ));
        Self { variables }
    }

    fn apply_to_command(&self, command: &mut tokio::process::Command) {
        command.env_clear();
        command.envs(self.variables.iter().cloned());
    }

    fn apply_to_pinned(&self, command: &mut PinnedRuntimeCommand) {
        command.env_clear();
        command.envs(
            self.variables
                .iter()
                .map(|(name, value)| (name.as_os_str(), value.as_os_str())),
        );
    }
}

/// A spawned kernel child; production children stay pinned to their verified runtime.
pub enum KernelChild {
    Pinned(PinnedChild),
    Loose(tokio::process::Child),
}

impl KernelChild {
    fn take_stdin(&mut self) -> Option<tokio::process::ChildStdin> {
        match self {
            Self::Pinned(child) => child.take_stdin(),
            Self::Loose(child) => child.stdin.take(),
        }
    }

    fn take_stdout(&mut self) -> Option<tokio::process::ChildStdout> {
        match self {
            Self::Pinned(child) => child.take_stdout(),
            Self::Loose(child) => child.stdout.take(),
        }
    }

    fn take_stderr(&mut self) -> Option<tokio::process::ChildStderr> {
        match self {
            Self::Pinned(child) => child.take_stderr(),
            Self::Loose(child) => child.stderr.take(),
        }
    }

    async fn wait(&mut self) -> Result<std::process::ExitStatus, String> {
        match self {
            Self::Pinned(child) => child.wait().await,
            Self::Loose(child) => child
                .wait()
                .await
                .map_err(|_| "runtime_process_wait_failed".to_string()),
        }
    }

    async fn kill(&mut self) -> Result<(), String> {
        match self {
            Self::Pinned(child) => child.kill().await,
            Self::Loose(child) => child
                .kill()
                .await
                .map_err(|_| "runtime_process_kill_failed".to_string()),
        }
    }
}

/// Resolves production entrypoints from the managed runtime pointer and falls back to
/// the repository kernel bundle in development.
pub struct StandardKernelLauncher {
    runtime: RuntimeManager,
}

impl StandardKernelLauncher {
    pub fn new(runtime: RuntimeManager) -> Self {
        Self { runtime }
    }

    fn development_command() -> tokio::process::Command {
        let repository_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let entrypoint = repository_root
            .join("agent-kernel")
            .join("dist")
            .join("index.mjs");
        let mut command = tokio::process::Command::new("node");
        command.current_dir(&repository_root).arg(entrypoint);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
}

#[async_trait::async_trait]
impl KernelLauncher for StandardKernelLauncher {
    async fn spawn_kernel(&self, spec: &KernelSpawnSpec) -> Result<KernelChild, String> {
        if cfg!(debug_assertions) {
            let mut command = Self::development_command();
            spec.apply_to_command(&mut command);
            command
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true);
            let child = command
                .spawn()
                .map_err(|_| "agent_spawn_failed".to_string())?;
            Ok(KernelChild::Loose(child))
        } else {
            let pinned_entrypoint = self.runtime.active_entrypoint().await?;
            let mut pinned_command = pinned_entrypoint.command()?;
            spec.apply_to_pinned(&mut pinned_command);
            pinned_command
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            Ok(KernelChild::Pinned(pinned_command.spawn()?))
        }
    }
}

struct AgentProcess {
    child: KernelChild,
    stdin: tokio::process::ChildStdin,
    router: Arc<JsonRpcRouter>,
    generation: u64,
}

/// Long-lived supervisor for the local agent kernel sidecar.
pub struct AgentSupervisor {
    launcher: Box<dyn KernelLauncher>,
    events: Arc<EventSink>,
    app_version: String,
    data_directory: PathBuf,
    process: Arc<SharedProcess>,
    next_id: AtomicU64,
    generation: AtomicU64,
}

impl AgentSupervisor {
    pub fn new(
        app_version: String,
        data_directory: PathBuf,
        launcher: Box<dyn KernelLauncher>,
        events: Arc<EventSink>,
    ) -> Self {
        Self {
            launcher,
            events,
            app_version,
            data_directory,
            process: Arc::new(tokio::sync::Mutex::new(None)),
            next_id: AtomicU64::new(0),
            generation: AtomicU64::new(0),
        }
    }

    /// Verifies the kernel answers `kernel.health` with protocol version 1.
    pub async fn health(&self) -> Result<Value, String> {
        self.request(super::protocol::KERNEL_HEALTH_METHOD, json!({}))
            .await
    }

    /// Cancels a run through the kernel's reserved control capacity.
    pub async fn cancel(&self, run_id: &str) -> Result<Value, String> {
        self.request(
            super::protocol::TURNS_CANCEL_METHOD,
            json!({ "runId": run_id }),
        )
        .await
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.ensure_started().await?;
        let id = allocate_request_id(&self.next_id)?;
        match self.dispatch(id, method, params.clone()).await {
            Ok(reply) => Ok(reply),
            Err(DispatchFailure::Write(_)) => {
                // The request never reached the kernel; respawn once and try again.
                self.expire_current_process().await;
                self.ensure_started().await?;
                let retried_id = allocate_request_id(&self.next_id)?;
                match self.dispatch(retried_id, method, params).await {
                    Ok(reply) => Ok(reply),
                    Err(DispatchFailure::Write(error)) | Err(DispatchFailure::Reply(error)) => {
                        Err(error)
                    }
                }
            }
            Err(DispatchFailure::Reply(error)) => Err(error),
        }
    }

    pub async fn ensure_started(&self) -> Result<(), String> {
        let mut slot = self.process.lock().await;
        if slot.is_some() {
            return Ok(());
        }
        self.start_locked(&mut slot).await
    }

    pub async fn stop(&self) -> Result<(), String> {
        let taken = self.process.lock().await.take();
        let Some(process) = taken else {
            return Err("agent_not_running".into());
        };
        let AgentProcess {
            mut child, stdin, ..
        } = process;
        drop(stdin);
        if tokio::time::timeout(STOP_KILL_DEADLINE, child.wait())
            .await
            .is_err()
        {
            let _ = child.kill().await;
            let _ = tokio::time::timeout(STOP_KILL_DEADLINE, child.wait()).await;
        }
        Ok(())
    }

    #[cfg(test)]
    pub async fn running_generation(&self) -> Option<u64> {
        self.process
            .lock()
            .await
            .as_ref()
            .map(|process| process.generation)
    }

    async fn start_locked(&self, slot: &mut Option<AgentProcess>) -> Result<(), String> {
        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        let spec = KernelSpawnSpec::for_data_directory(&self.data_directory);
        let mut child = self.launcher.spawn_kernel(&spec).await?;
        let stdin = child
            .take_stdin()
            .ok_or_else(|| "agent_spawn_failed".to_string())?;
        let stdout = child
            .take_stdout()
            .ok_or_else(|| "agent_spawn_failed".to_string())?;
        let stderr = child
            .take_stderr()
            .ok_or_else(|| "agent_spawn_failed".to_string())?;
        let router = Arc::new(JsonRpcRouter::default());
        let tail = spawn_stderr_tail(stderr);
        spawn_stdout_reader(
            stdout,
            router.clone(),
            self.events.clone(),
            tail,
            Arc::downgrade(&self.process),
            generation,
        );

        let mut process = AgentProcess {
            child,
            stdin,
            router,
            generation,
        };
        let handshake = async {
            verify_initialization(
                &mut process,
                &self.next_id,
                &self.app_version,
                &self.data_directory,
            )
            .await?;
            verify_health(&mut process, &self.next_id).await?;
            Ok(())
        };
        match tokio::time::timeout(HANDSHAKE_TIMEOUT, handshake).await {
            Ok(Ok(())) => {
                *slot = Some(process);
                Ok(())
            }
            Ok(Err(code)) => {
                terminate_rejected_start(process).await;
                Err(code)
            }
            Err(_) => {
                terminate_rejected_start(process).await;
                Err("agent_handshake_timeout".into())
            }
        }
    }

    async fn dispatch(
        &self,
        id: u64,
        method: &str,
        params: Value,
    ) -> Result<Value, DispatchFailure> {
        let mut slot = self.process.lock().await;
        let process = slot
            .as_mut()
            .ok_or_else(|| DispatchFailure::Write("agent_not_running".into()))?;
        let receiver = dispatch_locked(process, id, method, params).await?;
        drop(slot);
        receiver.await.map_err(DispatchFailure::Reply)
    }

    async fn expire_current_process(&self) {
        let mut slot = self.process.lock().await;
        *slot = None;
    }
}

enum DispatchFailure {
    Write(String),
    Reply(String),
}

async fn dispatch_locked(
    process: &mut AgentProcess,
    id: u64,
    method: &str,
    params: Value,
) -> Result<PendingReply, DispatchFailure> {
    let receiver = process
        .router
        .register(id)
        .map_err(DispatchFailure::Write)?;
    let request = AgentRequest {
        jsonrpc: JSONRPC_VERSION,
        id,
        method: method.to_string(),
        params,
    };
    if let Err(error) = write_request_line(&mut process.stdin, request).await {
        process.router.abandon(id);
        return Err(DispatchFailure::Write(error));
    }
    Ok(receiver)
}

async fn write_request_line(
    stdin: &mut tokio::process::ChildStdin,
    request: AgentRequest,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;

    let line = serde_json::to_vec(&request).map_err(|_| "agent_process_exited".to_string())?;
    let framed = [&line[..], b"\n"].concat();
    stdin
        .write_all(&framed)
        .await
        .and(stdin.flush().await)
        .map_err(|_| "agent_process_exited".to_string())
}

fn allocate_request_id(next_id: &AtomicU64) -> Result<u64, String> {
    let mut observed = next_id.load(Ordering::Relaxed);
    loop {
        if observed > MAX_SAFE_REQUEST_ID {
            return Err("agent_request_id_exhausted".into());
        }
        match next_id.compare_exchange_weak(
            observed,
            observed + 1,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => return Ok(observed),
            Err(actual) => observed = actual,
        }
    }
}

async fn verify_initialization(
    process: &mut AgentProcess,
    next_id: &AtomicU64,
    app_version: &str,
    data_directory: &Path,
) -> Result<(), String> {
    let id = allocate_request_id(next_id)?;
    let receiver = dispatch_locked(
        process,
        id,
        KERNEL_INITIALIZE_METHOD,
        handshake_params(app_version, data_directory),
    )
    .await
    .map_err(failure_code)?;
    let result = receiver.await?;
    if result.get("initialized") != Some(&Value::Bool(true))
        || result.get("protocolVersion") != Some(&json!(KERNEL_PROTOCOL_VERSION))
    {
        return Err("invalid_agent_protocol".into());
    }
    Ok(())
}

fn handshake_params(app_version: &str, data_directory: &Path) -> Value {
    json!({
        "protocolVersion": KERNEL_PROTOCOL_VERSION,
        "appVersion": app_version,
        "dataDirectory": data_directory.to_string_lossy(),
    })
}

async fn verify_health(process: &mut AgentProcess, next_id: &AtomicU64) -> Result<(), String> {
    let id = allocate_request_id(next_id)?;
    let receiver = dispatch_locked(process, id, KERNEL_HEALTH_METHOD, json!({}))
        .await
        .map_err(failure_code)?;
    let result = receiver.await?;
    if result.get("status") != Some(&json!("ok"))
        || result.get("protocolVersion") != Some(&json!(KERNEL_PROTOCOL_VERSION))
    {
        return Err("invalid_agent_protocol".into());
    }
    Ok(())
}

fn failure_code(failure: DispatchFailure) -> String {
    match failure {
        DispatchFailure::Write(error) | DispatchFailure::Reply(error) => error,
    }
}

async fn terminate_rejected_start(process: AgentProcess) {
    let AgentProcess {
        mut child, stdin, ..
    } = process;
    drop(stdin);
    if tokio::time::timeout(STOP_KILL_DEADLINE, child.wait())
        .await
        .is_err()
    {
        let _ = child.kill().await;
        let _ = tokio::time::timeout(STOP_KILL_DEADLINE, child.wait()).await;
    }
}

fn spawn_stdout_reader(
    stdout: tokio::process::ChildStdout,
    router: Arc<JsonRpcRouter>,
    events: Arc<EventSink>,
    tail: Arc<std::sync::Mutex<VecDeque<String>>>,
    process: Weak<SharedProcess>,
    generation: u64,
) {
    tokio::spawn(async move {
        let mut reader = tokio::io::BufReader::new(stdout);
        loop {
            let accepted = match read_bounded_line(&mut reader, MAX_STDOUT_LINE_BYTES).await {
                Ok(InboundLine::Line(line)) => {
                    let without_carriage_return = line.strip_suffix('\r').unwrap_or(&line);
                    Some(router.accept_line(without_carriage_return))
                }
                Ok(InboundLine::Oversized) => Some(Err("invalid_agent_protocol".to_string())),
                Ok(InboundLine::End) | Err(_) => None,
            };
            match accepted {
                Some(Ok(RouterOutput::Event(event))) => events(event),
                Some(Ok(RouterOutput::Response | RouterOutput::Ignored)) => {}
                Some(Err(fault)) => {
                    router.fail_all(&fault);
                    break;
                }
                None => break,
            }
        }
        router.fail_all("agent_process_exited");
        // Deliberate stops remove the process before closing stdin, so an occupant of
        // this generation means the kernel exited on its own.
        let exited_unexpectedly = process_still_installed(&process, generation).await;
        clear_expired_process(&process, generation).await;
        if exited_unexpectedly {
            let excerpt = lock_unpoison(&tail)
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join(" | ");
            if !excerpt.is_empty() {
                crate::store::log_line(&format!(
                    "agent kernel exited unexpectedly; stderr tail: {excerpt}"
                ));
            }
        }
    });
}

fn spawn_stderr_tail(
    stderr: tokio::process::ChildStderr,
) -> Arc<std::sync::Mutex<VecDeque<String>>> {
    let tail: Arc<std::sync::Mutex<VecDeque<String>>> =
        Arc::new(std::sync::Mutex::new(VecDeque::new()));
    let retained_tail = tail.clone();
    tokio::spawn(async move {
        let mut reader = tokio::io::BufReader::new(stderr);
        loop {
            match read_bounded_line(&mut reader, MAX_STDERR_LINE_BYTES).await {
                Ok(InboundLine::Line(line)) => {
                    let mut retained = lock_unpoison(&retained_tail);
                    retained.push_back(bounded_text(&line, STDERR_TAIL_LINE_CHARACTERS));
                    while retained.len() > STDERR_TAIL_LINES {
                        retained.pop_front();
                    }
                }
                Ok(InboundLine::Oversized) => {}
                Ok(InboundLine::End) | Err(_) => break,
            }
        }
    });
    tail
}

enum InboundLine {
    Line(String),
    Oversized,
    End,
}

async fn read_bounded_line<R>(reader: &mut R, maximum_bytes: usize) -> std::io::Result<InboundLine>
where
    R: tokio::io::AsyncBufRead + Unpin,
{
    use tokio::io::AsyncBufReadExt;

    let mut line: Vec<u8> = Vec::new();
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok(if line.is_empty() {
                InboundLine::End
            } else {
                InboundLine::Line(String::from_utf8_lossy(&line).into_owned())
            });
        }
        match available.iter().position(|byte| *byte == b'\n') {
            Some(index) => {
                line.extend_from_slice(&available[..index]);
                reader.consume(index + 1);
                return Ok(InboundLine::Line(
                    String::from_utf8_lossy(&line).into_owned(),
                ));
            }
            None => {
                line.extend_from_slice(available);
                let chunk_length = available.len();
                reader.consume(chunk_length);
                if line.len() > maximum_bytes {
                    return Ok(InboundLine::Oversized);
                }
            }
        }
    }
}

fn bounded_text(text: &str, maximum_characters: usize) -> String {
    if text.chars().count() <= maximum_characters {
        return text.to_string();
    }
    text.chars()
        .rev()
        .take(maximum_characters)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}

async fn clear_expired_process(process: &Weak<SharedProcess>, generation: u64) {
    if let Some(process) = process.upgrade() {
        let mut slot = process.lock().await;
        if slot
            .as_ref()
            .is_some_and(|current| current.generation == generation)
        {
            *slot = None;
        }
    }
}

async fn process_still_installed(process: &Weak<SharedProcess>, generation: u64) -> bool {
    match process.upgrade() {
        Some(process) => {
            let slot = process.lock().await;
            slot.as_ref()
                .is_some_and(|current| current.generation == generation)
        }
        None => false,
    }
}

fn lock_unpoison<T>(mutex: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use std::sync::{Arc, Mutex};

    const FAKE_KERNEL_SCRIPT: &str = r#"
import readline from 'node:readline';
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  switch (request.method) {
    case 'kernel.initialize':
      send({ jsonrpc: '2.0', id: request.id, result: { initialized: true, protocolVersion: 1 } });
      break;
    case 'kernel.health':
      send({ jsonrpc: '2.0', id: request.id, result: { status: 'ok', protocolVersion: 1 } });
      break;
    case 'echo':
      send({ jsonrpc: '2.0', id: request.id, result: request.params });
      break;
    case 'kernel_error':
      send({ jsonrpc: '2.0', id: request.id, error: { code: 'invalid_params', message: 'Invalid method parameters.' } });
      break;
    case 'notify':
      send({ jsonrpc: '2.0', method: 'agent.event', params: { runId: 'run-1', type: 'item.completed', payload: { text: 'hi' } } });
      send({ jsonrpc: '2.0', id: request.id, result: { ok: true } });
      break;
    case 'exit_without_reply':
      setTimeout(() => process.exit(9), 25);
      break;
    default:
      break;
  }
});
"#;

    const UNHEALTHY_KERNEL_SCRIPT: &str = r#"
import readline from 'node:readline';
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.method === 'kernel.initialize') {
    send({ jsonrpc: '2.0', id: request.id, result: { initialized: true, protocolVersion: 1 } });
  } else if (request.method === 'kernel.health') {
    send({ jsonrpc: '2.0', id: request.id, result: { status: 'ok', protocolVersion: 2 } });
  }
});
"#;

    struct ScriptKernelLauncher {
        script_path: PathBuf,
        spawns: Arc<AtomicUsize>,
    }

    #[async_trait::async_trait]
    impl KernelLauncher for ScriptKernelLauncher {
        async fn spawn_kernel(&self, spec: &KernelSpawnSpec) -> Result<KernelChild, String> {
            self.spawns.fetch_add(1, AtomicOrdering::SeqCst);
            let mut command = tokio::process::Command::new("node");
            command
                .arg(&self.script_path)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true);
            spec.apply_to_command(&mut command);
            let child = command
                .spawn()
                .map_err(|_| "agent_spawn_failed".to_string())?;
            Ok(KernelChild::Loose(child))
        }
    }

    struct TestKernel {
        supervisor: AgentSupervisor,
        events: Arc<Mutex<Vec<Value>>>,
        spawns: Arc<AtomicUsize>,
        _script_directory: tempfile::TempDir,
    }

    fn kernel_fixture(script: &str) -> TestKernel {
        let script_directory = tempfile::tempdir().unwrap();
        let script_path = script_directory.path().join("fake-kernel.mjs");
        std::fs::write(&script_path, script).unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let spawns = Arc::new(AtomicUsize::new(0));
        let launcher = ScriptKernelLauncher {
            script_path,
            spawns: spawns.clone(),
        };
        let event_sink = {
            let events = events.clone();
            move |event| events.lock().unwrap().push(event)
        };
        let supervisor = AgentSupervisor::new(
            "0.0.0-test".to_string(),
            script_directory.path().join("data"),
            Box::new(launcher),
            Arc::new(event_sink),
        );
        TestKernel {
            supervisor,
            events,
            spawns,
            _script_directory: script_directory,
        }
    }

    async fn bounded<T>(operation: impl std::future::Future<Output = T>) -> T {
        tokio::time::timeout(Duration::from_secs(15), operation)
            .await
            .expect("agent operation exceeded the test deadline")
    }

    #[test]
    fn allocates_only_javascript_safe_integer_request_ids() {
        assert_eq!(allocate_request_id(&AtomicU64::new(0)).unwrap(), 0);
        let exhausted = AtomicU64::new(9_007_199_254_740_991);
        assert_eq!(
            allocate_request_id(&exhausted).unwrap(),
            9_007_199_254_740_991
        );
        assert_eq!(
            allocate_request_id(&exhausted).unwrap_err(),
            "agent_request_id_exhausted"
        );
    }

    #[tokio::test]
    async fn handshakes_and_routes_requests_against_a_live_kernel() {
        let fixture = kernel_fixture(FAKE_KERNEL_SCRIPT);

        let health = bounded(fixture.supervisor.health()).await.unwrap();

        assert_eq!(health, json!({ "status": "ok", "protocolVersion": 1 }));
        assert_eq!(fixture.spawns.load(AtomicOrdering::SeqCst), 1);

        let echoed = bounded(fixture.supervisor.request("echo", json!({ "value": 42 })))
            .await
            .unwrap();
        assert_eq!(echoed, json!({ "value": 42 }));
        assert_eq!(fixture.spawns.load(AtomicOrdering::SeqCst), 1);
    }

    #[tokio::test]
    async fn surfaces_kernel_error_codes_to_requesters() {
        let fixture = kernel_fixture(FAKE_KERNEL_SCRIPT);

        let error = bounded(fixture.supervisor.request("kernel_error", json!({})))
            .await
            .unwrap_err();

        assert_eq!(error, "invalid_params");
    }

    #[tokio::test]
    async fn forwards_normalized_events_from_the_kernel() {
        let fixture = kernel_fixture(FAKE_KERNEL_SCRIPT);

        let result = bounded(fixture.supervisor.request("notify", json!({})))
            .await
            .unwrap();

        assert_eq!(result, json!({ "ok": true }));
        let events = fixture.events.lock().unwrap();
        assert_eq!(
            *events,
            vec![json!({
                "runId": "run-1",
                "type": "item.completed",
                "payload": { "text": "hi" }
            })]
        );
    }

    #[tokio::test]
    async fn fails_pending_requests_when_the_kernel_exits_without_replying() {
        let fixture = kernel_fixture(FAKE_KERNEL_SCRIPT);

        let error = bounded(fixture.supervisor.request("exit_without_reply", json!({})))
            .await
            .unwrap_err();

        assert_eq!(error, "agent_process_exited");
    }

    #[tokio::test]
    async fn transparently_restarts_the_kernel_after_an_unexpected_exit() {
        let fixture = kernel_fixture(FAKE_KERNEL_SCRIPT);
        bounded(fixture.supervisor.ensure_started()).await.unwrap();

        let crash = bounded(fixture.supervisor.request("exit_without_reply", json!({}))).await;
        assert_eq!(crash.unwrap_err(), "agent_process_exited");

        let restarted = bounded(fixture.supervisor.request("echo", json!({ "again": true })))
            .await
            .unwrap();

        assert_eq!(restarted, json!({ "again": true }));
        assert_eq!(fixture.spawns.load(AtomicOrdering::SeqCst), 2);
    }

    #[tokio::test]
    async fn refuses_kernels_that_report_an_unsupported_protocol_version() {
        let fixture = kernel_fixture(UNHEALTHY_KERNEL_SCRIPT);

        let error = bounded(fixture.supervisor.health()).await.unwrap_err();

        assert_eq!(error, "invalid_agent_protocol");
        assert_eq!(fixture.spawns.load(AtomicOrdering::SeqCst), 1);
    }

    #[tokio::test]
    async fn stop_closes_stdin_and_terminates_the_child_within_the_outer_deadline() {
        let fixture = kernel_fixture(FAKE_KERNEL_SCRIPT);
        bounded(fixture.supervisor.ensure_started()).await.unwrap();

        bounded(fixture.supervisor.stop()).await.unwrap();

        assert!(fixture.supervisor.running_generation().await.is_none());
        assert_eq!(fixture.spawns.load(AtomicOrdering::SeqCst), 1);
    }
}
