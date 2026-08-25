use super::atomic_write_json;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

const CONNECTION_SCHEMA_VERSION: u32 = 1;
const MAX_SECRET_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectionAuth {
    ApiKey { value: String },
    ProviderFile { home: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionRecord {
    pub provider: String,
    pub enabled: bool,
    pub auth: ConnectionAuth,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionFile {
    pub(crate) schema_version: u32,
    pub(crate) connections: BTreeMap<String, ConnectionRecord>,
}

impl Default for ConnectionFile {
    fn default() -> Self {
        Self {
            schema_version: CONNECTION_SCHEMA_VERSION,
            connections: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSummary {
    pub provider: String,
    pub configured: bool,
    pub authenticated: bool,
    pub auth_kind: String,
    pub display_name: String,
}

pub struct ConnectionStore {
    path: PathBuf,
}

impl ConnectionStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<ConnectionFile, String> {
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(ConnectionFile::default());
            }
            Err(error) => return Err(format!("read connections: {error}")),
        };
        let file: ConnectionFile = serde_json::from_slice(&bytes)
            .map_err(|error| format!("parse connections: {error}"))?;
        if file.schema_version != CONNECTION_SCHEMA_VERSION {
            return Err("unsupported_connections_schema".into());
        }
        for (provider, record) in &file.connections {
            validate_provider(provider)?;
            if record.provider != *provider {
                return Err("invalid_connection_record".into());
            }
            match &record.auth {
                ConnectionAuth::ApiKey { value } => validate_secret(value)?,
                ConnectionAuth::ProviderFile { home } if home.trim().is_empty() => {
                    return Err("invalid_provider_home".into());
                }
                ConnectionAuth::ProviderFile { .. } => {}
            }
        }
        Ok(file)
    }

    pub fn upsert_api_key(&self, provider: &str, value: &str) -> Result<(), String> {
        validate_provider(provider)?;
        let value = value.trim();
        validate_secret(value)?;
        self.upsert(
            provider,
            ConnectionAuth::ApiKey {
                value: value.to_string(),
            },
        )
    }

    pub fn upsert_provider_file(&self, provider: &str, home: &str) -> Result<(), String> {
        validate_provider(provider)?;
        let home = home.trim();
        if home.is_empty() {
            return Err("invalid_provider_home".into());
        }
        self.upsert(
            provider,
            ConnectionAuth::ProviderFile {
                home: home.to_string(),
            },
        )
    }

    pub fn secret(&self, provider: &str) -> Result<Option<String>, String> {
        validate_provider(provider)?;
        let file = self.load()?;
        Ok(file.connections.get(provider).and_then(|record| {
            if !record.enabled {
                return None;
            }
            match &record.auth {
                ConnectionAuth::ApiKey { value } => Some(value.clone()),
                ConnectionAuth::ProviderFile { .. } => None,
            }
        }))
    }

    pub fn summaries(&self) -> Result<Vec<ConnectionSummary>, String> {
        let file = self.load()?;
        Ok(file
            .connections
            .values()
            .map(|record| ConnectionSummary {
                provider: record.provider.clone(),
                configured: true,
                authenticated: record.enabled,
                auth_kind: match record.auth {
                    ConnectionAuth::ApiKey { .. } => "api_key",
                    ConnectionAuth::ProviderFile { .. } => "provider_file",
                }
                .to_string(),
                display_name: display_name(&record.provider).to_string(),
            })
            .collect())
    }

    pub fn remove(&self, provider: &str) -> Result<(), String> {
        validate_provider(provider)?;
        let mut file = self.load()?;
        if file.connections.remove(provider).is_some() {
            self.write(&file)?;
        }
        Ok(())
    }

    fn upsert(&self, provider: &str, auth: ConnectionAuth) -> Result<(), String> {
        let mut file = self.load()?;
        file.connections.insert(
            provider.to_string(),
            ConnectionRecord {
                provider: provider.to_string(),
                enabled: true,
                auth,
                updated_at_ms: now_ms(),
            },
        );
        self.write(&file)
    }

    fn write(&self, file: &ConnectionFile) -> Result<(), String> {
        atomic_write_json(&self.path, file)
    }
}

fn validate_provider(provider: &str) -> Result<(), String> {
    if matches!(provider, "codex" | "claude" | "gemini" | "compatible") {
        Ok(())
    } else {
        Err("invalid_provider".into())
    }
}

fn validate_secret(value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err("invalid_secret".into())
    } else if value.len() > MAX_SECRET_BYTES {
        Err("secret_too_large".into())
    } else {
        Ok(())
    }
}

fn display_name(provider: &str) -> &'static str {
    match provider {
        "codex" => "Codex",
        "claude" => "Claude",
        "gemini" => "Gemini",
        "compatible" => "Compatible",
        _ => unreachable!("provider is validated before display"),
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{ConnectionAuth, ConnectionStore};
    use crate::storage::DataLayout;

    #[test]
    fn stores_plaintext_but_never_returns_it_in_a_summary() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let store = ConnectionStore::new(layout.connections.clone());

        store.upsert_api_key("codex", " sk-test-value ").unwrap();

        let raw = std::fs::read_to_string(&layout.connections).unwrap();
        assert!(raw.contains("sk-test-value"));
        assert!(!raw.contains(" sk-test-value "));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&raw).unwrap()["schema_version"],
            1
        );

        let summaries = store.summaries().unwrap();
        assert_eq!(summaries[0].provider, "codex");
        let serialized = serde_json::to_string(&summaries).unwrap();
        assert!(serialized.contains("\"authKind\":\"api_key\""));
        assert!(serialized.contains("\"displayName\":\"Codex\""));
        assert!(!serialized.contains("auth_kind"));
        assert!(!serialized.contains("display_name"));
        assert!(!serialized.contains("sk-test-value"));
    }

    #[test]
    fn rejects_unknown_provider_identifiers() {
        let root = tempfile::tempdir().unwrap();
        let store = ConnectionStore::new(root.path().join("connections.json"));

        assert_eq!(
            store.upsert_api_key("../../escape", "x").unwrap_err(),
            "invalid_provider"
        );
        assert_eq!(
            store.secret("../../escape").unwrap_err(),
            "invalid_provider"
        );
        assert_eq!(
            store.remove("../../escape").unwrap_err(),
            "invalid_provider"
        );
    }

    #[test]
    fn rejects_empty_and_oversized_api_keys() {
        let root = tempfile::tempdir().unwrap();
        let store = ConnectionStore::new(root.path().join("connections.json"));

        assert_eq!(
            store.upsert_api_key("claude", "  ").unwrap_err(),
            "invalid_secret"
        );
        assert_eq!(
            store
                .upsert_api_key("claude", &"x".repeat(16 * 1024 + 1))
                .unwrap_err(),
            "secret_too_large"
        );
        assert!(!root.path().join("connections.json").exists());
    }

    #[test]
    fn supports_provider_files_without_exposing_their_home_in_summaries() {
        let root = tempfile::tempdir().unwrap();
        let store = ConnectionStore::new(root.path().join("connections.json"));

        store
            .upsert_provider_file("gemini", "C:\\Users\\test\\.gemini")
            .unwrap();

        assert_eq!(store.secret("gemini").unwrap(), None);
        let summary = &store.summaries().unwrap()[0];
        assert_eq!(summary.provider, "gemini");
        assert!(summary.configured);
        assert!(summary.authenticated);
        assert_eq!(summary.auth_kind, "provider_file");
        assert_eq!(summary.display_name, "Gemini");
        assert!(!serde_json::to_string(summary).unwrap().contains(".gemini"));
    }

    #[test]
    fn returns_stored_secrets_and_removes_connections() {
        let root = tempfile::tempdir().unwrap();
        let store = ConnectionStore::new(root.path().join("connections.json"));
        store.upsert_api_key("claude", "anthropic-secret").unwrap();
        store
            .upsert_api_key("compatible", "compatible-secret")
            .unwrap();

        assert_eq!(
            store.secret("claude").unwrap().as_deref(),
            Some("anthropic-secret")
        );
        assert_eq!(
            store.secret("compatible").unwrap().as_deref(),
            Some("compatible-secret")
        );

        store.remove("claude").unwrap();
        assert_eq!(store.secret("claude").unwrap(), None);
        assert_eq!(store.summaries().unwrap().len(), 1);
    }

    #[test]
    fn loads_an_absent_store_as_an_empty_schema_one_document() {
        let root = tempfile::tempdir().unwrap();
        let store = ConnectionStore::new(root.path().join("connections.json"));

        let file = store.load().unwrap();

        assert_eq!(file.schema_version, 1);
        assert!(file.connections.is_empty());
    }

    #[test]
    fn writes_the_declared_connection_auth_shape() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("connections.json");
        let store = ConnectionStore::new(path.clone());
        store.upsert_api_key("compatible", "secret").unwrap();

        let file = store.load().unwrap();
        assert!(matches!(
            file.connections["compatible"].auth,
            ConnectionAuth::ApiKey { ref value } if value == "secret"
        ));
        assert!(file.connections["compatible"].updated_at_ms > 0);
    }

    #[cfg(unix)]
    #[test]
    fn connection_file_is_owner_only_after_every_write() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("connections.json");
        let store = ConnectionStore::new(path.clone());
        store.upsert_api_key("claude", "first").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();

        store.upsert_api_key("claude", "second").unwrap();

        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
