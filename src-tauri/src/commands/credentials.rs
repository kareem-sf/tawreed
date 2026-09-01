// API key / credential management for every supported AI provider.
use crate::store;

#[tauri::command]
pub fn set_api_key(key: String) -> Result<bool, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Empty API key".into());
    }
    store::write_env_key(Some(trimmed))?;
    store::log_line("api key updated via settings");
    Ok(true)
}

#[tauri::command]
pub fn delete_api_key() -> Result<bool, String> {
    store::write_env_key(None)?;
    store::log_line("api key removed");
    Ok(true)
}

#[tauri::command]
pub fn set_compatible_api_key(key: String) -> Result<bool, String> {
    store::write_compatible_api_key(Some(key.trim()))?;
    store::log_line("compatible provider key updated");
    Ok(true)
}

#[tauri::command]
pub fn delete_compatible_api_key() -> Result<bool, String> {
    store::write_compatible_api_key(None)?;
    store::log_line("compatible provider key removed");
    Ok(true)
}

#[tauri::command]
pub fn set_gemini_api_key(key: String) -> Result<bool, String> {
    store::write_gemini_api_key(Some(key.trim()))?;
    store::log_line("gemini key updated");
    Ok(true)
}

#[tauri::command]
pub fn delete_gemini_api_key() -> Result<bool, String> {
    store::write_gemini_api_key(None)?;
    store::log_line("gemini key removed");
    Ok(true)
}

#[tauri::command]
pub fn set_grok_api_key(key: String) -> Result<bool, String> {
    store::write_grok_api_key(Some(key.trim()))?;
    store::log_line("grok key updated");
    Ok(true)
}

#[tauri::command]
pub fn delete_grok_api_key() -> Result<bool, String> {
    store::write_grok_api_key(None)?;
    store::log_line("grok key removed");
    Ok(true)
}
