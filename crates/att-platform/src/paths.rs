//! Data locations.
//!
//! - macOS: `~/Library/Application Support/be.yarne.azure-timetracker/`
//! - Windows: `%APPDATA%\be.yarne.azure-timetracker\`
//!
//! The 1.14.x data lives in `~/Library/Application Support/Azure timetracker/` and is only read
//! by the importer. `AZURE_TIME_DATA_DIR` overrides the location for previews and tests.

use std::path::PathBuf;

pub const APP_DIR: &str = "be.yarne.azure-timetracker";
pub const LEGACY_DIR: &str = "Azure timetracker";

pub fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("AZURE_TIME_DATA_DIR") {
        return PathBuf::from(dir);
    }
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join(APP_DIR)
}

pub fn cache_dir() -> PathBuf {
    dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join(APP_DIR)
}

/// The 1.14.x Application Support folder, when it exists (macOS only).
pub fn legacy_data_dir() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let dir = dirs::data_dir()?.join(LEGACY_DIR);
    dir.is_dir().then_some(dir)
}
