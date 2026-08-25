use std::path::PathBuf;

use serde::Serialize;

use super::installer::{
    current_target_key, runtime_http_client, HttpRuntimeSource, InstallPhase, InstallProgress,
    PinnedEntrypoint, RuntimeInstaller, RuntimeSource,
};
use super::manifest::{
    select_asset, validate_asset, verify_embedded_manifest, RuntimeAsset, RuntimeTarget,
};
use crate::storage::DataLayout;

pub const RUNTIME_MANIFEST_URL: &str =
    "https://github.com/kareem-sf/tawreed/releases/latest/download/runtime-manifest.json";
pub const RUNTIME_MANIFEST_SIGNATURE_URL: &str =
    "https://github.com/kareem-sf/tawreed/releases/latest/download/runtime-manifest.sig";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_SIGNATURE_BYTES: u64 = 1024;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBootstrapStatus {
    pub phase: String,
    pub progress: Option<f64>,
    pub component: Option<String>,
    pub version: Option<String>,
    pub error_code: Option<String>,
    pub recoverable: bool,
}

impl RuntimeBootstrapStatus {
    fn checking() -> Self {
        Self {
            phase: "checking".into(),
            progress: Some(0.0),
            component: None,
            version: None,
            error_code: None,
            recoverable: false,
        }
    }

    fn from_install_progress(event: InstallProgress, version: &str) -> Self {
        let phase = match event.phase {
            InstallPhase::Downloading => "downloading",
            InstallPhase::Verifying => "verifying",
            InstallPhase::Activating => "activating",
        };
        Self {
            phase: phase.into(),
            progress: Some(if event.progress.is_finite() {
                event.progress.clamp(0.0, 100.0)
            } else {
                0.0
            }),
            component: Some("agent-kernel".into()),
            version: Some(version.into()),
            error_code: None,
            recoverable: false,
        }
    }

    fn ready(version: String) -> Self {
        Self {
            phase: "ready".into(),
            progress: Some(100.0),
            component: None,
            version: Some(version),
            error_code: None,
            recoverable: false,
        }
    }

    fn error(internal_code: &str, version: Option<String>) -> Self {
        let (code, recoverable) = public_error(internal_code);
        Self {
            phase: "error".into(),
            progress: None,
            component: None,
            version: version.filter(|value| !value.is_empty() && value.len() <= 40),
            recoverable,
            error_code: Some(code.into()),
        }
    }
}

#[async_trait::async_trait]
pub trait RuntimeBootstrapSource: Send + Sync {
    async fn verified_asset(&self) -> Result<RuntimeAsset, String>;
}

pub struct HttpRuntimeBootstrap {
    client: reqwest::Client,
}

impl HttpRuntimeBootstrap {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            client: runtime_http_client()?,
        })
    }

    fn verified_asset_from_bytes(
        manifest_bytes: &[u8],
        signature_bytes: &[u8],
    ) -> Result<RuntimeAsset, String> {
        let signature = std::str::from_utf8(signature_bytes)
            .map_err(|_| "invalid_runtime_signature".to_string())?;
        let manifest = verify_embedded_manifest(manifest_bytes, signature)?;
        Ok(select_asset(&manifest, current_target()?)?.clone())
    }
}

#[async_trait::async_trait]
impl RuntimeBootstrapSource for HttpRuntimeBootstrap {
    async fn verified_asset(&self) -> Result<RuntimeAsset, String> {
        let manifest = fetch_bounded(
            &self.client,
            RUNTIME_MANIFEST_URL,
            MAX_MANIFEST_BYTES,
            "runtime_manifest_too_large",
        )
        .await?;
        let signature = fetch_bounded(
            &self.client,
            RUNTIME_MANIFEST_SIGNATURE_URL,
            MAX_SIGNATURE_BYTES,
            "runtime_manifest_signature_too_large",
        )
        .await?;
        Self::verified_asset_from_bytes(&manifest, &signature)
    }
}

pub struct RuntimeManager<
    S: RuntimeSource = HttpRuntimeSource,
    B: RuntimeBootstrapSource = HttpRuntimeBootstrap,
> {
    installer: std::sync::Arc<RuntimeInstaller<S>>,
    bootstrap: B,
    status: std::sync::Arc<std::sync::Mutex<RuntimeBootstrapStatus>>,
    operation: std::sync::Arc<std::sync::Mutex<OperationState>>,
}

#[derive(Clone)]
enum CompletedOperation {
    Bootstrap(Result<RuntimeBootstrapStatus, String>),
    Rollback(Result<PathBuf, String>),
}

