//! Names, identities and URLs that every release artifact must agree on.
//!
//! The bundle identity matches 1.14.x on purpose: the bridge release has to pass the 1.13–1.14.x
//! client validator, and Keychain items and Calendar/Accessibility grants are bound to the bundle
//! identifier plus the local signing certificate.

use std::path::PathBuf;

use anyhow::{Context, Result};

pub const BUNDLE_ID: &str = "be.yarne.azure-timetracker";
/// Identifier of the legacy helper stub; 1.14.x signed its real helper with the same identifier.
pub const HELPER_ID: &str = "be.yarne.azure-timetracker.updater";
pub const PRODUCT_NAME: &str = "Azure timetracker";
pub const APP_DIR_NAME: &str = "Azure timetracker.app";
pub const EXECUTABLE_NAME: &str = "AzureTimetracker";
pub const EXECUTABLE_PATH: &str = "Contents/MacOS/AzureTimetracker";
pub const HELPER_PATH: &str = "Contents/Helpers/AzureTimetrackerUpdater";
pub const INFO_PLIST_PATH: &str = "Contents/Info.plist";

/// Entitlement every macOS build must carry (EventKit agenda).
pub const CALENDAR_ENTITLEMENT: &str = "com.apple.security.personal-information.calendars";

pub const REPOSITORY: &str = "DerpRL/die-keure-azure-timetracker";
pub const RAW_BASE: &str =
    "https://raw.githubusercontent.com/DerpRL/die-keure-azure-timetracker/main";
/// The 2.x Tauri updater endpoint (`plugins.updater.endpoints` in tauri.conf.json).
pub const V2_FEED_URL: &str = "https://raw.githubusercontent.com/DerpRL/die-keure-azure-timetracker/main/updates/v2/latest.json";

/// Ed25519 verification key pinned in 1.13–1.14.x (`UpdateTrust.publicKey`). Public data.
pub const LEGACY_PUBLIC_KEY_B64: &str = "hNlaBgWVfvdYQIeZJJPNcXEA//Lao+Ee2PTmEyCWl3Q=";

/// Feed file names inside an artifact folder.
pub const V2_FEED_FILE: &str = "latest.json";
pub const LEGACY_FEED_FILE: &str = "legacy-latest.json";

/// Repository paths (relative to the repository root).
pub const REPO_LATEST_DIR: &str = "releases/latest";
pub const REPO_ARCHIVE_DIR: &str = "releases/archive";
pub const REPO_UPDATES_DIR: &str = "releases/updates";
pub const REPO_V2_FEED: &str = "updates/v2/latest.json";
pub const REPO_LEGACY_FEED: &str = "updates/latest.json";
pub const REPO_TAURI_CONF: &str = "apps/desktop/src-tauri/tauri.conf.json";
pub const REPO_DESKTOP_DIR: &str = "apps/desktop";

/// Permanent download URL of an update asset; the folder is immutable once published.
pub fn asset_url(version: &str, file_name: &str) -> String {
    format!("{RAW_BASE}/releases/updates/{version}/{file_name}")
}

/// Legacy 1.x-format update archive (`UpdateTrust.assetURL`).
pub fn legacy_zip_name(version: &str) -> String {
    format!("Azure-timetracker-{version}-universal-update.zip")
}

/// Tauri updater archive for the universal macOS app.
pub fn mac_archive_name(version: &str) -> String {
    format!("Azure-timetracker-{version}-universal.app.tar.gz")
}

/// NSIS installer, used both for manual installs and as the Windows update asset.
pub fn windows_installer_name(version: &str) -> String {
    format!("Azure-timetracker-{version}-x64-setup.exe")
}

/// Disk image; the label states the signing status, as in 1.x (`local-signed`, `unsigned`, ...).
pub fn dmg_name(version: &str, label: &str) -> String {
    format!("Azure-timetracker-{version}-universal-{label}.dmg")
}

/// `~/Library/Application Support/Azure timetracker Releases`, the folder outside Git that holds
/// the release keys and the local signing selector on the release Mac.
pub fn releases_home() -> Result<PathBuf> {
    let home = dirs::home_dir().context("could not determine the home folder")?;
    Ok(home.join("Library/Application Support/Azure timetracker Releases"))
}

/// Default location of the v2 (Tauri/minisign) updater key created by `keygen-v2`.
pub fn default_v2_key_path() -> Result<PathBuf> {
    Ok(releases_home()?.join("updater-v2.key"))
}

/// Default location of the legacy Ed25519 key. Only its path is ever used: the release owner
/// passes it to the Swift signer. This tool never opens it.
pub fn default_legacy_key_path() -> Result<PathBuf> {
    Ok(releases_home()?.join("update-signing.ed25519"))
}

/// Public selector (SHA-1) of the persistent local signing identity, written by
/// `scripts/setup-local-signing.sh`.
pub fn local_identity_selector_path() -> Result<PathBuf> {
    Ok(releases_home()?.join("local-signing/identity.txt"))
}
