use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

use super::manifest::{valid_entrypoint, validate_asset, RuntimeAsset};
use crate::storage::secure_dir::{file_identity, FileIdentity, SecureDir};
use crate::storage::DataLayout;

const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_EXPANDED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const MAX_RUNTIME_STATE_BYTES: u64 = 16 * 1024;
const MAX_RUNTIME_METADATA_BYTES: u64 = 4 * 1024;
const RUNTIME_STATE_FILE: &str = "runtime-state.json";
const RUNTIME_STATE_LOCK_FILE: &str = "runtime-state.lock";
const RUNTIME_METADATA_FILE: &str = "runtime-metadata.json";

#[async_trait::async_trait]
pub trait RuntimeSource: Send + Sync {
    async fn download(
        &self,
        asset: &RuntimeAsset,
        destination: &mut tokio::fs::File,
        resume_from: u64,
        progress: &(dyn Fn(u64, u64) + Send + Sync),
    ) -> Result<(), String>;
}

pub struct HttpRuntimeSource {
    client: reqwest::Client,
}

impl HttpRuntimeSource {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            client: runtime_http_client()?,
        })
    }

    #[cfg(test)]
    fn with_client(client: reqwest::Client) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl RuntimeSource for HttpRuntimeSource {
    async fn download(
        &self,
        asset: &RuntimeAsset,
        destination: &mut tokio::fs::File,
        resume_from: u64,
        progress: &(dyn Fn(u64, u64) + Send + Sync),
    ) -> Result<(), String> {
        let mut request = self.client.get(&asset.url);
        if resume_from > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={resume_from}-"));
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| "runtime_download_failed".to_string())?;

        let (append, base, response_limit) = match (resume_from, response.status()) {
            (0, reqwest::StatusCode::OK) => (false, 0, asset.size),
            (offset, reqwest::StatusCode::PARTIAL_CONTENT) if offset > 0 => {
                let range = response
                    .headers()
                    .get(reqwest::header::CONTENT_RANGE)
                    .and_then(|value| value.to_str().ok())
                    .and_then(parse_content_range)
                    .ok_or_else(|| "runtime_download_invalid_response".to_string())?;
                if range.start != offset
                    || range.end < range.start
                    || range.end >= range.total
                    || range.total != asset.size
                {
                    return Err("runtime_download_invalid_response".into());
                }
                (true, offset, range.end - range.start + 1)
            }
            (offset, reqwest::StatusCode::OK) if offset > 0 => (false, 0, asset.size),
            _ => return Err("runtime_download_invalid_response".into()),
        };

        if response
            .content_length()
            .is_some_and(|length| length > response_limit)
        {
            return Err("runtime_download_too_large".into());
        }

        if append {
            destination
                .seek(std::io::SeekFrom::Start(resume_from))
                .await
                .map_err(|_| "runtime_download_failed".to_string())?;
        } else {
            destination
                .set_len(0)
                .await
                .map_err(|_| "runtime_download_failed".to_string())?;
            destination
                .seek(std::io::SeekFrom::Start(0))
                .await
                .map_err(|_| "runtime_download_failed".to_string())?;
        }
        let mut received = 0_u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "runtime_download_failed".to_string())?
        {
            received = received
                .checked_add(chunk.len() as u64)
                .ok_or_else(|| "runtime_download_too_large".to_string())?;
            if received > response_limit || base + received > asset.size {
                destination
                    .set_len(0)
                    .await
                    .map_err(|_| "runtime_download_failed".to_string())?;
                return Err("runtime_download_too_large".into());
            }
            destination
                .write_all(&chunk)
                .await
                .map_err(|_| "runtime_download_failed".to_string())?;
            progress(base + received, asset.size);
        }
        destination
            .sync_all()
            .await
            .map_err(|_| "runtime_download_failed".to_string())?;
        Ok(())
    }
}

struct ContentRange {
    start: u64,
    end: u64,
    total: u64,
}

fn parse_content_range(value: &str) -> Option<ContentRange> {
    let value = value.strip_prefix("bytes ")?;
    let (range, total) = value.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    Some(ContentRange {
        start: start.parse().ok()?,
        end: end.parse().ok()?,
        total: total.parse().ok()?,
    })
}

fn allowed_redirect_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(
            url.host_str(),
            Some(
                "github.com"
                    | "objects.githubusercontent.com"
                    | "release-assets.githubusercontent.com"
                    | "github-releases.githubusercontent.com"
            )
        )
}