struct OperationState {
    generation: u64,
    in_flight: Option<InFlightOperation>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum OperationKind {
    Bootstrap,
    Rollback,
}

struct InFlightOperation {
    generation: u64,
    kind: OperationKind,
    result: tokio::sync::watch::Receiver<Option<CompletedOperation>>,
}

enum OperationRole {
    Leader {
        generation: u64,
        result: tokio::sync::watch::Sender<Option<CompletedOperation>>,
    },
    Follower(CompletedOperation),
}

impl RuntimeManager<HttpRuntimeSource, HttpRuntimeBootstrap> {
    pub fn new(layout: DataLayout) -> Result<Self, String> {
        Ok(Self::with_components(
            RuntimeInstaller::new(layout, HttpRuntimeSource::new()?),
            HttpRuntimeBootstrap::new()?,
        ))
    }
}

impl<S: RuntimeSource + 'static, B: RuntimeBootstrapSource + 'static> RuntimeManager<S, B> {
    pub fn with_components(installer: RuntimeInstaller<S>, bootstrap: B) -> Self {
        Self {
            installer: std::sync::Arc::new(installer),
            bootstrap,
            status: std::sync::Arc::new(std::sync::Mutex::new(RuntimeBootstrapStatus::checking())),
            operation: std::sync::Arc::new(std::sync::Mutex::new(OperationState {
                generation: 0,
                in_flight: None,
            })),
        }
    }

    pub async fn status(&self) -> RuntimeBootstrapStatus {
        lock_unpoison(&self.status).clone()
    }

    pub async fn start<F>(&self, progress: F) -> Result<RuntimeBootstrapStatus, String>
    where
        F: Fn(RuntimeBootstrapStatus) + Send + Sync,
    {
        let generation = match self.begin_operation(OperationKind::Bootstrap).await {
            OperationRole::Follower(CompletedOperation::Bootstrap(result)) => {
                if let Ok(status) = &result {
                    progress(status.clone());
                }
                return result;
            }
            OperationRole::Follower(CompletedOperation::Rollback(_)) => unreachable!(),
            OperationRole::Leader { generation, result } => (generation, result),
        };
        let (generation, result_sender) = generation;
        let result = self.run_start(&progress).await;
        self.finish_operation(
            OperationKind::Bootstrap,
            generation,
            result_sender,
            CompletedOperation::Bootstrap(result.clone()),
        );
        result
    }

    async fn run_start<F>(&self, progress: &F) -> Result<RuntimeBootstrapStatus, String>
    where
        F: Fn(RuntimeBootstrapStatus) + Send + Sync,
    {
        self.publish(RuntimeBootstrapStatus::checking(), progress);
        let asset = match self.bootstrap.verified_asset().await {
            Ok(asset) => asset,
            Err(code) => {
                let status = RuntimeBootstrapStatus::error(&code, None);
                self.publish(status.clone(), progress);
                return Ok(status);
            }
        };
        if asset.version.len() > 40 || validate_asset(&asset).is_err() {
            let status = RuntimeBootstrapStatus::error("invalid_runtime_asset", None);
            self.publish(status.clone(), progress);
            return Ok(status);
        }
        let version = asset.version.clone();
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let send_progress = move |event| {
            let _ = sender.send(event);
        };
        let installation = self.installer.ensure_with_progress(&asset, &send_progress);
        tokio::pin!(installation);

        let result = loop {
            tokio::select! {
                Some(event) = receiver.recv() => {
                    self.publish(
                        RuntimeBootstrapStatus::from_install_progress(event, &version),
                        progress,
                    );
                }
                result = &mut installation => break result,
            }
        };
        while let Ok(event) = receiver.try_recv() {
            self.publish(
                RuntimeBootstrapStatus::from_install_progress(event, &version),
                progress,
            );
        }

        match result {
            Ok(_) => {
                let status = RuntimeBootstrapStatus::ready(version);
                self.publish(status.clone(), progress);
                Ok(status)
            }
            Err(code) => {
                let status = RuntimeBootstrapStatus::error(&code, Some(version));
                self.publish(status.clone(), progress);
                Ok(status)
            }
        }
    }

    pub async fn retry<F>(&self, progress: F) -> Result<RuntimeBootstrapStatus, String>
    where
        F: Fn(RuntimeBootstrapStatus) + Send + Sync,
    {
        self.start(progress).await
    }

    pub async fn active_entrypoint(&self) -> Result<PinnedEntrypoint, String> {
        self.installer.active_entrypoint().await
    }

