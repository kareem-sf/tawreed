use std::path::PathBuf;

#[derive(Clone)]
pub struct HistoryStore {
    path: PathBuf,
}

impl HistoryStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
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
        let content = std::fs::read_to_string(&self.path).unwrap_or_default();
        content
            .lines()
            .rev()
            .map(|line| {
                serde_json::from_str(line).map_err(|error| format!("invalid_run_history: {error}"))
            })
            .collect()
    }
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
}
