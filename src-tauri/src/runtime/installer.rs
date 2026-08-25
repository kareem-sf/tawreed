use std::io::Read as _;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;

use super::manifest::{valid_entrypoint, validate_asset, RuntimeAsset};
use crate::storage::{atomic_write_json, DataLayout};

const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_EXPANDED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;

#[async_trait::async_trait]
pub trait RuntimeSource: Send + Sync {
    async fn download(
        &self,
        asset: &RuntimeAsset,
        destination: &Path,
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
        destination: &Path,
        resume_from: u64,
        progress: &(dyn Fn(u64, u64) + Send + Sync),
    ) -> Result<(), String> {
        use tokio::io::AsyncWriteExt;

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

        let mut options = tokio::fs::OpenOptions::new();
        options
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append);
        let mut file = options
            .open(destination)
            .await
            .map_err(|_| "runtime_download_failed".to_string())?;
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
                file.set_len(0)
                    .await
                    .map_err(|_| "runtime_download_failed".to_string())?;
                return Err("runtime_download_too_large".into());
            }
            file.write_all(&chunk)
                .await
                .map_err(|_| "runtime_download_failed".to_string())?;
            progress(base + received, asset.size);
        }
        file.sync_all()
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

pub struct RuntimeInstaller<S> {
    layout: DataLayout,
    source: S,
}

impl<S: RuntimeSource> RuntimeInstaller<S> {
    pub fn new(layout: DataLayout, source: S) -> Self {
        Self { layout, source }
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
        self.layout.ensure()?;

        if let Some(current) = read_pointer_if_exists(&self.layout.runtime.join("current.json"))? {
            if current.version == asset.version
                && current.target == current_target_key()?
                && current.entrypoint == asset.entrypoint
            {
                progress(InstallProgress {
                    phase: InstallPhase::Downloading,
                    progress: 80.0,
                });
                progress(InstallProgress {
                    phase: InstallPhase::Verifying,
                    progress: 85.0,
                });
                let entrypoint = resolve_pointer(&self.layout, &current)?;
                progress(InstallProgress {
                    phase: InstallPhase::Activating,
                    progress: 95.0,
                });
                run_health_check(&entrypoint).await?;
                return Ok(self.layout.runtime_versions.join(&asset.version));
            }
        }

        let part = self.layout.staging.join(format!(
            "{}-{}.zip.part",
            current_target_key()?,
            asset.version
        ));
        let mut existing = regular_file_len_or_zero(&part)?;
        if existing > asset.size {
            std::fs::remove_file(&part).map_err(|_| "runtime_download_failed".to_string())?;
            existing = 0;
        }
        report_download_progress(progress, existing, asset.size);
        if existing < asset.size {
            let download_progress = |downloaded, total| {
                report_download_progress(progress, downloaded, total);
            };
            self.source
                .download(asset, &part, existing, &download_progress)
                .await?;
        }
        progress(InstallProgress {
            phase: InstallPhase::Verifying,
            progress: 85.0,
        });
        if let Err(error) = verify_archive(&part, asset).await {
            if error == "runtime_hash_mismatch" {
                std::fs::remove_file(&part)
                    .map_err(|_| "runtime_download_cleanup_failed".to_string())?;
            }
            return Err(error);
        }

        progress(InstallProgress {
            phase: InstallPhase::Activating,
            progress: 95.0,
        });
        let staging_root = self
            .layout
            .staging
            .join(format!("runtime-{}.tmp", asset.version));
        reset_staging_directory(&staging_root)?;
        if let Err(error) = extract_archive(&part, &staging_root) {
            let _ = std::fs::remove_dir_all(&staging_root);
            return Err(error);
        }

        let staged_entrypoint = staging_root.join(&asset.entrypoint);
        if let Err(error) = run_health_check(&staged_entrypoint).await {
            let _ = std::fs::remove_dir_all(&staging_root);
            return Err(error);
        }

        let active_root = self.layout.runtime_versions.join(&asset.version);
        if active_root.exists() {
            let _ = std::fs::remove_dir_all(&staging_root);
            return Err("runtime_version_already_exists".into());
        }
        std::fs::rename(&staging_root, &active_root)
            .map_err(|_| "runtime_activation_failed".to_string())?;

        let pointer = RuntimePointer {
            version: asset.version.clone(),
            target: current_target_key()?.into(),
            entrypoint: asset.entrypoint.clone(),
        };
        let current_path = self.layout.runtime.join("current.json");
        let activation = (|| {
            if let Some(current) = read_pointer_if_exists(&current_path)? {
                atomic_write_json(&self.layout.runtime.join("previous.json"), &current)
                    .map_err(|_| "runtime_activation_failed".to_string())?;
            }
            atomic_write_json(&current_path, &pointer)
                .map_err(|_| "runtime_activation_failed".to_string())
        })();
        if let Err(error) = activation {
            std::fs::remove_dir_all(&active_root)
                .map_err(|_| "runtime_activation_cleanup_failed".to_string())?;
            return Err(error);
        }
        Ok(active_root)
    }