    pub async fn rollback(&self) -> Result<PathBuf, String> {
        let generation = match self.begin_operation(OperationKind::Rollback).await {
            OperationRole::Follower(CompletedOperation::Rollback(result)) => return result,
            OperationRole::Follower(CompletedOperation::Bootstrap(_)) => unreachable!(),
            OperationRole::Leader { generation, result } => (generation, result),
        };
        let (generation, result_sender) = generation;
        let result = match self.installer.rollback().await {
            Ok(committed) => {
                let entrypoint = committed.entrypoint;
                *lock_unpoison(&self.status) = RuntimeBootstrapStatus::ready(committed.version);
                Ok(entrypoint)
            }
            Err(error) => Err(error),
        };
        self.finish_operation(
            OperationKind::Rollback,
            generation,
            result_sender,
            CompletedOperation::Rollback(result.clone()),
        );
        result
    }

    async fn begin_operation(&self, requested: OperationKind) -> OperationRole {
        loop {
            let waiting = {
                let mut state = lock_unpoison(&self.operation);
                if let Some(in_flight) = &state.in_flight {
                    Some((
                        in_flight.kind == requested,
                        in_flight.generation,
                        in_flight.result.clone(),
                    ))
                } else {
                    state.generation = state.generation.checked_add(1).unwrap_or(1);
                    let generation = state.generation;
                    let (result, receiver) = tokio::sync::watch::channel(None);
                    state.in_flight = Some(InFlightOperation {
                        generation,
                        kind: requested,
                        result: receiver,
                    });
                    return OperationRole::Leader { generation, result };
                }
            };
            let Some((same_kind, generation, mut receiver)) = waiting else {
                continue;
            };
            if receiver.borrow().is_none() && receiver.changed().await.is_err() {
                let mut state = lock_unpoison(&self.operation);
                if state
                    .in_flight
                    .as_ref()
                    .is_some_and(|operation| operation.generation == generation)
                {
                    state.in_flight = None;
                }
                continue;
            }
            let completed = receiver.borrow().clone();
            if same_kind {
                if let Some(completed) = completed {
                    return OperationRole::Follower(completed);
                }
            }
        }
    }

    fn finish_operation(
        &self,
        kind: OperationKind,
        generation: u64,
        result: tokio::sync::watch::Sender<Option<CompletedOperation>>,
        completed: CompletedOperation,
    ) {
        let mut state = lock_unpoison(&self.operation);
        if let Some(in_flight) = &state.in_flight {
            if in_flight.kind == kind && in_flight.generation == generation {
                result.send_replace(Some(completed));
                state.in_flight = None;
            }
        }
    }

