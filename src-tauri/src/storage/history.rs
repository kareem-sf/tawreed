use std::path::PathBuf;

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

    pub fn record(&self, value: &serde_json::Value) -> Result<(), String> {
        if !value.is_object() {
            return Err("invalid_run_record".into());
        }
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        crate::storage::json::append_jsonl(&self.path, value)
    }

    pub fn list(&self) -> Result<Vec<serde_json::Value>, String> {
        let legacy_records = read_records(&self.legacy_path)?;
        let legacy_ids = legacy_records
            .iter()
            .filter_map(run_id)
            .collect::<std::collections::HashSet<_>>();
        let mut records = legacy_records;
        records.extend(
            read_records(&self.path)?
                .into_iter()
                .filter(|record| run_id(record).is_none_or(|id| !legacy_ids.contains(&id))),
        );
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

        store.record(&serde_json::json!({ "id": 1 })).unwrap();
        store.record(&serde_json::json!({ "id": 2 })).unwrap();

        assert_eq!(
            store.list().unwrap(),
            vec![
                serde_json::json!({ "id": 2 }),
                serde_json::json!({ "id": 1 })
            ]
        );
        assert_eq!(std::fs::read_to_string(path).unwrap().lines().count(), 2);
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
