pub mod classification_memory;
pub mod connections;
pub mod history;
mod json;
mod layout;
pub mod migration;
pub mod projects;

pub use json::{append_jsonl, atomic_write_json};
pub use layout::DataLayout;

#[cfg(test)]
mod tests {
    use super::{append_jsonl, atomic_write_json, DataLayout};

    #[test]
    fn creates_the_complete_platform_layout() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));

        layout.ensure().unwrap();

        for path in [
            &layout.runtime,
            &layout.assets,
            &layout.projects,
            &layout.rules,
            &layout.cache,
            &layout.staging,
            &layout.logs,
        ] {
            assert!(path.is_dir(), "missing {}", path.display());
        }
    }

    #[test]
    fn json_write_replaces_the_complete_document() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("settings.json");

        atomic_write_json(&path, &serde_json::json!({ "value": 1 })).unwrap();
        atomic_write_json(&path, &serde_json::json!({ "value": 2 })).unwrap();

        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(value["value"], 2);
    }

    #[test]
    fn json_write_is_pretty_and_newline_terminated() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("settings.json");

        atomic_write_json(&path, &serde_json::json!({ "enabled": true })).unwrap();

        assert_eq!(
            std::fs::read_to_string(path).unwrap(),
            "{\n  \"enabled\": true\n}\n"
        );
    }

    fn assert_failed_replace_cleans_temporary_file() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("settings.json");
        std::fs::create_dir(&path).unwrap();
        let temporary_path = root
            .path()
            .join(format!(".settings.json.{}.tmp", std::process::id()));

        let error =
            atomic_write_json(&path, &serde_json::json!({ "secret": "value" })).unwrap_err();

        assert!(error.contains("replace json"));
        assert!(!temporary_path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn failed_replace_cleans_owner_only_temporary_file_on_unix() {
        assert_failed_replace_cleans_temporary_file();
    }

    #[cfg(not(unix))]
    #[test]
    fn failed_replace_cleans_temporary_file_on_this_host() {
        assert_failed_replace_cleans_temporary_file();
    }

    #[test]
    fn jsonl_append_writes_one_document_per_line() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("events.jsonl");

        append_jsonl(&path, &serde_json::json!({ "event": "created" })).unwrap();
        append_jsonl(&path, &serde_json::json!({ "event": "updated" })).unwrap();

        assert_eq!(
            std::fs::read_to_string(path).unwrap(),
            "{\"event\":\"created\"}\n{\"event\":\"updated\"}\n"
        );
    }
}