    pub fn active_entrypoint(&self) -> Result<PathBuf, String> {
        let pointer = read_pointer_if_exists(&self.layout.runtime.join("current.json"))?
            .ok_or_else(|| "runtime_not_installed".to_string())?;
        resolve_pointer(&self.layout, &pointer)
    }

    pub(crate) fn active_version(&self) -> Result<String, String> {
        let pointer = read_pointer_if_exists(&self.layout.runtime.join("current.json"))?
            .ok_or_else(|| "runtime_not_installed".to_string())?;
        resolve_pointer(&self.layout, &pointer)?;
        Ok(pointer.version)
    }

    pub async fn rollback(&self) -> Result<PathBuf, String> {
        let current_path = self.layout.runtime.join("current.json");
        let previous_path = self.layout.runtime.join("previous.json");
        let current = read_pointer_if_exists(&current_path)?
            .ok_or_else(|| "runtime_not_installed".to_string())?;
        let previous = read_pointer_if_exists(&previous_path)?
            .ok_or_else(|| "runtime_rollback_unavailable".to_string())?;
        let entrypoint = resolve_pointer(&self.layout, &previous)?;
        run_health_check(&entrypoint).await?;

        atomic_write_json(&current_path, &previous)
            .map_err(|_| "runtime_activation_failed".to_string())?;
        atomic_write_json(&previous_path, &current)
            .map_err(|_| "runtime_activation_failed".to_string())?;
        Ok(entrypoint)
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimePointer {
    version: String,
    target: String,
    entrypoint: String,
}

fn regular_file_len_or_zero(path: &Path) -> Result<u64, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(_) => return Err("runtime_download_failed".into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("unsafe_runtime_download_path".into());
    }
    Ok(metadata.len())
}

async fn verify_archive(path: &Path, asset: &RuntimeAsset) -> Result<(), String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| "runtime_download_failed".to_string())?;
    let size = file
        .metadata()
        .await
        .map_err(|_| "runtime_download_failed".to_string())?
        .len();
    if size != asset.size {
        return Err("runtime_size_mismatch".into());
    }

    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|_| "runtime_download_failed".to_string())?;
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
    Ok(())
}

fn reset_staging_directory(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("unsafe_runtime_staging".into())
        }
        Ok(metadata) if metadata.is_dir() => {
            std::fs::remove_dir_all(path).map_err(|_| "runtime_staging_failed".to_string())?;
        }
        Ok(_) => return Err("unsafe_runtime_staging".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("runtime_staging_failed".into()),
    }
    std::fs::create_dir(path).map_err(|_| "runtime_staging_failed".to_string())
}