    fn publish<F>(&self, status: RuntimeBootstrapStatus, progress: &F)
    where
        F: Fn(RuntimeBootstrapStatus) + Send + Sync,
    {
        *lock_unpoison(&self.status) = status.clone();
        progress(status);
    }
}

fn lock_unpoison<T>(mutex: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn public_error(internal: &str) -> (&'static str, bool) {
    match internal {
        "runtime_download_failed"
        | "runtime_download_invalid_response"
        | "runtime_download_too_large"
        | "runtime_download_cleanup_failed"
        | "runtime_size_mismatch"
        | "runtime_hash_mismatch"
        | "runtime_staging_failed"
        | "runtime_extraction_failed"
        | "runtime_metadata_write_failed"
        | "runtime_version_unavailable"
        | "runtime_version_already_exists"
        | "runtime_version_lock_failed"
        | "runtime_version_referenced"
        | "runtime_state_lock_failed"
        | "runtime_state_stale"
        | "runtime_health_check_failed"
        | "runtime_health_timeout"
        | "runtime_health_output_too_large"
        | "runtime_health_stderr"
        | "runtime_activation_failed"
        | "runtime_orphan_cleanup_failed"
        | "runtime_manifest_download_failed" => (internal_to_public(internal), true),
        "invalid_runtime_signature"
        | "invalid_runtime_manifest"
        | "invalid_runtime_asset"
        | "runtime_manifest_too_large"
        | "runtime_manifest_signature_too_large"
        | "runtime_asset_unavailable"
        | "runtime_platform_unsupported"
        | "runtime_promotion_identity_mismatch"
        | "invalid_runtime_archive"
        | "unsafe_runtime_archive"
        | "runtime_archive_too_large"
        | "unsafe_runtime_root"
        | "unsafe_runtime_download_path"
        | "unsafe_runtime_staging"
        | "unsafe_runtime_version"
        | "invalid_runtime_state"
        | "invalid_runtime_metadata" => (internal_to_public(internal), false),
        _ => ("runtime_internal_error", true),
    }
}

fn internal_to_public(code: &str) -> &'static str {
    match code {
        "runtime_health_timeout" | "runtime_health_output_too_large" | "runtime_health_stderr" => {
            "runtime_health_check_failed"
        }
        "unsafe_runtime_archive"
        | "invalid_runtime_archive"
        | "runtime_archive_too_large"
        | "unsafe_runtime_root"
        | "unsafe_runtime_download_path"
        | "unsafe_runtime_staging"
        | "unsafe_runtime_version"
        | "invalid_runtime_state"
        | "invalid_runtime_metadata" => "runtime_install_security_error",
        "runtime_download_failed" => "runtime_download_failed",
        "runtime_download_invalid_response" => "runtime_download_invalid_response",
        "runtime_download_too_large" => "runtime_download_too_large",
        "runtime_download_cleanup_failed" => "runtime_download_cleanup_failed",
        "runtime_size_mismatch" => "runtime_size_mismatch",
        "runtime_hash_mismatch" => "runtime_hash_mismatch",
        "runtime_staging_failed" => "runtime_staging_failed",
        "runtime_extraction_failed" => "runtime_extraction_failed",
        "runtime_activation_failed"
        | "runtime_orphan_cleanup_failed"
        | "runtime_metadata_write_failed"
        | "runtime_version_unavailable"
        | "runtime_version_already_exists"
        | "runtime_version_lock_failed"
        | "runtime_version_referenced"
        | "runtime_state_lock_failed"
        | "runtime_state_stale" => "runtime_activation_failed",
        "runtime_manifest_download_failed" => "runtime_manifest_download_failed",
        "invalid_runtime_signature" => "invalid_runtime_signature",
        "invalid_runtime_manifest" => "invalid_runtime_manifest",
        "invalid_runtime_asset" => "invalid_runtime_asset",
        "runtime_manifest_too_large" => "runtime_manifest_too_large",
        "runtime_manifest_signature_too_large" => "runtime_manifest_signature_too_large",
        "runtime_asset_unavailable" => "runtime_asset_unavailable",
        "runtime_platform_unsupported" => "runtime_platform_unsupported",
        _ => "runtime_internal_error",
    }
}

async fn fetch_bounded(
    client: &reqwest::Client,
    url: &str,
    maximum: u64,
    too_large_code: &str,
) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "runtime_manifest_download_failed".to_string())?;
    if response.status() != reqwest::StatusCode::OK {
        return Err("runtime_manifest_download_failed".into());
    }
    if response
        .content_length()
        .is_some_and(|length| length > maximum)
    {
        return Err(too_large_code.into());
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "runtime_manifest_download_failed".to_string())?
    {
        if bytes.len() as u64 + chunk.len() as u64 > maximum {
            return Err(too_large_code.into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn current_target() -> Result<RuntimeTarget, String> {
    match current_target_key()? {
        "windows-x86_64" => Ok(RuntimeTarget::WindowsX86_64),
        "linux-x86_64" => Ok(RuntimeTarget::LinuxX86_64),
        "darwin-x86_64" => Ok(RuntimeTarget::DarwinX86_64),
        "darwin-aarch64" => Ok(RuntimeTarget::DarwinAarch64),
        _ => Err("runtime_platform_unsupported".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        fetch_bounded, HttpRuntimeBootstrap, RuntimeBootstrapSource, RuntimeBootstrapStatus,
        RuntimeManager, RUNTIME_MANIFEST_SIGNATURE_URL, RUNTIME_MANIFEST_URL,
    };
    use crate::runtime::installer::{RuntimeInstaller, RuntimeSource};
    use crate::runtime::manifest::RuntimeAsset;
    use crate::storage::DataLayout;
    use sha2::{Digest, Sha256};
    use std::io::Write as _;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use zip::write::SimpleFileOptions;

    #[derive(Clone)]
    struct FakeSource {
        bytes: Arc<Vec<u8>>,
        downloads: Arc<AtomicUsize>,
    }

    impl FakeSource {
        fn new() -> Self {
            Self {
                bytes: Arc::new(runtime_archive()),
                downloads: Arc::new(AtomicUsize::new(0)),
            }
        }

        fn asset(&self) -> RuntimeAsset {
            RuntimeAsset {
                version: "1.0.0".into(),
                url: "https://github.com/kareem-sf/tawreed/releases/download/v1.0.0/runtime.zip"
                    .into(),
                sha256: Sha256::digest(self.bytes.as_slice())
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect(),
                size: self.bytes.len() as u64,
                archive: "zip".into(),
                entrypoint: health_entrypoint().into(),
            }
        }
    }

    #[async_trait::async_trait]
    impl RuntimeSource for FakeSource {
        async fn download(
            &self,
            _asset: &RuntimeAsset,
            destination: &mut tokio::fs::File,
            resume_from: u64,
            progress: &(dyn Fn(u64, u64) + Send + Sync),
        ) -> Result<(), String> {
            use tokio::io::{AsyncSeekExt, AsyncWriteExt};

            self.downloads.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(30)).await;
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
            let midpoint = resume_from as usize + (self.bytes.len() - resume_from as usize) / 2;
            destination
                .write_all(&self.bytes[resume_from as usize..midpoint])
                .await
                .map_err(|_| "runtime_download_failed".to_string())?;
            progress(midpoint as u64, self.bytes.len() as u64);
            destination
                .write_all(&self.bytes[midpoint..])
                .await
                .map_err(|_| "runtime_download_failed".to_string())?;
            progress(self.bytes.len() as u64, self.bytes.len() as u64);
            destination
                .sync_all()
                .await
                .map_err(|_| "runtime_download_failed".to_string())
        }
    }

    #[derive(Clone)]
    struct FakeBootstrap {
        asset: RuntimeAsset,
        calls: Arc<AtomicUsize>,
    }

    #[async_trait::async_trait]
    impl RuntimeBootstrapSource for FakeBootstrap {
        async fn verified_asset(&self) -> Result<RuntimeAsset, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.asset.clone())
        }
    }

    #[tokio::test]
    async fn serializes_the_exact_renderer_status_shape() {
        let fixture = manager_fixture();

        let value = serde_json::to_value(fixture.manager.status().await).unwrap();

        assert_eq!(
            value,
            serde_json::json!({
                "phase": "checking",
                "progress": 0.0,
                "component": null,
                "version": null,
                "errorCode": null,
                "recoverable": false
            })
        );
    }

    #[tokio::test]
    async fn reports_only_the_ordered_bootstrap_phases() {
        let fixture = manager_fixture();
        let updates = Arc::new(Mutex::new(Vec::<RuntimeBootstrapStatus>::new()));
        let received = updates.clone();

        let final_status = fixture
            .manager
            .start(move |status| received.lock().unwrap().push(status))
            .await
            .unwrap();

        let phases = {
            let statuses = updates.lock().unwrap();
            statuses.iter().map(|status| status.phase.clone()).fold(
                Vec::new(),
                |mut unique, phase| {
                    if unique.last() != Some(&phase) {
                        unique.push(phase);
                    }
                    unique
                },
            )
        };
        assert_eq!(
            phases,
            vec![
                "checking",
                "downloading",
                "verifying",
                "activating",
                "ready"
            ]
        );
        assert_eq!(final_status.phase, "ready");
        assert_eq!(final_status.progress, Some(100.0));
        assert_eq!(final_status.version.as_deref(), Some("1.0.0"));
        assert_eq!(
            fixture
                .manager
                .active_entrypoint()
                .await
                .unwrap()
                .informational_path(),
            fixture
                .layout
                .runtime_versions
                .join("1.0.0")
                .join(health_entrypoint())
                .as_path()
        );
    }

    #[tokio::test]
    async fn duplicate_starts_share_one_manifest_fetch_and_download() {
        let fixture = manager_fixture();
        let manager = Arc::new(fixture.manager);
        let first = manager.clone();
        let second = manager.clone();

        let (first_result, second_result) =
            tokio::join!(async move { first.start(|_| {}).await }, async move {
                second.start(|_| {}).await
            });

        assert_eq!(first_result.unwrap().phase, "ready");
        assert_eq!(second_result.unwrap().phase, "ready");
        assert_eq!(fixture.bootstrap_calls.load(Ordering::SeqCst), 1);
        assert_eq!(fixture.source_downloads.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn concurrent_identical_retries_share_one_completed_generation() {
        let fixture = manager_fixture();
        let downloads = fixture.source_downloads.clone();
        let mut wrong_asset = fixture.source.asset();
        wrong_asset.sha256 = "0".repeat(64);
        let manager = Arc::new(RuntimeManager::with_components(
            RuntimeInstaller::new(fixture.layout, fixture.source),
            FakeBootstrap {
                asset: wrong_asset,
                calls: Arc::new(AtomicUsize::new(0)),
            },
        ));
        assert_eq!(manager.start(|_| {}).await.unwrap().phase, "error");
        let first = manager.clone();
        let second = manager.clone();

        let (first_status, second_status) = tokio::join!(
            async move { first.retry(|_| {}).await.unwrap() },
            async move { second.retry(|_| {}).await.unwrap() }
        );

        assert_eq!(first_status, second_status);
        assert_eq!(downloads.load(Ordering::SeqCst), 2);
    }

    #[derive(Clone)]
    struct CancelOnceBootstrap {
        asset: RuntimeAsset,
        calls: Arc<AtomicUsize>,
        started: Arc<tokio::sync::Notify>,
    }

    #[async_trait::async_trait]
    impl RuntimeBootstrapSource for CancelOnceBootstrap {
        async fn verified_asset(&self) -> Result<RuntimeAsset, String> {
            if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                self.started.notify_waiters();
                std::future::pending::<()>().await;
                unreachable!();
            }
            Ok(self.asset.clone())
        }
    }

    #[tokio::test]
    async fn aborted_leader_closes_followers_and_allows_one_new_leader() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeSource::new();
        let downloads = source.downloads.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let started = Arc::new(tokio::sync::Notify::new());
        let manager = Arc::new(RuntimeManager::with_components(
            RuntimeInstaller::new(layout, source.clone()),
            CancelOnceBootstrap {
                asset: source.asset(),
                calls: calls.clone(),
                started: started.clone(),
            },
        ));
        let started_wait = started.notified();
        let leader_manager = manager.clone();
        let leader = tokio::spawn(async move { leader_manager.start(|_| {}).await });
        started_wait.await;
        let follower_manager = manager.clone();
        let follower = tokio::spawn(async move { follower_manager.retry(|_| {}).await });
        tokio::task::yield_now().await;

        leader.abort();
        let _ = leader.await;
        let status = tokio::time::timeout(std::time::Duration::from_secs(2), follower)
            .await
            .expect("follower remained blocked after leader abort")
            .unwrap()
            .unwrap();

        assert_eq!(status.phase, "ready");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(downloads.load(Ordering::SeqCst), 1);
    }

    #[derive(Clone)]
    struct PanicOnceBootstrap {
        asset: RuntimeAsset,
        calls: Arc<AtomicUsize>,
    }

    #[async_trait::async_trait]
    impl RuntimeBootstrapSource for PanicOnceBootstrap {
        async fn verified_asset(&self) -> Result<RuntimeAsset, String> {
            if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                panic!("injected bootstrap panic");
            }
            Ok(self.asset.clone())
        }
    }

    #[tokio::test]
    async fn panicked_leader_closes_generation_and_next_start_releads() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeSource::new();
        let calls = Arc::new(AtomicUsize::new(0));
        let manager = Arc::new(RuntimeManager::with_components(
            RuntimeInstaller::new(layout, source.clone()),
            PanicOnceBootstrap {
                asset: source.asset(),
                calls: calls.clone(),
            },
        ));
        let first = manager.clone();
        assert!(tokio::spawn(async move { first.start(|_| {}).await })
            .await
            .is_err());

        let status = tokio::time::timeout(std::time::Duration::from_secs(2), manager.start(|_| {}))
            .await
            .expect("next start remained blocked after leader panic")
            .unwrap();

        assert_eq!(status.phase, "ready");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn exposes_stable_recoverable_error_state_and_retries() {
        let fixture = manager_fixture();
        let mut wrong_asset = fixture.source.asset();
        wrong_asset.sha256 = "0".repeat(64);
        let calls = Arc::new(AtomicUsize::new(0));
        let manager = RuntimeManager::with_components(
            RuntimeInstaller::new(fixture.layout, fixture.source),
            FakeBootstrap {
                asset: wrong_asset,
                calls,
            },
        );

        let returned = manager.start(|_| {}).await.unwrap();
        assert_eq!(returned.phase, "error");
        assert_eq!(
            returned.error_code.as_deref(),
            Some("runtime_hash_mismatch")
        );
        assert!(returned.recoverable);
        let status = manager.status().await;
        assert_eq!(status.phase, "error");
        assert_eq!(status.error_code.as_deref(), Some("runtime_hash_mismatch"));
        assert!(status.recoverable);
        assert_eq!(manager.retry(|_| {}).await.unwrap().phase, "error");
    }

    #[tokio::test]
    async fn rollback_updates_manager_status_to_the_restored_version() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeSource::new();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        let mut previous = source.asset();
        previous.version = "0.9.0".into();
        previous.url =
            "https://github.com/kareem-sf/tawreed/releases/download/v0.9.0/runtime.zip".into();
        installer.ensure(&previous).await.unwrap();
        let current = source.asset();
        installer.ensure(&current).await.unwrap();
        let manager = RuntimeManager::with_components(
            installer,
            FakeBootstrap {
                asset: current,
                calls: Arc::new(AtomicUsize::new(0)),
            },
        );

        manager.rollback().await.unwrap();

        let status = manager.status().await;
        assert_eq!(status.phase, "ready");
        assert_eq!(status.version.as_deref(), Some("0.9.0"));
    }

    #[tokio::test]
    async fn concurrent_rollbacks_share_one_swap_generation() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeSource::new();
        let downloads = source.downloads.clone();
        let installer = RuntimeInstaller::new(layout, source.clone());
        let mut previous = source.asset();
        previous.version = "0.9.0".into();
        previous.url =
            "https://github.com/kareem-sf/tawreed/releases/download/v0.9.0/runtime.zip".into();
        installer.ensure(&previous).await.unwrap();
        let current = source.asset();
        installer.ensure(&current).await.unwrap();
        let manager = Arc::new(RuntimeManager::with_components(
            installer,
            FakeBootstrap {
                asset: current,
                calls: Arc::new(AtomicUsize::new(0)),
            },
        ));
        let first = manager.clone();
        let second = manager.clone();

        let (first_path, second_path) =
            tokio::join!(async move { first.rollback().await.unwrap() }, async move {
                second.rollback().await.unwrap()
            });

        assert_eq!(first_path, second_path);
        assert!(first_path.to_string_lossy().contains("0.9.0"));
        assert_eq!(manager.status().await.version.as_deref(), Some("0.9.0"));
        assert_eq!(downloads.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn caller_abort_and_post_commit_validation_fault_cannot_replay_the_swap() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeSource::new();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        let mut previous = source.asset();
        previous.version = "0.9.0".into();
        previous.url =
            "https://github.com/kareem-sf/tawreed/releases/download/v0.9.0/runtime.zip".into();
        installer.ensure(&previous).await.unwrap();
        let current = source.asset();
        installer.ensure(&current).await.unwrap();
        let manager = Arc::new(RuntimeManager::with_components(
            installer,
            FakeBootstrap {
                asset: current,
                calls: Arc::new(AtomicUsize::new(0)),
            },
        ));
        let restored_metadata = layout
            .runtime_versions
            .join("0.9.0")
            .join("runtime-metadata.json");
        let held_metadata = restored_metadata.with_extension("held");
        let hook_held_metadata = held_metadata.clone();
        let hook_restored_metadata = restored_metadata.clone();
        let (entered_sender, entered_receiver) = std::sync::mpsc::sync_channel(0);
        let (release_sender, release_receiver) = std::sync::mpsc::sync_channel(0);
        manager
            .installer
            .set_test_after_rollback_commit_hook(move || {
                std::fs::rename(hook_restored_metadata, hook_held_metadata).unwrap();
                entered_sender.send(()).unwrap();
                release_receiver.recv().unwrap();
            });
        let caller_manager = manager.clone();
        let caller = tokio::spawn(async move { caller_manager.rollback().await });
        entered_receiver
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        let follower_manager = manager.clone();
        let follower = tokio::spawn(async move { follower_manager.rollback().await });
        tokio::task::yield_now().await;

        caller.abort();
        release_sender.send(()).unwrap();
        let entrypoint = tokio::time::timeout(std::time::Duration::from_secs(2), follower)
            .await
            .expect("rollback follower remained blocked")
            .unwrap()
            .unwrap();
        let _ = caller.await;
        std::fs::rename(held_metadata, restored_metadata).unwrap();

        assert!(entrypoint.to_string_lossy().contains("0.9.0"));
        assert_eq!(manager.status().await.version.as_deref(), Some("0.9.0"));
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(
                &std::fs::read(layout.runtime.join("runtime-state.json")).unwrap()
            )
            .unwrap()["current"]["version"],
            "0.9.0"
        );
    }

    #[derive(Clone)]
    struct ErrorBootstrap(String);

    #[async_trait::async_trait]
    impl RuntimeBootstrapSource for ErrorBootstrap {
        async fn verified_asset(&self) -> Result<RuntimeAsset, String> {
            Err(self.0.clone())
        }
    }

    #[tokio::test]
    async fn maps_private_diagnostics_and_oversized_versions_to_shared_contract_bounds() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeSource::new();
        let private = format!("C:\\Users\\secret\\{}", "x".repeat(200));
        let manager = RuntimeManager::with_components(
            RuntimeInstaller::new(layout.clone(), source.clone()),
            ErrorBootstrap(private.clone()),
        );

        let status = manager.start(|_| {}).await.unwrap();

        assert_eq!(status.error_code.as_deref(), Some("runtime_internal_error"));
        assert!(!serde_json::to_string(&status).unwrap().contains(&private));
        assert!(status.error_code.as_ref().unwrap().len() <= 80);

        let mut oversized = source.asset();
        oversized.version = "18446744073709551615.18446744073709551615.1".into();
        oversized.url = format!(
            "https://github.com/kareem-sf/tawreed/releases/download/v{}/runtime.zip",
            oversized.version
        );
        assert!(oversized.version.len() > 40);
        let manager = RuntimeManager::with_components(
            RuntimeInstaller::new(layout, source),
            FakeBootstrap {
                asset: oversized,
                calls: Arc::new(AtomicUsize::new(0)),
            },
        );
        let status = manager.start(|_| {}).await.unwrap();
        assert_eq!(status.error_code.as_deref(), Some("invalid_runtime_asset"));
        assert!(status.version.is_none());
    }

    #[test]
    fn uses_only_the_approved_bootstrap_endpoints() {
        assert_eq!(
            RUNTIME_MANIFEST_URL,
            "https://github.com/kareem-sf/tawreed/releases/latest/download/runtime-manifest.json"
        );
        assert_eq!(
            RUNTIME_MANIFEST_SIGNATURE_URL,
            "https://github.com/kareem-sf/tawreed/releases/latest/download/runtime-manifest.sig"
        );
    }

    #[test]
    fn rejects_the_manifest_signature_before_parsing_or_asset_selection() {
        let error =
            HttpRuntimeBootstrap::verified_asset_from_bytes(b"not json", b"not-a-signature")
                .unwrap_err();

        assert_eq!(error, "invalid_runtime_signature");
    }

    #[tokio::test]
    async fn bounds_bootstrap_responses_before_signature_verification() {
        let (url, request) = serve_bytes(b"0123456789abcdefg");

        let error = fetch_bounded(
            &reqwest::Client::new(),
            &url,
            16,
            "runtime_manifest_too_large",
        )
        .await
        .unwrap_err();

        assert_eq!(error, "runtime_manifest_too_large");
        request.join().unwrap();
    }

    struct ManagerFixture {
        manager: RuntimeManager<FakeSource, FakeBootstrap>,
        layout: DataLayout,
        source: FakeSource,
        bootstrap_calls: Arc<AtomicUsize>,
        source_downloads: Arc<AtomicUsize>,
        _root: tempfile::TempDir,
    }

    fn manager_fixture() -> ManagerFixture {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeSource::new();
        let source_downloads = source.downloads.clone();
        let bootstrap_calls = Arc::new(AtomicUsize::new(0));
        let bootstrap = FakeBootstrap {
            asset: source.asset(),
            calls: bootstrap_calls.clone(),
        };
        let manager = RuntimeManager::with_components(
            RuntimeInstaller::new(layout.clone(), source.clone()),
            bootstrap,
        );
        ManagerFixture {
            manager,
            layout,
            source,
            bootstrap_calls,
            source_downloads,
            _root: root,
        }
    }

    fn runtime_archive() -> Vec<u8> {
        let mut bytes = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(&mut bytes);
        writer
            .start_file(
                health_entrypoint(),
                SimpleFileOptions::default().unix_permissions(0o755),
            )
            .unwrap();
        writer.write_all(health_script().as_bytes()).unwrap();
        writer.finish().unwrap();
        bytes.into_inner()
    }

    fn serve_bytes(body: &'static [u8]) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut chunk = [0_u8; 512];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = stream.read(&mut chunk).unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
            }
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(body).unwrap();
        });
        (format!("http://{address}/bootstrap"), handle)
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
    fn health_script() -> &'static str {
        "@echo off\r\necho {\"status\":\"ok\",\"protocolVersion\":1}\r\nexit /b 0\r\n"
    }

    #[cfg(not(windows))]
    fn health_script() -> &'static str {
        "#!/bin/sh\nprintf '%s\\n' '{\"status\":\"ok\",\"protocolVersion\":1}'\n"
    }
}