pub(crate) fn runtime_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                return attempt.error("runtime_redirect_limit");
            }
            if allowed_redirect_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("unsafe_runtime_redirect")
            }
        }))
        .build()
        .map_err(|_| "runtime_download_failed".to_string())
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum InstallPhase {
    Downloading,
    Verifying,
    Activating,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct InstallProgress {
    pub phase: InstallPhase,
    pub progress: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeRecord {
    version: String,
    target: String,
    entrypoint: String,
    sha256: String,
    size: u64,
}

impl RuntimeRecord {
    fn from_asset(asset: &RuntimeAsset) -> Result<Self, String> {
        Ok(Self {
            version: asset.version.clone(),
            target: current_target_key()?.into(),
            entrypoint: asset.entrypoint.clone(),
            sha256: asset.sha256.clone(),
            size: asset.size,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeState {
    schema_version: u32,
    generation: u64,
    current: Option<RuntimeRecord>,
    previous: Option<RuntimeRecord>,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            schema_version: 1,
            generation: 0,
            current: None,
            previous: None,
        }
    }
}

struct RuntimeFs {
    layout: DataLayout,
    runtime: SecureDir,
    versions: SecureDir,
    staging: SecureDir,
}

#[derive(Clone)]
struct VersionLease {
    _file: std::sync::Arc<std::fs::File>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct RuntimeIdentity {
    directory: FileIdentity,
    entrypoint: FileIdentity,
}

struct StageGuard {
    parent: SecureDir,
    name: String,
    directory: Option<SecureDir>,
    identity: Option<FileIdentity>,
    promoted: bool,
}

impl StageGuard {
    fn create(parent: &SecureDir, version: &str) -> Result<Self, String> {
        let name = format!(".runtime-{version}-{}.tmp", uuid::Uuid::new_v4());
        let parent = parent.try_clone().map_err(|_| "runtime_staging_failed")?;
        parent
            .create_dir(&name)
            .map_err(|_| "runtime_staging_failed")?;
        let mut guard = Self {
            parent,
            name,
            directory: None,
            identity: None,
            promoted: false,
        };
        let directory = guard
            .parent
            .open_private_dir(&guard.name)
            .map_err(|_| "runtime_staging_failed")?;
        let identity = directory.identity().map_err(|_| "runtime_staging_failed")?;
        guard.directory = Some(directory);
        guard.identity = Some(identity);
        Ok(guard)
    }

    fn directory(&self) -> Result<&SecureDir, String> {
        self.directory
            .as_ref()
            .ok_or_else(|| "runtime_staging_failed".to_string())
    }

    fn promote(
        mut self,
        versions: &SecureDir,
        version: &str,
        entrypoint: &str,
        informational_path: PathBuf,
        expected_identity: RuntimeIdentity,
        version_lease: VersionLease,
    ) -> Result<PromotedRuntime, String> {
        let cleanup_versions = versions
            .try_clone()
            .map_err(|_| "runtime_activation_failed")?;
        drop(self.directory.take());
        self.parent
            .rename_to(&self.name, versions, version)
            .map_err(|_| "runtime_activation_failed")?;
        self.promoted = true;
        let mut promoted = PromotedRuntime {
            versions: Some(cleanup_versions),
            version: version.to_string(),
            pin: None,
            preserve: false,
            version_lease: Some(version_lease.clone()),
        };
        run_test_after_promotion_before_reopen_hook();
        let version_directory = versions
            .open_private_dir(version)
            .map_err(|_| "runtime_promotion_identity_mismatch")?;
        let pin = PinnedEntrypoint::open(
            version_directory,
            entrypoint,
            informational_path,
            Some(version_lease),
        )
        .map_err(|_| "runtime_promotion_identity_mismatch")?;
        if pin.identity() != expected_identity
            || expected_identity.directory
                != self
                    .identity
                    .ok_or_else(|| "runtime_staging_failed".to_string())?
        {
            return Err("runtime_promotion_identity_mismatch".into());
        }
        promoted.pin = Some(pin);
        Ok(promoted)
    }
}

impl Drop for StageGuard {
    fn drop(&mut self) {
        drop(self.directory.take());
        if !self.promoted {
            let _ = self.parent.remove_dir_all(&self.name);
        }
    }
}

struct PromotedRuntime {
    versions: Option<SecureDir>,
    version: String,
    pin: Option<PinnedEntrypoint>,
    preserve: bool,
    version_lease: Option<VersionLease>,
}

impl PromotedRuntime {
    fn pin(&self) -> Result<&PinnedEntrypoint, String> {
        self.pin
            .as_ref()
            .ok_or_else(|| "runtime_promotion_identity_mismatch".to_string())
    }

    fn preserve(&mut self) {
        self.preserve = true;
    }
}

impl Drop for PromotedRuntime {
    fn drop(&mut self) {
        drop(self.pin.take());
        if !self.preserve {
            if let Some(versions) = self.versions.take() {
                remove_directory_eventually(
                    versions,
                    self.version.clone(),
                    self.version_lease.take(),
                );
            }
        }
    }
}

struct DeferredDirectoryCleanup {
    parent: SecureDir,
    name: String,
    _version_lease: Option<VersionLease>,
}

impl DeferredDirectoryCleanup {
    fn run(self) {
        loop {
            match self.parent.remove_dir_all(&self.name) {
                Ok(()) => return,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
                Err(_) => std::thread::sleep(std::time::Duration::from_millis(10)),
            }
        }
    }
}

fn remove_directory_eventually(
    parent: SecureDir,
    name: String,
    version_lease: Option<VersionLease>,
) {
    match parent.remove_dir_all(&name) {
        Ok(()) => return,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(_) => {}
    }
    let slot = std::sync::Arc::new(std::sync::Mutex::new(Some(DeferredDirectoryCleanup {
        parent,
        name,
        _version_lease: version_lease,
    })));
    let thread_slot = slot.clone();
    if std::thread::Builder::new()
        .name("tawreed-runtime-cleanup".into())
        .spawn(move || {
            let cleanup = thread_slot
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take();
            if let Some(cleanup) = cleanup {
                cleanup.run();
            }
        })
        .is_err()
    {
        let cleanup = slot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some(cleanup) = cleanup {
            cleanup.run();
        }
    }
}

pub struct PinnedEntrypoint {
    informational_path: PathBuf,
    pins: std::sync::Arc<EntrypointPins>,
}

struct EntrypointPins {
    _version_directory: SecureDir,
    _executable: cap_std::fs::File,
    _version_lease: Option<VersionLease>,
    identity: RuntimeIdentity,
}

impl std::fmt::Debug for PinnedEntrypoint {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PinnedEntrypoint")
            .field("informational_path", &self.informational_path)
            .finish_non_exhaustive()
    }
}

impl PinnedEntrypoint {
    fn open(
        version_directory: SecureDir,
        entrypoint: &str,
        informational_path: PathBuf,
        version_lease: Option<VersionLease>,
    ) -> Result<Self, String> {
        let directory_identity = version_directory
            .identity()
            .map_err(|_| "runtime_version_unavailable")?;
        let executable = open_entrypoint(&version_directory, entrypoint)?;
        let entrypoint_identity =
            file_identity(&executable).map_err(|_| "runtime_version_unavailable")?;
        Ok(Self {
            informational_path,
            pins: std::sync::Arc::new(EntrypointPins {
                _version_directory: version_directory,
                _executable: executable,
                _version_lease: version_lease,
                identity: RuntimeIdentity {
                    directory: directory_identity,
                    entrypoint: entrypoint_identity,
                },
            }),
        })
    }

    fn identity(&self) -> RuntimeIdentity {
        self.pins.identity
    }

    pub fn informational_path(&self) -> &Path {
        &self.informational_path
    }

    pub fn command(&self) -> Result<PinnedRuntimeCommand, String> {
        #[cfg(unix)]
        let inherited_executable = duplicate_inheritable_file(&self.pins._executable)?;
        #[cfg(unix)]
        let command_path = {
            use std::os::fd::AsRawFd;

            #[cfg(any(target_os = "linux", target_os = "android"))]
            let root = "/proc/self/fd";
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            let root = "/dev/fd";
            PathBuf::from(format!("{root}/{}", inherited_executable.as_raw_fd()))
        };
        #[cfg(windows)]
        let command_path = self.informational_path.clone();

        Ok(PinnedRuntimeCommand {
            command: tokio::process::Command::new(command_path),
            pins: self.pins.clone(),
            #[cfg(unix)]
            _inherited_executable: inherited_executable,
        })
    }
}

pub struct PinnedRuntimeCommand {
    command: tokio::process::Command,
    pins: std::sync::Arc<EntrypointPins>,
    #[cfg(unix)]
    _inherited_executable: std::fs::File,
}

impl PinnedRuntimeCommand {
    pub fn arg<S: AsRef<std::ffi::OsStr>>(&mut self, argument: S) -> &mut Self {
        self.command.arg(argument);
        self
    }

    pub fn args<I, S>(&mut self, arguments: I) -> &mut Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        self.command.args(arguments);
        self
    }

    pub fn env<K, V>(&mut self, key: K, value: V) -> &mut Self
    where
        K: AsRef<std::ffi::OsStr>,
        V: AsRef<std::ffi::OsStr>,
    {
        self.command.env(key, value);
        self
    }

    pub fn envs<I, K, V>(&mut self, variables: I) -> &mut Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: AsRef<std::ffi::OsStr>,
        V: AsRef<std::ffi::OsStr>,
    {
        self.command.envs(variables);
        self
    }

    pub fn env_remove<K: AsRef<std::ffi::OsStr>>(&mut self, key: K) -> &mut Self {
        self.command.env_remove(key);
        self
    }

    pub fn env_clear(&mut self) -> &mut Self {
        self.command.env_clear();
        self
    }

    pub fn current_dir<P: AsRef<Path>>(&mut self, directory: P) -> &mut Self {
        self.command.current_dir(directory);
        self
    }

    pub fn stdin(&mut self, configuration: std::process::Stdio) -> &mut Self {
        self.command.stdin(configuration);
        self
    }

    pub fn stdout(&mut self, configuration: std::process::Stdio) -> &mut Self {
        self.command.stdout(configuration);
        self
    }

    pub fn stderr(&mut self, configuration: std::process::Stdio) -> &mut Self {
        self.command.stderr(configuration);
        self
    }

    #[cfg(unix)]
    fn process_group(&mut self, process_group: i32) -> &mut Self {
        self.command.process_group(process_group);
        self
    }

    pub fn spawn(&mut self) -> Result<PinnedChild, String> {
        self.command.kill_on_drop(true);
        let child = self
            .command
            .spawn()
            .map_err(|_| "runtime_process_start_failed".to_string())?;
        Ok(PinnedChild {
            child: Some(child),
            pins: Some(self.pins.clone()),
            #[cfg(test)]
            reaper_gate: take_test_child_reaper_gate(),
        })
    }
}

pub struct PinnedChild {
    child: Option<tokio::process::Child>,
    pins: Option<std::sync::Arc<EntrypointPins>>,
    #[cfg(test)]
    reaper_gate: Option<ChildReaperTestGate>,
}

#[cfg(test)]
type ChildReaperTestGate = std::sync::Arc<(std::sync::Mutex<(bool, bool)>, std::sync::Condvar)>;

#[cfg(test)]
thread_local! {
    static TEST_CHILD_REAPER_GATE: std::cell::RefCell<Option<ChildReaperTestGate>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn set_test_child_reaper_gate(gate: ChildReaperTestGate) {
    TEST_CHILD_REAPER_GATE.with(|slot| *slot.borrow_mut() = Some(gate));
}

#[cfg(test)]
fn take_test_child_reaper_gate() -> Option<ChildReaperTestGate> {
    TEST_CHILD_REAPER_GATE.with(|slot| slot.borrow_mut().take())
}

impl PinnedChild {
    pub fn id(&self) -> Option<u32> {
        self.child.as_ref().and_then(tokio::process::Child::id)
    }

    pub fn try_wait(&mut self) -> Result<Option<std::process::ExitStatus>, String> {
        self.child_mut_internal()?
            .try_wait()
            .map_err(|_| "runtime_process_wait_failed".to_string())
    }

    pub fn take_stdin(&mut self) -> Option<tokio::process::ChildStdin> {
        self.child.as_mut()?.stdin.take()
    }

    pub fn take_stdout(&mut self) -> Option<tokio::process::ChildStdout> {
        self.child.as_mut()?.stdout.take()
    }

    pub fn take_stderr(&mut self) -> Option<tokio::process::ChildStderr> {
        self.child.as_mut()?.stderr.take()
    }

    pub async fn wait(&mut self) -> Result<std::process::ExitStatus, String> {
        self.child_mut_internal()?
            .wait()
            .await
            .map_err(|_| "runtime_process_wait_failed".to_string())
    }

    pub async fn kill(&mut self) -> Result<(), String> {
        self.child_mut_internal()?
            .kill()
            .await
            .map_err(|_| "runtime_process_kill_failed".to_string())
    }

    pub fn start_kill(&mut self) -> Result<(), String> {
        self.child_mut_internal()?
            .start_kill()
            .map_err(|_| "runtime_process_kill_failed".to_string())
    }

    fn child_mut_internal(&mut self) -> Result<&mut tokio::process::Child, String> {
        self.child
            .as_mut()
            .ok_or_else(|| "runtime_process_unavailable".to_string())
    }

    #[cfg(windows)]
    fn raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
        self.child.as_ref()?.raw_handle()
    }
}

struct ChildReaperPayload {
    child: tokio::process::Child,
    _pins: std::sync::Arc<EntrypointPins>,
    #[cfg(test)]
    gate: Option<ChildReaperTestGate>,
}

impl ChildReaperPayload {
    fn reap(mut self) {
        #[cfg(test)]
        if let Some(gate) = self.gate.take() {
            let (state, condition) = &*gate;
            let mut state = state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.0 = true;
            condition.notify_all();
            while !state.1 {
                state = condition
                    .wait(state)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
        }
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) | Err(_) => {
                    let _ = self.child.start_kill();
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
            }
        }
    }
}

impl Drop for PinnedChild {
    fn drop(&mut self) {
        let (Some(mut child), Some(pins)) = (self.child.take(), self.pins.take()) else {
            return;
        };
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        let _ = child.start_kill();
        let payload = ChildReaperPayload {
            child,
            _pins: pins,
            #[cfg(test)]
            gate: self.reaper_gate.take(),
        };
        let slot = std::sync::Arc::new(std::sync::Mutex::new(Some(payload)));
        let thread_slot = slot.clone();
        // An OS thread keeps child and pins alive even when Tokio is absent or shutting down.
        // The shared slot preserves ownership for synchronous reaping if thread creation fails.
        if std::thread::Builder::new()
            .name("tawreed-runtime-child-reaper".into())
            .spawn(move || {
                let payload = thread_slot
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .take();
                if let Some(payload) = payload {
                    payload.reap();
                }
            })
            .is_err()
        {
            let payload = slot
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take();
            if let Some(payload) = payload {
                payload.reap();
            }
        }
    }
}

impl RuntimeFs {
    fn open(layout: &DataLayout) -> Result<Self, String> {
        let root = SecureDir::open_private_root(&layout.root).map_err(|_| "unsafe_runtime_root")?;
        let runtime = root
            .open_or_create_private_dir("runtime")
            .map_err(|_| "unsafe_runtime_root")?;
        let versions = runtime
            .open_or_create_private_dir("versions")
            .map_err(|_| "unsafe_runtime_root")?;
        let staging = root
            .open_or_create_private_dir("staging")
            .map_err(|_| "unsafe_runtime_root")?;
        Ok(Self {
            layout: layout.clone(),
            runtime,
            versions,
            staging,
        })
    }

    fn read_state(&self) -> Result<RuntimeState, String> {
        let _lock = self.lock_state()?;
        self.read_state_unlocked()
    }

    fn read_state_unlocked(&self) -> Result<RuntimeState, String> {
        let bytes = match self
            .runtime
            .read_bytes_limited(RUNTIME_STATE_FILE, MAX_RUNTIME_STATE_BYTES)
        {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(RuntimeState::default())
            }
            Err(_) => return Err("invalid_runtime_state".into()),
        };
        let state: RuntimeState =
            serde_json::from_slice(&bytes).map_err(|_| "invalid_runtime_state")?;
        if state.schema_version != 1 {
            return Err("invalid_runtime_state".into());
        }
        if let Some(record) = &state.current {
            validate_record(record)?;
        }
        if let Some(record) = &state.previous {
            validate_record(record)?;
        }
        Ok(state)
    }

    fn write_state_unlocked(&self, state: &RuntimeState) -> Result<(), String> {
        run_test_before_state_publish_hook().map_err(|_| "runtime_activation_failed")?;
        self.runtime
            .atomic_write_json(RUNTIME_STATE_FILE, state)
            .map_err(|_| "runtime_activation_failed".to_string())
    }

    fn lock_state(&self) -> Result<std::fs::File, String> {
        let file = self
            .runtime
            .open_or_create_lock_file(RUNTIME_STATE_LOCK_FILE)
            .map_err(|_| "runtime_state_lock_failed")?
            .into_std();
        fs2::FileExt::lock_exclusive(&file).map_err(|_| "runtime_state_lock_failed")?;
        Ok(file)
    }

    async fn lock_version(&self, record: &RuntimeRecord) -> Result<VersionLease, String> {
        let name = format!("runtime-version-{}.lock", record.version);
        let file = self
            .runtime
            .open_or_create_lock_file(&name)
            .map_err(|_| "runtime_version_lock_failed")?
            .into_std();
        loop {
            match fs2::FileExt::try_lock_exclusive(&file) {
                Ok(()) => {
                    return Ok(VersionLease {
                        _file: std::sync::Arc::new(file),
                    })
                }
                Err(error)
                    if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() =>
                {
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
                Err(_) => return Err("runtime_version_lock_failed".into()),
            }
        }
    }

    async fn lock_versions(&self, records: &[RuntimeRecord]) -> Result<Vec<VersionLease>, String> {
        let mut records = records.iter().collect::<Vec<_>>();
        records.sort_by(|left, right| left.version.cmp(&right.version));
        records.dedup_by(|left, right| left.version == right.version);
        let mut leases = Vec::with_capacity(records.len());
        for record in records {
            leases.push(self.lock_version(record).await?);
        }
        Ok(leases)
    }

    fn cleanup_stale_staging(&self, version: &str) -> Result<(), String> {
        let prefix = format!(".runtime-{version}-");
        for entry in self
            .staging
            .entries()
            .map_err(|_| "runtime_staging_failed")?
        {
            let Some(name) = entry.to_str() else {
                continue;
            };
            let Some(identifier) = name
                .strip_prefix(&prefix)
                .and_then(|name| name.strip_suffix(".tmp"))
            else {
                continue;
            };
            if uuid::Uuid::parse_str(identifier).is_err() {
                continue;
            }
            match self.staging.symlink_metadata(name) {
                Ok(metadata) if metadata.is_dir() => self
                    .staging
                    .remove_dir_all(name)
                    .map_err(|_| "runtime_staging_failed")?,
                Ok(_) => self
                    .staging
                    .remove_file_or_symlink(name)
                    .map_err(|_| "runtime_staging_failed")?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err("runtime_staging_failed".into()),
            }
        }
        Ok(())
    }

    fn commit_activation(
        &self,
        expected_generation: u64,
        record: RuntimeRecord,
        pinned_entrypoint: &PinnedEntrypoint,
    ) -> Result<(), String> {
        let _lock = self.lock_state()?;
        run_test_after_promoted_health_before_commit_hook();
        let _rechecked_entrypoint =
            self.reopen_matching_entrypoint(&record, pinned_entrypoint.identity())?;
        let state = self.read_state_unlocked()?;
        if state.generation < expected_generation {
            return Err("runtime_state_stale".into());
        }
        if state.current.as_ref() == Some(&record) {
            return Ok(());
        }
        let generation = state
            .generation
            .checked_add(1)
            .ok_or_else(|| "invalid_runtime_state".to_string())?;
        self.write_state_unlocked(&RuntimeState {
            schema_version: 1,
            generation,
            previous: state.current,
            current: Some(record),
        })
    }

    fn commit_rollback(
        &self,
        expected_generation: u64,
        expected_current: RuntimeRecord,
        expected_previous: RuntimeRecord,
        pinned_entrypoint: &PinnedEntrypoint,
    ) -> Result<(), String> {
        let _lock = self.lock_state()?;
        let _rechecked_entrypoint =
            self.reopen_matching_entrypoint(&expected_previous, pinned_entrypoint.identity())?;
        let state = self.read_state_unlocked()?;
        if state.generation != expected_generation
            || state.current.as_ref() != Some(&expected_current)
            || state.previous.as_ref() != Some(&expected_previous)
        {
            return Err("runtime_state_stale".into());
        }
        let generation = state
            .generation
            .checked_add(1)
            .ok_or_else(|| "invalid_runtime_state".to_string())?;
        self.write_state_unlocked(&RuntimeState {
            schema_version: 1,
            generation,
            current: Some(expected_previous),
            previous: Some(expected_current),
        })
    }

    fn read_version_metadata(&self, version: &str) -> Result<RuntimeRecord, String> {
        let directory = self
            .versions
            .open_private_dir(version)
            .map_err(|_| "runtime_version_unavailable")?;
        let bytes = directory
            .read_bytes_limited(RUNTIME_METADATA_FILE, MAX_RUNTIME_METADATA_BYTES)
            .map_err(|_| "invalid_runtime_metadata")?;
        let record: RuntimeRecord =
            serde_json::from_slice(&bytes).map_err(|_| "invalid_runtime_metadata")?;
        validate_record(&record)?;
        if record.version != version {
            return Err("invalid_runtime_metadata".into());
        }
        Ok(record)
    }

    fn version_exists(&self, version: &str) -> Result<bool, String> {
        match self.versions.symlink_metadata(version) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(_) => Err("unsafe_runtime_version".into()),
        }
    }

    fn remove_version_entry(&self, version: &str) -> Result<(), String> {
        let metadata = self
            .versions
            .symlink_metadata(version)
            .map_err(|_| "runtime_orphan_cleanup_failed")?;
        if metadata.is_dir() {
            self.versions
                .remove_dir_all(version)
                .map_err(|_| "runtime_orphan_cleanup_failed".to_string())
        } else {
            self.versions
                .remove_file_or_symlink(version)
                .map_err(|_| "runtime_orphan_cleanup_failed".to_string())
        }
    }

    fn remove_version_if_unreferenced(&self, record: &RuntimeRecord) -> Result<(), String> {
        run_test_before_orphan_delete_hook();
        let _state_lock = self.lock_state()?;
        let state = self.read_state_unlocked()?;
        if state
            .current
            .as_ref()
            .is_some_and(|current| current.version == record.version)
            || state
                .previous
                .as_ref()
                .is_some_and(|previous| previous.version == record.version)
        {
            return Err("runtime_version_referenced".into());
        }
        self.remove_version_entry(&record.version)
    }

    fn reopen_matching_entrypoint(
        &self,
        record: &RuntimeRecord,
        expected_identity: RuntimeIdentity,
    ) -> Result<PinnedEntrypoint, String> {
        let version_directory = self
            .versions
            .open_private_dir(&record.version)
            .map_err(|_| "runtime_promotion_identity_mismatch")?;
        let pin = PinnedEntrypoint::open(
            version_directory,
            &record.entrypoint,
            self.active_path(record),
            None,
        )
        .map_err(|_| "runtime_promotion_identity_mismatch")?;
        if pin.identity() != expected_identity {
            return Err("runtime_promotion_identity_mismatch".into());
        }
        Ok(pin)
    }

    fn active_path(&self, record: &RuntimeRecord) -> PathBuf {
        self.layout
            .runtime_versions
            .join(&record.version)
            .join(&record.entrypoint)
    }
}

pub struct RuntimeInstaller<S> {
    layout: DataLayout,
    source: S,
    #[cfg(test)]
    rollback_commit_hook: std::sync::Mutex<Option<Box<dyn FnOnce() + Send>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommittedRuntime {
    pub version: String,
    pub entrypoint: PathBuf,
}

impl<S: RuntimeSource> RuntimeInstaller<S> {
    pub fn new(layout: DataLayout, source: S) -> Self {
        Self {
            layout,
            source,
            #[cfg(test)]
            rollback_commit_hook: std::sync::Mutex::new(None),
        }
    }

    pub async fn ensure(&self, asset: &RuntimeAsset) -> Result<PathBuf, String> {
        self.ensure_with_progress(asset, &|_| {}).await
    }

    pub(crate) async fn ensure_with_progress(
        &self,
        asset: &RuntimeAsset,
        progress: &(dyn Fn(InstallProgress) + Send + Sync),
    ) -> Result<PathBuf, String> {
        validate_asset(asset)?;
        if asset.version.len() > 40 {
            return Err("invalid_runtime_asset".into());
        }
        let fs = RuntimeFs::open(&self.layout)?;
        let record = RuntimeRecord::from_asset(asset)?;
        let version_lease = fs.lock_version(&record).await?;
        fs.cleanup_stale_staging(&record.version)?;
        let state = fs.read_state()?;

        if state
            .current
            .as_ref()
            .is_some_and(|current| current == &record)
        {
            report_reuse_progress(progress);
            let pinned_entrypoint = verify_installed_version(&fs, &record).await?;
            run_test_after_current_health_hook();
            publish_active_record(&fs, state.generation, record.clone(), &pinned_entrypoint)?;
            return Ok(fs.layout.runtime_versions.join(&record.version));
        }

        if fs.version_exists(&record.version)? {
            let referenced = state
                .current
                .as_ref()
                .is_some_and(|current| current.version == record.version)
                || state
                    .previous
                    .as_ref()
                    .is_some_and(|previous| previous.version == record.version);
            match fs.read_version_metadata(&record.version) {
                Ok(metadata) if metadata == record => {
                    match verify_installed_version(&fs, &record).await {
                        Ok(pinned_entrypoint) => {
                            report_reuse_progress(progress);
                            publish_active_record(
                                &fs,
                                state.generation,
                                record.clone(),
                                &pinned_entrypoint,
                            )?;
                            return Ok(fs.layout.runtime_versions.join(&record.version));
                        }
                        Err(error) if referenced => return Err(error),
                        Err(_) => fs.remove_version_if_unreferenced(&record)?,
                    }
                }
                _ if referenced => return Err("invalid_runtime_metadata".into()),
                _ => fs.remove_version_if_unreferenced(&record)?,
            }
        }

        let part_name = format!("{}-{}.zip.part", current_target_key()?, asset.version);
        let archive = fs
            .staging
            .open_or_create_private_rw(&part_name)
            .map_err(|_| "unsafe_runtime_download_path")?;
        let mut existing = archive
            .metadata()
            .map_err(|_| "runtime_download_failed")?
            .len();
        if existing > asset.size {
            archive.set_len(0).map_err(|_| "runtime_download_failed")?;
            existing = 0;
        }
        report_download_progress(progress, existing, asset.size);
        let mut archive = tokio::fs::File::from_std(archive.into_std());
        if existing < asset.size {
            let download_progress = |downloaded, total| {
                report_download_progress(progress, downloaded, total);
            };
            self.source
                .download(asset, &mut archive, existing, &download_progress)
                .await?;
        }
        archive
            .sync_all()
            .await
            .map_err(|_| "runtime_download_failed")?;
        let mut archive = archive.into_std().await;
        progress(InstallProgress {
            phase: InstallPhase::Verifying,
            progress: 85.0,
        });
        if let Err(error) = verify_archive_handle(&mut archive, asset) {
            if error == "runtime_hash_mismatch" {
                drop(archive);
                fs.staging
                    .remove_file_or_symlink(&part_name)
                    .map_err(|_| "runtime_download_cleanup_failed")?;
            }
            return Err(error);
        }
        run_test_after_archive_verify_hook();

        progress(InstallProgress {
            phase: InstallPhase::Activating,
            progress: 95.0,
        });
        let staging = StageGuard::create(&fs.staging, &asset.version)?;
        extract_archive(&mut archive, staging.directory()?)?;
        staging
            .directory()?
            .atomic_write_json(RUNTIME_METADATA_FILE, &record)
            .map_err(|_| "runtime_metadata_write_failed")?;
        let staged_entrypoint_path = fs
            .layout
            .staging
            .join(&staging.name)
            .join(&asset.entrypoint);
        let staged_entrypoint = PinnedEntrypoint::open(
            staging
                .directory()?
                .try_clone()
                .map_err(|_| "runtime_staging_failed")?,
            &asset.entrypoint,
            staged_entrypoint_path,
            None,
        )?;
        let staged_identity = staged_entrypoint.identity();
        #[cfg(windows)]
        drop(staged_entrypoint);

        if fs.version_exists(&asset.version)? {
            return Err("runtime_version_already_exists".into());
        }
        let mut promoted = staging.promote(
            &fs.versions,
            &asset.version,
            &asset.entrypoint,
            fs.active_path(&record),
            staged_identity,
            version_lease,
        )?;
        #[cfg(unix)]
        drop(staged_entrypoint);
        run_health_check(promoted.pin()?).await?;
        match publish_active_record(&fs, state.generation, record, promoted.pin()?) {
            Ok(()) => promoted.preserve(),
            Err(error) if error == "runtime_promotion_identity_mismatch" => return Err(error),
            Err(error) => {
                promoted.preserve();
                return Err(error);
            }
        }
        Ok(fs.layout.runtime_versions.join(&asset.version))
    }

    pub async fn active_entrypoint(&self) -> Result<PinnedEntrypoint, String> {
        let fs = RuntimeFs::open(&self.layout)?;
        let initial = fs.read_state()?;
        let record = initial
            .current
            .ok_or_else(|| "runtime_not_installed".to_string())?;
        let version_lease = fs.lock_version(&record).await?;
        let current = fs.read_state()?.current;
        if current.as_ref() != Some(&record) {
            return Err("runtime_state_stale".into());
        }
        validate_installed_record(&fs, &record)?;
        let version_directory = fs
            .versions
            .open_private_dir(&record.version)
            .map_err(|_| "runtime_version_unavailable")?;
        PinnedEntrypoint::open(
            version_directory,
            &record.entrypoint,
            fs.active_path(&record),
            Some(version_lease),
        )
    }

    pub async fn rollback(&self) -> Result<CommittedRuntime, String> {
        let fs = RuntimeFs::open(&self.layout)?;
        let state = fs.read_state()?;
        let current = state
            .current
            .clone()
            .ok_or_else(|| "runtime_not_installed".to_string())?;
        let previous = state
            .previous
            .clone()
            .ok_or_else(|| "runtime_rollback_unavailable".to_string())?;
        let _version_leases = fs
            .lock_versions(&[current.clone(), previous.clone()])
            .await?;
        validate_installed_record(&fs, &previous)?;
        let entrypoint = fs.active_path(&previous);
        let version_directory = fs
            .versions
            .open_private_dir(&previous.version)
            .map_err(|_| "runtime_version_unavailable")?;
        let pinned_entrypoint = PinnedEntrypoint::open(
            version_directory,
            &previous.entrypoint,
            entrypoint.clone(),
            None,
        )?;
        run_health_check(&pinned_entrypoint).await?;
        let version = previous.version.clone();
        fs.commit_rollback(state.generation, current, previous, &pinned_entrypoint)?;
        #[cfg(test)]
        if let Some(hook) = self
            .rollback_commit_hook
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            hook();
        }
        Ok(CommittedRuntime {
            version,
            entrypoint,
        })
    }

    #[cfg(test)]
    pub(crate) fn set_test_after_rollback_commit_hook(&self, hook: impl FnOnce() + Send + 'static) {
        *self
            .rollback_commit_hook
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Box::new(hook));
    }
}

