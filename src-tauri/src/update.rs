use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use ts_rs::TS;

const RELEASE_API: &str = "https://api.github.com/repos/kareem-sf/tawreed/releases/latest";
const RELEASE_PAGE_ROOT: &str = "https://github.com/kareem-sf/tawreed/releases/tag";
#[cfg(target_os = "windows")]
const PLATFORM_ASSET: &str = "Tawreed-Windows-x64.exe";
#[cfg(target_os = "linux")]
const PLATFORM_ASSET: &str = "Tawreed-Linux-x64.AppImage";
#[cfg(target_os = "macos")]
const PLATFORM_ASSET: &str = "Tawreed-macOS-universal.dmg";

#[derive(Debug, Deserialize)]
struct ReleaseAsset {
    name: String,
    digest: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Serialize, PartialEq, TS)]
#[ts(export, export_to = "../../src/bridge-types/")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub latest_tag: String,
    pub update_available: bool,
    pub asset_name: String,
    pub asset_sha256: Option<String>,
    pub published_at: Option<String>,
}

fn validate_release(current: &str, release: GithubRelease) -> Result<UpdateInfo, String> {
    if release.draft || release.prerelease {
        return Err("no_stable_release".into());
    }

    let current_version = Version::parse(current).map_err(|_| "invalid_current_version")?;
    let raw_version = release
        .tag_name
        .strip_prefix('v')
        .ok_or("invalid_release")?;
    let latest_version = Version::parse(raw_version).map_err(|_| "invalid_release")?;
    if !latest_version.pre.is_empty()
        || !latest_version.build.is_empty()
        || release.tag_name != format!("v{latest_version}")
    {
        return Err("invalid_release".into());
    }

    let matching_assets: Vec<&ReleaseAsset> = release
        .assets
        .iter()
        .filter(|asset| asset.name == PLATFORM_ASSET)
        .collect();
    let update_available = latest_version > current_version;
    let asset_sha256 = if update_available {
        if matching_assets.len() != 1 {
            return Err("missing_update_asset".into());
        }
        let digest = matching_assets[0]
            .digest
            .as_deref()
            .and_then(|value| value.strip_prefix("sha256:"))
            .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .ok_or("invalid_release")?;
        Some(digest.to_ascii_lowercase())
    } else {
        None
    };

    Ok(UpdateInfo {
        current_version: current_version.to_string(),
        latest_version: latest_version.to_string(),
        latest_tag: release.tag_name,
        update_available,
        asset_name: PLATFORM_ASSET.into(),
        asset_sha256,
        published_at: release.published_at,
    })
}

fn status_error(status: reqwest::StatusCode) -> Option<&'static str> {
    if status.is_success() {
        None
    } else if status == reqwest::StatusCode::NOT_FOUND {
        Some("no_stable_release")
    } else if status == reqwest::StatusCode::FORBIDDEN
        || status == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        Some("rate_limited")
    } else if status.is_server_error() {
        Some("service_unavailable")
    } else {
        Some("request_failed")
    }
}

#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent(format!("Tawreed/{}", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(12))
        .https_only(true)
        .build()
        .map_err(|_| "request_failed")?;

    let mut response = client
        .get(RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() || error.is_connect() {
                "offline"
            } else {
                "request_failed"
            }
        })?;

    if let Some(code) = status_error(response.status()) {
        return Err(code.into());
    }

    if response
        .content_length()
        .is_some_and(|length| length > 1_000_000)
    {
        return Err("invalid_release".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "request_failed")? {
        if body.len() + chunk.len() > 1_000_000 {
            return Err("invalid_release".into());
        }
        body.extend_from_slice(&chunk);
    }
    let release = serde_json::from_slice::<GithubRelease>(&body).map_err(|_| "invalid_release")?;
    let result = validate_release(env!("CARGO_PKG_VERSION"), release);
    if let Err(code) = &result {
        crate::store::log_line(&format!("update check rejected the latest release: {code}"));
    }
    result
}

#[tauri::command]
pub fn open_update_release(version: String) -> Result<(), String> {
    crate::commands::open_url(update_release_url(&version)?)
}

