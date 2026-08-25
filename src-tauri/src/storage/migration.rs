use super::{atomic_write_json, DataLayout};
use rusqlite::OpenFlags;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const LEGACY_SQLITE_MIGRATION: &str = "legacy-sqlite-v1";
const LEGACY_ENV_MIGRATION: &str = "legacy-env-v1";
const MAX_SNAPSHOT_ATTEMPTS: usize = 3;
const MAX_FINALIZATION_PASSES: usize = 2;

#[derive(Default, Deserialize, Serialize)]
struct MigrationState {
    #[serde(default)]
    completed: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    legacy_sqlite_v1: Option<LegacySqliteContentFingerprint>,
}

struct LegacySqliteSnapshot {
    directory: PathBuf,
    database: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct FileFingerprint {
    length: u64,
    sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct LegacySqliteContentFingerprint {
    database: FileFingerprint,
    wal: Option<FileFingerprint>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct MetadataSignal {
    length: u64,
    modified: Option<std::time::SystemTime>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct LegacySqliteFingerprint {
    content: LegacySqliteContentFingerprint,
    shm: Option<MetadataSignal>,
    journal: Option<MetadataSignal>,
}

impl LegacySqliteSnapshot {
    fn create<F>(
        source: &Path,
        after_database_copy: &mut F,
    ) -> Result<(Self, LegacySqliteContentFingerprint), String>
    where
        F: FnMut(usize) -> Result<(), String>,
    {
        for attempt in 0..MAX_SNAPSHOT_ATTEMPTS {
            let before = LegacySqliteFingerprint::capture(source)?;
            if before.journal.is_some() {
                return Err("legacy_sqlite_busy".into());
            }
            let snapshot = Self::create_empty()?;
            std::fs::copy(source, &snapshot.database)
                .map_err(|error| format!("copy legacy sqlite snapshot: {error}"))?;
            after_database_copy(attempt)?;

            let copied_wal = sqlite_sidecar(&snapshot.database, "-wal");
            let wal_copy_stable = match &before.content.wal {
                Some(_) => match std::fs::copy(sqlite_sidecar(source, "-wal"), &copied_wal) {
                    Ok(_) => true,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
                    Err(error) => {
                        return Err(format!("copy legacy sqlite WAL snapshot: {error}"));
                    }
                },
                None => true,
            };
            let after = LegacySqliteFingerprint::capture(source)?;
            if after.journal.is_some() {
                return Err("legacy_sqlite_busy".into());
            }
            let copied_database = fingerprint_file(&snapshot.database)
                .map_err(|error| format!("fingerprint copied legacy sqlite: {error}"))?;
            let copied_wal = fingerprint_optional_file(&copied_wal)
                .map_err(|error| format!("fingerprint copied legacy sqlite WAL: {error}"))?;
            if wal_copy_stable
                && before == after
                && copied_database == before.content.database
                && copied_wal == before.content.wal
            {
                return Ok((snapshot, before.content));
            }
        }
        Err("legacy_sqlite_unstable".into())
    }

    fn create_empty() -> Result<Self, String> {
        static NEXT_SNAPSHOT: AtomicU64 = AtomicU64::new(0);

        let sequence = NEXT_SNAPSHOT.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "tawreed-legacy-sqlite-{}-{sequence}",
            std::process::id()
        ));
        std::fs::create_dir(&directory)
            .map_err(|error| format!("create legacy sqlite snapshot: {error}"))?;
        let snapshot = Self {
            database: directory.join("history.sqlite"),
            directory,
        };
        Ok(snapshot)
    }

    fn database(&self) -> &Path {
        &self.database
    }
}

impl Drop for LegacySqliteSnapshot {
    fn drop(&mut self) {
        for suffix in ["-journal", "-shm", "-wal", ""] {
            let _ = std::fs::remove_file(sqlite_sidecar(&self.database, suffix));
        }
        let _ = std::fs::remove_dir(&self.directory);
    }
}

fn sqlite_sidecar(database: &Path, suffix: &str) -> PathBuf {
    let mut path = database.as_os_str().to_os_string();
    path.push(suffix);
    path.into()
}

impl LegacySqliteFingerprint {
    fn capture(database: &Path) -> Result<Self, String> {
        Ok(Self {
            content: LegacySqliteContentFingerprint {
                database: fingerprint_file(database)
                    .map_err(|error| format!("fingerprint legacy sqlite: {error}"))?,
                wal: fingerprint_optional_file(&sqlite_sidecar(database, "-wal"))
                    .map_err(|error| format!("fingerprint legacy sqlite WAL: {error}"))?,
            },
            shm: metadata_signal(&sqlite_sidecar(database, "-shm"))
                .map_err(|error| format!("inspect legacy sqlite SHM: {error}"))?,
            journal: metadata_signal(&sqlite_sidecar(database, "-journal"))
                .map_err(|error| format!("inspect legacy sqlite journal: {error}"))?,
        })
    }
}

fn fingerprint_optional_file(path: &Path) -> std::io::Result<Option<FileFingerprint>> {
    match fingerprint_file(path) {
        Ok(fingerprint) => Ok(Some(fingerprint)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn fingerprint_file(path: &Path) -> std::io::Result<FileFingerprint> {
    let mut file = std::fs::File::open(path)?;
    let length = file.metadata()?.len();
    let mut sha256 = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        sha256.update(&buffer[..read]);
    }
    Ok(FileFingerprint {
        length,
        sha256: format!("{:x}", sha256.finalize()),
    })
}

fn metadata_signal(path: &Path) -> std::io::Result<Option<MetadataSignal>> {
    match std::fs::metadata(path) {
        Ok(metadata) => Ok(Some(MetadataSignal {
            length: metadata.len(),
            modified: metadata.modified().ok(),
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn stable_legacy_content_fingerprint(
    database: &Path,
) -> Result<Option<LegacySqliteContentFingerprint>, String> {
    for _ in 0..MAX_SNAPSHOT_ATTEMPTS {
        let before = LegacySqliteFingerprint::capture(database)?;
        if before.journal.is_some() {
            return Ok(None);
        }
        let after = LegacySqliteFingerprint::capture(database)?;
        if after.journal.is_some() {
            return Ok(None);
        }
        if before == after {
            return Ok(Some(before.content));
        }
    }
    Err("legacy_sqlite_unstable".into())
}

pub fn migrate_legacy_state(layout: &DataLayout) -> Result<(), String> {
    migrate_legacy_state_with_hooks(layout, |_| Ok(()), |_| Ok(()), |_| Ok(()), || Ok(()))
}

#[cfg(test)]
fn migrate_legacy_state_with_snapshot_hook<F>(
    layout: &DataLayout,
    after_database_copy: F,
) -> Result<(), String>
where
    F: FnMut(usize) -> Result<(), String>,
{
    migrate_legacy_state_with_hooks(
        layout,
        after_database_copy,
        |_| Ok(()),
        |_| Ok(()),
        || Ok(()),
    )
}

#[cfg(test)]
fn migrate_legacy_state_with_accepted_snapshot_hook<F>(
    layout: &DataLayout,
    after_accepted_snapshot: F,
) -> Result<(), String>
where
    F: FnMut(usize) -> Result<(), String>,
{
    migrate_legacy_state_with_hooks(
        layout,
        |_| Ok(()),
        after_accepted_snapshot,
        |_| Ok(()),
        || Ok(()),
    )
}

#[cfg(test)]
fn migrate_legacy_state_with_finalization_hook<F>(
    layout: &DataLayout,
    after_finalization: F,
) -> Result<(), String>
where
    F: FnMut() -> Result<(), String>,
{
    migrate_legacy_state_with_hooks(
        layout,
        |_| Ok(()),
        |_| Ok(()),
        |_| Ok(()),
        after_finalization,
    )
}

#[cfg(test)]
fn migrate_legacy_state_with_marker_hook<F>(
    layout: &DataLayout,
    after_marker: F,
) -> Result<(), String>
where
    F: FnMut(usize) -> Result<(), String>,
{
    migrate_legacy_state_with_hooks(layout, |_| Ok(()), |_| Ok(()), after_marker, || Ok(()))
}

fn migrate_legacy_state_with_hooks<F, G, H, I>(
    layout: &DataLayout,
    mut after_database_copy: F,
    mut after_accepted_snapshot: G,
    mut after_marker: H,
    mut after_finalization: I,
) -> Result<(), String>
where
    F: FnMut(usize) -> Result<(), String>,
    G: FnMut(usize) -> Result<(), String>,
    H: FnMut(usize) -> Result<(), String>,
    I: FnMut() -> Result<(), String>,
{
    layout.ensure()?;
    let state_path = layout.root.join("migrations.json");
    let mut state = load_state(&state_path)?;
    let mut state_dirty = false;

    let database_path = layout.root.join("history.sqlite");
    if database_path.exists() {
        for pass in 0..MAX_FINALIZATION_PASSES {
            let (snapshot, fingerprint) =
                LegacySqliteSnapshot::create(&database_path, &mut after_database_copy)?;
            after_accepted_snapshot(pass)?;
            if state.legacy_sqlite_v1.as_ref() == Some(&fingerprint) {
                break;
            }
            import_runs(
                snapshot.database(),
                &layout.root.join("history").join("legacy-runs.jsonl"),
            )?;
            import_memory(
                snapshot.database(),
                &layout.rules.join("legacy-classification-memory.jsonl"),
            )?;
            if !state
                .completed
                .iter()
                .any(|migration| migration == LEGACY_SQLITE_MIGRATION)
            {
                state.completed.push(LEGACY_SQLITE_MIGRATION.into());
            }
            state.legacy_sqlite_v1 = Some(fingerprint.clone());
            atomic_write_json(&state_path, &state)?;
            state_dirty = false;
            after_marker(pass)?;

            let Some(current_fingerprint) = stable_legacy_content_fingerprint(&database_path)?
            else {
                // A transaction started after snapshot acceptance; its outcome is reconciled
                // against the accepted fingerprint on the next migration pass.
                break;
            };
            if current_fingerprint == fingerprint {
                break;
            }
            if pass + 1 == MAX_FINALIZATION_PASSES {
                return Err("legacy_sqlite_unstable".into());
            }
        }
        after_finalization()?;
    }

    let env_complete = state
        .completed
        .iter()
        .any(|migration| migration == LEGACY_ENV_MIGRATION);
    if !env_complete {
        import_env(layout)?;
        state.completed.push(LEGACY_ENV_MIGRATION.into());
        state_dirty = true;
    }

    if state_dirty {
        atomic_write_json(&state_path, &state)?;
    }
    Ok(())
}

fn load_state(path: &Path) -> Result<MigrationState, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("parse migration state: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(MigrationState::default()),
        Err(error) => Err(format!("read migration state: {error}")),
    }
}

fn import_runs(database_path: &Path, destination: &Path) -> Result<(), String> {
    let mut connection = rusqlite::Connection::open_with_flags(
        database_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("open legacy history read-only: {error}"))?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("read legacy history transaction: {error}"))?;
    let columns = {
        let mut statement = transaction
            .prepare("PRAGMA table_info(runs)")
            .map_err(|error| format!("inspect legacy runs schema: {error}"))?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| format!("inspect legacy runs schema: {error}"))?
            .collect::<Result<std::collections::HashSet<_>, _>>()
            .map_err(|error| format!("inspect legacy runs schema: {error}"))?;
        columns
    };
    let optional = |name: &str, default: &str| {
        if columns.contains(name) {
            name.to_string()
        } else {
            default.to_string()
        }
    };
    let query = format!(
        "SELECT id, started_at, file_name, file_hash, item_count, package_count,
                error_count, warning_count, output_file, duration_ms, llm_used,
                {} AS project_name, {} AS revision, {} AS package_folder,
                {} AS source_kind, {} AS ocr_used, {} AS provider, {} AS model,
                {} AS trace_json, {} AS memory_applied
         FROM runs ORDER BY id ASC",
        optional("project_name", "''"),
        optional("revision", "0"),
        optional("package_folder", "''"),
        optional("source_kind", "'xlsx'"),
        optional("ocr_used", "0"),
        optional("provider", "'offline'"),
        optional("model", "''"),
        optional("trace_json", "'[]'"),
        optional("memory_applied", "0"),
    );
    let mut statement = transaction
        .prepare(&query)
        .map_err(|error| format!("prepare legacy runs: {error}"))?;
    let records = statement
        .query_map([], |row| {
            let legacy_id = row.get::<_, i64>(0)?;
            Ok(json!({
                "id": -legacy_id.abs(),
                "legacyId": legacy_id,
                "startedAt": row.get::<_, String>(1)?,
                "fileName": row.get::<_, String>(2)?,
                "fileHash": row.get::<_, String>(3)?,
                "itemCount": row.get::<_, i64>(4)?,
                "packageCount": row.get::<_, i64>(5)?,
                "errorCount": row.get::<_, i64>(6)?,
                "warningCount": row.get::<_, i64>(7)?,
                "outputFile": row.get::<_, String>(8)?,
                "durationMs": row.get::<_, i64>(9)?,
                "llmUsed": row.get::<_, i64>(10)? == 1,
                "projectName": row.get::<_, String>(11)?,
                "revision": row.get::<_, i64>(12)?,
                "packageFolder": row.get::<_, String>(13)?,
                "sourceKind": row.get::<_, String>(14)?,
                "ocrUsed": row.get::<_, i64>(15)? == 1,
                "provider": row.get::<_, String>(16)?,
                "model": row.get::<_, String>(17)?,
                "trace": serde_json::from_str::<Value>(&row.get::<_, String>(18)?)
                    .unwrap_or_else(|_| json!([])),
                "memoryApplied": row.get::<_, i64>(19)?,
            }))
        })
        .map_err(|error| format!("query legacy runs: {error}"))?
        .collect::<Result<Vec<Value>, _>>()
        .map_err(|error| format!("read legacy run: {error}"))?;
    drop(statement);
    transaction
        .commit()
        .map_err(|error| format!("finish legacy history read: {error}"))?;

    atomic_write_jsonl(destination, &records)
}

fn import_memory(database_path: &Path, destination: &Path) -> Result<(), String> {
    let mut connection = rusqlite::Connection::open_with_flags(
        database_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("open legacy memory read-only: {error}"))?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("read legacy memory transaction: {error}"))?;
    let table_exists = transaction
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name = 'classification_memory'
            )",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("inspect legacy memory schema: {error}"))?;
    let records = if table_exists {
        let mut statement = transaction
            .prepare(
                "SELECT project_name, description_key, package_code, package_name_en,
                        package_name_ar, updated_at
                 FROM classification_memory
                 ORDER BY project_name ASC, description_key ASC",
            )
            .map_err(|error| format!("prepare legacy memory: {error}"))?;
        let records = statement
            .query_map([], |row| {
                Ok(json!({
                    "projectName": row.get::<_, String>(0)?,
                    "descriptionKey": row.get::<_, String>(1)?,
                    "packageCode": row.get::<_, String>(2)?,
                    "packageNameEn": row.get::<_, String>(3)?,
                    "packageNameAr": row.get::<_, String>(4)?,
                    "updatedAt": row.get::<_, String>(5)?,
                }))
            })
            .map_err(|error| format!("query legacy memory: {error}"))?
            .collect::<Result<Vec<Value>, _>>()
            .map_err(|error| format!("read legacy memory: {error}"))?;
        records
    } else {
        Vec::new()
    };
    transaction
        .commit()
        .map_err(|error| format!("finish legacy memory read: {error}"))?;

    atomic_write_jsonl(destination, &records)
}

fn import_env(layout: &DataLayout) -> Result<(), String> {
    let path = layout.root.join(".env");
    if !path.exists() {
        return Ok(());
    }
    let mut legacy_values = std::collections::HashMap::new();
    for pair in
        dotenvy::from_path_iter(&path).map_err(|error| format!("read legacy .env: {error}"))?
    {
        let (name, value) = pair.map_err(|error| format!("parse legacy .env: {error}"))?;
        if matches!(name.as_str(), "ANTHROPIC_API_KEY" | "COMPATIBLE_API_KEY")
            && !value.trim().is_empty()
        {
            legacy_values.insert(name, value.trim().to_string());
        }
    }

    let store = crate::storage::connections::ConnectionStore::new(layout.connections.clone());
    let existing = store.load()?;
    for (environment_name, provider) in [
        ("ANTHROPIC_API_KEY", "claude"),
        ("COMPATIBLE_API_KEY", "compatible"),
    ] {
        if !existing.connections.contains_key(provider) {
            if let Some(value) = legacy_values.get(environment_name) {
                store.upsert_api_key(provider, value)?;
            }
        }
    }
    Ok(())
}

fn atomic_write_jsonl(path: &Path, values: &[Value]) -> Result<(), String> {
    let parent = path.parent().ok_or("text_store_parent_missing")?;
    std::fs::create_dir_all(parent).map_err(|error| format!("create history parent: {error}"))?;
    let temporary_path = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().unwrap().to_string_lossy(),
        std::process::id()
    ));
    let result = (|| {
        let mut file = std::fs::File::create(&temporary_path)
            .map_err(|error| format!("create temporary jsonl: {error}"))?;
        for value in values {
            serde_json::to_writer(&mut file, value)
                .map_err(|error| format!("serialize jsonl: {error}"))?;
            file.write_all(b"\n")
                .map_err(|error| format!("write temporary jsonl: {error}"))?;
        }
        file.sync_all()
            .map_err(|error| format!("sync temporary jsonl: {error}"))?;
        drop(file);
        crate::store::replace_file(&temporary_path, path)
            .map_err(|error| format!("replace jsonl: {error}"))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary_path);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{
        migrate_legacy_state, migrate_legacy_state_with_accepted_snapshot_hook,
        migrate_legacy_state_with_finalization_hook, migrate_legacy_state_with_marker_hook,
        migrate_legacy_state_with_snapshot_hook, sqlite_sidecar,
    };
    use crate::storage::history::HistoryStore;
    use crate::storage::DataLayout;
    use std::collections::BTreeMap;

    fn legacy_sqlite_family(root: &std::path::Path) -> BTreeMap<String, Vec<u8>> {
        std::fs::read_dir(root)
            .unwrap()
            .map(|entry| entry.unwrap())
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                name.starts_with("history.sqlite")
                    .then(|| (name, std::fs::read(entry.path()).unwrap()))
            })
            .collect()
    }

    #[test]
    fn imports_legacy_runs_once_and_keeps_the_database() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let db = layout.root.join("history.sqlite");
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TABLE runs (id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, file_name TEXT NOT NULL, file_hash TEXT NOT NULL, item_count INTEGER NOT NULL, package_count INTEGER NOT NULL, error_count INTEGER NOT NULL, warning_count INTEGER NOT NULL, output_file TEXT NOT NULL, duration_ms INTEGER NOT NULL, llm_used INTEGER NOT NULL); INSERT INTO runs VALUES (1,'2026-01-01','a.xlsx','abc',2,1,0,0,'out.xlsx',10,1);").unwrap();
        drop(conn);
        let database_before = std::fs::read(&db).unwrap();

        migrate_legacy_state(&layout).unwrap();
        migrate_legacy_state(&layout).unwrap();

        assert!(db.exists());
        assert_eq!(std::fs::read(&db).unwrap(), database_before);
        assert!(!layout.root.join("history.sqlite-journal").exists());
        assert!(!layout.root.join("history.sqlite-wal").exists());
        assert!(!layout.root.join("history.sqlite-shm").exists());
        let lines = std::fs::read_to_string(layout.root.join("history/legacy-runs.jsonl")).unwrap();
        assert_eq!(lines.lines().count(), 1);
    }