fn report_reuse_progress(progress: &(dyn Fn(InstallProgress) + Send + Sync)) {
    for (phase, value) in [
        (InstallPhase::Downloading, 80.0),
        (InstallPhase::Verifying, 85.0),
        (InstallPhase::Activating, 95.0),
    ] {
        progress(InstallProgress {
            phase,
            progress: value,
        });
    }
}

fn publish_active_record(
    fs: &RuntimeFs,
    expected_generation: u64,
    record: RuntimeRecord,
    pinned_entrypoint: &PinnedEntrypoint,
) -> Result<(), String> {
    fs.commit_activation(expected_generation, record, pinned_entrypoint)
}

fn validate_record(record: &RuntimeRecord) -> Result<(), String> {
    let version = semver::Version::parse(&record.version).map_err(|_| "invalid_runtime_state")?;
    if record.target != current_target_key()?
        || record.version.len() > 40
        || version.to_string() != record.version
        || !version.pre.is_empty()
        || !version.build.is_empty()
        || !valid_entrypoint(&record.entrypoint)
        || record.sha256.len() != 64
        || !record
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || record.size == 0
    {
        return Err("invalid_runtime_state".into());
    }
    Ok(())
}

fn validate_installed_record(fs: &RuntimeFs, record: &RuntimeRecord) -> Result<(), String> {
    validate_record(record)?;
    if fs.read_version_metadata(&record.version)? != *record {
        return Err("invalid_runtime_metadata".into());
    }
    let directory = fs
        .versions
        .open_private_dir(&record.version)
        .map_err(|_| "runtime_version_unavailable")?;
    open_entrypoint(&directory, &record.entrypoint)?;
    Ok(())
}

async fn verify_installed_version(
    fs: &RuntimeFs,
    record: &RuntimeRecord,
) -> Result<PinnedEntrypoint, String> {
    validate_installed_record(fs, record)?;
    let version_directory = fs
        .versions
        .open_private_dir(&record.version)
        .map_err(|_| "runtime_version_unavailable")?;
    let pinned_entrypoint = PinnedEntrypoint::open(
        version_directory,
        &record.entrypoint,
        fs.active_path(record),
        None,
    )?;
    run_health_check(&pinned_entrypoint).await?;
    Ok(pinned_entrypoint)
}

fn report_download_progress(
    callback: &(dyn Fn(InstallProgress) + Send + Sync),
    downloaded: u64,
    total: u64,
) {
    let fraction = if total == 0 {
        0.0
    } else {
        downloaded.min(total) as f64 / total as f64
    };
    callback(InstallProgress {
        phase: InstallPhase::Downloading,
        progress: fraction * 80.0,
    });
}

fn verify_archive_handle(file: &mut std::fs::File, asset: &RuntimeAsset) -> Result<(), String> {
    let size = file
        .metadata()
        .map_err(|_| "runtime_download_failed")?
        .len();
    if size != asset.size {
        return Err("runtime_size_mismatch".into());
    }

    file.seek(SeekFrom::Start(0))
        .map_err(|_| "runtime_download_failed")?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "runtime_download_failed")?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    let actual = digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if actual != asset.sha256 {
        return Err("runtime_hash_mismatch".into());
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|_| "runtime_download_failed")?;
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ArchiveEntryKind {
    Directory,
    File,
}

struct ArchivePlanEntry {
    index: usize,
    components: Vec<String>,
    kind: ArchiveEntryKind,
    size: u64,
    executable: bool,
}

fn extract_archive(
    archive_file: &mut std::fs::File,
    staging_root: &SecureDir,
) -> Result<(), String> {
    let declared_entries = central_directory_entry_count(archive_file)?;
    archive_file
        .seek(SeekFrom::Start(0))
        .map_err(|_| "invalid_runtime_archive")?;
    let mut archive = zip::ZipArchive::new(archive_file).map_err(|_| "invalid_runtime_archive")?;
    if archive.len() != declared_entries {
        return Err("unsafe_runtime_archive".into());
    }
    let plan = preflight_archive(&mut archive)?;
    for item in plan {
        let entry = archive
            .by_index(item.index)
            .map_err(|_| "invalid_runtime_archive")?;
        let parent = open_or_create_parent(staging_root, &item.components)?;
        let name = item.components.last().ok_or("unsafe_runtime_archive")?;
        if item.kind == ArchiveEntryKind::Directory {
            parent
                .open_or_create_private_dir(name)
                .map_err(|_| "runtime_extraction_failed")?;
            continue;
        }
        let mut output = parent
            .create_private_file(name, item.executable)
            .map_err(|_| "runtime_extraction_failed")?;
        let copied = std::io::copy(&mut entry.take(item.size + 1), &mut output)
            .map_err(|_| "runtime_extraction_failed")?;
        if copied != item.size {
            return Err("invalid_runtime_archive".into());
        }
        output.sync_all().map_err(|_| "runtime_extraction_failed")?;
    }
    Ok(())
}

fn central_directory_entry_count(file: &mut std::fs::File) -> Result<usize, String> {
    let length = file
        .metadata()
        .map_err(|_| "invalid_runtime_archive")?
        .len();
    let tail_length = length.min(65_557) as usize;
    file.seek(SeekFrom::End(-(tail_length as i64)))
        .map_err(|_| "invalid_runtime_archive")?;
    let mut tail = vec![0_u8; tail_length];
    file.read_exact(&mut tail)
        .map_err(|_| "invalid_runtime_archive")?;
    let offset = tail
        .windows(4)
        .rposition(|window| window == b"PK\x05\x06")
        .ok_or_else(|| "invalid_runtime_archive".to_string())?;
    if offset + 22 > tail.len() {
        return Err("invalid_runtime_archive".into());
    }
    let disk_entries = u16::from_le_bytes([tail[offset + 8], tail[offset + 9]]);
    let total_entries = u16::from_le_bytes([tail[offset + 10], tail[offset + 11]]);
    let comment_length = u16::from_le_bytes([tail[offset + 20], tail[offset + 21]]) as usize;
    if total_entries as usize > MAX_ARCHIVE_ENTRIES {
        return Err("runtime_archive_too_large".into());
    }
    if disk_entries != total_entries
        || total_entries == u16::MAX
        || offset + 22 + comment_length != tail.len()
    {
        return Err("invalid_runtime_archive".into());
    }
    Ok(total_entries as usize)
}

fn preflight_archive<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<Vec<ArchivePlanEntry>, String> {
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("runtime_archive_too_large".into());
    }
    let mut expanded = 0_u64;
    let mut namespace = BTreeMap::<String, ArchiveEntryKind>::new();
    let mut plan = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| "invalid_runtime_archive")?;
        let entry_name = entry.name().to_string();
        let relative = entry
            .enclosed_name()
            .ok_or("unsafe_runtime_archive")?
            .to_owned();
        let kind = if entry.is_dir() {
            ArchiveEntryKind::Directory
        } else {
            ArchiveEntryKind::File
        };
        let unix_mode = entry.unix_mode();
        if !safe_archive_name(&entry_name, &relative) || unsafe_unix_file_type(unix_mode, kind) {
            return Err("unsafe_runtime_archive".into());
        }
        let expected_size = entry.size();
        expanded = expanded
            .checked_add(expected_size)
            .ok_or_else(|| "runtime_archive_too_large".to_string())?;
        if expanded > MAX_EXPANDED_BYTES {
            return Err("runtime_archive_too_large".into());
        }
        if kind == ArchiveEntryKind::Directory && expected_size != 0 {
            return Err("invalid_runtime_archive".into());
        }
        let components = relative
            .components()
            .map(|component| match component {
                Component::Normal(value) => value
                    .to_str()
                    .map(str::to_string)
                    .ok_or_else(|| "unsafe_runtime_archive".to_string()),
                _ => Err("unsafe_runtime_archive".into()),
            })
            .collect::<Result<Vec<_>, _>>()?;
        let normalized = components
            .iter()
            .map(|component| component.to_lowercase())
            .collect::<Vec<_>>();
        let key = normalized.join("/");
        if key == RUNTIME_METADATA_FILE {
            return Err("unsafe_runtime_archive".into());
        }
        for end in 1..normalized.len() {
            let ancestor = normalized[..end].join("/");
            match namespace.get(&ancestor) {
                Some(ArchiveEntryKind::File) => return Err("unsafe_runtime_archive".into()),
                Some(ArchiveEntryKind::Directory) => {}
                None => {
                    namespace.insert(ancestor, ArchiveEntryKind::Directory);
                }
            }
        }
        if namespace.contains_key(&key)
            || (kind == ArchiveEntryKind::File
                && namespace
                    .keys()
                    .any(|existing| existing.starts_with(&(key.clone() + "/"))))
        {
            return Err("unsafe_runtime_archive".into());
        }
        namespace.insert(key, kind);
        plan.push(ArchivePlanEntry {
            index,
            components,
            kind,
            size: expected_size,
            executable: unix_mode.is_some_and(|mode| mode & 0o111 != 0),
        });
    }
    Ok(plan)
}

