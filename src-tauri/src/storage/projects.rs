use super::secure_dir::SecureDir;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

const PROJECT_STATUS_ACTIVE: &str = "active";
const PROJECT_NAME_LIMIT: usize = 160;
const CHECKPOINT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub status: String,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectRecord {
    id: String,
    name: String,
    status: String,
    created_at_ms: u64,
    updated_at_ms: u64,
}

impl ProjectRecord {
    fn summary(&self) -> ProjectSummary {
        ProjectSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            status: self.status.clone(),
            updated_at_ms: self.updated_at_ms,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub schema_version: u32,
    pub run_id: String,
    pub stage: String,
    pub sequence: u64,
    pub created_at_ms: u64,
    pub payload: serde_json::Value,
}

impl Checkpoint {
    pub fn new(run_id: &str, stage: &str, sequence: u64) -> Self {
        Self {
            schema_version: CHECKPOINT_SCHEMA_VERSION,
            run_id: run_id.to_owned(),
            stage: stage.to_owned(),
            sequence,
            created_at_ms: now_ms(),
            payload: serde_json::json!({}),
        }
    }
}

pub struct ProjectStore {
    root: PathBuf,
}

impl ProjectStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn create(&self, name: &str) -> Result<ProjectSummary, String> {
        let name = validate_name(name)?;
        let root = self.root_directory()?;
        let created_at_ms = now_ms();

        for _ in 0..8 {
            let id = Uuid::new_v4().to_string();
            match root.create_dir(&id) {
                Ok(()) => {
                    let project_directory =
                        root.open_dir(&id).map_err(|_| "unsafe_project_path")?;
                    let record = ProjectRecord {
                        id,
                        name: name.clone(),
                        status: PROJECT_STATUS_ACTIVE.to_string(),
                        created_at_ms,
                        updated_at_ms: created_at_ms,
                    };
                    self.write_project(&project_directory, &record)?;
                    return Ok(record.summary());
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err("create_project_failed".into()),
            }
        }

        Err("project_id_generation_failed".into())
    }

