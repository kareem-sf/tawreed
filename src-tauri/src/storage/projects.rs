use super::atomic_write_json;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
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
            let project_directory = root.join(&id);
            match std::fs::create_dir(&project_directory) {
                Ok(()) => {
                    let project_directory = existing_directory_inside(&root, &project_directory)?;
                    let summary = ProjectSummary {
                        id,
                        name: name.clone(),
                        status: PROJECT_STATUS_ACTIVE.to_string(),
                        created_at_ms,
                        updated_at_ms: created_at_ms,
                    };
                    self.write_project(&root, &project_directory, &summary)?;
                    return Ok(summary);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err("create_project_failed".into()),
            }
        }

        Err("project_id_generation_failed".into())
    }

    pub fn list(&self) -> Result<Vec<ProjectSummary>, String> {
        let root = self.root_directory()?;
        let entries = std::fs::read_dir(&root).map_err(|_| "read_projects_failed")?;
        let mut projects = Vec::new();

        for entry in entries {
            let entry = entry.map_err(|_| "read_projects_failed")?;
            let path = entry.path();
            let metadata = std::fs::symlink_metadata(&path).map_err(|_| "read_projects_failed")?;
            if metadata.file_type().is_symlink() {
                return Err("unsafe_project_path".into());
            }
            if !metadata.is_dir() {
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let Ok(id) = validate_id(&name) else {
                continue;
            };
            let project_directory = existing_directory_inside(&root, &path)?;
            projects.push(self.read_project(&root, &project_directory, &id)?);
        }

        projects.sort_by(|left, right| {
            right
                .updated_at_ms
                .cmp(&left.updated_at_ms)
                .then_with(|| right.created_at_ms.cmp(&left.created_at_ms))
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(projects)
    }

    pub fn load(&self, id: &str) -> Result<ProjectSummary, String> {
        let id = validate_id(id)?;
        let root = self.root_directory()?;
        let project_directory = existing_directory_inside(&root, &root.join(&id))?;
        self.read_project(&root, &project_directory, &id)
    }

    pub fn save_checkpoint(&self, id: &str, checkpoint: &Checkpoint) -> Result<(), String> {
        validate_checkpoint(checkpoint)?;
        let id = validate_id(id)?;
        let root = self.root_directory()?;
        let project_directory = existing_directory_inside(&root, &root.join(&id))?;
        self.read_project(&root, &project_directory, &id)?;

        let checkpoints = project_directory.join("checkpoints");
        let checkpoints = ensure_directory_inside(&root, &checkpoints)?;
        let checkpoint_path = checkpoints.join(format!("{}.json", checkpoint.sequence));
        ensure_write_target_inside(&root, &checkpoint_path)?;
        atomic_write_json(&checkpoint_path, checkpoint)
            .map_err(|_| "write_checkpoint_failed".to_string())
    }

    pub fn latest_checkpoint(&self, id: &str) -> Result<Option<Checkpoint>, String> {
        let id = validate_id(id)?;
        let root = self.root_directory()?;
        let project_directory = existing_directory_inside(&root, &root.join(&id))?;
        self.read_project(&root, &project_directory, &id)?;
        let checkpoints = project_directory.join("checkpoints");
        let checkpoints = match existing_directory_inside(&root, &checkpoints) {
            Ok(path) => path,
            Err(error) if error == "project_not_found" => return Ok(None),
            Err(error) => return Err(error),
        };
        let entries = std::fs::read_dir(checkpoints).map_err(|_| "read_checkpoints_failed")?;
        let mut latest = None;

        for entry in entries {
            let entry = entry.map_err(|_| "read_checkpoints_failed")?;
            let path = entry.path();
            let metadata =
                std::fs::symlink_metadata(&path).map_err(|_| "read_checkpoints_failed")?;
            if metadata.file_type().is_symlink() {
                return Err("unsafe_project_path".into());
            }
            if !metadata.is_file() {
                continue;
            }
            let Some(sequence) = checkpoint_sequence(entry.file_name().as_ref()) else {
                continue;
            };
            let path = existing_file_inside(&root, &path)?;
            let checkpoint = std::fs::read(path)
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
        root: &Path,
        project_directory: &Path,
        expected_id: &str,
    ) -> Result<ProjectSummary, String> {
        let project_path = existing_file_inside(root, &project_directory.join("project.json"))?;
        let bytes = std::fs::read(project_path).map_err(|_| "read_project_failed")?;
        let project: ProjectSummary =
            serde_json::from_slice(&bytes).map_err(|_| "invalid_project_record")?;
        validate_project_record(&project, expected_id)?;
        Ok(project)
    }

    fn write_project(
        &self,
        root: &Path,
        project_directory: &Path,
        project: &ProjectSummary,
    ) -> Result<(), String> {
        let project_path = project_directory.join("project.json");
        ensure_write_target_inside(root, &project_path)?;
        atomic_write_json(&project_path, project).map_err(|_| "write_project_failed".to_string())
    }

    fn root_directory(&self) -> Result<PathBuf, String> {
        std::fs::create_dir_all(&self.root).map_err(|_| "create_project_store_failed")?;
        existing_directory(&self.root, "unsafe_project_path")
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
    Uuid::parse_str(id)
        .map(|parsed| parsed.to_string())
        .map_err(|_| "invalid_project_id".into())
}

fn validate_project_record(project: &ProjectSummary, expected_id: &str) -> Result<(), String> {
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

fn ensure_directory_inside(root: &Path, path: &Path) -> Result<PathBuf, String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("unsafe_project_path".into());
            }
            existing_directory_inside(root, path)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(path).map_err(|_| "create_project_directory_failed")?;
            existing_directory_inside(root, path)
        }
        Err(_) => Err("unsafe_project_path".into()),
    }
}

fn existing_directory_inside(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err("project_not_found".into());
        }
        Err(_) => return Err("unsafe_project_path".into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("unsafe_project_path".into());
    }
    let path = std::fs::canonicalize(path).map_err(|_| "unsafe_project_path")?;
    if path.starts_with(root) {
        Ok(path)
    } else {
        Err("unsafe_project_path".into())
    }
}

fn existing_directory(path: &Path, error: &str) -> Result<PathBuf, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(error.into());
    }
    std::fs::canonicalize(path).map_err(|_| error.into())
}

fn existing_file_inside(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| -> String {
        if error.kind() == std::io::ErrorKind::NotFound {
            "project_not_found".into()
        } else {
            "unsafe_project_path".into()
        }
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("unsafe_project_path".into());
    }
    let path = std::fs::canonicalize(path).map_err(|_| "unsafe_project_path")?;
    if path.starts_with(root) {
        Ok(path)
    } else {
        Err("unsafe_project_path".into())
    }
}

fn ensure_write_target_inside(root: &Path, path: &Path) -> Result<(), String> {
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("unsafe_project_path".into());
        }
        let path = std::fs::canonicalize(path).map_err(|_| "unsafe_project_path")?;
        if !path.starts_with(root) {
            return Err("unsafe_project_path".into());
        }
    }
    Ok(())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
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
    fn lists_projects_with_noncanonical_but_valid_uuid_directory_names() {
        let root = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(root.path().join("projects"));
        let project = store.create("Atlas").unwrap();
        let projects_root = root.path().join("projects");
        std::fs::rename(
            projects_root.join(&project.id),
            projects_root.join(project.id.to_uppercase()),
        )
        .unwrap();

        assert_eq!(store.list().unwrap()[0].id, project.id);
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
