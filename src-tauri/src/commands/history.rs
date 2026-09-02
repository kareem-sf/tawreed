// Run history and classification-memory persistence (SQLite-backed).
use super::revisions::safe_component;
use crate::store;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ts_rs::TS;

/// One run's audit row.
///
/// This used to be an untyped `serde_json::Value` read with `.unwrap_or("")` /
/// `.unwrap_or(0)` per field, so a malformed or missing `itemCount` was persisted as 0 and
/// a missing `fileHash` as "". An audit trail that quietly records a zero is worse than one
/// that rejects the insert, so the shape is enforced by serde and the row is refused if it
/// does not fit.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunEntry {
    started_at: String,
    file_name: String,
    file_hash: String,
    item_count: i64,
    package_count: i64,
    error_count: i64,
    warning_count: i64,
    output_file: String,
    duration_ms: i64,
    llm_used: bool,
    #[serde(default)]
    project_name: String,
    #[serde(default)]
    revision: i64,
    #[serde(default)]
    package_folder: String,
    #[serde(default = "default_source_kind")]
    source_kind: String,
    #[serde(default)]
    ocr_used: bool,
    #[serde(default = "default_provider")]
    provider: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    trace: Vec<Value>,
    #[serde(default)]
    memory_applied: i64,
    /// Per-item provenance. Retained because a user correction here is a labelled example
    /// of what the classifier got wrong - the only ground truth this app ever sees.
    #[serde(default)]
    classifications: Vec<RunClassification>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunClassification {
    item_id: i64,
    #[serde(default)]
    description: String,
    package_code: String,
    source: String,
    confidence: f64,
}

fn default_source_kind() -> String {
    "xlsx".into()
}

fn default_provider() -> String {
    "offline".into()
}

const MAX_TRACE_BYTES: usize = 256 * 1024;
const MAX_RUN_CLASSIFICATIONS: usize = 20_000;
const MAX_DESCRIPTION_CHARS: usize = 1_000;