    #[test]
    fn upgrades_released_state_with_provenance_and_distinct_current_history() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let database_path = layout.root.join("history.sqlite");
        let connection = rusqlite::Connection::open(&database_path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE runs (
                    id INTEGER PRIMARY KEY, started_at TEXT NOT NULL,
                    file_name TEXT NOT NULL, file_hash TEXT NOT NULL,
                    item_count INTEGER NOT NULL, package_count INTEGER NOT NULL,
                    error_count INTEGER NOT NULL, warning_count INTEGER NOT NULL,
                    output_file TEXT NOT NULL, duration_ms INTEGER NOT NULL,
                    llm_used INTEGER NOT NULL
                 );
                 INSERT INTO runs VALUES (
                    7, '2026-01-01', 'legacy.xlsx', 'legacy',
                    1, 1, 0, 0, 'legacy-out.xlsx', 10, 0
                 );",
            )
            .unwrap();
        drop(connection);
        let database_before = std::fs::read(&database_path).unwrap();
        let current_path = layout.root.join("history/runs.jsonl");
        assert!(!current_path.exists());
        assert!(!layout.root.join("migrations.json").exists());

        migrate_legacy_state(&layout).unwrap();

        assert_eq!(std::fs::read(&database_path).unwrap(), database_before);
        let legacy: serde_json::Value = serde_json::from_str(
            std::fs::read_to_string(layout.root.join("history/legacy-runs.jsonl"))
                .unwrap()
                .trim(),
        )
        .unwrap();
        assert_eq!(legacy["id"], -7);
        assert_eq!(legacy["legacyId"], 7);

