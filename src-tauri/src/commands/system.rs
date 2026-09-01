// Bootstrap, input file reading, folder/URL opening, logging, and settings get/set.
use crate::store;
use base64::Engine;
use serde_json::{json, Value};

#[tauri::command]
pub fn bootstrap() -> Result<store::BootstrapInfo, String> {
    store::bootstrap_data_dir()
}

#[tauri::command]
pub fn read_input_file(path: String) -> Result<Value, String> {
    let path = std::path::Path::new(&path);
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_lowercase)
        .ok_or("The input file has no extension")?;
    if !matches!(extension.as_str(), "xlsx" | "xls" | "csv" | "ods" | "pdf") {
        return Err("Only .xlsx, .xls, .csv, .ods, and .pdf inputs are supported".into());
    }
    let metadata = std::fs::metadata(path).map_err(|e| format!("read workbook metadata: {e}"))?;
    if !metadata.is_file() {
        return Err("The dropped path is not a file".into());
    }
    if metadata.len() > 100 * 1024 * 1024 {
        return Err("The input file is larger than the 100 MB limit".into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("read input file: {e}"))?;
    let valid = match extension.as_str() {
        "pdf" => bytes.starts_with(b"%PDF-"),
        "xlsx" | "ods" => {
            bytes.len() >= 4
                && bytes[0] == 0x50
                && bytes[1] == 0x4b
                && matches!(bytes[2], 0x03 | 0x05 | 0x07)
        }
        "xls" => bytes.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        // Text files have no reliable magic number. Reject empty and obviously
        // binary payloads while retaining UTF-8 and legacy Windows/Arabic encodings.
        "csv" => !bytes.is_empty() && bytes.iter().filter(|byte| **byte == 0).count() < 4,
        _ => false,
    };
    if !valid {
        return Err(format!(
            "The selected .{extension} file has an invalid file signature"
        ));
    }
    Ok(json!({
        "bytes": base64::engine::general_purpose::STANDARD.encode(bytes),
        "name": path.file_name().and_then(|name| name.to_str()).unwrap_or("input").to_string(),
        "mime": match extension.as_str() {
            "pdf" => "application/pdf",
            "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "xls" => "application/vnd.ms-excel",
            "ods" => "application/vnd.oasis.opendocument.spreadsheet",
            "csv" => "text/csv",
            _ => "application/octet-stream",
        },
    }))
}

#[tauri::command]
pub fn open_generated_folder(path: String) -> Result<(), String> {
    let output = std::fs::canonicalize(store::output_dir()?)
        .map_err(|e| format!("resolve output directory: {e}"))?;
    let folder =
        std::fs::canonicalize(path).map_err(|e| format!("resolve generated folder: {e}"))?;
    if !folder.starts_with(output) || !folder.is_dir() {
        return Err("Only generated Tawreed folders can be opened".into());
    }
    #[cfg(target_os = "windows")]
    crate::codex::quiet_command("explorer")
        .arg(&folder)
        .spawn()
        .map_err(|e| format!("open generated folder: {e}"))?;
    #[cfg(target_os = "macos")]
    crate::codex::quiet_command("open")
        .arg(&folder)
        .spawn()
        .map_err(|e| format!("open generated folder: {e}"))?;
    #[cfg(all(unix, not(target_os = "macos")))]
    crate::codex::quiet_command("xdg-open")
        .arg(&folder)
        .spawn()
        .map_err(|e| format!("open generated folder: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_logs_folder() -> Result<(), String> {
    let log_file = store::log_path()?;
    let dir = log_file
        .parent()
        .ok_or("resolve logs directory")?
        .to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| format!("create logs directory: {e}"))?;
    #[cfg(target_os = "windows")]
    crate::codex::quiet_command("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("open logs folder: {e}"))?;
    #[cfg(target_os = "macos")]
    crate::codex::quiet_command("open")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("open logs folder: {e}"))?;
    #[cfg(all(unix, not(target_os = "macos")))]
    crate::codex::quiet_command("xdg-open")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("open logs folder: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_workbook(path: String) -> Result<(), String> {
    let output_dir = std::fs::canonicalize(store::output_dir()?)
        .map_err(|e| format!("resolve output directory: {e}"))?;
    let workbook = std::fs::canonicalize(&path).map_err(|e| format!("resolve workbook: {e}"))?;
    if !workbook.starts_with(&output_dir)
        || workbook
            .extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_lowercase)
            .as_deref()
            != Some("xlsx")
    {
        return Err("Only generated Tawreed workbooks can be opened".into());
    }
    #[cfg(target_os = "windows")]
    crate::codex::quiet_command("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(&workbook)
        .spawn()
        .map_err(|e| format!("open workbook: {e}"))?;
    #[cfg(target_os = "macos")]
    crate::codex::quiet_command("open")
        .arg(&workbook)
        .spawn()
        .map_err(|e| format!("open workbook: {e}"))?;
    #[cfg(all(unix, not(target_os = "macos")))]
    crate::codex::quiet_command("xdg-open")
        .arg(&workbook)
        .spawn()
        .map_err(|e| format!("open workbook: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn app_log(message: String) -> Result<(), String> {
    store::log_line(&message);
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    approved_external_url(&url)?;
    #[cfg(target_os = "windows")]
    crate::codex::quiet_command("explorer")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("open url: {e}"))?;
    #[cfg(target_os = "macos")]
    crate::codex::quiet_command("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("open url: {e}"))?;
    #[cfg(all(unix, not(target_os = "macos")))]
    crate::codex::quiet_command("xdg-open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("open url: {e}"))?;
    Ok(())
}

fn approved_external_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "invalid URL")?;
    let approved_host = matches!(
        parsed.host_str(),
        Some("github.com") | Some("kareemsafwat.com") | Some("www.kareemsafwat.com")
    );
    if parsed.scheme() != "https"
        || !approved_host
        || parsed.username() != ""
        || parsed.password().is_some()
    {
        return Err("only approved HTTPS URLs can be opened".into());
    }
    Ok(())
}

#[tauri::command]
pub fn get_settings() -> Value {
    store::get_settings()
}

#[tauri::command]
pub fn set_setting(key: String, value: Value) -> Result<(), String> {
    store::set_setting(&key, value)
}

#[cfg(test)]
mod external_url_tests {
    use super::approved_external_url;

    #[test]
    fn permits_only_approved_https_hosts_without_credentials() {
        for url in [
            "https://github.com/kareem-sf/tawreed",
            "https://kareemsafwat.com",
            "https://www.kareemsafwat.com/work",
        ] {
            assert!(approved_external_url(url).is_ok());
        }
        for url in [
            "http://github.com/kareem-sf/tawreed",
            "https://github.com.evil.example/kareem-sf/tawreed",
            "https://user:password@github.com/kareem-sf/tawreed",
            "file:///C:/Windows/System32/calc.exe",
        ] {
            assert!(approved_external_url(url).is_err());
        }
    }
}
