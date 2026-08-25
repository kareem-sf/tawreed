use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

const CURRENT_FILE: &str = "classification-memory.jsonl";
const LEGACY_FILE: &str = "legacy-classification-memory.jsonl";
const MAX_LIST_ENTRIES: usize = 20_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationMemoryEntry {
    pub description_key: String,
    pub package_code: String,
    pub package_name_en: String,
    pub package_name_ar: String,
    pub updated_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredEntry {
    project_name: String,
    #[serde(flatten)]
    entry: ClassificationMemoryEntry,
}

pub struct ClassificationMemoryStore {
    current_path: PathBuf,
    legacy_path: PathBuf,
}

impl ClassificationMemoryStore {
    pub fn new(rules_directory: PathBuf) -> Self {
        Self {
            current_path: rules_directory.join(CURRENT_FILE),
            legacy_path: rules_directory.join(LEGACY_FILE),
        }
    }

    pub fn save(
        &self,
        project_name: &str,
        entries: &[ClassificationMemoryEntry],
    ) -> Result<usize, String> {
        let mut records = load_records(&self.current_path)?
            .into_iter()
            .map(|record| {
                (
                    (
                        record.project_name.clone(),
                        record.entry.description_key.clone(),
                    ),
                    record,
                )
            })
            .collect::<BTreeMap<_, _>>();
        for entry in entries {
            records.insert(
                (project_name.to_string(), entry.description_key.clone()),
                StoredEntry {
                    project_name: project_name.to_string(),
                    entry: entry.clone(),
                },
            );
        }
        atomic_write_records(&self.current_path, records.values())?;
        Ok(entries.len())
    }

    pub fn list(&self, project_name: &str) -> Result<Vec<ClassificationMemoryEntry>, String> {
        let mut entries = BTreeMap::new();
        for record in load_records(&self.legacy_path)?
            .into_iter()
            .chain(load_records(&self.current_path)?)
        {
            if record.project_name == project_name {
                entries.insert(record.entry.description_key.clone(), record.entry);
            }
        }
        let mut entries = entries.into_values().collect::<Vec<_>>();
        entries.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.description_key.cmp(&right.description_key))
        });
        entries.truncate(MAX_LIST_ENTRIES);
        Ok(entries)
    }
}

fn load_records(path: &Path) -> Result<Vec<StoredEntry>, String> {
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("read classification memory: {error}")),
    };
    content
        .lines()
        .map(|line| {
            serde_json::from_str(line)
                .map_err(|error| format!("invalid_classification_memory: {error}"))
        })
        .collect()
}

fn atomic_write_records<'a>(
    path: &Path,
    records: impl Iterator<Item = &'a StoredEntry>,
) -> Result<(), String> {
    let parent = path.parent().ok_or("text_store_parent_missing")?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("create classification memory parent: {error}"))?;
    let temporary_path = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().unwrap().to_string_lossy(),
        std::process::id()
    ));
    let result = (|| {
        let mut file = std::fs::File::create(&temporary_path)
            .map_err(|error| format!("create temporary classification memory: {error}"))?;
        for record in records {
            serde_json::to_writer(&mut file, record)
                .map_err(|error| format!("serialize classification memory: {error}"))?;
            file.write_all(b"\n")
                .map_err(|error| format!("write classification memory: {error}"))?;
        }
        file.sync_all()
            .map_err(|error| format!("sync classification memory: {error}"))?;
        drop(file);
        crate::store::replace_file(&temporary_path, path)
            .map_err(|error| format!("replace classification memory: {error}"))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary_path);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{ClassificationMemoryEntry, ClassificationMemoryStore};

    fn entry(code: &str, updated_at: &str) -> ClassificationMemoryEntry {
        ClassificationMemoryEntry {
            description_key: "reinforced concrete".into(),
            package_code: code.into(),
            package_name_en: "Concrete".into(),
            package_name_ar: "خرسانة".into(),
            updated_at: updated_at.into(),
        }
    }

    #[test]
    fn saves_project_scoped_entries_and_upserts_by_description() {
        let root = tempfile::tempdir().unwrap();
        let store = ClassificationMemoryStore::new(root.path().join("rules"));

        assert_eq!(
            store
                .save("project-a", &[entry("A", "2026-01-01")])
                .unwrap(),
            1
        );
        assert_eq!(
            store
                .save("project-b", &[entry("B", "2026-01-02")])
                .unwrap(),
            1
        );
        assert_eq!(
            store
                .save("project-a", &[entry("A2", "2026-01-03")])
                .unwrap(),
            1
        );

        let project_a = store.list("project-a").unwrap();
        assert_eq!(project_a.len(), 1);
        assert_eq!(project_a[0].package_code, "A2");
        assert_eq!(store.list("project-b").unwrap()[0].package_code, "B");
    }
}
