// Project revision reservation / publish / discard workflow (Rev NN folders).
use crate::store;
use base64::Engine;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Sanitize a user-supplied path component (project name, artifact filename, etc.) into a
/// value that is safe to use as a filesystem path segment on Windows/macOS/Linux alike.
pub(crate) fn safe_component(raw: &str, max_chars: usize) -> String {
    let mut value = String::with_capacity(raw.len());
    let mut previous_space = false;
    for ch in raw.chars() {
        let invalid =
            ch < ' ' || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
        let next = if invalid { ' ' } else { ch };
        if next.is_whitespace() {
            if !previous_space {
                value.push(' ');
            }
            previous_space = true;
        } else {
            value.push(next);
            previous_space = false;
        }
    }
    value = value
        .trim()
        .trim_end_matches(['.', ' '])
        .chars()
        .take(max_chars)
        .collect();
    value = value.trim_end_matches(['.', ' ']).to_string();
    if value.is_empty() {
        value = "Untitled Project".into();
    }
    let lower = value.to_lowercase();
    // Windows reserves these names *with any extension too* — CON.xlsx is as refused as
    // CON — so the check is against the stem, not the whole value.
    let stem = lower.split('.').next().unwrap_or(lower.as_str());
    let reserved = matches!(stem, "con" | "prn" | "aux" | "nul")
        || (stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && stem[3..].parse::<u8>().is_ok_and(|n| (1..=9).contains(&n)));
    if reserved {
        format!("Project {value}")
    } else {
        value
    }
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bridge-types/")]
pub struct RevisionReservation {
    project_name: String,
    revision: u32,
    revision_label: String,
    session: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionArtifact {
    relative_path: String,
    bytes_b64: String,
    kind: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bridge-types/")]
pub struct RevisionOutput {
    project_name: String,
    revision: u32,
    revision_label: String,
    master_path: String,
    package_folder: String,
    revision_folder: String,
    files: Vec<String>,
}

/// Process-wide guard against two generations of the same project running at once — both
/// could otherwise reserve the same `Rev NN` and the loser would fail only after doing all
/// the work. Acquired by reserve_revision, released by write_revision_bundle and
/// discard_revision on every exit path. These commands are synchronous, so the lock is
/// only held for a map insert/remove at a time — never across an .await.
static ACTIVE_GENERATIONS: std::sync::Mutex<Option<std::collections::HashSet<String>>> =
    std::sync::Mutex::new(None);

fn acquire_generation(project: &str) -> bool {
    let mut guard = ACTIVE_GENERATIONS.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .get_or_insert_with(std::collections::HashSet::new)
        .insert(project.to_string())
}

fn release_generation(project: &str) {
    let mut guard = ACTIVE_GENERATIONS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(active) = guard.as_mut() {
        active.remove(project);
    }
}

#[tauri::command]
pub fn reserve_revision(project_name: String) -> Result<RevisionReservation, String> {
    let project_name = safe_component(&project_name, 100);
    if !acquire_generation(&project_name) {
        return Err(format!(
            "A generation is already running for {project_name} — wait for it to finish or discard it"
        ));
    }
    let reservation = reserve_revision_inner(&project_name);
    if reservation.is_err() {
        release_generation(&project_name);
    }
    reservation
}

fn reserve_revision_inner(project_name: &str) -> Result<RevisionReservation, String> {
    let project_dir = store::output_dir()?.join(project_name);
    std::fs::create_dir_all(&project_dir)
        .map_err(|e| format!("create project output directory: {e}"))?;
    let revision = (1..10_000u32)
        .find(|revision| !project_dir.join(format!("Rev {revision:02}")).exists())
        .ok_or("Could not allocate another project revision")?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let session = format!(
        ".tawreed-rev-{revision:02}-{stamp}-{}.tmp",
        std::process::id()
    );
    let temp = project_dir.join(&session);
    std::fs::create_dir_all(temp.join("Packages"))
        .map_err(|e| format!("reserve revision directory: {e}"))?;
    Ok(RevisionReservation {
        project_name: project_name.to_string(),
        revision,
        revision_label: format!("Rev {revision:02}"),
        session,
    })
}

fn safe_artifact_path(
    root: &std::path::Path,
    relative: &str,
) -> Result<std::path::PathBuf, String> {
    let normalized = relative.replace('\\', "/");
    let parts: Vec<&str> = normalized.split('/').collect();
    if parts.is_empty() || parts.len() > 2 || (parts.len() == 2 && parts[0] != "Packages") {
        return Err("Invalid generated artifact path".into());
    }
    let name = parts.last().copied().unwrap_or("");
    if name != safe_component(name, 220) || !name.to_lowercase().ends_with(".xlsx") {
        return Err("Invalid generated workbook filename".into());
    }
    Ok(if parts.len() == 2 {
        root.join("Packages").join(name)
    } else {
        root.join(name)
    })
}

#[tauri::command]
pub fn write_revision_bundle(
    project_name: String,
    session: String,
    revision: u32,
    artifacts: Vec<RevisionArtifact>,
) -> Result<RevisionOutput, String> {
    // Release the per-project generation guard on every exit path, success or failure.
    let project_name = safe_component(&project_name, 100);
    let result = write_revision_bundle_inner(&project_name, session, revision, artifacts);
    release_generation(&project_name);
    result
}

fn write_revision_bundle_inner(
    project_name: &str,
    session: String,
    revision: u32,
    artifacts: Vec<RevisionArtifact>,
) -> Result<RevisionOutput, String> {
    if artifacts.is_empty()
        || session.contains(['/', '\\'])
        || !session.starts_with(".tawreed-rev-")
        || !session.ends_with(".tmp")
    {
        return Err("Invalid revision session".into());
    }
    let project_dir = store::output_dir()?.join(project_name);
    let temp = project_dir.join(&session);
    if !temp.is_dir() {
        return Err("Revision reservation no longer exists".into());
    }
    let final_dir = project_dir.join(format!("Rev {revision:02}"));
    if final_dir.exists() {
        return Err(format!("Rev {revision:02} already exists"));
    }

    // Fail fast before any file of the bundle is written: the full target path
    // (<output>/<project>/Rev NN/Packages/<name>.xlsx) must fit under Windows' 260-char
    // MAX_PATH with margin, otherwise the write would die halfway through the bundle.
    for artifact in &artifacts {
        let target = safe_artifact_path(&final_dir, &artifact.relative_path)?;
        if target.to_string_lossy().chars().count() > 240 {
            return Err(format!(
                "'{}' would exceed the maximum Windows path length — use a shorter project name",
                artifact.relative_path
            ));
        }
    }

    let mut files = Vec::new();
    let mut master_relative: Option<String> = None;
    let write_result = (|| -> Result<(), String> {
        for artifact in artifacts {
            if artifact.bytes_b64.len() > 268_435_456 {
                let _ = std::fs::remove_dir_all(&temp);
                return Err("Artifact exceeds the 200 MB limit".into());
            }
            let path = safe_artifact_path(&temp, &artifact.relative_path)?;
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("create package directory: {e}"))?;
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&artifact.bytes_b64)
                .map_err(|e| format!("decode generated workbook: {e}"))?;
            let tmp_file = path.with_extension("xlsx.tmp");
            std::fs::write(&tmp_file, &bytes)
                .map_err(|e| format!("write generated workbook: {e}"))?;
            store::replace_file(&tmp_file, &path)
                .map_err(|e| format!("publish generated workbook: {e}"))?;
            if artifact.kind == "master" {
                master_relative = Some(artifact.relative_path.clone());
            }
            files.push(artifact.relative_path);
        }
        if master_relative.is_none() {
            return Err("Generated bundle has no master workbook".into());
        }
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_dir_all(&temp);
        return Err(error);
    }

    // Publish. On Windows this rename fails while anything holds a handle inside the
    // folder (Explorer, antivirus, an open workbook) — keep the temp dir so the completed
    // generation survives and the user can retry instead of losing the work.
    if let Err(e) = std::fs::rename(&temp, &final_dir) {
        return Err(format!(
            "Could not publish the revision ({e}). The generated files are preserved at {} — close whatever is using them and try again.",
            temp.to_string_lossy()
        ));
    }

    let master = final_dir.join(master_relative.ok_or("Generated bundle has no master workbook")?);
    let absolute_files = files
        .iter()
        .map(|relative| final_dir.join(relative).to_string_lossy().to_string())
        .collect();
    store::log_line(&format!(
        "revision published: {project_name} Rev {revision:02} ({} files)",
        files.len()
    ));
    Ok(RevisionOutput {
        project_name: project_name.to_string(),
        revision,
        revision_label: format!("Rev {revision:02}"),
        master_path: master.to_string_lossy().to_string(),
        package_folder: final_dir.join("Packages").to_string_lossy().to_string(),
        revision_folder: final_dir.to_string_lossy().to_string(),
        files: absolute_files,
    })
}

#[tauri::command]
pub fn discard_revision(project_name: String, session: String) -> Result<(), String> {
    let project_name = safe_component(&project_name, 100);
    let result = (|| -> Result<(), String> {
        if session.contains(['/', '\\']) || !session.starts_with(".tawreed-rev-") {
            return Err("Invalid revision session".into());
        }
        if !session.ends_with(".tmp") {
            return Err("Invalid session directory name".into());
        }
        let temp = store::output_dir()?.join(&project_name).join(session);
        if temp.exists() {
            std::fs::remove_dir_all(temp).map_err(|e| format!("discard revision: {e}"))?;
        }
        Ok(())
    })();
    // A malformed or already-missing reservation must not permanently strand the
    // process-wide project guard.
    release_generation(&project_name);
    result
}

#[cfg(test)]
mod path_safety_tests {
    use super::{safe_artifact_path, safe_component};
    use std::path::Path;

    #[test]
    fn strips_windows_illegal_characters_and_control_codes() {
        assert_eq!(safe_component("Tower <A>:\"B\"|C?*", 100), "Tower A B C");
        assert_eq!(safe_component("Rev\u{0}\u{1}One", 100), "Rev One");
    }

    #[test]
    fn refuses_to_produce_a_traversal_segment() {
        // A bare "." or ".." trims away entirely and falls back to a literal name.
        assert_eq!(safe_component("..", 100), "Untitled Project");
        assert_eq!(safe_component(".", 100), "Untitled Project");
        // Separators are replaced before anything else, so no output can span directories
        // or be interpreted as a parent reference by the OS.
        // Separators are replaced with spaces before anything else, so the result is
        // always ONE directory name. Dots may survive inside it ("../../etc" becomes
        // ".. .. etc"), which is inert precisely because no separator is left to make
        // them a parent reference.
        for raw in ["../../etc", r"..\..\Windows", "a/../../b", "/etc/passwd"] {
            let safe = safe_component(raw, 100);
            assert!(
                !safe.contains('/') && !safe.contains('\\'),
                "{raw} -> {safe}"
            );
            assert!(safe != ".." && safe != ".", "{raw} -> {safe}");
            assert_eq!(
                std::path::Path::new(&safe).components().count(),
                1,
                "{raw} -> {safe}"
            );
        }
    }

    #[test]
    fn trims_trailing_dots_and_spaces_windows_silently_drops() {
        assert_eq!(safe_component("Project.  ", 100), "Project");
        assert_eq!(safe_component("   ", 100), "Untitled Project");
    }

    #[test]
    fn escapes_reserved_device_names_with_or_without_an_extension() {
        for raw in ["CON", "con", "PRN", "aux", "NUL", "COM1", "lpt9"] {
            assert!(
                safe_component(raw, 100).starts_with("Project "),
                "bare {raw}"
            );
        }
        // Windows refuses CON.xlsx exactly as it refuses CON.
        for raw in ["CON.xlsx", "nul.xlsx", "COM4.xlsx"] {
            assert!(
                safe_component(raw, 100).starts_with("Project "),
                "with extension: {raw}"
            );
        }
    }

    #[test]
    fn leaves_ordinary_names_including_arabic_and_dots_alone() {
        assert_eq!(safe_component("Tower 1.5 Podium", 100), "Tower 1.5 Podium");
        assert_eq!(safe_component("مشروع البرج", 100), "مشروع البرج");
        assert_eq!(safe_component("console", 100), "console");
        assert_eq!(safe_component("COM10", 100), "COM10");
    }

    #[test]
    fn artifact_paths_accept_only_the_master_and_the_packages_folder() {
        let root = Path::new("C:/out/Rev 01");
        assert!(safe_artifact_path(root, "Master.xlsx").is_ok());
        assert!(safe_artifact_path(root, "Packages/WP-01.xlsx").is_ok());
        assert!(safe_artifact_path(root, r"Packages\WP-01.xlsx").is_ok());
    }

    #[test]
    fn artifact_paths_reject_traversal_depth_and_wrong_extensions() {
        let root = Path::new("C:/out/Rev 01");
        for relative in [
            "../escape.xlsx",
            "Packages/../../escape.xlsx",
            "Other/WP-01.xlsx",
            "a/b/c.xlsx",
            "Packages/WP-01.exe",
            "Master.xlsx.exe",
            "Packages/CON.xlsx",
        ] {
            assert!(safe_artifact_path(root, relative).is_err(), "{relative}");
        }
    }
}