    pub fn list(&self) -> Result<Vec<ProjectSummary>, String> {
        let root = self.root_directory()?;
        let mut projects = Vec::new();

        for entry in root.entries().map_err(|_| "read_projects_failed")? {
            let Some(id) = entry.to_str() else {
                continue;
            };
            let Ok(id) = validate_id(id) else {
                continue;
            };
            let project_directory = root.open_dir(&id).map_err(|_| "unsafe_project_path")?;
            projects.push(self.read_project(&project_directory, &id)?.summary());
        }

        projects.sort_by(|left, right| {
            right
                .updated_at_ms
                .cmp(&left.updated_at_ms)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(projects)
    }

    pub fn load(&self, id: &str) -> Result<ProjectSummary, String> {
        let id = validate_id(id)?;
        let root = self.root_directory()?;
        let project_directory = open_project_directory(&root, &id)?;
        run_test_after_project_open_hook();
        Ok(self.read_project(&project_directory, &id)?.summary())
    }

    pub fn save_checkpoint(&self, id: &str, checkpoint: &Checkpoint) -> Result<(), String> {
        validate_checkpoint(checkpoint)?;
        let id = validate_id(id)?;
        let root = self.root_directory()?;
        let project_directory = open_project_directory(&root, &id)?;
        run_test_after_project_open_hook();
        self.read_project(&project_directory, &id)?;
        let checkpoints = project_directory
            .open_or_create_dir("checkpoints")
            .map_err(|_| "unsafe_project_path")?;
        run_test_after_checkpoint_open_hook();
        checkpoints
            .atomic_write_json(&format!("{}.json", checkpoint.sequence), checkpoint)
            .map_err(|_| "write_checkpoint_failed".to_string())
    }

    pub fn latest_checkpoint(&self, id: &str) -> Result<Option<Checkpoint>, String> {
        let id = validate_id(id)?;
        let root = self.root_directory()?;
        let project_directory = open_project_directory(&root, &id)?;
        run_test_after_project_open_hook();
        self.read_project(&project_directory, &id)?;
        let checkpoints = match project_directory.open_dir("checkpoints") {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("unsafe_project_path".into()),
        };
        let mut latest = None;

        for entry in checkpoints
            .entries()
            .map_err(|_| "read_checkpoints_failed")?
        {
            let Some(sequence) = checkpoint_sequence(&entry) else {
                continue;
            };
            let Some(name) = entry.to_str() else {
                continue;
            };
            let checkpoint = checkpoints
                .read_bytes(name)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Checkpoint>(&bytes).ok());
            let Some(checkpoint) = checkpoint else {
                continue;
            };
            if checkpoint.sequence != sequence || validate_checkpoint(&checkpoint).is_err() {
                continue;
            }
            if latest
                .as_ref()
                .is_none_or(|current: &Checkpoint| checkpoint.sequence > current.sequence)
            {
                latest = Some(checkpoint);
            }
        }

        Ok(latest)
    }

    fn read_project(
        &self,
        project_directory: &SecureDir,
        expected_id: &str,
    ) -> Result<ProjectRecord, String> {
        let bytes = project_directory
            .read_bytes("project.json")
            .map_err(|_| "read_project_failed")?;
        let project: ProjectRecord =
            serde_json::from_slice(&bytes).map_err(|_| "invalid_project_record")?;
        validate_project_record(&project, expected_id)?;
        Ok(project)
    }

    fn write_project(
        &self,
        project_directory: &SecureDir,
        project: &ProjectRecord,
    ) -> Result<(), String> {
        project_directory
            .atomic_write_json("project.json", project)
            .map_err(|_| "write_project_failed".to_string())
    }

    fn root_directory(&self) -> Result<SecureDir, String> {
        SecureDir::open_root(&self.root).map_err(|_| "create_project_store_failed".into())
    }
}

fn validate_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > PROJECT_NAME_LIMIT {
        Err("invalid_project_name".into())
    } else {
        Ok(name.to_string())
    }
}

fn validate_id(id: &str) -> Result<String, String> {
    let parsed = Uuid::parse_str(id).map_err(|_| "invalid_project_id")?;
    let canonical = parsed.to_string();
    if id == canonical {
        Ok(canonical)
    } else {
        Err("invalid_project_id".into())
    }
}

fn validate_project_record(project: &ProjectRecord, expected_id: &str) -> Result<(), String> {
    if validate_id(&project.id).as_deref() != Ok(expected_id)
        || project.status != PROJECT_STATUS_ACTIVE
        || validate_name(&project.name).is_err()
    {
        return Err("invalid_project_record".into());
    }
    Ok(())
}

fn validate_checkpoint(checkpoint: &Checkpoint) -> Result<(), String> {
    if checkpoint.schema_version != CHECKPOINT_SCHEMA_VERSION
        || checkpoint.run_id.trim().is_empty()
        || checkpoint.stage.trim().is_empty()
    {
        Err("invalid_checkpoint".into())
    } else {
        Ok(())
    }
}

fn checkpoint_sequence(name: &std::ffi::OsStr) -> Option<u64> {
    let name = name.to_str()?;
    let sequence = name.strip_suffix(".json")?;
    if sequence.is_empty() || sequence.starts_with('+') || sequence.starts_with('-') {
        return None;
    }
    let sequence = sequence.parse::<u64>().ok()?;
    (sequence.to_string() == name.strip_suffix(".json")?).then_some(sequence)
}

fn open_project_directory(root: &SecureDir, id: &str) -> Result<SecureDir, String> {
    root.open_dir(id).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "project_not_found".into()
        } else {
            "unsafe_project_path".into()
        }
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(all(test, unix))]
thread_local! {
    static TEST_AFTER_PROJECT_OPEN_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
}

#[cfg(all(test, unix))]
thread_local! {
    static TEST_AFTER_CHECKPOINT_OPEN_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
}

#[cfg(all(test, unix))]
fn set_test_after_project_open_hook(hook: impl FnOnce() + 'static) {
    TEST_AFTER_PROJECT_OPEN_HOOK.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
}

#[cfg(all(test, unix))]
fn set_test_after_checkpoint_open_hook(hook: impl FnOnce() + 'static) {
    TEST_AFTER_CHECKPOINT_OPEN_HOOK.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
}

