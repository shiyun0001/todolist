use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Manager, Runtime};

use crate::models::{AppSnapshot, ExportBundle};

const STATE_FILE_NAME: &str = "app-state.json";

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn state_file_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    dir.push(STATE_FILE_NAME);
    Ok(dir)
}

pub fn load_snapshot<R: Runtime>(app: &AppHandle<R>) -> Result<AppSnapshot, String> {
    let path = state_file_path(app)?;
    if !path.exists() {
        return Ok(AppSnapshot::default());
    }

    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut snapshot: AppSnapshot =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    snapshot.normalize();
    Ok(snapshot)
}

pub fn persist_snapshot<R: Runtime>(app: &AppHandle<R>, snapshot: &AppSnapshot) -> Result<(), String> {
    let path = state_file_path(app)?;
    ensure_parent(&path)?;
    let pretty = serde_json::to_string_pretty(snapshot).map_err(|error| error.to_string())?;
    fs::write(path, pretty).map_err(|error| error.to_string())
}

pub fn write_export_file(path: &Path, bundle: &ExportBundle) -> Result<(), String> {
    ensure_parent(path)?;
    let pretty = serde_json::to_string_pretty(bundle).map_err(|error| error.to_string())?;
    fs::write(path, pretty).map_err(|error| error.to_string())
}

pub fn read_import_file(path: &Path) -> Result<ExportBundle, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| format!("导入文件解析失败: {error}"))
}