fn update_release_url(version: &str) -> Result<String, String> {
    let parsed = Version::parse(version).map_err(|_| "invalid_release")?;
    if !parsed.pre.is_empty() || !parsed.build.is_empty() || parsed.to_string() != version {
        return Err("invalid_release".into());
    }
    Ok(format!("{RELEASE_PAGE_ROOT}/v{parsed}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, assets: &[&str]) -> GithubRelease {
        GithubRelease {
            tag_name: tag.into(),
            draft: false,
            prerelease: false,
            published_at: Some("2026-07-19T12:00:00Z".into()),
            assets: assets
                .iter()
                .map(|name| ReleaseAsset {
                    name: (*name).into(),
                    digest: Some(format!("sha256:{}", "a".repeat(64))),
                })
                .collect(),
        }
    }

    #[test]
    fn reports_newer_semantic_version() {
        let info = validate_release("0.9.9", release("v1.0.0", &[PLATFORM_ASSET])).unwrap();
        assert!(info.update_available);
        assert_eq!(info.latest_version, "1.0.0");
    }

    #[test]
    fn equal_or_older_release_does_not_offer_downgrade() {
        assert!(
            !validate_release("1.0.0", release("v1.0.0", &[]))
                .unwrap()
                .update_available
        );
        assert!(
            !validate_release("1.1.0", release("v1.0.0", &[]))
                .unwrap()
                .update_available
        );
    }

    #[test]
    fn rejects_noncanonical_or_unstable_tags() {
        for tag in ["1.0.0", "vv1.0.0", "v1.0", "v1.0.0-beta.1", "v1.0.0+build"] {
            assert_eq!(
                validate_release("0.1.0", release(tag, &[PLATFORM_ASSET])),
                Err("invalid_release".into())
            );
        }
    }

    #[test]
    fn requires_one_exact_platform_asset() {
        for assets in [
            vec![],
            vec!["tawreed-platform-package"],
            vec!["Tawreed-platform-package.zip"],
            vec![PLATFORM_ASSET, PLATFORM_ASSET],
        ] {
            assert_eq!(
                validate_release("0.1.0", release("v0.2.0", &assets)),
                Err("missing_update_asset".into())
            );
        }
    }

    #[test]
    fn requires_a_github_sha256_for_an_available_update() {
        let mut missing_digest = release("v0.2.0", &[PLATFORM_ASSET]);
        missing_digest.assets[0].digest = None;
        assert_eq!(
            validate_release("0.1.0", missing_digest),
            Err("invalid_release".into())
        );

        let mut invalid_digest = release("v0.2.0", &[PLATFORM_ASSET]);
        invalid_digest.assets[0].digest = Some("sha256:not-a-digest".into());
        assert_eq!(
            validate_release("0.1.0", invalid_digest),
            Err("invalid_release".into())
        );
    }

    #[test]
    fn rejects_drafts_and_prereleases() {
        let mut draft = release("v0.2.0", &[PLATFORM_ASSET]);
        draft.draft = true;
        assert_eq!(
            validate_release("0.1.0", draft),
            Err("no_stable_release".into())
        );

        let mut prerelease = release("v0.2.0", &[PLATFORM_ASSET]);
        prerelease.prerelease = true;
        assert_eq!(
            validate_release("0.1.0", prerelease),
            Err("no_stable_release".into())
        );
    }

    #[test]
    fn constructs_only_the_canonical_official_release_page() {
        assert_eq!(
            update_release_url("1.2.3").unwrap(),
            "https://github.com/kareem-sf/tawreed/releases/tag/v1.2.3"
        );
        for version in ["v1.2.3", "1.2", "1.2.3/other", "1.2.3-beta.1"] {
            assert_eq!(update_release_url(version), Err("invalid_release".into()));
        }
    }

    #[test]
    fn maps_github_http_statuses_to_stable_error_codes() {
        assert_eq!(status_error(reqwest::StatusCode::OK), None);
        assert_eq!(
            status_error(reqwest::StatusCode::NOT_FOUND),
            Some("no_stable_release")
        );
        assert_eq!(
            status_error(reqwest::StatusCode::FORBIDDEN),
            Some("rate_limited")
        );
        assert_eq!(
            status_error(reqwest::StatusCode::TOO_MANY_REQUESTS),
            Some("rate_limited")
        );
        assert_eq!(
            status_error(reqwest::StatusCode::BAD_GATEWAY),
            Some("service_unavailable")
        );
        assert_eq!(
            status_error(reqwest::StatusCode::UNAUTHORIZED),
            Some("request_failed")
        );
    }
}