        let store = HistoryStore::new(current_path.clone());
        store
            .record(&serde_json::json!({
                "id": -7,
                "startedAt": "2026-01-02",
                "fileName": "current.xlsx"
            }))
            .unwrap();
        let current_before_reimport = std::fs::read(&current_path).unwrap();
        migrate_legacy_state(&layout).unwrap();

        assert_eq!(
            std::fs::read(&current_path).unwrap(),
            current_before_reimport
        );
        let history = store.list().unwrap();
        assert_eq!(
            history
                .iter()
                .map(|record| record["fileName"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["current.xlsx", "legacy.xlsx"]
        );
        let current_id = history[0]["id"].as_i64().unwrap();
        assert!((1..=9_007_199_254_740_991).contains(&current_id));
        assert_ne!(current_id, 7);
        assert_ne!(current_id, -7);
        assert_eq!(history[1]["id"], -7);
        assert_eq!(history[1]["legacyId"], 7);
    }

    #[test]
    fn imports_optional_legacy_run_columns_when_present() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let database_path = layout.root.join("history.sqlite");
        let connection = rusqlite::Connection::open(&database_path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE runs (
                id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, file_name TEXT NOT NULL,
                file_hash TEXT NOT NULL, item_count INTEGER NOT NULL,
                package_count INTEGER NOT NULL, error_count INTEGER NOT NULL,
                warning_count INTEGER NOT NULL, output_file TEXT NOT NULL,
                duration_ms INTEGER NOT NULL, llm_used INTEGER NOT NULL,
                project_name TEXT NOT NULL, revision INTEGER NOT NULL,
                package_folder TEXT NOT NULL, source_kind TEXT NOT NULL,
                ocr_used INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
                trace_json TEXT NOT NULL, memory_applied INTEGER NOT NULL
            );
            INSERT INTO runs VALUES (
                7, '2026-01-02', 'b.pdf', 'def', 3, 2, 1, 4, 'out-2.xlsx', 20, 1,
                'Tower', 5, 'packages', 'pdf', 1, 'anthropic', 'claude-test',
                '[{\"type\":\"decision\"}]', 6
            );",
            )
            .unwrap();
        drop(connection);

        migrate_legacy_state(&layout).unwrap();

        let content =
            std::fs::read_to_string(layout.root.join("history/legacy-runs.jsonl")).unwrap();
        let record: serde_json::Value = serde_json::from_str(content.trim()).unwrap();
        assert_eq!(record["projectName"], "Tower");
        assert_eq!(record["revision"], 5);
        assert_eq!(record["sourceKind"], "pdf");
        assert_eq!(record["ocrUsed"], true);
        assert_eq!(record["provider"], "anthropic");
        assert_eq!(record["model"], "claude-test");
        assert_eq!(record["trace"][0]["type"], "decision");
        assert_eq!(record["memoryApplied"], 6);
    }