fn open_or_create_parent(root: &SecureDir, components: &[String]) -> Result<SecureDir, String> {
    let mut directory = root.try_clone().map_err(|_| "runtime_extraction_failed")?;
    for component in components.iter().take(components.len().saturating_sub(1)) {
        directory = directory
            .open_or_create_private_dir(component)
            .map_err(|_| "runtime_extraction_failed")?;
    }
    Ok(directory)
}

fn safe_archive_name(name: &str, path: &Path) -> bool {
    let bytes = name.as_bytes();
    let normalized = name.trim_end_matches('/');
    !normalized.is_empty()
        && valid_entrypoint(normalized)
        && !name.starts_with('/')
        && !name.starts_with('\\')
        && !name.contains('\\')
        && !(bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        && !name
            .trim_end_matches('/')
            .split('/')
            .any(|component| component.is_empty() || component == "." || component == "..")
        && !path.as_os_str().is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn unsafe_unix_file_type(mode: Option<u32>, entry_kind: ArchiveEntryKind) -> bool {
    let Some(type_bits) = mode.map(|value| value & 0o170000) else {
        return false;
    };
    if type_bits == 0 {
        return false;
    }
    match entry_kind {
        ArchiveEntryKind::Directory => type_bits != 0o040000,
        ArchiveEntryKind::File => type_bits != 0o100000,
    }
}

async fn run_health_check(pinned_entrypoint: &PinnedEntrypoint) -> Result<(), String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct HealthStatus {
        status: String,
        protocol_version: u32,
    }

    const MAX_HEALTH_STREAM_BYTES: usize = 4 * 1024;

    let mut pinned_command = pinned_entrypoint.command()?;
    pinned_command
        .arg("--health-check")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(unix)]
    pinned_command.process_group(0);
    let mut pinned_child = pinned_command
        .spawn()
        .map_err(|_| "runtime_health_check_failed".to_string())?;
    let mut process_group = HealthProcessGroup::new(&pinned_child)?;
    let stdout = pinned_child
        .take_stdout()
        .ok_or("runtime_health_check_failed")?;
    let stderr = pinned_child
        .take_stderr()
        .ok_or("runtime_health_check_failed")?;
    let operation = async {
        tokio::try_join!(
            read_capped_health_stream(stdout, MAX_HEALTH_STREAM_BYTES),
            read_capped_health_stream(stderr, MAX_HEALTH_STREAM_BYTES),
            async {
                let status = pinned_child
                    .wait()
                    .await
                    .map_err(|_| "runtime_health_check_failed".to_string())?;
                #[cfg(unix)]
                process_group.disarm();
                Ok(status)
            }
        )
    };
    let (stdout, stderr, status) = match tokio::time::timeout(health_timeout(), operation).await {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => {
            process_group.terminate();
            let _ = pinned_child.kill().await;
            let _ = pinned_child.wait().await;
            return Err(error);
        }
        Err(_) => {
            process_group.terminate();
            let _ = pinned_child.kill().await;
            let _ = pinned_child.wait().await;
            return Err("runtime_health_timeout".into());
        }
    };
    if !status.success() {
        return Err("runtime_health_check_failed".into());
    }
    if !stderr.is_empty() {
        return Err("runtime_health_stderr".into());
    }
    let stdout =
        std::str::from_utf8(&stdout).map_err(|_| "runtime_health_check_failed".to_string())?;
    let mut lines = stdout.lines();
    let line = lines.next().ok_or("runtime_health_check_failed")?;
    if lines.next().is_some() {
        return Err("runtime_health_check_failed".into());
    }
    let health: HealthStatus =
        serde_json::from_str(line).map_err(|_| "runtime_health_check_failed".to_string())?;
    if health.status != "ok" || health.protocol_version != 1 {
        return Err("runtime_health_check_failed".into());
    }
    Ok(())
}

#[cfg(not(test))]
fn health_timeout() -> std::time::Duration {
    std::time::Duration::from_secs(30)
}

#[cfg(test)]
thread_local! {
    static TEST_HEALTH_TIMEOUT: std::cell::Cell<Option<std::time::Duration>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(test)]
fn health_timeout() -> std::time::Duration {
    TEST_HEALTH_TIMEOUT
        .with(std::cell::Cell::take)
        .unwrap_or_else(|| std::time::Duration::from_secs(5))
}

#[cfg(test)]
fn set_test_health_timeout(timeout: std::time::Duration) {
    TEST_HEALTH_TIMEOUT.with(|value| value.set(Some(timeout)));
}

#[cfg(unix)]
fn duplicate_inheritable_file(file: &cap_std::fs::File) -> Result<std::fs::File, String> {
    use std::os::fd::{AsRawFd, FromRawFd};

    let descriptor = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_DUPFD, 3) };
    if descriptor < 0 {
        return Err("runtime_health_check_failed".into());
    }
    Ok(unsafe { std::fs::File::from_raw_fd(descriptor) })
}

#[cfg(windows)]
struct HealthProcessGroup {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
// SAFETY: the guard owns one kernel HANDLE and only invokes thread-safe handle APIs.
unsafe impl Send for HealthProcessGroup {}

#[cfg(windows)]
impl HealthProcessGroup {
    fn new(child: &PinnedChild) -> Result<Self, String> {
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err("runtime_health_check_failed".into());
        }
        let mut information = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&information).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        let Some(process) = child.raw_handle() else {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(handle);
            }
            return Err("runtime_health_check_failed".into());
        };
        let assigned = unsafe { AssignProcessToJobObject(handle, process.cast()) };
        if configured == 0 || assigned == 0 {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(handle);
            }
            return Err("runtime_health_check_failed".into());
        }
        Ok(Self { handle })
    }

    fn terminate(&mut self) {
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.handle, 1);
        }
    }
}

#[cfg(windows)]
impl Drop for HealthProcessGroup {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.handle);
        }
    }
}

#[cfg(unix)]
struct HealthProcessGroup {
    process_group: i32,
    armed: bool,
}

#[cfg(unix)]
impl HealthProcessGroup {
    fn new(child: &PinnedChild) -> Result<Self, String> {
        let process_group = child.id().ok_or("runtime_health_check_failed")? as i32;
        Ok(Self {
            process_group,
            armed: true,
        })
    }