fn extract_archive(archive_path: &Path, staging_root: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|_| "invalid_runtime_archive")?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| "invalid_runtime_archive")?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("runtime_archive_too_large".into());
    }
    let mut expanded = 0_u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| "invalid_runtime_archive")?;
        let entry_name = entry.name().to_string();
        let relative = entry
            .enclosed_name()
            .ok_or("unsafe_runtime_archive")?
            .to_owned();
        let unix_mode = entry.unix_mode();
        if !safe_archive_name(&entry_name, &relative)
            || unsafe_unix_file_type(unix_mode, entry.is_dir())
        {
            return Err("unsafe_runtime_archive".into());
        }
        let expected_size = entry.size();
        expanded = expanded
            .checked_add(expected_size)
            .ok_or_else(|| "runtime_archive_too_large".to_string())?;
        if expanded > MAX_EXPANDED_BYTES {
            return Err("runtime_archive_too_large".into());
        }

        let destination = staging_root.join(relative);
        if entry.is_dir() {
            ensure_safe_directory(staging_root, &destination)?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            ensure_safe_directory(staging_root, parent)?;
        }
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|_| "runtime_extraction_failed".to_string())?;
        let copied = std::io::copy(&mut entry.take(expected_size + 1), &mut output)
            .map_err(|_| "runtime_extraction_failed".to_string())?;
        if copied != expected_size {
            return Err("invalid_runtime_archive".into());
        }
        output
            .sync_all()
            .map_err(|_| "runtime_extraction_failed".to_string())?;
        set_executable_permissions(&destination, unix_mode)?;
    }
    Ok(())
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

fn unsafe_unix_file_type(mode: Option<u32>, directory: bool) -> bool {
    let Some(kind) = mode.map(|value| value & 0o170000) else {
        return false;
    };
    kind != 0 && kind != 0o100000 && !(directory && kind == 0o040000)
}

fn ensure_safe_directory(root: &Path, directory: &Path) -> Result<(), String> {
    let relative = directory
        .strip_prefix(root)
        .map_err(|_| "unsafe_runtime_archive".to_string())?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            return Err("unsafe_runtime_archive".into());
        };
        current.push(component);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err("unsafe_runtime_archive".into())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                std::fs::create_dir(&current).map_err(|_| "runtime_extraction_failed")?;
                let metadata = std::fs::symlink_metadata(&current)
                    .map_err(|_| "runtime_extraction_failed".to_string())?;
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err("unsafe_runtime_archive".into());
                }
            }
            Err(_) => return Err("runtime_extraction_failed".into()),
        }
    }
    Ok(())
}

#[cfg(unix)]
fn set_executable_permissions(path: &Path, unix_mode: Option<u32>) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    if let Some(mode) = unix_mode {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode & 0o777))
            .map_err(|_| "runtime_extraction_failed".to_string())?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn set_executable_permissions(_path: &Path, _unix_mode: Option<u32>) -> Result<(), String> {
    Ok(())
}

async fn run_health_check(entrypoint: &Path) -> Result<(), String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct HealthStatus {
        status: String,
        protocol_version: u32,
    }

    let output = tokio::process::Command::new(entrypoint)
        .arg("--health-check")
        .output()
        .await
        .map_err(|_| "runtime_health_check_failed".to_string())?;
    if !output.status.success() {
        return Err("runtime_health_check_failed".into());
    }
    let stdout = std::str::from_utf8(&output.stdout)
        .map_err(|_| "runtime_health_check_failed".to_string())?;
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

fn read_pointer_if_exists(path: &Path) -> Result<Option<RuntimePointer>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "invalid_runtime_pointer".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("invalid_runtime_pointer".into()),
    }
}