fn run_test_after_project_open_hook() {
    #[cfg(all(test, unix))]
    TEST_AFTER_PROJECT_OPEN_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

fn run_test_after_checkpoint_open_hook() {
    #[cfg(all(test, unix))]
    TEST_AFTER_CHECKPOINT_OPEN_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::{set_test_after_checkpoint_open_hook, set_test_after_project_open_hook};
    use super::{Checkpoint, ProjectStore};
    use crate::storage::DataLayout;

    #[test]
    fn creates_lists_and_reopens_projects() {
        let root = tempfile::tempdir().unwrap();
        let layout = DataLayout::from_root(root.path().join(".tawreed"));
        layout.ensure().unwrap();
        let store = ProjectStore::new(layout.projects.clone());
        let created = store.create("Project Atlas").unwrap();
        assert_eq!(store.list().unwrap()[0].id, created.id);
        assert_eq!(store.load(&created.id).unwrap().name, "Project Atlas");
    }

    #[test]
    fn project_summary_serialization_omits_persisted_creation_time() {
        let root = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(root.path().join("projects"));

        let serialized = serde_json::to_value(store.create("Atlas").unwrap()).unwrap();

        assert!(serialized.get("createdAtMs").is_none());
        assert_eq!(
            serialized
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>(),
            std::collections::BTreeSet::from([
                "id".to_string(),
                "name".to_string(),
                "status".to_string(),
                "updatedAtMs".to_string(),
            ])
        );
    }

    #[test]
    fn returns_only_the_latest_valid_checkpoint() {
        let root = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(root.path().join("projects"));
        let project = store.create("Atlas").unwrap();
        store
            .save_checkpoint(&project.id, &Checkpoint::new("run-1", "bootstrap", 1))
            .unwrap();
        store
            .save_checkpoint(&project.id, &Checkpoint::new("run-1", "agent_ready", 2))
            .unwrap();
        assert_eq!(
            store.latest_checkpoint(&project.id).unwrap().unwrap().stage,
            "agent_ready"
        );
    }

    #[test]
    fn trims_names_and_rejects_empty_or_oversized_names() {
        let root = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(root.path().join("projects"));

        assert_eq!(store.create("  ").unwrap_err(), "invalid_project_name");
        assert_eq!(
            store.create(&"a".repeat(161)).unwrap_err(),
            "invalid_project_name"
        );
        assert_eq!(store.create("  Atlas  ").unwrap().name, "Atlas");
    }

    #[test]
    fn rejects_invalid_project_ids_without_creating_paths() {
        let root = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(root.path().join("projects"));

        for invalid_id in ["../../escape", "not-a-uuid", ""] {
            assert_eq!(store.load(invalid_id).unwrap_err(), "invalid_project_id");
            assert_eq!(
                store.latest_checkpoint(invalid_id).unwrap_err(),
                "invalid_project_id"
            );
        }
        assert!(!root.path().join("escape").exists());
    }

    #[test]
    fn latest_checkpoint_skips_corrupted_or_mismatched_documents() {
        let root = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(root.path().join("projects"));
        let project = store.create("Atlas").unwrap();
        store
            .save_checkpoint(&project.id, &Checkpoint::new("run-1", "ready", 2))
            .unwrap();
        let checkpoints = root
            .path()
            .join("projects")
            .join(&project.id)
            .join("checkpoints");
        std::fs::write(checkpoints.join("3.json"), "not json").unwrap();
        std::fs::write(
            checkpoints.join("4.json"),
            serde_json::to_vec(&Checkpoint::new("run-1", "wrong-sequence", 3)).unwrap(),
        )
        .unwrap();

        let latest = store.latest_checkpoint(&project.id).unwrap().unwrap();

        assert_eq!(latest.sequence, 2);
        assert_eq!(latest.stage, "ready");
    }

    #[test]
    fn latest_checkpoint_ignores_noncanonical_sequence_filenames() {
        let root = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(root.path().join("projects"));
        let project = store.create("Atlas").unwrap();
        store
            .save_checkpoint(&project.id, &Checkpoint::new("run-1", "ready", 2))
            .unwrap();
        let checkpoints = root
            .path()
            .join("projects")
            .join(&project.id)
            .join("checkpoints");
        std::fs::write(
            checkpoints.join("09.json"),
            serde_json::to_vec(&Checkpoint::new("run-1", "ambiguous", 9)).unwrap(),
        )
        .unwrap();

        assert_eq!(
            store.latest_checkpoint(&project.id).unwrap().unwrap().stage,
            "ready"
        );
    }

    #[test]
    fn checkpoints_remain_scoped_to_the_requested_project() {
        let root = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(root.path().join("projects"));
        let first = store.create("First").unwrap();
        let second = store.create("Second").unwrap();
        store
            .save_checkpoint(&first.id, &Checkpoint::new("run-1", "first-stage", 9))
            .unwrap();
        store
            .save_checkpoint(&second.id, &Checkpoint::new("run-2", "second-stage", 1))
            .unwrap();

        assert_eq!(
            store.latest_checkpoint(&second.id).unwrap().unwrap().stage,
            "second-stage"
        );
    }

    #[test]
    fn skips_noncanonical_uuid_directory_names_and_every_listed_id_reopens() {
        let root = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(root.path().join("projects"));
        let project = store.create("Atlas").unwrap();
        let projects_root = root.path().join("projects");
        std::fs::rename(
            projects_root.join(&project.id),
            projects_root.join(project.id.to_uppercase()),
        )
        .unwrap();

        assert!(store.list().unwrap().is_empty());

        let canonical = store.create("Canonical").unwrap();
        for listed in store.list().unwrap() {
            assert_eq!(store.load(&listed.id).unwrap().id, listed.id);
        }
        assert_eq!(store.load(&canonical.id).unwrap().id, canonical.id);
    }

    #[cfg(unix)]
    #[test]
    fn checkpoint_write_stays_in_the_opened_project_directory_after_a_parent_swap() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(root.path().join("projects"));
        let project = store.create("Atlas").unwrap();
        let project_path = root.path().join("projects").join(&project.id);
        let held_path = root
            .path()
            .join("projects")
            .join(format!("{}.held", project.id));
        let hook_project_path = project_path.clone();
        let hook_held_path = held_path.clone();
        let outside_path = outside.path().to_path_buf();

        set_test_after_project_open_hook(move || {
            std::fs::rename(&hook_project_path, &hook_held_path).unwrap();
            symlink(&outside_path, &hook_project_path).unwrap();
        });

        store
            .save_checkpoint(&project.id, &Checkpoint::new("run-1", "safe", 1))
            .unwrap();

        assert!(held_path.join("checkpoints").join("1.json").is_file());
        assert!(!outside.path().join("checkpoints").exists());
    }

    #[cfg(unix)]
    #[test]
    fn checkpoint_write_stays_in_the_opened_checkpoint_directory_after_a_parent_swap() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(root.path().join("projects"));
        let project = store.create("Atlas").unwrap();
        store
            .save_checkpoint(&project.id, &Checkpoint::new("run-1", "first", 1))
            .unwrap();
        let checkpoints = root
            .path()
            .join("projects")
            .join(&project.id)
            .join("checkpoints");
        let held_checkpoints = checkpoints.with_file_name("checkpoints.held");
        let hook_checkpoints = checkpoints.clone();
        let hook_held_checkpoints = held_checkpoints.clone();
        let outside_path = outside.path().to_path_buf();

        set_test_after_checkpoint_open_hook(move || {
            std::fs::rename(&hook_checkpoints, &hook_held_checkpoints).unwrap();
            symlink(&outside_path, &hook_checkpoints).unwrap();
        });

        store
            .save_checkpoint(&project.id, &Checkpoint::new("run-1", "second", 2))
            .unwrap();

        assert!(held_checkpoints.join("2.json").is_file());
        assert!(!outside.path().join("2.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn project_read_uses_the_opened_directory_after_a_parent_swap() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(root.path().join("projects"));
        let project = store.create("Atlas").unwrap();
        let project_path = root.path().join("projects").join(&project.id);
        let held_path = root
            .path()
            .join("projects")
            .join(format!("{}.held", project.id));
        let hook_project_path = project_path.clone();
        let hook_held_path = held_path.clone();
        let outside_path = outside.path().to_path_buf();

        std::fs::write(
            outside.path().join("project.json"),
            format!(
                "{{\"id\":\"{}\",\"name\":\"Outside\",\"status\":\"active\",\"createdAtMs\":1,\"updatedAtMs\":1}}",
                project.id
            ),
        )
        .unwrap();
        set_test_after_project_open_hook(move || {
            std::fs::rename(&hook_project_path, &hook_held_path).unwrap();
            symlink(&outside_path, &hook_project_path).unwrap();
        });

        assert_eq!(store.load(&project.id).unwrap().name, "Atlas");
        assert!(held_path.join("project.json").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_project_directories() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(root.path().join("projects"));
        let project = store.create("Atlas").unwrap();
        let project_path = root.path().join("projects").join(&project.id);
        std::fs::remove_dir_all(&project_path).unwrap();
        symlink(outside.path(), &project_path).unwrap();

        assert_eq!(store.load(&project.id).unwrap_err(), "unsafe_project_path");
    }
}