    fn terminate(&mut self) {
        if self.armed {
            #[cfg(test)]
            TEST_PROCESS_GROUP_TERMINATIONS.with(|count| count.set(count.get() + 1));
            unsafe {
                libc::kill(-self.process_group, libc::SIGKILL);
            }
            self.armed = false;
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

#[cfg(all(test, unix))]
thread_local! {
    static TEST_PROCESS_GROUP_TERMINATIONS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(all(test, unix))]
fn reset_test_process_group_terminations() {
    TEST_PROCESS_GROUP_TERMINATIONS.with(|count| count.set(0));
}

#[cfg(all(test, unix))]
fn test_process_group_terminations() -> usize {
    TEST_PROCESS_GROUP_TERMINATIONS.with(std::cell::Cell::get)
}

#[cfg(unix)]
impl Drop for HealthProcessGroup {
    fn drop(&mut self) {
        if self.armed {
            self.terminate();
        }
    }
}

async fn read_capped_health_stream<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    maximum: usize,
) -> Result<Vec<u8>, String> {
    use tokio::io::AsyncReadExt;

    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 1024];
    loop {
        let read = reader
            .read(&mut chunk)
            .await
            .map_err(|_| "runtime_health_check_failed".to_string())?;
        if read == 0 {
            return Ok(bytes);
        }
        if bytes.len() + read > maximum {
            return Err("runtime_health_output_too_large".into());
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
}

fn open_entrypoint(
    version_directory: &SecureDir,
    entrypoint: &str,
) -> Result<cap_std::fs::File, String> {
    if !valid_entrypoint(entrypoint) {
        return Err("invalid_runtime_state".into());
    }
    let components = entrypoint.split('/').collect::<Vec<_>>();
    let mut directory = version_directory
        .try_clone()
        .map_err(|_| "runtime_version_unavailable")?;
    for component in components.iter().take(components.len().saturating_sub(1)) {
        directory = directory
            .open_private_dir(component)
            .map_err(|_| "runtime_version_unavailable")?;
    }
    directory
        .open_private_read(components.last().ok_or("invalid_runtime_state")?)
        .map_err(|_| "runtime_version_unavailable".into())
}

#[cfg(test)]
type StatePublishHook = Box<dyn FnOnce() -> Result<(), String>>;

#[cfg(test)]
thread_local! {
    static TEST_AFTER_ARCHIVE_VERIFY_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
    static TEST_BEFORE_STATE_PUBLISH_HOOK: std::cell::RefCell<Option<StatePublishHook>> =
        std::cell::RefCell::new(None);
    static TEST_AFTER_PROMOTION_BEFORE_REOPEN_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
    static TEST_AFTER_PROMOTED_HEALTH_BEFORE_COMMIT_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
    static TEST_AFTER_CURRENT_HEALTH_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
    static TEST_BEFORE_ORPHAN_DELETE_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
}

#[cfg(test)]
fn set_test_after_archive_verify_hook(hook: impl FnOnce() + 'static) {
    TEST_AFTER_ARCHIVE_VERIFY_HOOK.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
}

#[cfg(test)]
fn set_test_before_state_publish_hook(hook: impl FnOnce() -> Result<(), String> + 'static) {
    TEST_BEFORE_STATE_PUBLISH_HOOK.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
}

#[cfg(test)]
fn set_test_after_promotion_before_reopen_hook(hook: impl FnOnce() + 'static) {
    TEST_AFTER_PROMOTION_BEFORE_REOPEN_HOOK.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
}

#[cfg(test)]
fn set_test_after_promoted_health_before_commit_hook(hook: impl FnOnce() + 'static) {
    TEST_AFTER_PROMOTED_HEALTH_BEFORE_COMMIT_HOOK
        .with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
}

#[cfg(test)]
fn set_test_after_current_health_hook(hook: impl FnOnce() + 'static) {
    TEST_AFTER_CURRENT_HEALTH_HOOK.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
}

#[cfg(test)]
fn set_test_before_orphan_delete_hook(hook: impl FnOnce() + 'static) {
    TEST_BEFORE_ORPHAN_DELETE_HOOK.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
}

fn run_test_after_archive_verify_hook() {
    #[cfg(test)]
    TEST_AFTER_ARCHIVE_VERIFY_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

fn run_test_before_state_publish_hook() -> Result<(), String> {
    #[cfg(test)]
    return TEST_BEFORE_STATE_PUBLISH_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook()
        } else {
            Ok(())
        }
    });
    #[cfg(not(test))]
    Ok(())
}

fn run_test_after_promotion_before_reopen_hook() {
    #[cfg(test)]
    TEST_AFTER_PROMOTION_BEFORE_REOPEN_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

fn run_test_after_promoted_health_before_commit_hook() {
    #[cfg(test)]
    TEST_AFTER_PROMOTED_HEALTH_BEFORE_COMMIT_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

fn run_test_after_current_health_hook() {
    #[cfg(test)]
    TEST_AFTER_CURRENT_HEALTH_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

fn run_test_before_orphan_delete_hook() {
    #[cfg(test)]
    TEST_BEFORE_ORPHAN_DELETE_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

pub(crate) fn current_target_key() -> Result<&'static str, String> {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Ok("windows-x86_64");
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Ok("linux-x86_64");
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return Ok("darwin-x86_64");
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Ok("darwin-aarch64");
    }
    #[allow(unreachable_code)]
    Err("runtime_platform_unsupported".into())
}

#[cfg(test)]
mod tests {
    use super::{
        allowed_redirect_url, set_test_after_archive_verify_hook,
        set_test_after_current_health_hook, set_test_after_promoted_health_before_commit_hook,
        set_test_after_promotion_before_reopen_hook, set_test_before_orphan_delete_hook,
        set_test_before_state_publish_hook, set_test_child_reaper_gate, set_test_health_timeout,
        HttpRuntimeSource, RuntimeFs, RuntimeInstaller, RuntimeSource, MAX_RUNTIME_STATE_BYTES,
        RUNTIME_STATE_FILE,
    };
    #[cfg(unix)]
    use super::{
        reset_test_process_group_terminations, test_process_group_terminations, HealthProcessGroup,
    };
    use crate::runtime::manifest::RuntimeAsset;
    use crate::storage::DataLayout;
    use sha2::{Digest, Sha256};
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};

    #[derive(Clone)]
    struct FakeRuntimeSource {
        bytes: Arc<Vec<u8>>,
        offsets: Arc<Mutex<Vec<u64>>>,
    }

    impl FakeRuntimeSource {
        fn healthy_archive() -> Self {
            Self {
                bytes: Arc::new(runtime_archive(true)),
                offsets: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn unhealthy_archive() -> Self {
            Self {
                bytes: Arc::new(runtime_archive(false)),
                offsets: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn from_bytes(bytes: Vec<u8>) -> Self {
            Self {
                bytes: Arc::new(bytes),
                offsets: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn requested_offsets(&self) -> Vec<u64> {
            self.offsets.lock().unwrap().clone()
        }
    }

    #[async_trait::async_trait]
    impl RuntimeSource for FakeRuntimeSource {
        async fn download(
            &self,
            _asset: &RuntimeAsset,
            destination: &mut tokio::fs::File,
            resume_from: u64,
            progress: &(dyn Fn(u64, u64) + Send + Sync),
        ) -> Result<(), String> {
            use tokio::io::{AsyncSeekExt, AsyncWriteExt};

            self.offsets.lock().unwrap().push(resume_from);
            if resume_from == 0 {
                destination
                    .set_len(0)
                    .await
                    .map_err(|_| "runtime_download_failed".to_string())?;
                destination
                    .seek(std::io::SeekFrom::Start(0))
                    .await
                    .map_err(|_| "runtime_download_failed".to_string())?;
            } else {
                destination
                    .seek(std::io::SeekFrom::Start(resume_from))
                    .await
                    .map_err(|_| "runtime_download_failed".to_string())?;
            }
            destination
                .write_all(&self.bytes[resume_from as usize..])
                .await
                .map_err(|_| "runtime_download_failed".to_string())?;
            destination
                .sync_all()
                .await
                .map_err(|_| "runtime_download_failed".to_string())?;
            progress(self.bytes.len() as u64, self.bytes.len() as u64);
            Ok(())
        }
    }

    #[tokio::test]
    async fn promotes_only_a_verified_healthy_runtime() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());

        let active = installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();

        assert!(active.join(health_entrypoint()).exists());
        assert_eq!(state_version(&layout, "current"), "1.0.0");
    }

    #[tokio::test]
    async fn publishes_current_and_previous_in_one_generation_state_document() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        installer
            .ensure(&asset_for(&source, "0.9.0"))
            .await
            .unwrap();
        installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();

        let state: serde_json::Value = serde_json::from_slice(
            &std::fs::read(layout.runtime.join("runtime-state.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(state["generation"], 2);
        assert_eq!(state["current"]["version"], "1.0.0");
        assert_eq!(state["previous"]["version"], "0.9.0");
        assert!(!layout.runtime.join("current.json").exists());
        assert!(!layout.runtime.join("previous.json").exists());
    }

    #[tokio::test]
    async fn separate_installers_preserve_both_activation_generations() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let first = RuntimeInstaller::new(layout.clone(), source.clone());
        let second = RuntimeInstaller::new(layout.clone(), source.clone());
        let first_asset = asset_for(&source, "1.0.0");
        let second_asset = asset_for(&source, "1.1.0");

        let (first_result, second_result) =
            tokio::join!(first.ensure(&first_asset), second.ensure(&second_asset));

        first_result.unwrap();
        second_result.unwrap();
        let state = runtime_state(&layout);
        assert_eq!(state["generation"], 2);
        let current = state["current"]["version"].as_str().unwrap();
        let previous = state["previous"]["version"].as_str().unwrap();
        assert_ne!(current, previous);
        assert!([current, previous].contains(&"1.0.0"));
        assert!([current, previous].contains(&"1.1.0"));
    }

    #[tokio::test]
    async fn separate_instances_cannot_lose_concurrent_activation_and_rollback() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let setup = RuntimeInstaller::new(layout.clone(), source.clone());
        setup.ensure(&asset_for(&source, "0.9.0")).await.unwrap();
        setup.ensure(&asset_for(&source, "1.0.0")).await.unwrap();
        let rollback = RuntimeInstaller::new(layout.clone(), source.clone());
        let activation = RuntimeInstaller::new(layout.clone(), source.clone());
        let next = asset_for(&source, "1.1.0");

        let (rollback_result, activation_result) =
            tokio::join!(rollback.rollback(), activation.ensure(&next));

        activation_result.unwrap();
        if let Err(error) = &rollback_result {
            assert_eq!(error, "runtime_state_stale");
        }
        let state = runtime_state(&layout);
        assert_eq!(state["current"]["version"], "1.1.0");
        assert_eq!(
            state["generation"],
            if rollback_result.is_ok() { 4 } else { 3 }
        );
        assert!(state["previous"]["version"] == "0.9.0" || state["previous"]["version"] == "1.0.0");
    }

    #[test]
    fn runtime_lock_child_process() {
        let Ok(root) = std::env::var("TAWREED_TEST_RUNTIME_CHILD_ROOT") else {
            return;
        };
        let mode = std::env::var("TAWREED_TEST_RUNTIME_CHILD_MODE").unwrap();
        let version = std::env::var("TAWREED_TEST_RUNTIME_CHILD_VERSION").unwrap();
        let layout = DataLayout::from_root(PathBuf::from(root));
        layout.ensure().unwrap();
        write_child_barrier("TAWREED_TEST_RUNTIME_CHILD_EXECUTED");
        write_child_barrier("TAWREED_TEST_RUNTIME_CHILD_ATTEMPTED");
        let fs = RuntimeFs::open(&layout).unwrap();
        let target = std::env::var("TAWREED_TEST_RUNTIME_CHILD_TARGET")
            .unwrap_or_else(|_| current_target_key().to_string());
        let record = child_runtime_record(&version, &target);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        match mode.as_str() {
            "version" => {
                probe_child_lock(
                    fs.runtime
                        .open_or_create_lock_file(&format!(
                            "runtime-version-{}.lock",
                            record.version
                        ))
                        .unwrap()
                        .into_std(),
                );
                let lease = runtime.block_on(fs.lock_version(&record)).unwrap();
                write_child_barrier("TAWREED_TEST_RUNTIME_CHILD_ACQUIRED");
                wait_for_child_release();
                drop(lease);
            }
            "state" => {
                probe_child_lock(
                    fs.runtime
                        .open_or_create_lock_file(super::RUNTIME_STATE_LOCK_FILE)
                        .unwrap()
                        .into_std(),
                );
                let state_lock = fs.lock_state().unwrap();
                write_child_barrier("TAWREED_TEST_RUNTIME_CHILD_ACQUIRED");
                wait_for_child_release();
                let state = fs.read_state_unlocked().unwrap();
                let generation = state.generation.checked_add(1).unwrap();
                fs.write_state_unlocked(&super::RuntimeState {
                    schema_version: 1,
                    generation,
                    previous: state.current,
                    current: Some(record),
                })
                .unwrap();
                drop(state_lock);
            }
            _ => panic!("unknown runtime child mode"),
        }
    }

    #[test]
    fn cooperating_processes_prove_version_and_state_lock_contention() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let barriers = root.path().join("barriers");
        std::fs::create_dir(&barriers).unwrap();

        let version_first = spawn_runtime_lock_child(
            &layout,
            &barriers,
            "version-first",
            "version",
            "1.0.0",
            "darwin-x86_64",
            true,
        );
        wait_for_path(&version_first.acquired);
        let mut version_second = spawn_runtime_lock_child(
            &layout,
            &barriers,
            "version-second",
            "version",
            "1.0.0",
            "darwin-aarch64",
            false,
        );
        wait_for_path(&version_second.attempted);
        wait_for_either(&version_second.contended, &version_second.acquired);
        assert!(version_second.contended.exists());
        assert!(!version_second.acquired.exists());
        assert!(version_second
            .child
            .as_mut()
            .unwrap()
            .try_wait()
            .unwrap()
            .is_none());
        release_child(&version_first);
        assert_child_success(version_first);
        wait_for_path(&version_second.acquired);
        assert_child_success(version_second);

        let state_first = spawn_runtime_lock_child(
            &layout,
            &barriers,
            "state-first",
            "state",
            "1.1.0",
            current_target_key(),
            true,
        );
        wait_for_path(&state_first.acquired);
        let mut state_second = spawn_runtime_lock_child(
            &layout,
            &barriers,
            "state-second",
            "state",
            "1.2.0",
            current_target_key(),
            false,
        );
        wait_for_path(&state_second.attempted);
        wait_for_either(&state_second.contended, &state_second.acquired);
        assert!(state_second.contended.exists());
        assert!(!state_second.acquired.exists());
        assert!(state_second
            .child
            .as_mut()
            .unwrap()
            .try_wait()
            .unwrap()
            .is_none());
        release_child(&state_first);
        assert_child_success(state_first);
        wait_for_path(&state_second.acquired);
        assert_child_success(state_second);
        let state = runtime_state(&layout);
        assert_eq!(state["generation"], 2);
        assert_eq!(state["current"]["version"], "1.2.0");
        assert_eq!(state["previous"]["version"], "1.1.0");
    }

    struct RuntimeLockChild {
        child: Option<std::process::Child>,
        attempted: PathBuf,
        contended: PathBuf,
        acquired: PathBuf,
        release: Option<PathBuf>,
        executed: PathBuf,
        token: String,
    }

    #[allow(clippy::too_many_arguments)]
    fn spawn_runtime_lock_child(
        layout: &DataLayout,
        barriers: &Path,
        name: &str,
        mode: &str,
        version: &str,
        target: &str,
        hold: bool,
    ) -> RuntimeLockChild {
        let attempted = barriers.join(format!("{name}.attempted"));
        let contended = barriers.join(format!("{name}.contended"));
        let acquired = barriers.join(format!("{name}.acquired"));
        let executed = barriers.join(format!("{name}.executed"));
        let release = hold.then(|| barriers.join(format!("{name}.release")));
        let token = format!("{name}-{}", uuid::Uuid::new_v4());
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "runtime::installer::tests::runtime_lock_child_process",
                "--nocapture",
            ])
            .env("TAWREED_TEST_RUNTIME_CHILD_ROOT", &layout.root)
            .env("TAWREED_TEST_RUNTIME_CHILD_MODE", mode)
            .env("TAWREED_TEST_RUNTIME_CHILD_VERSION", version)
            .env("TAWREED_TEST_RUNTIME_CHILD_TARGET", target)
            .env("TAWREED_TEST_RUNTIME_CHILD_ATTEMPTED", &attempted)
            .env("TAWREED_TEST_RUNTIME_CHILD_CONTENDED", &contended)
            .env("TAWREED_TEST_RUNTIME_CHILD_ACQUIRED", &acquired)
            .env("TAWREED_TEST_RUNTIME_CHILD_EXECUTED", &executed)
            .env("TAWREED_TEST_RUNTIME_CHILD_TOKEN", &token)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        if let Some(release) = &release {
            command.env("TAWREED_TEST_RUNTIME_CHILD_RELEASE", release);
        }
        RuntimeLockChild {
            child: Some(command.spawn().unwrap()),
            attempted,
            contended,
            acquired,
            release,
            executed,
            token,
        }
    }

    impl Drop for RuntimeLockChild {
        fn drop(&mut self) {
            let Some(mut child) = self.child.take() else {
                return;
            };
            if let Some(release) = &self.release {
                if !release.exists() {
                    let _ = std::fs::write(release, b"release");
                }
            }
            if !matches!(child.try_wait(), Ok(Some(_))) {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    fn assert_child_success(mut child: RuntimeLockChild) {
        let output = child.child.take().unwrap().wait_with_output().unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            output.status.success(),
            "child failed: stdout={} stderr={}",
            stdout,
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(stdout.matches("running 1 test").count(), 1, "{stdout}");
        assert_eq!(
            stdout
                .matches("test runtime::installer::tests::runtime_lock_child_process ... ok")
                .count(),
            1,
            "{stdout}"
        );
        assert_eq!(
            std::fs::read_to_string(&child.executed).unwrap(),
            child.token
        );
    }

    fn child_runtime_record(version: &str, target: &str) -> super::RuntimeRecord {
        super::RuntimeRecord {
            version: version.into(),
            target: target.into(),
            entrypoint: health_entrypoint().into(),
            sha256: "a".repeat(64),
            size: 1,
        }
    }

    fn test_pin_for_record(
        fs: &RuntimeFs,
        record: &super::RuntimeRecord,
    ) -> super::PinnedEntrypoint {
        let directory = fs.versions.open_private_dir(&record.version).unwrap();
        super::PinnedEntrypoint::open(directory, &record.entrypoint, fs.active_path(record), None)
            .unwrap()
    }

    fn write_child_barrier(variable: &str) {
        use std::io::Write;

        let path = std::env::var_os(variable).unwrap();
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .unwrap();
        file.write_all(
            std::env::var("TAWREED_TEST_RUNTIME_CHILD_TOKEN")
                .unwrap()
                .as_bytes(),
        )
        .unwrap();
        file.sync_all().unwrap();
    }

    fn probe_child_lock(file: std::fs::File) {
        match fs2::FileExt::try_lock_exclusive(&file) {
            Ok(()) => fs2::FileExt::unlock(&file).unwrap(),
            Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
                write_child_barrier("TAWREED_TEST_RUNTIME_CHILD_CONTENDED");
            }
            Err(error) => panic!("unexpected lock probe error: {error}"),
        }
    }

    fn wait_for_child_release() {
        let Some(path) = std::env::var_os("TAWREED_TEST_RUNTIME_CHILD_RELEASE") else {
            return;
        };
        wait_for_path(Path::new(&path));
    }

    fn release_child(child: &RuntimeLockChild) {
        std::fs::write(child.release.as_ref().unwrap(), b"release").unwrap();
    }

    fn wait_for_path(path: &Path) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !path.exists() {
            assert!(
                std::time::Instant::now() < deadline,
                "timed out waiting for {}",
                path.display()
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    fn wait_for_either(first: &Path, second: &Path) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !first.exists() && !second.exists() {
            assert!(
                std::time::Instant::now() < deadline,
                "timed out waiting for {} or {}",
                first.display(),
                second.display()
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    #[cfg(windows)]
    fn wait_until_path_is_writable(path: &Path) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            if std::fs::OpenOptions::new().write(true).open(path).is_ok() {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "timed out waiting for {} to become writable",
                path.display()
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    #[tokio::test]
    async fn pins_verified_archive_handle_through_extraction() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let asset = asset_for(&source, "1.0.0");
        let part = layout
            .staging
            .join(format!("{}-1.0.0.zip.part", current_target_key()));
        #[cfg(unix)]
        let held = layout.staging.join("verified-held.zip");
        let replacement = archive_with_file("attacker.txt", b"unverified", Some(0o644));
        set_test_after_archive_verify_hook(move || {
            #[cfg(windows)]
            assert!(std::fs::write(&part, &replacement).is_err());
            #[cfg(unix)]
            {
                std::fs::rename(&part, &held).unwrap();
                std::fs::write(&part, &replacement).unwrap();
            }
        });

        let active = RuntimeInstaller::new(layout, source)
            .ensure(&asset)
            .await
            .unwrap();

        assert!(active.join(health_entrypoint()).is_file());
        assert!(!active.join("attacker.txt").exists());
    }

    #[tokio::test]
    async fn promotion_rejects_health_passing_entrypoint_substitution_and_retry_is_clean() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        installer
            .ensure(&asset_for(&source, "0.9.0"))
            .await
            .unwrap();
        let promoted_entrypoint = layout
            .runtime_versions
            .join("1.0.0")
            .join(health_entrypoint());
        let verified_entrypoint = promoted_entrypoint.with_extension("verified");
        let attacker_marker = root.path().join("attacker-ran");
        let malicious = health_passing_marker_script(&attacker_marker);
        set_test_after_promotion_before_reopen_hook(move || {
            std::fs::rename(&promoted_entrypoint, verified_entrypoint).unwrap();
            std::fs::write(promoted_entrypoint, malicious).unwrap();
        });

        assert_eq!(
            installer
                .ensure(&asset_for(&source, "1.0.0"))
                .await
                .unwrap_err(),
            "runtime_promotion_identity_mismatch"
        );
        assert_eq!(state_version(&layout, "current"), "0.9.0");
        assert!(!layout.runtime_versions.join("1.0.0").exists());

        let active = installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();

        assert_eq!(state_version(&layout, "current"), "1.0.0");
        assert_eq!(
            std::fs::read_to_string(active.join(health_entrypoint())).unwrap(),
            health_script(true)
        );
        assert!(!attacker_marker.exists());
    }

    #[tokio::test]
    async fn promotion_rejects_whole_directory_substitution_and_retry_is_clean() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        installer
            .ensure(&asset_for(&source, "0.9.0"))
            .await
            .unwrap();
        let promoted = layout.runtime_versions.join("1.0.0");
        let held = layout.runtime_versions.join("1.0.0.held");
        let entrypoint = health_entrypoint().to_string();
        set_test_after_promotion_before_reopen_hook(move || {
            std::fs::rename(&promoted, &held).unwrap();
            let replacement_entrypoint = promoted.join(&entrypoint);
            std::fs::create_dir_all(replacement_entrypoint.parent().unwrap()).unwrap();
            std::fs::hard_link(held.join(&entrypoint), replacement_entrypoint).unwrap();
            std::fs::copy(
                held.join(super::RUNTIME_METADATA_FILE),
                promoted.join(super::RUNTIME_METADATA_FILE),
            )
            .unwrap();
        });

        assert_eq!(
            installer
                .ensure(&asset_for(&source, "1.0.0"))
                .await
                .unwrap_err(),
            "runtime_promotion_identity_mismatch"
        );
        assert_eq!(state_version(&layout, "current"), "0.9.0");
        assert!(!layout.runtime_versions.join("1.0.0").exists());

        installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();

        assert_eq!(state_version(&layout, "current"), "1.0.0");
    }

    #[tokio::test]
    async fn promoted_health_pin_survives_the_commit_boundary_recheck() {
        use std::sync::atomic::{AtomicBool, Ordering};

        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        installer
            .ensure(&asset_for(&source, "0.9.0"))
            .await
            .unwrap();
        let promoted_entrypoint = layout
            .runtime_versions
            .join("1.0.0")
            .join(health_entrypoint());
        let verified_entrypoint = promoted_entrypoint.with_extension("verified");
        let attempted = Arc::new(AtomicBool::new(false));
        let substituted = Arc::new(AtomicBool::new(false));
        let hook_attempted = attempted.clone();
        let hook_substituted = substituted.clone();
        set_test_after_promoted_health_before_commit_hook(move || {
            hook_attempted.store(true, Ordering::SeqCst);
            if std::fs::rename(&promoted_entrypoint, &verified_entrypoint).is_ok() {
                std::fs::write(
                    &promoted_entrypoint,
                    health_passing_marker_script(&promoted_entrypoint.with_extension("ran")),
                )
                .unwrap();
                hook_substituted.store(true, Ordering::SeqCst);
            }
        });

        let result = installer.ensure(&asset_for(&source, "1.0.0")).await;

        assert!(attempted.load(Ordering::SeqCst));
        #[cfg(windows)]
        {
            assert!(!substituted.load(Ordering::SeqCst));
            result.unwrap();
            assert_eq!(state_version(&layout, "current"), "1.0.0");
        }
        #[cfg(unix)]
        {
            assert!(substituted.load(Ordering::SeqCst));
            assert_eq!(result.unwrap_err(), "runtime_promotion_identity_mismatch");
            assert_eq!(state_version(&layout, "current"), "0.9.0");
            assert!(!layout.runtime_versions.join("1.0.0").exists());
        }
    }

    #[tokio::test]
    async fn abort_during_promoted_health_removes_the_candidate_and_uuid_stage() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::from_bytes(runtime_archive_with_script(hanging_script()));
        let installer = std::sync::Arc::new(RuntimeInstaller::new(layout.clone(), source.clone()));
        let task_installer = installer.clone();
        let asset = asset_for(&source, "1.0.0");
        let task = tokio::spawn(async move { task_installer.ensure(&asset).await });

        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if layout.runtime_versions.join("1.0.0").is_dir() {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        task.abort();
        let _ = task.await;

        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while layout.runtime_versions.join("1.0.0").exists() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(generated_staging_directories(&layout, "1.0.0").is_empty());
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn cancellation_cleanup_retains_version_lease_until_candidate_is_removed() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::from_bytes(runtime_archive_with_script(hanging_script()));
        let installer = Arc::new(RuntimeInstaller::new(layout.clone(), source.clone()));
        let gate = Arc::new((
            std::sync::Mutex::new((false, false)),
            std::sync::Condvar::new(),
        ));
        set_test_child_reaper_gate(gate.clone());
        let task_installer = installer.clone();
        let asset = asset_for(&source, "1.0.0");
        let task = tokio::spawn(async move { task_installer.ensure(&asset).await });
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while !layout.runtime_versions.join("1.0.0").exists() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        task.abort();
        let _ = task.await;
        let (state, condition) = &*gate;
        let entered = state.lock().unwrap();
        let (mut entered, timeout) = condition
            .wait_timeout_while(entered, std::time::Duration::from_secs(2), |state| !state.0)
            .unwrap();
        assert!(!timeout.timed_out(), "child reaper did not take ownership");
        assert!(layout.runtime_versions.join("1.0.0").exists());

        let barriers = root.path().join("cleanup-barriers");
        std::fs::create_dir(&barriers).unwrap();
        let mut contender = spawn_runtime_lock_child(
            &layout,
            &barriers,
            "cleanup-contender",
            "version",
            "1.0.0",
            current_target_key(),
            false,
        );
        wait_for_path(&contender.attempted);
        wait_for_either(&contender.contended, &contender.acquired);
        assert!(contender.contended.exists());
        assert!(!contender.acquired.exists());
        assert!(contender
            .child
            .as_mut()
            .unwrap()
            .try_wait()
            .unwrap()
            .is_none());

        entered.1 = true;
        condition.notify_all();
        drop(entered);
        wait_for_path(&contender.acquired);

        assert!(!layout.runtime_versions.join("1.0.0").exists());
        assert_child_success(contender);
    }

    #[tokio::test]
    async fn current_fast_path_reconciles_a_concurrent_current_change_before_ready() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();
        installer
            .ensure(&asset_for(&source, "1.1.0"))
            .await
            .unwrap();
        installer.rollback().await.unwrap();
        let hook_layout = layout.clone();
        set_test_after_current_health_hook(move || {
            let fs = RuntimeFs::open(&hook_layout).unwrap();
            let state = fs.read_state().unwrap();
            let record = fs.read_version_metadata("1.1.0").unwrap();
            let pin = test_pin_for_record(&fs, &record);
            fs.commit_activation(state.generation, record, &pin)
                .unwrap();
        });

        installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();

        assert_eq!(state_version(&layout, "current"), "1.0.0");
    }

    #[tokio::test]
    async fn orphan_delete_rechecks_references_under_state_lock() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        installer
            .ensure(&asset_for(&source, "0.9.0"))
            .await
            .unwrap();
        set_test_before_state_publish_hook(|| Err("injected_state_write_failure".into()));
        assert!(installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .is_err());
        let orphan_entrypoint = layout
            .runtime_versions
            .join("1.0.0")
            .join(health_entrypoint());
        std::fs::remove_file(&orphan_entrypoint).unwrap();
        let hook_layout = layout.clone();
        set_test_before_orphan_delete_hook(move || {
            let fs = RuntimeFs::open(&hook_layout).unwrap();
            let _state_lock = fs.lock_state().unwrap();
            let state = fs.read_state_unlocked().unwrap();
            let record = fs.read_version_metadata("1.0.0").unwrap();
            fs.write_state_unlocked(&super::RuntimeState {
                schema_version: 1,
                generation: state.generation + 1,
                previous: state.current,
                current: Some(record),
            })
            .unwrap();
        });

        assert!(installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .is_err());

        assert!(layout.runtime_versions.join("1.0.0").is_dir());
        assert_eq!(state_version(&layout, "current"), "1.0.0");
    }

    #[tokio::test]
    async fn orphan_cleanup_preserves_same_version_referenced_with_different_metadata() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let installed_source = FakeRuntimeSource::healthy_archive();
        let installed_asset = asset_for(&installed_source, "1.0.0");
        RuntimeInstaller::new(layout.clone(), installed_source)
            .ensure(&installed_asset)
            .await
            .unwrap();
        let installed_entrypoint = layout
            .runtime_versions
            .join("1.0.0")
            .join(health_entrypoint());
        let installed_bytes = std::fs::read(&installed_entrypoint).unwrap();
        let requested_source = FakeRuntimeSource::from_bytes(archive_with_files(&[
            (health_entrypoint(), health_script(true).as_bytes()),
            ("agent/different-metadata.txt", b"different"),
        ]));

        let error = RuntimeInstaller::new(layout.clone(), requested_source.clone())
            .ensure(&asset_for(&requested_source, "1.0.0"))
            .await
            .unwrap_err();

        assert_eq!(error, "invalid_runtime_metadata");
        assert_eq!(state_version(&layout, "current"), "1.0.0");
        assert_eq!(
            std::fs::read(installed_entrypoint).unwrap(),
            installed_bytes
        );
        assert!(layout.runtime_versions.join("1.0.0").is_dir());
        assert!(requested_source.requested_offsets().is_empty());
    }

    #[tokio::test]
    async fn rejects_a_symlinked_staging_root_without_touching_its_target() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        std::fs::remove_dir_all(&layout.staging).unwrap();
        create_directory_link(outside.path(), &layout.staging);
        let source = FakeRuntimeSource::healthy_archive();

        let error = RuntimeInstaller::new(layout, source.clone())
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap_err();

        assert_eq!(error, "unsafe_runtime_root");
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn bounds_runtime_state_reads_before_parsing() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();
        std::fs::write(
            layout.runtime.join(RUNTIME_STATE_FILE),
            vec![b'x'; (MAX_RUNTIME_STATE_BYTES + 1) as usize],
        )
        .unwrap();

        assert_eq!(
            installer.active_entrypoint().await.unwrap_err(),
            "invalid_runtime_state"
        );
    }

    #[tokio::test]
    async fn state_write_failure_keeps_one_old_generation_and_reuses_verified_orphan() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        installer
            .ensure(&asset_for(&source, "0.9.0"))
            .await
            .unwrap();
        set_test_before_state_publish_hook(|| Err("injected_state_write_failure".into()));

        assert_eq!(
            installer
                .ensure(&asset_for(&source, "1.0.0"))
                .await
                .unwrap_err(),
            "runtime_activation_failed"
        );
        assert_eq!(state_version(&layout, "current"), "0.9.0");
        assert!(layout.runtime_versions.join("1.0.0").is_dir());

        installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();
        assert_eq!(source.requested_offsets(), vec![0, 0]);
        assert_eq!(state_version(&layout, "current"), "1.0.0");
    }

    #[tokio::test]
    async fn reinstalls_matching_metadata_orphans_with_missing_or_unhealthy_entrypoints() {
        for missing in [true, false] {
            let root = tempfile::tempdir().unwrap();
            let layout = DataLayout::from_root(root.path().join(".tawreed"));
            layout.ensure().unwrap();
            let source = FakeRuntimeSource::healthy_archive();
            let installer = RuntimeInstaller::new(layout.clone(), source.clone());
            installer
                .ensure(&asset_for(&source, "0.9.0"))
                .await
                .unwrap();
            set_test_before_state_publish_hook(|| Err("injected_state_write_failure".into()));
            assert_eq!(
                installer
                    .ensure(&asset_for(&source, "1.0.0"))
                    .await
                    .unwrap_err(),
                "runtime_activation_failed"
            );
            let orphan_entrypoint = layout
                .runtime_versions
                .join("1.0.0")
                .join(health_entrypoint());
            if missing {
                std::fs::remove_file(&orphan_entrypoint).unwrap();
            } else {
                std::fs::write(&orphan_entrypoint, invalid_health_scripts()[0]).unwrap();
            }

            let active = installer
                .ensure(&asset_for(&source, "1.0.0"))
                .await
                .unwrap();

            assert!(active.join(health_entrypoint()).is_file());
            assert_eq!(state_version(&layout, "current"), "1.0.0");
            assert_eq!(source.requested_offsets(), vec![0, 0]);
        }
    }

    #[tokio::test]
    async fn reuses_the_current_healthy_runtime_without_downloading_again() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        let asset = asset_for(&source, "1.0.0");
        let first = installer.ensure(&asset).await.unwrap();

        let second = installer.ensure(&asset).await.unwrap();

        assert_eq!(first, second);
        assert_eq!(source.requested_offsets(), vec![0]);
        assert_eq!(runtime_state(&layout)["generation"], 1);
        assert!(runtime_state(&layout)["previous"].is_null());
    }

    #[tokio::test]
    async fn active_entrypoint_remains_pinned_through_command_spawn() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout, source.clone());
        installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();
        let pinned = installer.active_entrypoint().await.unwrap();
        assert!(pinned.informational_path().ends_with(health_entrypoint()));
        #[cfg(windows)]
        assert!(std::fs::OpenOptions::new()
            .write(true)
            .open(pinned.informational_path())
            .is_err());