impl RunEntry {
    fn validate(&self) -> Result<(), String> {
        if !matches!(
            self.provider.as_str(),
            "offline" | "codex" | "anthropic" | "compatible" | "gemini" | "grok"
        ) {
            return Err("Invalid run provider".into());
        }
        if !matches!(
            self.source_kind.as_str(),
            "xlsx" | "xls" | "csv" | "ods" | "pdf"
        ) {
            return Err("Invalid run source kind".into());
        }
        if self.model.chars().count() > 160 {
            return Err("Run model identifier is too long".into());
        }
        for count in [
            self.item_count,
            self.package_count,
            self.error_count,
            self.warning_count,
            self.duration_ms,
            self.revision,
            self.memory_applied,
        ] {
            if count < 0 {
                return Err("Run counters must not be negative".into());
            }
        }
        if self.classifications.len() > MAX_RUN_CLASSIFICATIONS {
            return Err("Run carries too many classifications".into());
        }
        for classification in &self.classifications {
            if !matches!(
                classification.source.as_str(),
                "heuristic" | "llm" | "fallback" | "memory" | "user"
            ) {
                return Err("Invalid classification source".into());
            }
            if !valid_package_code(&classification.package_code) {
                return Err("Invalid classification package code".into());
            }
            if !(0.0..=1.0).contains(&classification.confidence) {
                return Err("Classification confidence must be between 0 and 1".into());
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub fn record_run(entry: RunEntry) -> Result<i64, String> {
    entry.validate()?;
    let trace_json =
        serde_json::to_string(&entry.trace).map_err(|e| format!("serialize run trace: {e}"))?;
    if trace_json.len() > MAX_TRACE_BYTES {
        return Err("Run trace exceeds the 256 KB limit".into());
    }
    let mut conn = store::open_db()?;
    // One transaction, so a run row can never exist without the provenance it claims.
    let tx = conn
        .transaction()
        .map_err(|e| format!("begin run transaction: {e}"))?;
    tx.execute(
        "INSERT INTO runs (started_at, file_name, file_hash, item_count, package_count,
                           error_count, warning_count, output_file, duration_ms, llm_used,
                           project_name, revision, package_folder, source_kind, ocr_used,
                           provider, model, trace_json, memory_applied)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
        rusqlite::params![
            entry.started_at,
            entry.file_name,
            entry.file_hash,
            entry.item_count,
            entry.package_count,
            entry.error_count,
            entry.warning_count,
            entry.output_file,
            entry.duration_ms,
            entry.llm_used as i64,
            entry.project_name,
            entry.revision,
            entry.package_folder,
            entry.source_kind,
            entry.ocr_used as i64,
            entry.provider,
            entry.model,
            trace_json,
            entry.memory_applied,
        ],
    )
    .map_err(|e| format!("insert run: {e}"))?;
    let run_id = tx.last_insert_rowid();
    for classification in &entry.classifications {
        let description: String = classification
            .description
            .chars()
            .take(MAX_DESCRIPTION_CHARS)
            .collect();
        tx.execute(
            "INSERT OR REPLACE INTO run_classifications
                 (run_id, item_id, description, package_code, source, confidence)
             VALUES (?1,?2,?3,?4,?5,?6)",
            rusqlite::params![
                run_id,
                classification.item_id,
                description,
                classification.package_code,
                classification.source,
                classification.confidence,
            ],
        )
        .map_err(|e| format!("insert run classification: {e}"))?;
    }
    tx.commit().map_err(|e| format!("commit run: {e}"))?;
    Ok(run_id)
}

/// Per-item classification provenance, optionally narrowed to one run or one source.
/// `source = "user"` is every item a human re-assigned during review - the labelled
/// examples the evaluation harness consumes.
#[tauri::command]
pub fn list_run_classifications(
    run_id: Option<i64>,
    source: Option<String>,
) -> Result<Vec<Value>, String> {
    if let Some(source) = source.as_deref() {
        if !matches!(source, "heuristic" | "llm" | "fallback" | "memory" | "user") {
            return Err("Invalid classification source".into());
        }
    }
    let conn = store::open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT run_id, item_id, description, package_code, source, confidence
             FROM run_classifications
             WHERE (?1 IS NULL OR run_id = ?1) AND (?2 IS NULL OR source = ?2)
             ORDER BY run_id DESC, item_id ASC LIMIT 50000",
        )
        .map_err(|e| format!("prepare: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params![run_id, source], |r| {
            Ok(json!({
                "runId": r.get::<_, i64>(0)?,
                "itemId": r.get::<_, i64>(1)?,
                "description": r.get::<_, String>(2)?,
                "packageCode": r.get::<_, String>(3)?,
                "source": r.get::<_, String>(4)?,
                "confidence": r.get::<_, f64>(5)?,
            }))
        })
        .map_err(|e| format!("query run classifications: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("row: {e}"))?);
    }
    Ok(out)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_entry() -> serde_json::Value {
        json!({
            "startedAt": "2026-09-02T08:00:00.000Z",
            "fileName": "boq.xlsx",
            "fileHash": "a".repeat(64),
            "itemCount": 42,
            "packageCount": 7,
            "errorCount": 0,
            "warningCount": 2,
            "outputFile": "C:/out/master.xlsx",
            "durationMs": 1234,
            "llmUsed": true
        })
    }

    fn parse(entry: serde_json::Value) -> Result<RunEntry, String> {
        serde_json::from_value::<RunEntry>(entry).map_err(|e| e.to_string())
    }

    #[test]
    fn a_well_formed_entry_parses_and_validates() {
        let entry = parse(valid_entry()).expect("parses");
        entry.validate().expect("validates");
        // Optional fields fall back to the same defaults the old untyped reader used.
        assert_eq!(entry.source_kind, "xlsx");
        assert_eq!(entry.provider, "offline");
        assert_eq!(entry.item_count, 42);
    }

    #[test]
    fn a_wrong_typed_count_is_refused_rather_than_silently_stored_as_zero() {
        // The exact regression this struct exists to prevent: itemCount arriving as a
        // string used to be read with .unwrap_or(0) and persisted as a run of zero items.
        let mut entry = valid_entry();
        entry["itemCount"] = json!("many");
        assert!(parse(entry).is_err());
    }

    #[test]
    fn a_missing_required_field_is_refused() {
        for field in [
            "startedAt",
            "fileName",
            "fileHash",
            "itemCount",
            "outputFile",
            "llmUsed",
        ] {
            let mut entry = valid_entry();
            entry.as_object_mut().unwrap().remove(field);
            assert!(parse(entry).is_err(), "accepted a run missing {field}");
        }
    }

    #[test]
    fn an_unknown_field_is_refused() {
        let mut entry = valid_entry();
        entry["totallyUnexpected"] = json!(1);
        assert!(parse(entry).is_err());
    }

    #[test]
    fn a_negative_counter_is_rejected() {
        let mut entry = valid_entry();
        entry["itemCount"] = json!(-1);
        assert!(parse(entry).unwrap().validate().is_err());
    }

    #[test]
    fn an_unknown_provider_or_source_kind_is_rejected() {
        let mut provider = valid_entry();
        provider["provider"] = json!("some-other-llm");
        assert!(parse(provider).unwrap().validate().is_err());

        let mut source = valid_entry();
        source["sourceKind"] = json!("docx");
        assert!(parse(source).unwrap().validate().is_err());
    }

    #[test]
    fn classification_provenance_is_validated_field_by_field() {
        let with = |classification: serde_json::Value| {
            let mut entry = valid_entry();
            entry["classifications"] = json!([classification]);
            parse(entry).unwrap().validate()
        };
        let good = json!({
            "itemId": 1, "description": "Reinforced concrete",
            "packageCode": "WP-02", "source": "user", "confidence": 1.0
        });
        assert!(with(good.clone()).is_ok());

        for (field, bad) in [
            ("source", json!("guessed")),
            ("packageCode", json!("../etc/passwd")),
            ("confidence", json!(1.5)),
            ("confidence", json!(-0.1)),
        ] {
            let mut broken = good.clone();
            broken[field] = bad.clone();
            assert!(with(broken).is_err(), "accepted {field} = {bad}");
        }
    }
}
