use std::io::Write;
use std::path::Path;

pub fn atomic_write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path.parent().ok_or("text_store_parent_missing")?;
    std::fs::create_dir_all(parent).map_err(|error| format!("create parent: {error}"))?;

    let temporary_path = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().unwrap().to_string_lossy(),
        std::process::id()
    ));
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|error| format!("serialize json: {error}"))?;
    let write_result = (|| {
        let mut file = open_private_temporary_file(&temporary_path)?;
        file.write_all(&bytes)
            .and_then(|_| file.write_all(b"\n"))
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("write temporary json: {error}"))?;
        drop(file);

        crate::store::replace_file(&temporary_path, path)
            .map_err(|error| format!("replace json: {error}"))
    })();

    if let Err(error) = write_result {
        return Err(remove_failed_temporary_file(&temporary_path, error));
    }

    verify_owner_only_file(path)
}

#[cfg(unix)]
fn open_private_temporary_file(path: &Path) -> Result<std::fs::File, String> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| format!("create temporary json: {error}"))?;
    file.set_permissions(std::fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("restrict temporary json: {error}"))?;
    Ok(file)
}

#[cfg(not(unix))]
fn open_private_temporary_file(path: &Path) -> Result<std::fs::File, String> {
    std::fs::File::create(path).map_err(|error| format!("create temporary json: {error}"))
}

fn remove_failed_temporary_file(path: &Path, error: String) -> String {
    match std::fs::remove_file(path) {
        Ok(()) => error,
        Err(cleanup_error) if cleanup_error.kind() == std::io::ErrorKind::NotFound => error,
        Err(cleanup_error) => format!("{error}; cleanup temporary json: {cleanup_error}"),
    }
}

#[cfg(unix)]
fn verify_owner_only_file(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let verification = std::fs::metadata(path)
        .map(|metadata| metadata.permissions().mode() & 0o777)
        .map_err(|error| format!("verify json permissions: {error}"))
        .and_then(|mode| {
            if mode == 0o600 {
                Ok(())
            } else {
                Err(format!(
                    "verify json permissions: expected 0600, found {mode:04o}"
                ))
            }
        });
    let Err(error) = verification else {
        return Ok(());
    };
    match std::fs::remove_file(path) {
        Ok(()) => Err(error),
        Err(cleanup_error) => Err(format!("{error}; cleanup unsafe json: {cleanup_error}")),
    }
}

#[cfg(not(unix))]
fn verify_owner_only_file(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub fn append_jsonl<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("open jsonl: {error}"))?;
    serde_json::to_writer(&mut file, value).map_err(|error| format!("serialize jsonl: {error}"))?;
    file.write_all(b"\n")
        .and_then(|_| file.sync_data())
        .map_err(|error| format!("append jsonl: {error}"))
}

#[cfg(all(test, unix))]
mod tests {
    use super::{atomic_write_json, open_private_temporary_file};
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn temporary_and_final_json_files_are_owner_only() {
        let root = tempfile::tempdir().unwrap();
        let temporary_path = root.path().join("probe.tmp");

        let file = open_private_temporary_file(&temporary_path).unwrap();
        let metadata = file.metadata().unwrap();
        assert_eq!(metadata.len(), 0);
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
        drop(file);
        std::fs::remove_file(temporary_path).unwrap();

        let path = root.path().join("settings.json");
        atomic_write_json(&path, &serde_json::json!({ "secret": "value" })).unwrap();
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
