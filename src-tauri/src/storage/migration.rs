use super::{atomic_write_json, DataLayout};
use rusqlite::OpenFlags;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const LEGACY_SQLITE_MIGRATION: &str = "legacy-sqlite-v1";
const LEGACY_ENV_MIGRATION: &str = "legacy-env-v1";

#[derive(Default, Deserialize, Serialize)]
struct MigrationState {
    completed: Vec<String>,
}

struct LegacySqliteSnapshot {
    directory: PathBuf,
    database: PathBuf,
}

impl LegacySqliteSnapshot {
    fn create(source: &Path) -> Result<Self, String> {
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
        std::fs::copy(source, &snapshot.database)
            .map_err(|error| format!("copy legacy sqlite snapshot: {error}"))?;
        let source_wal = sqlite_sidecar(source, "-wal");
        if source_wal.exists() {
            std::fs::copy(&source_wal, sqlite_sidecar(&snapshot.database, "-wal"))
                .map_err(|error| format!("copy legacy sqlite WAL snapshot: {error}"))?;
        }
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

pub fn migrate_legacy_state(layout: &DataLayout) -> Result<(), String> {
    layout.ensure()?;
    let state_path = layout.root.join("migrations.json");
    let mut state = load_state(&state_path)?;
    let sqlite_complete = state
        .completed
        .iter()
        .any(|migration| migration == LEGACY_SQLITE_MIGRATION);
    let env_complete = state
        .completed
        .iter()
        .any(|migration| migration == LEGACY_ENV_MIGRATION);
    if sqlite_complete && env_complete {
        return Ok(());
    }

    if !sqlite_complete {
        let database_path = layout.root.join("history.sqlite");
        if database_path.exists() {
            let snapshot = LegacySqliteSnapshot::create(&database_path)?;
            import_runs(
                snapshot.database(),
                &layout.root.join("history").join("runs.jsonl"),
            )?;
            import_memory(
                snapshot.database(),
                &layout.rules.join("legacy-classification-memory.jsonl"),
            )?;
        }
        state.completed.push(LEGACY_SQLITE_MIGRATION.into());
    }

    if !env_complete {
        import_env(layout)?;
        state.completed.push(LEGACY_ENV_MIGRATION.into());
    }

    atomic_write_json(&state_path, &state)
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
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
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
    use super::migrate_legacy_state;
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
        let lines = std::fs::read_to_string(layout.root.join("history/runs.jsonl")).unwrap();
        assert_eq!(lines.lines().count(), 1);
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

        let content = std::fs::read_to_string(layout.root.join("history/runs.jsonl")).unwrap();
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
            std::fs::read_to_string(layout.root.join("history/runs.jsonl"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        std::fs::remove_dir(&marker_temporary_path).unwrap();

        migrate_legacy_state(&layout).unwrap();
        migrate_legacy_state(&layout).unwrap();

        assert_eq!(
            std::fs::read_to_string(layout.root.join("history/runs.jsonl"))
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

        let history = std::fs::read_to_string(layout.root.join("history/runs.jsonl")).unwrap();
        let record: serde_json::Value = serde_json::from_str(history.trim()).unwrap();
        assert_eq!(record["id"], 91);
        assert_eq!(record["fileName"], "wal.xlsx");
        assert_eq!(legacy_sqlite_family(&layout.root), before);
        drop(writer);
    }
}