    #[test]
    fn exports_legacy_classification_memory_for_the_text_store() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let database_path = layout.root.join("history.sqlite");
        let connection = rusqlite::Connection::open(&database_path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE runs (
                id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, file_name TEXT NOT NULL,
                file_hash TEXT NOT NULL, item_count INTEGER NOT NULL,
                package_count INTEGER NOT NULL, error_count INTEGER NOT NULL,
                warning_count INTEGER NOT NULL, output_file TEXT NOT NULL,
                duration_ms INTEGER NOT NULL, llm_used INTEGER NOT NULL
            );
            CREATE TABLE classification_memory (
                project_name TEXT NOT NULL, description_key TEXT NOT NULL,
                package_code TEXT NOT NULL, package_name_en TEXT NOT NULL,
                package_name_ar TEXT NOT NULL, updated_at TEXT NOT NULL,
                PRIMARY KEY (project_name, description_key)
            );
            INSERT INTO classification_memory VALUES (
                'Tower', 'reinforced concrete', 'CONC', 'Concrete', 'خرسانة', '2026-01-02'
            );",
            )
            .unwrap();
        drop(connection);

        migrate_legacy_state(&layout).unwrap();

        let store = crate::storage::classification_memory::ClassificationMemoryStore::new(
            layout.rules.clone(),
        );
        let entries = store.list("Tower").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].description_key, "reinforced concrete");
        assert_eq!(entries[0].package_code, "CONC");
        assert!(layout
            .rules
            .join("legacy-classification-memory.jsonl")
            .exists());
    }

    #[test]
    fn imports_missing_env_connections_without_changing_the_legacy_file() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let env_path = layout.root.join(".env");
        let env_bytes = b"# legacy input\nANTHROPIC_API_KEY= legacy-claude \nCOMPATIBLE_API_KEY=legacy-compatible\n";
        std::fs::write(&env_path, env_bytes).unwrap();
        let connections =
            crate::storage::connections::ConnectionStore::new(layout.connections.clone());
        connections
            .upsert_api_key("compatible", "current-compatible")
            .unwrap();

        migrate_legacy_state(&layout).unwrap();
        migrate_legacy_state(&layout).unwrap();

        assert_eq!(std::fs::read(&env_path).unwrap(), env_bytes);
        assert_eq!(
            connections.secret("claude").unwrap().as_deref(),
            Some("legacy-claude")
        );
        assert_eq!(
            connections.secret("compatible").unwrap().as_deref(),
            Some("current-compatible")
        );
        let state: serde_json::Value =
            serde_json::from_slice(&std::fs::read(layout.root.join("migrations.json")).unwrap())
                .unwrap();
        assert!(state["completed"]
            .as_array()
            .unwrap()
            .iter()
            .any(|marker| marker == "legacy-env-v1"));
    }

    #[test]
    fn rebuilds_complete_outputs_after_a_marker_write_failure() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let database_path = layout.root.join("history.sqlite");
        let connection = rusqlite::Connection::open(&database_path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE runs (
                id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, file_name TEXT NOT NULL,
                file_hash TEXT NOT NULL, item_count INTEGER NOT NULL,
                package_count INTEGER NOT NULL, error_count INTEGER NOT NULL,
                warning_count INTEGER NOT NULL, output_file TEXT NOT NULL,
                duration_ms INTEGER NOT NULL, llm_used INTEGER NOT NULL
            );
            INSERT INTO runs VALUES (
                1, '2026-01-01', 'a.xlsx', 'abc', 2, 1, 0, 0, 'out.xlsx', 10, 1
            );",
            )
            .unwrap();
        drop(connection);
        let marker_temporary_path = layout
            .root
            .join(format!(".migrations.json.{}.tmp", std::process::id()));
        std::fs::create_dir(&marker_temporary_path).unwrap();

        assert!(migrate_legacy_state(&layout).is_err());
        assert_eq!(
            std::fs::read_to_string(layout.root.join("history/legacy-runs.jsonl"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        std::fs::remove_dir(&marker_temporary_path).unwrap();

        migrate_legacy_state(&layout).unwrap();
        migrate_legacy_state(&layout).unwrap();

        assert_eq!(
            std::fs::read_to_string(layout.root.join("history/legacy-runs.jsonl"))
                .unwrap()
                .lines()
                .count(),
            1
        );
    }

    #[test]
    fn imports_committed_wal_rows_without_touching_the_legacy_sqlite_family() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let database_path = layout.root.join("history.sqlite");
        let writer = rusqlite::Connection::open(&database_path).unwrap();
        let journal_mode: String = writer
            .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
            .unwrap();
        assert_eq!(journal_mode, "wal");
        writer
            .execute_batch(
                "PRAGMA wal_autocheckpoint = 0;
                 CREATE TABLE runs (
                    id INTEGER PRIMARY KEY, started_at TEXT NOT NULL,
                    file_name TEXT NOT NULL, file_hash TEXT NOT NULL,
                    item_count INTEGER NOT NULL, package_count INTEGER NOT NULL,
                    error_count INTEGER NOT NULL, warning_count INTEGER NOT NULL,
                    output_file TEXT NOT NULL, duration_ms INTEGER NOT NULL,
                    llm_used INTEGER NOT NULL
                 );
                 INSERT INTO runs VALUES (
                    91, '2026-02-01', 'wal.xlsx', 'wal-hash', 4, 2, 0, 1,
                    'wal-out.xlsx', 30, 1
                 );",
            )
            .unwrap();
        let before = legacy_sqlite_family(&layout.root);
        assert!(before["history.sqlite-wal"].len() > 32);
        assert!(before.contains_key("history.sqlite-shm"));

        migrate_legacy_state(&layout).unwrap();

        let history =
            std::fs::read_to_string(layout.root.join("history/legacy-runs.jsonl")).unwrap();
        let record: serde_json::Value = serde_json::from_str(history.trim()).unwrap();
        assert_eq!(record["id"], -91);
        assert_eq!(record["legacyId"], 91);
        assert_eq!(record["fileName"], "wal.xlsx");
        assert_eq!(legacy_sqlite_family(&layout.root), before);
        drop(writer);
    }

    #[test]
    fn rejects_a_snapshot_when_checkpoint_changes_family_during_copy() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let database_path = layout.root.join("history.sqlite");
        let writer = rusqlite::Connection::open(&database_path).unwrap();
        writer
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA wal_autocheckpoint = 0;
                 CREATE TABLE runs (
                    id INTEGER PRIMARY KEY, started_at TEXT NOT NULL,
                    file_name TEXT NOT NULL, file_hash TEXT NOT NULL,
                    item_count INTEGER NOT NULL, package_count INTEGER NOT NULL,
                    error_count INTEGER NOT NULL, warning_count INTEGER NOT NULL,
                    output_file TEXT NOT NULL, duration_ms INTEGER NOT NULL,
                    llm_used INTEGER NOT NULL
                 );
                 INSERT INTO runs VALUES (
                    1, '2026-03-01', 'base.xlsx', 'base-hash', 1, 1, 0, 0,
                    'base-out.xlsx', 10, 0
                 );",
            )
            .unwrap();

        let error = migrate_legacy_state_with_snapshot_hook(&layout, |attempt| {
            writer
                .execute(
                    "INSERT INTO runs VALUES (
                        ?1, '2026-03-02', 'racing.xlsx', 'racing-hash', 1, 1, 0, 0,
                        'racing-out.xlsx', 11, 0
                    )",
                    [100 + attempt as i64],
                )
                .map_err(|error| error.to_string())?;
            writer
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .map_err(|error| error.to_string())?;
            Ok(())
        })
        .unwrap_err();

        assert_eq!(error, "legacy_sqlite_unstable");
        assert!(!layout.root.join("history/legacy-runs.jsonl").exists());
        assert!(!layout
            .rules
            .join("legacy-classification-memory.jsonl")
            .exists());
        assert!(!layout.root.join("migrations.json").exists());
        drop(writer);
    }

    #[test]
    fn rejects_an_active_rollback_journal_without_importing_uncommitted_rows() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let database_path = layout.root.join("history.sqlite");
        let writer = rusqlite::Connection::open(&database_path).unwrap();
        writer
            .execute_batch(
                "PRAGMA page_size = 512;
                 PRAGMA journal_mode = DELETE;
                 PRAGMA cache_size = 1;
                 PRAGMA cache_spill = ON;
                 CREATE TABLE runs (
                    id INTEGER PRIMARY KEY, started_at TEXT NOT NULL,
                    file_name TEXT NOT NULL, file_hash TEXT NOT NULL,
                    item_count INTEGER NOT NULL, package_count INTEGER NOT NULL,
                    error_count INTEGER NOT NULL, warning_count INTEGER NOT NULL,
                    output_file TEXT NOT NULL, duration_ms INTEGER NOT NULL,
                    llm_used INTEGER NOT NULL
                 );
                 INSERT INTO runs VALUES (
                    1, '2026-04-01', 'committed.xlsx', 'committed-hash', 1, 1, 0, 0,
                    'committed-out.xlsx', 10, 0
                 );
                 BEGIN IMMEDIATE;",
            )
            .unwrap();
        writer
            .execute(
                "INSERT INTO runs VALUES (
                    2, '2026-04-02', ?1, 'uncommitted-hash', 1, 1, 0, 0,
                    'uncommitted-out.xlsx', 11, 0
                )",
                [&"x".repeat(256 * 1024)],
            )
            .unwrap();
        let journal_path = sqlite_sidecar(&database_path, "-journal");
        assert!(std::fs::metadata(&journal_path).unwrap().len() > 0);

        let error = migrate_legacy_state(&layout).unwrap_err();

        assert_eq!(error, "legacy_sqlite_busy");
        assert!(!layout.root.join("history/legacy-runs.jsonl").exists());
        assert!(!layout
            .rules
            .join("legacy-classification-memory.jsonl")
            .exists());
        assert!(!layout.root.join("migrations.json").exists());
        writer.execute_batch("ROLLBACK;").unwrap();
        drop(writer);
    }

    #[test]
    fn imports_a_verified_snapshot_when_a_later_delete_transaction_commits() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let database_path = layout.root.join("history.sqlite");
        let writer = rusqlite::Connection::open(&database_path).unwrap();
        writer
            .execute_batch(
                "PRAGMA page_size = 512;
                 PRAGMA journal_mode = DELETE;
                 PRAGMA cache_size = 1;
                 PRAGMA cache_spill = ON;
                 CREATE TABLE runs (
                    id INTEGER PRIMARY KEY, started_at TEXT NOT NULL,
                    file_name TEXT NOT NULL, file_hash TEXT NOT NULL,
                    item_count INTEGER NOT NULL, package_count INTEGER NOT NULL,
                    error_count INTEGER NOT NULL, warning_count INTEGER NOT NULL,
                    output_file TEXT NOT NULL, duration_ms INTEGER NOT NULL,
                    llm_used INTEGER NOT NULL
                 );
                 INSERT INTO runs VALUES (
                    1, '2026-07-01', 'committed-before-snapshot.xlsx', 'before',
                    1, 1, 0, 0, 'before-out.xlsx', 10, 0
                 );",
            )
            .unwrap();

        migrate_legacy_state_with_accepted_snapshot_hook(&layout, |pass| {
            assert_eq!(pass, 0);
            writer
                .execute_batch("BEGIN IMMEDIATE;")
                .map_err(|error| error.to_string())?;
            writer
                .execute(
                    "INSERT INTO runs VALUES (
                        2, '2026-07-02', ?1, 'after', 1, 1, 0, 0,
                        'after-out.xlsx', 11, 0
                    )",
                    [&"x".repeat(256 * 1024)],
                )
                .map_err(|error| error.to_string())?;
            assert!(sqlite_sidecar(&database_path, "-journal").exists());
            Ok(())
        })
        .unwrap();

        let first_history = HistoryStore::new(layout.root.join("history/runs.jsonl"))
            .list()
            .unwrap();
        assert_eq!(
            first_history
                .iter()
                .map(|record| record["id"].as_i64().unwrap())
                .collect::<Vec<_>>(),
            vec![-1]
        );
        let first_state: serde_json::Value =
            serde_json::from_slice(&std::fs::read(layout.root.join("migrations.json")).unwrap())
                .unwrap();
        let first_fingerprint = first_state["legacy_sqlite_v1"].clone();
        assert!(!first_fingerprint.is_null());

        writer.execute_batch("COMMIT;").unwrap();
        migrate_legacy_state(&layout).unwrap();

        let refreshed_history = HistoryStore::new(layout.root.join("history/runs.jsonl"))
            .list()
            .unwrap();
        assert_eq!(
            refreshed_history
                .iter()
                .map(|record| record["id"].as_i64().unwrap())
                .collect::<Vec<_>>(),
            vec![-2, -1]
        );
        let refreshed_state: serde_json::Value =
            serde_json::from_slice(&std::fs::read(layout.root.join("migrations.json")).unwrap())
                .unwrap();
        assert_ne!(refreshed_state["legacy_sqlite_v1"], first_fingerprint);
        drop(writer);
    }

    #[test]
    fn keeps_the_accepted_fingerprint_when_a_later_delete_transaction_rolls_back() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let database_path = layout.root.join("history.sqlite");
        let writer = rusqlite::Connection::open(&database_path).unwrap();
        writer
            .execute_batch(
                "PRAGMA page_size = 512;
                 PRAGMA journal_mode = DELETE;
                 PRAGMA cache_size = 1;
                 PRAGMA cache_spill = ON;
                 CREATE TABLE runs (
                    id INTEGER PRIMARY KEY, started_at TEXT NOT NULL,
                    file_name TEXT NOT NULL, file_hash TEXT NOT NULL,
                    item_count INTEGER NOT NULL, package_count INTEGER NOT NULL,
                    error_count INTEGER NOT NULL, warning_count INTEGER NOT NULL,
                    output_file TEXT NOT NULL, duration_ms INTEGER NOT NULL,
                    llm_used INTEGER NOT NULL
                 );
                 INSERT INTO runs VALUES (
                    1, '2026-08-01', 'committed-before-snapshot.xlsx', 'before',
                    1, 1, 0, 0, 'before-out.xlsx', 10, 0
                 );",
            )
            .unwrap();

        migrate_legacy_state_with_accepted_snapshot_hook(&layout, |pass| {
            assert_eq!(pass, 0);
            writer
                .execute_batch("BEGIN IMMEDIATE;")
                .map_err(|error| error.to_string())?;
            writer
                .execute(
                    "INSERT INTO runs VALUES (
                        2, '2026-08-02', ?1, 'rolled-back', 1, 1, 0, 0,
                        'rolled-back-out.xlsx', 11, 0
                    )",
                    [&"x".repeat(256 * 1024)],
                )
                .map_err(|error| error.to_string())?;
            assert!(sqlite_sidecar(&database_path, "-journal").exists());
            Ok(())
        })
        .unwrap();

        let legacy_path = layout.root.join("history/legacy-runs.jsonl");
        let legacy_before = std::fs::read(&legacy_path).unwrap();
        let state_path = layout.root.join("migrations.json");
        let state_before = std::fs::read(&state_path).unwrap();
        assert_eq!(
            HistoryStore::new(layout.root.join("history/runs.jsonl"))
                .list()
                .unwrap()
                .into_iter()
                .map(|record| record["id"].as_i64().unwrap())
                .collect::<Vec<_>>(),
            vec![-1]
        );

        writer.execute_batch("ROLLBACK;").unwrap();
        let blocked_temporary_path = legacy_path
            .parent()
            .unwrap()
            .join(format!(".legacy-runs.jsonl.{}.tmp", std::process::id()));
        std::fs::create_dir(&blocked_temporary_path).unwrap();

        migrate_legacy_state(&layout).unwrap();

        assert_eq!(std::fs::read(&legacy_path).unwrap(), legacy_before);
        assert_eq!(std::fs::read(&state_path).unwrap(), state_before);
        std::fs::remove_dir(&blocked_temporary_path).unwrap();
        drop(writer);
    }

    #[test]
    fn reimports_a_stale_source_fingerprint_without_losing_current_history() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let database_path = layout.root.join("history.sqlite");
        let writer = rusqlite::Connection::open(&database_path).unwrap();
        writer
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA wal_autocheckpoint = 0;
                 CREATE TABLE runs (
                    id INTEGER PRIMARY KEY, started_at TEXT NOT NULL,
                    file_name TEXT NOT NULL, file_hash TEXT NOT NULL,
                    item_count INTEGER NOT NULL, package_count INTEGER NOT NULL,
                    error_count INTEGER NOT NULL, warning_count INTEGER NOT NULL,
                    output_file TEXT NOT NULL, duration_ms INTEGER NOT NULL,
                    llm_used INTEGER NOT NULL
                 );
                 INSERT INTO runs VALUES (
                    1, '2026-05-01', 'legacy-one.xlsx', 'legacy-one', 1, 1, 0, 0,
                    'legacy-one-out.xlsx', 10, 0
                 );",
            )
            .unwrap();
        let current_path = layout.root.join("history/runs.jsonl");
        let history = HistoryStore::new(current_path.clone());
        let current_id = history
            .record(&serde_json::json!({
                "id": 900,
                "startedAt": "2026-05-03",
                "fileName": "current.xlsx"
            }))
            .unwrap();
        let current_before = std::fs::read(&current_path).unwrap();

        migrate_legacy_state_with_finalization_hook(&layout, || {
            writer
                .execute(
                    "INSERT INTO runs VALUES (
                        2, '2026-05-02', 'legacy-two.xlsx', 'legacy-two', 1, 1, 0, 0,
                        'legacy-two-out.xlsx', 11, 0
                    )",
                    [],
                )
                .map_err(|error| error.to_string())?;
            writer
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .map_err(|error| error.to_string())?;
            Ok(())
        })
        .unwrap();

        let first_state: serde_json::Value =
            serde_json::from_slice(&std::fs::read(layout.root.join("migrations.json")).unwrap())
                .unwrap();
        let first_fingerprint = first_state["legacy_sqlite_v1"].clone();
        assert!(!first_fingerprint.is_null());
        assert_eq!(
            std::fs::read_to_string(layout.root.join("history/legacy-runs.jsonl"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        assert_eq!(std::fs::read(&current_path).unwrap(), current_before);

        migrate_legacy_state(&layout).unwrap();

        let second_state: serde_json::Value =
            serde_json::from_slice(&std::fs::read(layout.root.join("migrations.json")).unwrap())
                .unwrap();
        assert_ne!(second_state["legacy_sqlite_v1"], first_fingerprint);
        assert_eq!(
            std::fs::read_to_string(layout.root.join("history/legacy-runs.jsonl"))
                .unwrap()
                .lines()
                .count(),
            2
        );
        assert_eq!(std::fs::read(&current_path).unwrap(), current_before);
        assert_eq!(
            history
                .list()
                .unwrap()
                .into_iter()
                .map(|record| record["id"].as_i64().unwrap())
                .collect::<Vec<_>>(),
            vec![current_id, -2, -1]
        );
        drop(writer);
    }

    #[test]
    fn reimports_once_when_source_changes_during_finalization() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let database_path = layout.root.join("history.sqlite");
        let writer = rusqlite::Connection::open(&database_path).unwrap();
        writer
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA wal_autocheckpoint = 0;
                 CREATE TABLE runs (
                    id INTEGER PRIMARY KEY, started_at TEXT NOT NULL,
                    file_name TEXT NOT NULL, file_hash TEXT NOT NULL,
                    item_count INTEGER NOT NULL, package_count INTEGER NOT NULL,
                    error_count INTEGER NOT NULL, warning_count INTEGER NOT NULL,
                    output_file TEXT NOT NULL, duration_ms INTEGER NOT NULL,
                    llm_used INTEGER NOT NULL
                 );
                 INSERT INTO runs VALUES (
                    1, '2026-06-01', 'first.xlsx', 'first', 1, 1, 0, 0,
                    'first-out.xlsx', 10, 0
                 );",
            )
            .unwrap();

        migrate_legacy_state_with_marker_hook(&layout, |pass| {
            if pass == 0 {
                writer
                    .execute(
                        "INSERT INTO runs VALUES (
                            2, '2026-06-02', 'second.xlsx', 'second', 1, 1, 0, 0,
                            'second-out.xlsx', 11, 0
                        )",
                        [],
                    )
                    .map_err(|error| error.to_string())?;
                writer
                    .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
        .unwrap();

        let legacy =
            std::fs::read_to_string(layout.root.join("history/legacy-runs.jsonl")).unwrap();
        assert_eq!(legacy.lines().count(), 2);
        let state = super::load_state(&layout.root.join("migrations.json")).unwrap();
        assert_eq!(
            state.legacy_sqlite_v1.unwrap(),
            super::stable_legacy_content_fingerprint(&database_path)
                .unwrap()
                .unwrap()
        );
        drop(writer);
    }
}
