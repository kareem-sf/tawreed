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
    let mut file = std::fs::File::create(&temporary_path)
        .map_err(|error| format!("create temporary json: {error}"))?;
    file.write_all(&bytes)
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("write temporary json: {error}"))?;

    crate::store::replace_file(&temporary_path, path)
        .map_err(|error| format!("replace json: {error}"))
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