        let mut command = pinned.command().unwrap();
        command
            .arg("--health-check")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child = command.spawn().unwrap();
        assert!(child.id().is_some());
        let _ = child.try_wait().unwrap();
        let stdout = child.take_stdout().unwrap();
        let stderr = child.take_stderr().unwrap();
        let (stdout, stderr, status) = tokio::try_join!(
            read_test_stream(stdout),
            read_test_stream(stderr),
            child.wait()
        )
        .unwrap();

        assert!(status.success());
        assert!(stderr.is_empty());
        assert_eq!(
            std::str::from_utf8(&stdout).unwrap().trim(),
            "{\"status\":\"ok\",\"protocolVersion\":1}"
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn detached_child_retains_windows_pins_until_kill_and_wait() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout, source.clone());
        let active = installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();
        let path = active.join(health_entrypoint());
        std::fs::write(&path, hanging_script()).unwrap();
        let pinned = installer.active_entrypoint().await.unwrap();
        let mut command = pinned.command().unwrap();
        let mut child = command.spawn().unwrap();
        drop(command);
        drop(pinned);

        assert!(std::fs::OpenOptions::new().write(true).open(&path).is_err());

        child.kill().await.unwrap();
        child.wait().await.unwrap();
        drop(child);
        assert!(std::fs::OpenOptions::new().write(true).open(path).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn dropped_child_reaper_retains_pins_without_an_active_runtime() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let installer = RuntimeInstaller::new(layout, source.clone());
        let active = runtime
            .block_on(installer.ensure(&asset_for(&source, "1.0.0")))
            .unwrap();
        let path = active.join(health_entrypoint());
        let ready = root.path().join("child-ready");
        std::fs::write(&path, ready_then_hang_script(&ready)).unwrap();
        let pinned = runtime.block_on(installer.active_entrypoint()).unwrap();
        let mut command = pinned.command().unwrap();
        let gate = Arc::new((
            std::sync::Mutex::new((false, false)),
            std::sync::Condvar::new(),
        ));
        set_test_child_reaper_gate(gate.clone());
        let child = command.spawn().unwrap();
        drop(command);
        drop(pinned);
        wait_for_path(&ready);
        drop(runtime);

        drop(child);

        let (state, condition) = &*gate;
        let entered = state.lock().unwrap();
        let (mut entered, timeout) = condition
            .wait_timeout_while(entered, std::time::Duration::from_secs(2), |state| !state.0)
            .unwrap();
        assert!(!timeout.timed_out(), "child reaper did not take ownership");
        assert!(std::fs::OpenOptions::new().write(true).open(&path).is_err());
        entered.1 = true;
        condition.notify_all();
        drop(entered);
        wait_until_path_is_writable(&path);
    }

