use std::collections::BTreeMap;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use semver::Version;
use serde::Deserialize;

const MAX_RUNTIME_ASSET_SIZE: u64 = 1 << 30;
const OFFICIAL_RELEASE_PATH: &str = "/kareem-sf/tawreed/releases/download/";
const EMBEDDED_RUNTIME_PUBLIC_KEY_BASE64: &str = include_str!("../../runtime-updater.pub");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeManifest {
    pub schema_version: u32,
    pub app_version: String,
    pub assets: BTreeMap<String, RuntimeAsset>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeAsset {
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
    pub archive: String,
    pub entrypoint: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeTarget {
    WindowsX86_64,
    LinuxX86_64,
    DarwinX86_64,
    DarwinAarch64,
}

impl RuntimeTarget {
    pub fn key(self) -> &'static str {
        match self {
            Self::WindowsX86_64 => "windows-x86_64",
            Self::LinuxX86_64 => "linux-x86_64",
            Self::DarwinX86_64 => "darwin-x86_64",
            Self::DarwinAarch64 => "darwin-aarch64",
        }
    }
}

pub fn verify_manifest(
    bytes: &[u8],
    signature: &[u8; 64],
    public_key: &[u8; 32],
) -> Result<RuntimeManifest, String> {
    let key = VerifyingKey::from_bytes(public_key).map_err(|_| "invalid_runtime_key")?;
    key.verify(bytes, &Signature::from_bytes(signature))
        .map_err(|_| "invalid_runtime_signature")?;

    let manifest: RuntimeManifest =
        serde_json::from_slice(bytes).map_err(|_| "invalid_runtime_manifest")?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

pub fn verify_manifest_base64(
    bytes: &[u8],
    signature_base64: &str,
    public_key_base64: &str,
) -> Result<RuntimeManifest, String> {
    let signature = decode_signature_base64(signature_base64)?;
    let public_key = decode_public_key_base64(public_key_base64)?;
    verify_manifest(bytes, &signature, &public_key)
}

pub fn verify_embedded_manifest(
    bytes: &[u8],
    signature_base64: &str,
) -> Result<RuntimeManifest, String> {
    verify_manifest_base64(bytes, signature_base64, EMBEDDED_RUNTIME_PUBLIC_KEY_BASE64)
}

pub fn select_asset(
    manifest: &RuntimeManifest,
    target: RuntimeTarget,
) -> Result<&RuntimeAsset, String> {
    manifest
        .assets
        .get(target.key())
        .ok_or_else(|| "runtime_asset_unavailable".into())
}

pub fn validate_manifest(manifest: &RuntimeManifest) -> Result<(), String> {
    let app_version = stable_canonical_version(&manifest.app_version)
        .ok_or_else(|| "invalid_runtime_manifest".to_string())?;
    if manifest.schema_version != 1
        || manifest.app_version != env!("CARGO_PKG_VERSION")
        || app_version.to_string() != env!("CARGO_PKG_VERSION")
        || manifest.assets.is_empty()
    {
        return Err("invalid_runtime_manifest".into());
    }

    for (target, asset) in &manifest.assets {
        if !is_supported_target(target) || validate_asset(asset).is_err() {
            return Err("invalid_runtime_manifest".into());
        }
    }

    Ok(())
}

pub fn validate_asset(asset: &RuntimeAsset) -> Result<(), String> {
    let version = stable_canonical_version(&asset.version)
        .ok_or_else(|| "invalid_runtime_asset".to_string())?;
    if version.to_string() != asset.version
        || !valid_official_release_url(asset, &version)
        || asset.sha256.len() != 64
        || !asset
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || !(1..=MAX_RUNTIME_ASSET_SIZE).contains(&asset.size)
        || asset.archive != "zip"
        || !valid_entrypoint(&asset.entrypoint)
    {
        return Err("invalid_runtime_asset".into());
    }

    Ok(())
}

pub fn decode_signature_base64(encoded: &str) -> Result<[u8; 64], String> {
    decode_fixed_base64(encoded).map_err(|_| "invalid_runtime_signature".into())
}

pub fn decode_public_key_base64(encoded: &str) -> Result<[u8; 32], String> {
    decode_fixed_base64(encoded).map_err(|_| "invalid_runtime_key".into())
}

fn decode_fixed_base64<const N: usize>(encoded: &str) -> Result<[u8; N], ()> {
    let decoded = STANDARD.decode(encoded.trim()).map_err(|_| ())?;
    decoded.try_into().map_err(|_| ())
}

fn stable_canonical_version(value: &str) -> Option<Version> {
    let version = Version::parse(value).ok()?;
    if !version.pre.is_empty() || !version.build.is_empty() || version.to_string() != value {
        return None;
    }
    Some(version)
}

fn is_supported_target(target: &str) -> bool {
    matches!(
        target,
        "windows-x86_64" | "linux-x86_64" | "darwin-x86_64" | "darwin-aarch64"
    )
}

fn valid_official_release_url(asset: &RuntimeAsset, version: &Version) -> bool {
    let Ok(url) = reqwest::Url::parse(&asset.url) else {
        return false;
    };
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path().contains('%')
    {
        return false;
    }

    let expected_prefix = format!("{OFFICIAL_RELEASE_PATH}v{version}/");
    let Some(filename) = url.path().strip_prefix(&expected_prefix) else {
        return false;
    };
    !filename.is_empty() && !filename.contains('/') && filename != "." && filename != ".."
}

fn valid_entrypoint(entrypoint: &str) -> bool {
    if entrypoint.is_empty() || entrypoint.starts_with('/') || entrypoint.contains('\\') {
        return false;
    }

    entrypoint.split('/').all(valid_entrypoint_component)
}

fn valid_entrypoint_component(component: &str) -> bool {
    if component.is_empty()
        || component == "."
        || component == ".."
        || component.ends_with('.')
        || component.ends_with(' ')
        || component.chars().any(|character| {
            character <= '\u{1f}' || matches!(character, '<' | '>' | '"' | '|' | '?' | '*' | ':')
        })
    {
        return false;
    }

    let stem = component.split('.').next().unwrap_or_default();
    let upper_stem = stem.to_ascii_uppercase();
    if matches!(upper_stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return false;
    }
    for prefix in ["COM", "LPT"] {
        if let Some(suffix) = upper_stem.strip_prefix(prefix) {
            if matches!(
                suffix,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            ) {
                return false;
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;
    use ed25519_dalek::{Signer, SigningKey};
    use sha2::{Digest, Sha256};

    const VALID_MANIFEST: &[u8] = br#"{"schemaVersion":1,"appVersion":"0.5.6","assets":{"windows-x86_64":{"version":"1.0.0","url":"https://github.com/kareem-sf/tawreed/releases/download/v1.0.0/tawreed-runtime-windows-x64.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":1024,"archive":"zip","entrypoint":"agent/node.exe"}}}"#;

    fn verify_test_manifest(bytes: &[u8]) -> Result<RuntimeManifest, String> {
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let signature = signing.sign(bytes);
        verify_manifest(
            bytes,
            &signature.to_bytes(),
            &signing.verifying_key().to_bytes(),
        )
    }

    fn valid_asset() -> RuntimeAsset {
        RuntimeAsset {
            version: "1.0.0".into(),
            url: "https://github.com/kareem-sf/tawreed/releases/download/v1.0.0/tawreed-runtime-windows-x64.zip".into(),
            sha256: "a".repeat(64),
            size: 1024,
            archive: "zip".into(),
            entrypoint: "agent/node.exe".into(),
        }
    }

    #[test]
    fn verifies_a_signed_manifest_and_selects_windows_x64() {
        let manifest = verify_test_manifest(VALID_MANIFEST).unwrap();

        assert_eq!(
            select_asset(&manifest, RuntimeTarget::WindowsX86_64)
                .unwrap()
                .version,
            "1.0.0"
        );
    }

    #[test]
    fn verifies_signature_before_attempting_json_parsing() {
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let other_signing = SigningKey::from_bytes(&[8_u8; 32]);
        let invalid_json = b"not json";
        let untrusted_signature = other_signing.sign(invalid_json);

        assert_eq!(
            verify_manifest(
                invalid_json,
                &untrusted_signature.to_bytes(),
                &signing.verifying_key().to_bytes(),
            )
            .unwrap_err(),
            "invalid_runtime_signature"
        );
    }

    #[test]
    fn rejects_unknown_manifest_and_asset_fields() {
        let unknown_manifest_field =
            br#"{"schemaVersion":1,"appVersion":"0.5.6","assets":{},"extra":true}"#;
        let unknown_asset_field = br#"{"schemaVersion":1,"appVersion":"0.5.6","assets":{"windows-x86_64":{"version":"1.0.0","url":"https://github.com/kareem-sf/tawreed/releases/download/v1.0.0/tawreed-runtime-windows-x64.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":1024,"archive":"zip","entrypoint":"agent/node.exe","extra":true}}}"#;

        assert_eq!(
            verify_test_manifest(unknown_manifest_field).unwrap_err(),
            "invalid_runtime_manifest"
        );
        assert_eq!(
            verify_test_manifest(unknown_asset_field).unwrap_err(),
            "invalid_runtime_manifest"
        );
    }

    #[test]
    fn rejects_wrong_schema_and_app_versions() {
        for bytes in [
            br#"{"schemaVersion":2,"appVersion":"0.5.6","assets":{}}"#.as_slice(),
            br#"{"schemaVersion":1,"appVersion":"0.5.5","assets":{}}"#.as_slice(),
            br#"{"schemaVersion":1,"appVersion":"0.5.6+build","assets":{}}"#.as_slice(),
        ] {
            assert_eq!(
                verify_test_manifest(bytes).unwrap_err(),
                "invalid_runtime_manifest"
            );
        }
    }

    #[test]
    fn rejects_manifests_without_any_platform_assets() {
        let empty_assets = br#"{"schemaVersion":1,"appVersion":"0.5.6","assets":{}}"#;

        assert_eq!(
            verify_test_manifest(empty_assets).unwrap_err(),
            "invalid_runtime_manifest"
        );
    }

    #[test]
    fn rejects_unknown_targets_and_missing_selected_targets() {
        let unknown_target = br#"{"schemaVersion":1,"appVersion":"0.5.6","assets":{"windows-arm64":{"version":"1.0.0","url":"https://github.com/kareem-sf/tawreed/releases/download/v1.0.0/tawreed-runtime-windows-arm64.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":1024,"archive":"zip","entrypoint":"agent/node.exe"}}}"#;
        let manifest = verify_test_manifest(VALID_MANIFEST).unwrap();

        assert_eq!(
            verify_test_manifest(unknown_target).unwrap_err(),
            "invalid_runtime_manifest"
        );
        assert_eq!(
            select_asset(&manifest, RuntimeTarget::LinuxX86_64).unwrap_err(),
            "runtime_asset_unavailable"
        );
    }

    #[test]
    fn exposes_only_supported_runtime_target_keys() {
        assert_eq!(RuntimeTarget::WindowsX86_64.key(), "windows-x86_64");
        assert_eq!(RuntimeTarget::LinuxX86_64.key(), "linux-x86_64");
        assert_eq!(RuntimeTarget::DarwinX86_64.key(), "darwin-x86_64");
        assert_eq!(RuntimeTarget::DarwinAarch64.key(), "darwin-aarch64");
    }

    #[test]
    fn rejects_untrusted_hosts_and_invalid_entrypoints() {
        let mut asset = valid_asset();
        asset.url = "https://evil.example/runtime.zip".into();
        assert_eq!(validate_asset(&asset).unwrap_err(), "invalid_runtime_asset");

        asset = valid_asset();
        asset.entrypoint = "../escape".into();
        assert_eq!(validate_asset(&asset).unwrap_err(), "invalid_runtime_asset");
    }

    #[test]
    fn accepts_only_official_matching_versioned_release_urls() {
        for url in [
            "http://github.com/kareem-sf/tawreed/releases/download/v1.0.0/runtime.zip",
            "https://github.com.evil.example/kareem-sf/tawreed/releases/download/v1.0.0/runtime.zip",
            "https://github.com/kareem-sf/tawreed/releases/download/v1.0.1/runtime.zip",
            "https://github.com/kareem-sf/tawreed/releases/download/v1.0.0/",
            "https://github.com/kareem-sf/tawreed/releases/download/v1.0.0/runtime.zip?token=secret",
            "https://user@github.com/kareem-sf/tawreed/releases/download/v1.0.0/runtime.zip",
        ] {
            let mut asset = valid_asset();
            asset.url = url.into();
            assert_eq!(validate_asset(&asset).unwrap_err(), "invalid_runtime_asset");
        }
    }

    #[test]
    fn rejects_unstable_or_noncanonical_asset_versions() {
        for version in ["1.0.0-alpha.1", "1.0.0+build.1", "01.0.0", "v1.0.0"] {
            let mut asset = valid_asset();
            asset.version = version.into();
            assert_eq!(validate_asset(&asset).unwrap_err(), "invalid_runtime_asset");
        }
    }

    #[test]
    fn rejects_invalid_digests_sizes_archives_and_entrypoint_paths() {
        for digest in ["A".repeat(64), "g".repeat(64), "a".repeat(63)] {
            let mut asset = valid_asset();
            asset.sha256 = digest;
            assert_eq!(validate_asset(&asset).unwrap_err(), "invalid_runtime_asset");
        }

        for size in [0, (1_u64 << 30) + 1] {
            let mut asset = valid_asset();
            asset.size = size;
            assert_eq!(validate_asset(&asset).unwrap_err(), "invalid_runtime_asset");
        }

        let mut asset = valid_asset();
        asset.archive = "tar.gz".into();
        assert_eq!(validate_asset(&asset).unwrap_err(), "invalid_runtime_asset");

        for entrypoint in [
            "",
            "/absolute/node",
            "\\server\\share\\node.exe",
            "C:/agent/node.exe",
            "agent\\node.exe",
            "agent//node.exe",
            "agent/./node.exe",
            "agent/../node.exe",
        ] {
            let mut asset = valid_asset();
            asset.entrypoint = entrypoint.into();
            assert_eq!(validate_asset(&asset).unwrap_err(), "invalid_runtime_asset");
        }
    }

    #[test]
    fn rejects_windows_ambiguous_entrypoint_components() {
        for entrypoint in [
            "agent./node.exe",
            "agent /node.exe",
            "agent/node.exe.",
            "agent/node.exe ",
            "agent/no\u{1f}de.exe",
            "agent/no<de.exe",
            "agent/no>de.exe",
            "agent/no\"de.exe",
            "agent/no|de.exe",
            "agent/no?de.exe",
            "agent/no*de.exe",
            "CON",
            "con.txt",
            "agent/PRN.exe",
            "agent/aux.log",
            "agent/NUL",
            "agent/com1.exe",
            "agent/COM9",
            "agent/COM¹",
            "agent/com².exe",
            "agent/CoM³.log",
            "agent/lpt1.bin",
            "agent/LPT9",
            "agent/LPT¹",
            "agent/lpt².exe",
            "agent/LpT³.log",
        ] {
            let mut asset = valid_asset();
            asset.entrypoint = entrypoint.into();
            assert_eq!(
                validate_asset(&asset),
                Err("invalid_runtime_asset".into()),
                "accepted ambiguous Windows path {entrypoint:?}"
            );
        }
    }

    #[test]
    fn decodes_only_exact_length_base64_signatures_and_public_keys() {
        assert_eq!(
            decode_signature_base64(&STANDARD.encode([1_u8; 64])).unwrap(),
            [1_u8; 64]
        );
        assert_eq!(
            decode_public_key_base64(&STANDARD.encode([2_u8; 32])).unwrap(),
            [2_u8; 32]
        );

        for encoded in [
            STANDARD.encode([1_u8; 63]),
            STANDARD.encode([1_u8; 65]),
            "not-base64".into(),
        ] {
            assert_eq!(
                decode_signature_base64(&encoded).unwrap_err(),
                "invalid_runtime_signature"
            );
        }

        for encoded in [
            STANDARD.encode([2_u8; 31]),
            STANDARD.encode([2_u8; 33]),
            "not-base64".into(),
        ] {
            assert_eq!(
                decode_public_key_base64(&encoded).unwrap_err(),
                "invalid_runtime_key"
            );
        }
    }

    #[test]
    fn embedded_public_key_matches_the_approved_fingerprint() {
        let public_key = decode_public_key_base64(EMBEDDED_RUNTIME_PUBLIC_KEY_BASE64).unwrap();
        let fingerprint = Sha256::digest(public_key)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();

        assert_eq!(public_key.len(), 32);
        assert_eq!(
            fingerprint,
            "daf0aba9cd4450abb50f89c2e75c943cb6ddda54a66211399bb434e026e6a71b"
        );
    }

    #[test]
    fn verifies_base64_signature_and_public_key_with_deterministic_test_key() {
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let signature = signing.sign(VALID_MANIFEST);

        let manifest = verify_manifest_base64(
            VALID_MANIFEST,
            &STANDARD.encode(signature.to_bytes()),
            &STANDARD.encode(signing.verifying_key().to_bytes()),
        )
        .unwrap();

        assert_eq!(manifest.app_version, "0.5.6");
    }

    #[test]
    fn embedded_verifier_rejects_wrong_length_signature_before_key_use() {
        assert_eq!(
            verify_embedded_manifest(VALID_MANIFEST, &STANDARD.encode([1_u8; 63])).unwrap_err(),
            "invalid_runtime_signature"
        );
    }
}
