//! columns.json — same format as the Electron version, stored separately
//! (in this app's own config dir) so the two versions never fight over it.
//! On first run the Electron version's file is copied in, so both show the
//! same columns for a fair comparison.

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager};

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("columns.json"))
}

/// Electron's userData for package name "xdeck": %APPDATA%\xdeck.
fn electron_config_path() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("xdeck").join("columns.json"))
}

fn read_array(path: &PathBuf) -> Option<Vec<Value>> {
    let text = fs::read_to_string(path).ok()?;
    match serde_json::from_str(&text).ok()? {
        Value::Array(items) => Some(items),
        _ => None,
    }
}

pub fn load(app: &AppHandle) -> Result<Vec<Value>, String> {
    let path = config_path(app)?;
    if let Some(columns) = read_array(&path) {
        return Ok(columns);
    }
    Ok(electron_config_path().and_then(|p| read_array(&p)).unwrap_or_default())
}

pub fn save(app: &AppHandle, columns: &[Value]) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(columns).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}