    #[tokio::test]
    async fn retains_previous_runtime_when_health_check_fails() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let healthy = FakeRuntimeSource::healthy_archive();
        RuntimeInstaller::new(layout.clone(), healthy.clone())
            .ensure(&asset_for(&healthy, "0.9.0"))
            .await
            .unwrap();
        let unhealthy = FakeRuntimeSource::unhealthy_archive();

        let error = RuntimeInstaller::new(layout.clone(), unhealthy.clone())
            .ensure(&asset_for(&unhealthy, "1.0.0"))
            .await
            .unwrap_err();

        assert_eq!(error, "runtime_health_check_failed");
        assert_eq!(state_version(&layout, "current"), "0.9.0");
    }

    #[tokio::test]
    async fn state_publication_uses_an_unpredictable_no_follow_temporary_file() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        installer
            .ensure(&asset_for(&source, "0.9.0"))
            .await
            .unwrap();
        let sentinel = root.path().join("sentinel.txt");
        std::fs::write(&sentinel, b"preserve").unwrap();
        let predictable = layout
            .runtime
            .join(format!(".runtime-state.json.{}.tmp", std::process::id()));
        create_file_symlink(&sentinel, &predictable);

        installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();

        assert_eq!(std::fs::read(sentinel).unwrap(), b"preserve");
        assert_eq!(state_version(&layout, "current"), "1.0.0");
    }

    #[tokio::test]
    async fn resumes_a_partial_archive_before_verifying_and_activating() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let asset = asset_for(&source, "1.2.3");
        let part = layout
            .staging
            .join(format!("{}-1.2.3.zip.part", current_target_key()));
        let prefix_len = 31_u64;
        std::fs::write(&part, &source.bytes[..prefix_len as usize]).unwrap();

        RuntimeInstaller::new(layout, source.clone())
            .ensure(&asset)
            .await
            .unwrap();

        assert_eq!(source.requested_offsets(), vec![prefix_len]);
    }

    #[tokio::test]
    async fn discards_a_corrupt_completed_partial_before_retrying_from_zero() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let asset = asset_for(&source, "1.2.3");
        let part = layout
            .staging
            .join(format!("{}-1.2.3.zip.part", current_target_key()));
        let prefix_len = 31_usize;
        std::fs::write(&part, vec![0_u8; prefix_len]).unwrap();
        let installer = RuntimeInstaller::new(layout, source.clone());

        assert_eq!(
            installer.ensure(&asset).await.unwrap_err(),
            "runtime_hash_mismatch"
        );
        assert!(!part.exists());
        installer.ensure(&asset).await.unwrap();

        assert_eq!(source.requested_offsets(), vec![prefix_len as u64, 0]);
    }

    #[tokio::test]
    async fn rejects_wrong_size_and_digest_before_extraction() {
        for expected_error in ["runtime_size_mismatch", "runtime_hash_mismatch"] {
            let root = tempfile::tempdir().unwrap();
            let layout = DataLayout::from_root(root.path().join(".tawreed"));
            layout.ensure().unwrap();
            let source = FakeRuntimeSource::healthy_archive();
            let mut asset = asset_for(&source, "1.0.0");
            if expected_error == "runtime_size_mismatch" {
                asset.size += 1;
            } else {
                asset.sha256 = "0".repeat(64);
            }

            let error = RuntimeInstaller::new(layout.clone(), source)
                .ensure(&asset)
                .await
                .unwrap_err();

            assert_eq!(error, expected_error);
            assert!(!layout.runtime.join(RUNTIME_STATE_FILE).exists());
            assert!(generated_staging_directories(&layout, &asset.version).is_empty());
        }
    }

    #[tokio::test]
    async fn rejects_unsafe_archive_paths_without_writing_outside_staging() {
        for unsafe_name in [
            "../outside.txt",
            "/absolute.txt",
            "C:/drive.txt",
            "agent/../../outside.txt",
            "agent\\..\\outside.txt",
            "agent/file:stream",
            "agent/file.",
            "agent/file ",
            "agent/CON",
            "agent/CONIN$",
            "agent/conout$.log",
            "agent/com1.log",
        ] {
            let root = tempfile::tempdir().unwrap();
            let layout = DataLayout::from_root(root.path().join(".tawreed"));
            layout.ensure().unwrap();
            let source = FakeRuntimeSource::from_bytes(archive_with_file(
                unsafe_name,
                b"escape",
                Some(0o644),
            ));

            let error = RuntimeInstaller::new(layout.clone(), source.clone())
                .ensure(&asset_for(&source, "1.0.0"))
                .await
                .unwrap_err();

            assert_eq!(error, "unsafe_runtime_archive", "accepted {unsafe_name:?}");
            assert!(!root.path().join("outside.txt").exists());
            assert!(!layout.runtime.join(RUNTIME_STATE_FILE).exists());
        }
    }

    #[tokio::test]
    async fn rejects_archive_symlinks_before_following_them() {
        use zip::write::SimpleFileOptions;

        let mut bytes = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(&mut bytes);
        writer
            .add_symlink("agent/link", "../../outside", SimpleFileOptions::default())
            .unwrap();
        writer.finish().unwrap();
        let source = FakeRuntimeSource::from_bytes(bytes.into_inner());
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();

        let error = RuntimeInstaller::new(layout.clone(), source.clone())
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap_err();

        assert_eq!(error, "unsafe_runtime_archive");
        assert!(!root.path().join("outside").exists());
    }

    #[tokio::test]
    async fn preflights_exact_case_and_file_prefix_collisions_before_extraction() {
        let mut exact = archive_with_files(&[
            ("agent/Foo", b"one".as_slice()),
            ("agent/foo", b"two".as_slice()),
        ]);
        for index in 0..exact.len().saturating_sub(2) {
            if &exact[index..index + 3] == b"Foo" {
                exact[index..index + 3].copy_from_slice(b"foo");
            }
        }
        let exact_names = {
            let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&exact)).unwrap();
            (0..archive.len())
                .map(|index| archive.by_index(index).unwrap().name().to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(exact_names, vec!["agent/foo"]);
        for (case, bytes) in [
            exact,
            archive_with_files(&[
                ("agent/Foo", b"one".as_slice()),
                ("agent/foo", b"two".as_slice()),
            ]),
            archive_with_files(&[
                ("agent", b"file".as_slice()),
                ("agent/child", b"child".as_slice()),
            ]),
            archive_with_files(&[
                ("agent/child", b"child".as_slice()),
                ("agent", b"file".as_slice()),
            ]),
        ]
        .into_iter()
        .enumerate()
        {
            let root = tempfile::tempdir().unwrap();
            let layout = DataLayout::from_root(root.path().join(".tawreed"));
            layout.ensure().unwrap();
            let source = FakeRuntimeSource::from_bytes(bytes);

            assert_eq!(
                RuntimeInstaller::new(layout.clone(), source.clone())
                    .ensure(&asset_for(&source, "1.0.0"))
                    .await
                    .unwrap_err(),
                "unsafe_runtime_archive",
                "collision case {case} was not rejected during preflight"
            );
            assert!(generated_staging_directories(&layout, "1.0.0").is_empty());
        }
    }

    #[tokio::test]
    async fn version_lease_cleans_only_matching_stale_uuid_stages() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let stale = layout
            .staging
            .join(format!(".runtime-1.0.0-{}.tmp", uuid::Uuid::new_v4()));
        let unrelated = layout
            .staging
            .join(format!(".runtime-1.1.0-{}.tmp", uuid::Uuid::new_v4()));
        std::fs::create_dir(&stale).unwrap();
        std::fs::create_dir(&unrelated).unwrap();
        let source = FakeRuntimeSource::healthy_archive();

        RuntimeInstaller::new(layout.clone(), source.clone())
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();

        assert!(!stale.exists());
        assert!(unrelated.exists());
        assert!(generated_staging_directories(&layout, "1.0.0").is_empty());
    }

    #[tokio::test]
    async fn removes_an_unreferenced_invalid_orphan_then_installs_verified_bytes() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let orphan = layout.runtime_versions.join("1.0.0");
        std::fs::create_dir(&orphan).unwrap();
        std::fs::write(orphan.join("untrusted.txt"), b"remove").unwrap();
        let source = FakeRuntimeSource::healthy_archive();

        let active = RuntimeInstaller::new(layout, source.clone())
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();

        assert!(!active.join("untrusted.txt").exists());
        assert!(active.join("runtime-metadata.json").is_file());
        assert!(active.join(health_entrypoint()).is_file());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn clamps_signed_archive_modes_to_private_runtime_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::from_bytes(runtime_archive_with_mode(0o777));
        let active = RuntimeInstaller::new(layout.clone(), source.clone())
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();

        assert_eq!(
            std::fs::metadata(active.join(health_entrypoint()))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        for directory in [&layout.runtime, &layout.runtime_versions, &layout.staging] {
            assert_eq!(
                std::fs::metadata(directory).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
    }

    #[tokio::test]
    async fn rejects_archives_with_more_than_ten_thousand_entries() {
        use zip::write::SimpleFileOptions;

        let mut bytes = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(&mut bytes);
        for index in 0..=10_000 {
            writer
                .start_file(format!("files/{index}"), SimpleFileOptions::default())
                .unwrap();
        }
        writer.finish().unwrap();
        let source = FakeRuntimeSource::from_bytes(bytes.into_inner());
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();

        let error = RuntimeInstaller::new(layout, source.clone())
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap_err();

        assert_eq!(error, "runtime_archive_too_large");
    }

    #[tokio::test]
    async fn rejects_archives_declaring_more_than_two_gibibytes_expanded() {
        let mut bytes = archive_with_file("large.bin", b"x", Some(0o644));
        patch_zip_uncompressed_size(&mut bytes, 2 * 1024 * 1024 * 1024 + 1);
        let source = FakeRuntimeSource::from_bytes(bytes);
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();

        let error = RuntimeInstaller::new(layout, source.clone())
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap_err();

        assert_eq!(error, "runtime_archive_too_large");
    }

    #[tokio::test]
    async fn accepts_only_one_exact_health_json_line() {
        for (index, script) in invalid_health_scripts().iter().enumerate() {
            let root = tempfile::tempdir().unwrap();
            let layout = DataLayout::from_root(root.path().join(".tawreed"));
            layout.ensure().unwrap();
            let source = FakeRuntimeSource::from_bytes(runtime_archive_with_script(script));
            let version = format!("1.0.{index}");

            let error = RuntimeInstaller::new(layout.clone(), source.clone())
                .ensure(&asset_for(&source, &version))
                .await
                .unwrap_err();

            assert_eq!(error, "runtime_health_check_failed");
            assert!(!layout.runtime.join(RUNTIME_STATE_FILE).exists());
        }
    }

    #[tokio::test]
    async fn health_check_times_out_and_reaps_a_hung_process() {
        #[cfg(unix)]
        reset_test_process_group_terminations();
        set_test_health_timeout(std::time::Duration::from_millis(400));
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::from_bytes(runtime_archive_with_script(hanging_script()));
        let started = std::time::Instant::now();

        let error = RuntimeInstaller::new(layout, source.clone())
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap_err();

        assert_eq!(error, "runtime_health_timeout");
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        #[cfg(unix)]
        assert_eq!(test_process_group_terminations(), 1);
    }

    #[tokio::test]
    async fn health_check_caps_stdout_and_rejects_any_stderr() {
        for (script, expected) in [
            (flooding_stdout_script(), "runtime_health_output_too_large"),
            (stderr_script(), "runtime_health_stderr"),
        ] {
            let root = tempfile::tempdir().unwrap();
            let layout = DataLayout::from_root(root.path().join(".tawreed"));
            layout.ensure().unwrap();
            let source = FakeRuntimeSource::from_bytes(runtime_archive_with_script(script));

            assert_eq!(
                RuntimeInstaller::new(layout, source.clone())
                    .ensure(&asset_for(&source, "1.0.0"))
                    .await
                    .unwrap_err(),
                expected
            );
        }
    }

    #[tokio::test]
    async fn health_check_does_not_wait_forever_on_inherited_descendant_pipes() {
        #[cfg(unix)]
        reset_test_process_group_terminations();
        set_test_health_timeout(std::time::Duration::from_millis(400));
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source =
            FakeRuntimeSource::from_bytes(runtime_archive_with_script(inherited_pipe_script()));
        let started = std::time::Instant::now();

        let error = RuntimeInstaller::new(layout, source.clone())
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap_err();

        assert_eq!(error, "runtime_health_timeout");
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        #[cfg(unix)]
        assert_eq!(test_process_group_terminations(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn successful_wait_disarms_process_group_before_drop() {
        let mut group = HealthProcessGroup {
            process_group: i32::MAX,
            armed: true,
        };

        group.disarm();

        assert!(!group.armed);
    }

    #[tokio::test]
    async fn rollback_health_checks_and_atomically_swaps_pointers() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        installer
            .ensure(&asset_for(&source, "0.9.0"))
            .await
            .unwrap();
        installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();

        let committed = installer.rollback().await.unwrap();

        assert_eq!(committed.version, "0.9.0");
        assert!(committed.entrypoint.ends_with(health_entrypoint()));
        assert_eq!(state_version(&layout, "current"), "0.9.0");
        assert_eq!(state_version(&layout, "previous"), "1.0.0");
        assert_eq!(
            installer
                .active_entrypoint()
                .await
                .unwrap()
                .informational_path(),
            committed.entrypoint.as_path()
        );
    }

    #[tokio::test]
    async fn failed_rollback_health_check_leaves_current_pointer_intact() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        installer
            .ensure(&asset_for(&source, "0.9.0"))
            .await
            .unwrap();
        installer
            .ensure(&asset_for(&source, "1.0.0"))
            .await
            .unwrap();
        std::fs::write(
            layout
                .runtime_versions
                .join("0.9.0")
                .join(health_entrypoint()),
            invalid_health_scripts()[0],
        )
        .unwrap();

        assert_eq!(
            installer.rollback().await.unwrap_err(),
            "runtime_health_check_failed"
        );
        assert_eq!(state_version(&layout, "current"), "1.0.0");
    }

    #[tokio::test]
    async fn http_source_requires_matching_content_range_when_resuming() {
        let root = tempfile::tempdir().unwrap();
        let part = root.path().join("runtime.zip.part");
        std::fs::write(&part, b"abc").unwrap();
        let (url, request) = serve_once(
            "206 Partial Content",
            &[("Content-Range", "bytes 3-5/6")],
            b"def",
        );
        let source = HttpRuntimeSource::with_client(reqwest::Client::new());
        let asset = http_asset(url, 6);
        let mut destination = open_test_part(&part).await;

        source
            .download(&asset, &mut destination, 3, &|_, _| {})
            .await
            .unwrap();
        drop(destination);

        assert_eq!(std::fs::read(part).unwrap(), b"abcdef");
        assert!(request
            .join()
            .unwrap()
            .to_ascii_lowercase()
            .contains("range: bytes=3-"));
    }

    #[tokio::test]
    async fn http_source_restarts_when_a_resumed_request_returns_ok() {
        let root = tempfile::tempdir().unwrap();
        let part = root.path().join("runtime.zip.part");
        std::fs::write(&part, b"stale").unwrap();
        let (url, request) = serve_once("200 OK", &[], b"abcdef");
        let source = HttpRuntimeSource::with_client(reqwest::Client::new());
        let mut destination = open_test_part(&part).await;

        source
            .download(&http_asset(url, 6), &mut destination, 5, &|_, _| {})
            .await
            .unwrap();
        drop(destination);

        assert_eq!(std::fs::read(part).unwrap(), b"abcdef");
        assert!(request
            .join()
            .unwrap()
            .to_ascii_lowercase()
            .contains("range: bytes=5-"));
    }

    #[tokio::test]
    async fn http_source_rejects_mismatched_ranges_and_oversized_bodies() {
        let root = tempfile::tempdir().unwrap();
        let part = root.path().join("runtime.zip.part");
        std::fs::write(&part, b"abc").unwrap();
        let (url, request) = serve_once(
            "206 Partial Content",
            &[("Content-Range", "bytes 2-5/6")],
            b"def",
        );
        let source = HttpRuntimeSource::with_client(reqwest::Client::new());
        let mut destination = open_test_part(&part).await;
        assert_eq!(
            source
                .download(&http_asset(url, 6), &mut destination, 3, &|_, _| {})
                .await
                .unwrap_err(),
            "runtime_download_invalid_response"
        );
        drop(destination);
        request.join().unwrap();

        let (url, request) = serve_once("200 OK", &[], b"abcdefg");
        let mut destination = open_test_part(&part).await;
        assert_eq!(
            source
                .download(&http_asset(url, 6), &mut destination, 0, &|_, _| {})
                .await
                .unwrap_err(),
            "runtime_download_too_large"
        );
        drop(destination);
        request.join().unwrap();
    }

    #[test]
    fn redirect_policy_allows_only_expected_https_github_object_hosts() {
        for url in [
            "https://github.com/kareem-sf/tawreed/releases/download/v1/runtime.zip",
            "https://objects.githubusercontent.com/object",
            "https://release-assets.githubusercontent.com/object?token=temporary",
            "https://github-releases.githubusercontent.com/object",
        ] {
            assert!(allowed_redirect_url(&reqwest::Url::parse(url).unwrap()));
        }

        for url in [
            "http://release-assets.githubusercontent.com/object",
            "https://user@github.com/object",
            "https://github.com:444/object",
            "https://github.com.evil.example/object",
            "https://raw.githubusercontent.com/object",
            "https://example.com/object",
        ] {
            assert!(!allowed_redirect_url(&reqwest::Url::parse(url).unwrap()));
        }
    }

    fn asset_for(source: &FakeRuntimeSource, version: &str) -> RuntimeAsset {
        RuntimeAsset {
            version: version.into(),
            url: format!(
                "https://github.com/kareem-sf/tawreed/releases/download/v{version}/runtime.zip"
            ),
            sha256: Sha256::digest(source.bytes.as_slice())
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
            size: source.bytes.len() as u64,
            archive: "zip".into(),
            entrypoint: health_entrypoint().into(),
        }
    }

    fn runtime_archive(healthy: bool) -> Vec<u8> {
        runtime_archive_with_script(health_script(healthy))
    }

    fn runtime_archive_with_script(script: &str) -> Vec<u8> {
        runtime_archive_with_script_and_mode(script, 0o755)
    }

    #[cfg(unix)]
    fn runtime_archive_with_mode(mode: u32) -> Vec<u8> {
        runtime_archive_with_script_and_mode(health_script(true), mode)
    }

    fn runtime_archive_with_script_and_mode(script: &str, mode: u32) -> Vec<u8> {
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let mut bytes = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(&mut bytes);
        writer
            .start_file(
                health_entrypoint(),
                SimpleFileOptions::default().unix_permissions(mode),
            )
            .unwrap();
        writer.write_all(script.as_bytes()).unwrap();
        writer.finish().unwrap();
        bytes.into_inner()
    }

    fn archive_with_file(name: &str, contents: &[u8], mode: Option<u32>) -> Vec<u8> {
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let mut bytes = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(&mut bytes);
        let mut options = SimpleFileOptions::default();
        if let Some(mode) = mode {
            options = options.unix_permissions(mode);
        }
        writer.start_file(name, options).unwrap();
        writer.write_all(contents).unwrap();
        writer.finish().unwrap();
        bytes.into_inner()
    }

    fn archive_with_files(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let mut bytes = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(&mut bytes);
        for (name, contents) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default().unix_permissions(0o644))
                .unwrap();
            writer.write_all(contents).unwrap();
        }
        writer.finish().unwrap();
        bytes.into_inner()
    }

    fn patch_zip_uncompressed_size(bytes: &mut [u8], size: u32) {
        for (signature, size_offset) in [
            (b"PK\x03\x04".as_slice(), 22),
            (b"PK\x01\x02".as_slice(), 24),
        ] {
            let header = bytes
                .windows(signature.len())
                .position(|window| window == signature)
                .unwrap();
            bytes[header + size_offset..header + size_offset + 4]
                .copy_from_slice(&size.to_le_bytes());
        }
    }

    fn state_version(layout: &DataLayout, slot: &str) -> String {
        let state = runtime_state(layout);
        state[slot]["version"].as_str().unwrap().to_string()
    }

    fn runtime_state(layout: &DataLayout) -> serde_json::Value {
        serde_json::from_slice(&std::fs::read(layout.runtime.join(RUNTIME_STATE_FILE)).unwrap())
            .unwrap()
    }

    fn generated_staging_directories(layout: &DataLayout, version: &str) -> Vec<PathBuf> {
        let prefix = format!(".runtime-{version}-");
        std::fs::read_dir(&layout.staging)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                name.starts_with(&prefix) && name.ends_with(".tmp")
            })
            .map(|entry| entry.path())
            .collect()
    }

    #[cfg(unix)]
    fn create_file_symlink(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(windows)]
    fn create_file_symlink(target: &Path, link: &Path) {
        std::fs::hard_link(target, link).unwrap();
    }

    #[cfg(unix)]
    fn create_directory_link(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(windows)]
    fn create_directory_link(target: &Path, link: &Path) {
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[cfg(windows)]
    fn invalid_health_scripts() -> Vec<&'static str> {
        vec![
            "@echo off\r\necho {\"status\":\"error\",\"protocolVersion\":1}\r\nexit /b 0\r\n",
            "@echo off\r\necho {\"status\":\"ok\",\"protocolVersion\":2}\r\nexit /b 0\r\n",
            "@echo off\r\necho {\"status\":\"ok\",\"protocolVersion\":1}\r\necho extra\r\nexit /b 0\r\n",
            "@echo off\r\necho not-json\r\nexit /b 0\r\n",
        ]
    }

    #[cfg(not(windows))]
    fn invalid_health_scripts() -> Vec<&'static str> {
        vec![
            "#!/bin/sh\nprintf '%s\\n' '{\"status\":\"error\",\"protocolVersion\":1}'\n",
            "#!/bin/sh\nprintf '%s\\n' '{\"status\":\"ok\",\"protocolVersion\":2}'\n",
            "#!/bin/sh\nprintf '%s\\n%s\\n' '{\"status\":\"ok\",\"protocolVersion\":1}' extra\n",
            "#!/bin/sh\nprintf '%s\\n' not-json\n",
        ]
    }

    #[cfg(windows)]
    fn hanging_script() -> &'static str {
        "@echo off\r\nping -n 4 127.0.0.1 >nul\r\necho {\"status\":\"ok\",\"protocolVersion\":1}\r\n"
    }

    #[cfg(windows)]
    fn ready_then_hang_script(ready: &Path) -> String {
        format!(
            "@echo off\r\necho ready>\"{}\"\r\nping -n 6 127.0.0.1 >nul\r\n",
            ready.display()
        )
    }

    #[cfg(not(windows))]
    fn hanging_script() -> &'static str {
        "#!/bin/sh\nsleep 3\nprintf '%s\\n' '{\"status\":\"ok\",\"protocolVersion\":1}'\n"
    }

    #[cfg(windows)]
    fn flooding_stdout_script() -> &'static str {
        "@echo off\r\nfor /L %%i in (1,1,100) do echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\r\n"
    }

    #[cfg(not(windows))]
    fn flooding_stdout_script() -> &'static str {
        "#!/bin/sh\nhead -c 5000 /dev/zero\n"
    }

    #[cfg(windows)]
    fn stderr_script() -> &'static str {
        "@echo off\r\necho noise 1>&2\r\necho {\"status\":\"ok\",\"protocolVersion\":1}\r\n"
    }

    #[cfg(not(windows))]
    fn stderr_script() -> &'static str {
        "#!/bin/sh\nprintf '%s\\n' noise >&2\nprintf '%s\\n' '{\"status\":\"ok\",\"protocolVersion\":1}'\n"
    }

    #[cfg(windows)]
    fn inherited_pipe_script() -> &'static str {
        "@echo off\r\nstart \"\" /b ping -n 4 127.0.0.1\r\necho {\"status\":\"ok\",\"protocolVersion\":1}\r\nexit /b 0\r\n"
    }

    #[cfg(not(windows))]
    fn inherited_pipe_script() -> &'static str {
        "#!/bin/sh\n(sleep 3) &\nprintf '%s\\n' '{\"status\":\"ok\",\"protocolVersion\":1}'\n"
    }

    fn http_asset(url: String, size: u64) -> RuntimeAsset {
        RuntimeAsset {
            version: "1.0.0".into(),
            url,
            sha256: "a".repeat(64),
            size,
            archive: "zip".into(),
            entrypoint: health_entrypoint().into(),
        }
    }

    async fn open_test_part(path: &Path) -> tokio::fs::File {
        tokio::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .await
            .unwrap()
    }

    async fn read_test_stream<R: tokio::io::AsyncRead + Unpin>(
        mut stream: R,
    ) -> Result<Vec<u8>, String> {
        use tokio::io::AsyncReadExt;

        let mut bytes = Vec::new();
        stream
            .read_to_end(&mut bytes)
            .await
            .map_err(|error| error.to_string())?;
        Ok(bytes)
    }

    fn serve_once(
        status: &'static str,
        headers: &'static [(&'static str, &'static str)],
        body: &'static [u8],
    ) -> (String, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut chunk = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = stream.read(&mut chunk).unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
            }
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\n",
                body.len()
            )
            .unwrap();
            for (name, value) in headers {
                write!(stream, "{name}: {value}\r\n").unwrap();
            }
            write!(stream, "Connection: close\r\n\r\n").unwrap();
            stream.write_all(body).unwrap();
            String::from_utf8(request).unwrap()
        });
        (format!("http://{address}/runtime.zip"), handle)
    }

    #[cfg(windows)]
    fn health_entrypoint() -> &'static str {
        "agent/health-check.cmd"
    }

    #[cfg(not(windows))]
    fn health_entrypoint() -> &'static str {
        "agent/health-check"
    }

    #[cfg(windows)]
    fn health_script(healthy: bool) -> &'static str {
        if healthy {
            "@echo off\r\necho {\"status\":\"ok\",\"protocolVersion\":1}\r\nexit /b 0\r\n"
        } else {
            "@echo off\r\necho {\"status\":\"error\",\"protocolVersion\":1}\r\nexit /b 1\r\n"
        }
    }

    #[cfg(windows)]
    fn health_passing_marker_script(marker: &Path) -> String {
        format!(
            "@echo off\r\necho attacker>\"{}\"\r\necho {{\"status\":\"ok\",\"protocolVersion\":1}}\r\nexit /b 0\r\n",
            marker.display()
        )
    }

    #[cfg(not(windows))]
    fn health_passing_marker_script(marker: &Path) -> String {
        format!(
            "#!/bin/sh\nprintf attacker >'{}'\nprintf '%s\\n' '{{\"status\":\"ok\",\"protocolVersion\":1}}'\n",
            marker.display()
        )
    }

    #[cfg(not(windows))]
    fn health_script(healthy: bool) -> &'static str {
        if healthy {
            "#!/bin/sh\nprintf '%s\\n' '{\"status\":\"ok\",\"protocolVersion\":1}'\n"
        } else {
            "#!/bin/sh\nprintf '%s\\n' '{\"status\":\"error\",\"protocolVersion\":1}'\nexit 1\n"
        }
    }

    fn current_target_key() -> &'static str {
        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
        {
            return "windows-x86_64";
        }
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        {
            return "linux-x86_64";
        }
        #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
        {
            return "darwin-x86_64";
        }
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            return "darwin-aarch64";
        }
        #[allow(unreachable_code)]
        "unsupported"
    }
}
