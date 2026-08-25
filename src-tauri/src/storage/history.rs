use std::path::PathBuf;
use std::sync::Mutex;

const MAX_SAFE_RUN_ID: i64 = 9_007_199_254_740_991;
static HISTORY_WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone)]
pub struct HistoryStore {
    path: PathBuf,
    legacy_path: PathBuf,
}

impl HistoryStore {
    pub fn new(path: PathBuf) -> Self {
        let legacy_path = path.with_file_name("legacy-runs.jsonl");
        Self { path, legacy_path }
    }

    pub fn record(&self, value: &serde_json::Value) -> Result<i64, String> {
        if !value.is_object() {
            return Err("invalid_run_record".into());
        }
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let _write_guard = HISTORY_WRITE_LOCK
            .lock()
            .map_err(|_| "run_history_lock_poisoned".to_string())?;
        let id = next_run_id(&self.path)?;
        let mut record = value.clone();
        record
            .as_object_mut()
            .expect("run record object checked above")
            .insert("id".into(), serde_json::json!(id));
        crate::storage::json::append_jsonl(&self.path, &record)?;
        Ok(id)
    }

    pub fn list(&self) -> Result<Vec<serde_json::Value>, String> {
        let mut records = read_records(&self.legacy_path)?;
        records.extend(read_records(&self.path)?);
        records.sort_by(|left, right| {
            let left_started = left
                .get("startedAt")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let right_started = right
                .get("startedAt")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            right_started.cmp(left_started).then_with(|| {
                right
                    .get("id")
                    .and_then(serde_json::Value::as_i64)
                    .unwrap_or(0)
                    .cmp(
                        &left
                            .get("id")
                            .and_then(serde_json::Value::as_i64)
                            .unwrap_or(0),
                    )
            })
        });
        Ok(records)
    }
}

fn next_run_id(path: &std::path::Path) -> Result<i64, String> {
    let max_current_id = read_records(path)?
        .into_iter()
        .filter_map(|record| run_id(&record))
        .filter(|id| *id > 0)
        .max();
    let sequential_candidate = match max_current_id {
        Some(id) if id < MAX_SAFE_RUN_ID => id + 1,
        Some(_) => return Err("run_id_exhausted".into()),
        None => 1,
    };
    let now_millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let time_candidate = now_millis
        .checked_mul(1000)
        .filter(|candidate| *candidate <= MAX_SAFE_RUN_ID as u128)
        .ok_or_else(|| "run_id_exhausted".to_string())? as i64;

    Ok(time_candidate.max(sequential_candidate))
}

fn run_id(record: &serde_json::Value) -> Option<i64> {
    record.get("id").and_then(serde_json::Value::as_i64)
}

fn read_records(path: &std::path::Path) -> Result<Vec<serde_json::Value>, String> {
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("read run history: {error}")),
    };
    content
        .lines()
        .map(|line| {
            serde_json::from_str(line).map_err(|error| format!("invalid_run_history: {error}"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::HistoryStore;

    #[test]
    fn records_objects_and_lists_newest_first() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("history").join("runs.jsonl");
        let store = HistoryStore::new(path.clone());

        store
            .record(&serde_json::json!({ "id": -7, "fileName": "first.xlsx" }))
            .unwrap();
        store
            .record(&serde_json::json!({ "id": -7, "fileName": "second.xlsx" }))
            .unwrap();

        let records = store.list().unwrap();
        assert_eq!(records[0]["fileName"], "second.xlsx");
        assert_eq!(records[1]["fileName"], "first.xlsx");
        let ids = records
            .iter()
            .map(|record| record["id"].as_i64().unwrap())
            .collect::<Vec<_>>();
        assert!(ids
            .iter()
            .all(|id| (1..=9_007_199_254_740_991).contains(id)));
        assert!(ids[0] > ids[1]);
        assert_eq!(std::fs::read_to_string(path).unwrap().lines().count(), 2);
    }

    #[test]
    fn assigns_monotonically_unique_positive_ids_to_rapid_records() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("history").join("runs.jsonl");
        let store = HistoryStore::new(path.clone());

        for sequence in 0..32 {
            store
                .record(&serde_json::json!({ "id": -7, "sequence": sequence }))
                .unwrap();
        }

        let ids = std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|line| {
                serde_json::from_str::<serde_json::Value>(line).unwrap()["id"]
                    .as_i64()
                    .unwrap()
            })
            .collect::<Vec<_>>();
        assert_eq!(ids.len(), 32);
        assert!(ids
            .iter()
            .all(|id| (1..=9_007_199_254_740_991).contains(id)));
        assert!(ids.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn lists_every_legacy_and_current_record_even_when_manual_ids_collide() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("history").join("runs.jsonl");
        let legacy_path = path.with_file_name("legacy-runs.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &legacy_path,
            "{\"id\":-7,\"startedAt\":\"2026-01-01\",\"fileName\":\"legacy.xlsx\"}\n",
        )
        .unwrap();
        std::fs::write(
            &path,
            concat!(
                "{\"id\":-7,\"startedAt\":\"2026-01-02\",\"fileName\":\"current-collision.xlsx\"}\n",
                "{\"startedAt\":\"2026-01-04\",\"fileName\":\"missing-id.xlsx\"}\n",
                "{\"id\":\"manual\",\"startedAt\":\"2026-01-03\",\"fileName\":\"nonnumeric-id.xlsx\"}\n"
            ),
        )
        .unwrap();

        let records = HistoryStore::new(path).list().unwrap();

        assert_eq!(
            records
                .iter()
                .map(|record| record["fileName"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec![
                "missing-id.xlsx",
                "nonnumeric-id.xlsx",
                "current-collision.xlsx",
                "legacy.xlsx",
            ]
        );
    }

    #[test]
    fn reports_non_not_found_read_errors() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("runs.jsonl");
        std::fs::write(&path, [0xff]).unwrap();
        let store = HistoryStore::new(path);

        let error = store.list().unwrap_err();

        assert!(error.starts_with("read run history: "), "{error}");
    }
}