fn resolve_pointer(layout: &DataLayout, pointer: &RuntimePointer) -> Result<PathBuf, String> {
    let version = semver::Version::parse(&pointer.version)
        .map_err(|_| "invalid_runtime_pointer".to_string())?;
    let entrypoint = Path::new(&pointer.entrypoint);
    if pointer.target != current_target_key()?
        || version.to_string() != pointer.version
        || !version.pre.is_empty()
        || !version.build.is_empty()
        || !safe_archive_name(&pointer.entrypoint, entrypoint)
    {
        return Err("invalid_runtime_pointer".into());
    }

    let version_root = layout.runtime_versions.join(&pointer.version);
    let resolved = version_root.join(entrypoint);
    let metadata =
        std::fs::symlink_metadata(&resolved).map_err(|_| "runtime_not_installed".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("invalid_runtime_pointer".into());
    }
    let mut current = version_root;
    for component in entrypoint.components() {
        let Component::Normal(component) = component else {
            return Err("invalid_runtime_pointer".into());
        };
        current.push(component);
        let metadata =
            std::fs::symlink_metadata(&current).map_err(|_| "runtime_not_installed".to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("invalid_runtime_pointer".into());
        }
    }
    Ok(resolved)
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
    use super::{allowed_redirect_url, HttpRuntimeSource, RuntimeInstaller, RuntimeSource};
    use crate::runtime::manifest::RuntimeAsset;
    use crate::storage::DataLayout;
    use sha2::{Digest, Sha256};
    use std::path::Path;
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
            destination: &Path,
            resume_from: u64,
            progress: &(dyn Fn(u64, u64) + Send + Sync),
        ) -> Result<(), String> {
            use tokio::io::AsyncWriteExt;

            self.offsets.lock().unwrap().push(resume_from);
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
            file.write_all(&self.bytes[resume_from as usize..])
                .await
                .map_err(|_| "runtime_download_failed".to_string())?;
            file.sync_all()
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
        let pointer: serde_json::Value =
            serde_json::from_slice(&std::fs::read(layout.runtime.join("current.json")).unwrap())
                .unwrap();
        assert_eq!(pointer["version"], "1.0.0");
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
        assert!(!layout.runtime.join("previous.json").exists());
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
        let pointer: serde_json::Value =
            serde_json::from_slice(&std::fs::read(layout.runtime.join("current.json")).unwrap())
                .unwrap();
        assert_eq!(pointer["version"], "0.9.0");
    }

    #[tokio::test]
    async fn failed_pointer_publication_keeps_current_and_removes_orphaned_version() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let source = FakeRuntimeSource::healthy_archive();
        let installer = RuntimeInstaller::new(layout.clone(), source.clone());
        installer
            .ensure(&asset_for(&source, "0.9.0"))
            .await
            .unwrap();
        std::fs::create_dir(layout.runtime.join("previous.json")).unwrap();

        assert_eq!(
            installer
                .ensure(&asset_for(&source, "1.0.0"))
                .await
                .unwrap_err(),
            "runtime_activation_failed"
        );

        assert_eq!(pointer_version(&layout, "current.json"), "0.9.0");
        assert!(!layout.runtime_versions.join("1.0.0").exists());
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
            assert!(!layout.runtime.join("current.json").exists());
            assert!(!layout
                .staging
                .join(format!("runtime-{}.tmp", asset.version))
                .exists());
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
            assert!(!layout.runtime.join("current.json").exists());
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
            assert!(!layout.runtime.join("current.json").exists());
        }
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

        let entrypoint = installer.rollback().await.unwrap();

        assert!(entrypoint.ends_with(health_entrypoint()));
        assert_eq!(pointer_version(&layout, "current.json"), "0.9.0");
        assert_eq!(pointer_version(&layout, "previous.json"), "1.0.0");
        assert_eq!(installer.active_entrypoint().unwrap(), entrypoint);
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
        assert_eq!(pointer_version(&layout, "current.json"), "1.0.0");
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

        source.download(&asset, &part, 3, &|_, _| {}).await.unwrap();

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

        source
            .download(&http_asset(url, 6), &part, 5, &|_, _| {})
            .await
            .unwrap();

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
        assert_eq!(
            source
                .download(&http_asset(url, 6), &part, 3, &|_, _| {})
                .await
                .unwrap_err(),
            "runtime_download_invalid_response"
        );
        request.join().unwrap();

        let (url, request) = serve_once("200 OK", &[], b"abcdefg");
        assert_eq!(
            source
                .download(&http_asset(url, 6), &part, 0, &|_, _| {})
                .await
                .unwrap_err(),
            "runtime_download_too_large"
        );
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
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let mut bytes = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(&mut bytes);
        writer
            .start_file(
                health_entrypoint(),
                SimpleFileOptions::default().unix_permissions(0o755),
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

    fn pointer_version(layout: &DataLayout, name: &str) -> String {
        let pointer: serde_json::Value =
            serde_json::from_slice(&std::fs::read(layout.runtime.join(name)).unwrap()).unwrap();
        pointer["version"].as_str().unwrap().to_string()
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
