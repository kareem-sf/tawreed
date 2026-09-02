// History-database schema: table definitions and the additive column migrations.
//
// Split out of store.rs, which owns the ~/.tawreed layout, settings, credentials and
// logging. Schema is its own concern and grows on its own schedule; keeping it here means
// adding a table does not push an unrelated module past its size budget.

/// Create anything missing and bring an older database up to the current column set.
/// Safe to call on every connection — every statement is idempotent.
pub fn initialize(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_hash TEXT NOT NULL,
                item_count INTEGER NOT NULL,
                package_count INTEGER NOT NULL,
                error_count INTEGER NOT NULL,
                warning_count INTEGER NOT NULL,
                output_file TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                llm_used INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS run_classifications (
                run_id INTEGER NOT NULL,
                item_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                package_code TEXT NOT NULL,
                source TEXT NOT NULL,
                confidence REAL NOT NULL,
                PRIMARY KEY (run_id, item_id)
            );
            CREATE INDEX IF NOT EXISTS run_classifications_source
                ON run_classifications (source);
            CREATE TABLE IF NOT EXISTS classification_memory (
                project_name TEXT NOT NULL,
                description_key TEXT NOT NULL,
                package_code TEXT NOT NULL,
                package_name_en TEXT NOT NULL,
                package_name_ar TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (project_name, description_key)
            );",
    )
    .map_err(|e| format!("init history db: {e}"))?;
    migrate_runs_table(conn)
}

/// Additive migrations for installations created before project revisions and PDF support.
/// Inspect the schema itself instead of matching ALTER TABLE error strings — a genuine
/// failure must surface here, not be logged away while later INSERTs break opaquely.
fn migrate_runs_table(conn: &rusqlite::Connection) -> Result<(), String> {
    let existing: std::collections::HashSet<String> = {
        let mut stmt = conn
            .prepare("PRAGMA table_info(runs)")
            .map_err(|e| format!("inspect history db schema: {e}"))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| format!("inspect history db schema: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("inspect history db schema: {e}"))?;
        rows
    };
    for (column, migration) in [
        (
            "project_name",
            "ALTER TABLE runs ADD COLUMN project_name TEXT NOT NULL DEFAULT ''",
        ),
        (
            "revision",
            "ALTER TABLE runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "package_folder",
            "ALTER TABLE runs ADD COLUMN package_folder TEXT NOT NULL DEFAULT ''",
        ),
        (
            "source_kind",
            "ALTER TABLE runs ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'xlsx'",
        ),
        (
            "ocr_used",
            "ALTER TABLE runs ADD COLUMN ocr_used INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "provider",
            "ALTER TABLE runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'offline'",
        ),
        (
            "model",
            "ALTER TABLE runs ADD COLUMN model TEXT NOT NULL DEFAULT ''",
        ),
        (
            "trace_json",
            "ALTER TABLE runs ADD COLUMN trace_json TEXT NOT NULL DEFAULT '[]'",
        ),
        (
            "memory_applied",
            "ALTER TABLE runs ADD COLUMN memory_applied INTEGER NOT NULL DEFAULT 0",
        ),
    ] {
        if !existing.contains(column) {
            conn.execute(migration, [])
                .map_err(|e| format!("migrate history db ({column}): {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::migrate_runs_table;

    #[test]
    fn migrations_add_only_missing_columns_and_are_idempotent() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT NOT NULL
            );",
        )
        .unwrap();
        migrate_runs_table(&conn).unwrap();
        // A second run must not trip over the columns it added the first time.
        migrate_runs_table(&conn).unwrap();
        let has_revision: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('runs') WHERE name = 'revision'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count == 1)
            .unwrap();
        assert!(has_revision);
    }
}
