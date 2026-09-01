// Run history and classification-memory persistence (SQLite-backed).
use super::revisions::safe_component;
use crate::store;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ts_rs::TS;

#[tauri::command]
pub fn record_run(entry: Value) -> Result<i64, String> {
    let provider = entry
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("offline");
    if !matches!(
        provider,
        "offline" | "codex" | "anthropic" | "compatible" | "gemini" | "grok"
    ) {
        return Err("Invalid run provider".into());
    }
    let model = entry.get("model").and_then(Value::as_str).unwrap_or("");
    if model.chars().count() > 160 {
        return Err("Run model identifier is too long".into());
    }
    let empty_trace = json!([]);
    let trace_json = serde_json::to_string(
        entry
            .get("trace")
            .filter(|trace| trace.is_array())
            .unwrap_or(&empty_trace),
    )
    .map_err(|e| format!("serialize run trace: {e}"))?;
    if trace_json.len() > 256 * 1024 {
        return Err("Run trace exceeds the 256 KB limit".into());
    }
    let conn = store::open_db()?;
    conn.execute(
        "INSERT INTO runs (started_at, file_name, file_hash, item_count, package_count,
                           error_count, warning_count, output_file, duration_ms, llm_used,
                           project_name, revision, package_folder, source_kind, ocr_used,
                           provider, model, trace_json, memory_applied)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
        rusqlite::params![
            entry.get("startedAt").and_then(Value::as_str).unwrap_or(""),
            entry.get("fileName").and_then(Value::as_str).unwrap_or(""),
            entry.get("fileHash").and_then(Value::as_str).unwrap_or(""),
            entry.get("itemCount").and_then(Value::as_i64).unwrap_or(0),
            entry
                .get("packageCount")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            entry.get("errorCount").and_then(Value::as_i64).unwrap_or(0),
            entry
                .get("warningCount")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            entry
                .get("outputFile")
                .and_then(Value::as_str)
                .unwrap_or(""),
            entry.get("durationMs").and_then(Value::as_i64).unwrap_or(0),
            entry
                .get("llmUsed")
                .and_then(Value::as_bool)
                .unwrap_or(false) as i64,
            entry
                .get("projectName")
                .and_then(Value::as_str)
                .unwrap_or(""),
            entry.get("revision").and_then(Value::as_i64).unwrap_or(0),
            entry
                .get("packageFolder")
                .and_then(Value::as_str)
                .unwrap_or(""),
            entry
                .get("sourceKind")
                .and_then(Value::as_str)
                .unwrap_or("xlsx"),
            entry
                .get("ocrUsed")
                .and_then(Value::as_bool)
                .unwrap_or(false) as i64,
            provider,
            model,
            trace_json,
            entry
                .get("memoryApplied")
                .and_then(Value::as_i64)
                .unwrap_or(0),
        ],
    )
    .map_err(|e| format!("insert run: {e}"))?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn list_runs() -> Result<Vec<Value>, String> {
    let conn = store::open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, started_at, file_name, file_hash, item_count, package_count,
                    error_count, warning_count, output_file, duration_ms, llm_used,
                    project_name, revision, package_folder, source_kind, ocr_used,
                    provider, model, trace_json, memory_applied
             FROM runs ORDER BY id DESC LIMIT 100",
        )
        .map_err(|e| format!("prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "startedAt": r.get::<_, String>(1)?,
                "fileName": r.get::<_, String>(2)?,
                "fileHash": r.get::<_, String>(3)?,
                "itemCount": r.get::<_, i64>(4)?,
                "packageCount": r.get::<_, i64>(5)?,
                "errorCount": r.get::<_, i64>(6)?,
                "warningCount": r.get::<_, i64>(7)?,
                "outputFile": r.get::<_, String>(8)?,
                "durationMs": r.get::<_, i64>(9)?,
                "llmUsed": r.get::<_, i64>(10)? == 1,
                "projectName": r.get::<_, String>(11)?,
                "revision": r.get::<_, i64>(12)?,
                "packageFolder": r.get::<_, String>(13)?,
                "sourceKind": r.get::<_, String>(14)?,
                "ocrUsed": r.get::<_, i64>(15)? == 1,
                "provider": r.get::<_, String>(16)?,
                "model": r.get::<_, String>(17)?,
                "trace": serde_json::from_str::<Value>(&r.get::<_, String>(18)?)
                    .unwrap_or_else(|_| json!([])),
                "memoryApplied": r.get::<_, i64>(19)?,
            }))
        })
        .map_err(|e| format!("query runs: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("row: {e}"))?);
    }
    Ok(out)
}

#[derive(Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bridge-types/")]
pub struct ClassificationMemoryEntry {
    description_key: String,
    package_code: String,
    package_name_en: String,
    package_name_ar: String,
    updated_at: String,
}

fn valid_package_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 32
        && code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[tauri::command]
pub fn save_classification_memory(
    project_name: String,
    entries: Vec<ClassificationMemoryEntry>,
) -> Result<usize, String> {
    let project_name = safe_component(&project_name, 100);
    if entries.len() > 20_000 {
        return Err("Too many classification memory entries".into());
    }
    let mut conn = store::open_db()?;
    let transaction = conn
        .transaction()
        .map_err(|e| format!("start memory transaction: {e}"))?;
    let mut saved = 0usize;
    for entry in entries {
        let description_key = entry.description_key.trim();
        if description_key.is_empty()
            || description_key.chars().count() > 1_000
            || !valid_package_code(entry.package_code.trim())
            || entry.package_name_en.trim().is_empty()
            || entry.package_name_en.chars().count() > 240
            || entry.package_name_ar.chars().count() > 240
            || entry.updated_at.trim().is_empty()
            || entry.updated_at.chars().count() > 64
        {
            return Err("Invalid classification memory entry".into());
        }
        transaction
            .execute(
                "INSERT INTO classification_memory (
                    project_name, description_key, package_code, package_name_en,
                    package_name_ar, updated_at
                 ) VALUES (?1,?2,?3,?4,?5,?6)
                 ON CONFLICT(project_name, description_key) DO UPDATE SET
                    package_code=excluded.package_code,
                    package_name_en=excluded.package_name_en,
                    package_name_ar=excluded.package_name_ar,
                    updated_at=excluded.updated_at",
                rusqlite::params![
                    &project_name,
                    description_key,
                    entry.package_code.trim(),
                    entry.package_name_en.trim(),
                    entry.package_name_ar.trim(),
                    entry.updated_at,
                ],
            )
            .map_err(|e| format!("save classification memory: {e}"))?;
        saved += 1;
    }
    transaction
        .commit()
        .map_err(|e| format!("commit classification memory: {e}"))?;
    Ok(saved)
}

#[tauri::command]
pub fn list_classification_memory(
    project_name: String,
) -> Result<Vec<ClassificationMemoryEntry>, String> {
    let project_name = safe_component(&project_name, 100);
    let conn = store::open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT description_key, package_code, package_name_en, package_name_ar, updated_at
             FROM classification_memory
             WHERE project_name = ?1
             ORDER BY updated_at DESC
             LIMIT 20000",
        )
        .map_err(|e| format!("prepare classification memory: {e}"))?;
    let entries = stmt
        .query_map([project_name], |row| {
            Ok(ClassificationMemoryEntry {
                description_key: row.get(0)?,
                package_code: row.get(1)?,
                package_name_en: row.get(2)?,
                package_name_ar: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("read classification memory: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("read classification memory: {e}"))?;
    Ok(entries)
}
