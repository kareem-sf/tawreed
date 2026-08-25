use std::path::PathBuf;

use serde::Serialize;

use super::installer::{
    current_target_key, runtime_http_client, HttpRuntimeSource, InstallPhase, InstallProgress,
    RuntimeInstaller, RuntimeSource,
};
use super::manifest::{select_asset, verify_embedded_manifest, RuntimeAsset, RuntimeTarget};
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
            progress: Some(event.progress),
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

    fn error(code: String, version: Option<String>) -> Self {
        Self {
            phase: "error".into(),
            progress: None,
            component: None,
            version,
            recoverable: recoverable_error(&code),
            error_code: Some(code),
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
    installer: RuntimeInstaller<S>,
    bootstrap: B,
    status: tokio::sync::RwLock<RuntimeBootstrapStatus>,
    install_lock: tokio::sync::Mutex<()>,
}

impl RuntimeManager<HttpRuntimeSource, HttpRuntimeBootstrap> {
    pub fn new(layout: DataLayout) -> Result<Self, String> {
        Ok(Self::with_components(
            RuntimeInstaller::new(layout, HttpRuntimeSource::new()?),
            HttpRuntimeBootstrap::new()?,
        ))
    }
}

impl<S: RuntimeSource, B: RuntimeBootstrapSource> RuntimeManager<S, B> {
    pub fn with_components(installer: RuntimeInstaller<S>, bootstrap: B) -> Self {
        Self {
            installer,
            bootstrap,
            status: tokio::sync::RwLock::new(RuntimeBootstrapStatus::checking()),
            install_lock: tokio::sync::Mutex::new(()),
        }
    }

    pub async fn status(&self) -> RuntimeBootstrapStatus {
        self.status.read().await.clone()
    }

    pub async fn start<F>(&self, progress: F) -> Result<RuntimeBootstrapStatus, String>
    where
        F: Fn(RuntimeBootstrapStatus) + Send + Sync,
    {
        let observed = self.status().await;
        let _install_guard = self.install_lock.lock().await;
        let current = self.status().await;
        if current != observed || current.phase == "ready" {
            progress(current.clone());
            return status_result(current);
        }

        self.publish(RuntimeBootstrapStatus::checking(), &progress)
            .await;
        let asset = match self.bootstrap.verified_asset().await {
            Ok(asset) => asset,
            Err(code) => {
                let status = RuntimeBootstrapStatus::error(code.clone(), None);
                self.publish(status.clone(), &progress).await;
                return Ok(status);
            }
        };
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
                        &progress,
                    ).await;
                }
                result = &mut installation => break result,
            }
        };
        while let Ok(event) = receiver.try_recv() {
            self.publish(
                RuntimeBootstrapStatus::from_install_progress(event, &version),
                &progress,
            )
            .await;
        }

        match result {
            Ok(_) => {
                let status = RuntimeBootstrapStatus::ready(version);
                self.publish(status.clone(), &progress).await;
                Ok(status)
            }
            Err(code) => {
                let status = RuntimeBootstrapStatus::error(code.clone(), Some(version));
                self.publish(status.clone(), &progress).await;
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

    pub fn active_entrypoint(&self) -> Result<PathBuf, String> {
        self.installer.active_entrypoint()
    }

    pub async fn rollback(&self) -> Result<PathBuf, String> {
        let _install_guard = self.install_lock.lock().await;
        let entrypoint = self.installer.rollback().await?;
        let version = self.installer.active_version()?;
        *self.status.write().await = RuntimeBootstrapStatus::ready(version);
        Ok(entrypoint)
    }

    async fn publish<F>(&self, status: RuntimeBootstrapStatus, progress: &F)
    where
        F: Fn(RuntimeBootstrapStatus) + Send + Sync,
    {
        *self.status.write().await = status.clone();
        progress(status);
    }
}

fn status_result(status: RuntimeBootstrapStatus) -> Result<RuntimeBootstrapStatus, String> {
    Ok(status)
}

fn recoverable_error(code: &str) -> bool {
    matches!(
        code,
        "runtime_download_failed"
            | "runtime_download_invalid_response"
            | "runtime_download_too_large"
            | "runtime_download_cleanup_failed"
            | "runtime_size_mismatch"
            | "runtime_hash_mismatch"
            | "runtime_staging_failed"
            | "runtime_extraction_failed"
            | "runtime_health_check_failed"
            | "runtime_activation_failed"
            | "runtime_activation_cleanup_failed"
            | "runtime_manifest_download_failed"
    )
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
    use std::path::Path;
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
            destination: &Path,
            resume_from: u64,
            progress: &(dyn Fn(u64, u64) + Send + Sync),
        ) -> Result<(), String> {
            use tokio::io::AsyncWriteExt;

            self.downloads.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(30)).await;
            let mut options = tokio::fs::OpenOptions::new();
            options.create(true).write(true);
            if resume_from == 0 {
                options.truncate(true);
            } else {
                options.append(true);
            }
            let mut file = options
                .open(destination)
                .await
                .map_err(|_| "runtime_download_failed".to_string())?;
            let midpoint = resume_from as usize + (self.bytes.len() - resume_from as usize) / 2;
            file.write_all(&self.bytes[resume_from as usize..midpoint])
                .await
                .map_err(|_| "runtime_download_failed".to_string())?;
            progress(midpoint as u64, self.bytes.len() as u64);
            file.write_all(&self.bytes[midpoint..])
                .await
                .map_err(|_| "runtime_download_failed".to_string())?;
            progress(self.bytes.len() as u64, self.bytes.len() as u64);
            file.sync_all()
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

        let statuses = updates.lock().unwrap();
        let phases = statuses.iter().map(|status| status.phase.clone()).fold(
            Vec::new(),
            |mut unique, phase| {
                if unique.last() != Some(&phase) {
                    unique.push(phase);
                }
                unique
            },
        );
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
            fixture.manager.active_entrypoint().unwrap(),
            fixture
                .layout
                .runtime_versions
                .join("1.0.0")
                .join(health_entrypoint())
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
        let installer = RuntimeInstaller::new(layout, source.clone());
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
