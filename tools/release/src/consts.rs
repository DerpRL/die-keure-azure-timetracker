//! Names, identities and URLs that every release artifact must agree on.
//!
//! The bundle identity matches 1.14.x on purpose: the bridge release has to pass the 1.13–1.14.x
//! client validator. 2.x is signed with the Developer ID of team [`DEVELOPER_ID_TEAM`] and
//! notarized; 2.x installers, update assets and the v2 feed are GitHub Release assets, while the
//! 1.x bridge stays in the repository because 1.x clients only read `raw.githubusercontent.com`.

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
pub const GITHUB_BASE: &str = "https://github.com/DerpRL/die-keure-azure-timetracker";
pub const RAW_BASE: &str =
    "https://raw.githubusercontent.com/DerpRL/die-keure-azure-timetracker/main";
/// The 2.x Tauri updater endpoint (`plugins.updater.endpoints` in tauri.conf.json): the
/// `latest.json` asset of the newest published (non-draft, non-prerelease) GitHub Release.
pub const V2_FEED_URL: &str =
    "https://github.com/DerpRL/die-keure-azure-timetracker/releases/latest/download/latest.json";

/// Apple Developer team whose "Developer ID Application" certificate signs 2.x releases.
pub const DEVELOPER_ID_TEAM: &str = "4M2RD85AL6";
/// App Store Connect API key used by `notarytool` (public identifiers; the `.p8` is the secret).
pub const NOTARY_KEY_ID: &str = "4U3DC628X5";
pub const NOTARY_ISSUER: &str = "c2b73d0c-5160-413a-b4c8-9d679881bc11";

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

/// Git tag (and GitHub Release) of a version.
pub fn release_tag(version: &str) -> String {
    format!("v{version}")
}

/// Permanent download URL of a 2.x release asset on GitHub Releases.
pub fn asset_url(version: &str, file_name: &str) -> String {
    format!("{GITHUB_BASE}/releases/download/{}/{file_name}", release_tag(version))
}

/// Where 1.13–1.14.x clients download an update ZIP (`UpdateTrust.assetURL`); the repository
/// folder is immutable once published.
pub fn legacy_asset_url(version: &str) -> String {
    format!("{RAW_BASE}/releases/updates/{version}/{}", legacy_zip_name(version))
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
    format!("azure-timetracker-{version}-x64.exe")
}

/// Universal disk image. The signing status is stated in its installation note, not its name.
pub fn dmg_name(version: &str) -> String {
    format!("azure-timetracker-{version}.dmg")
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

/// The App Store Connect API key for notarization: `APPLE_API_KEY_PATH`, else
/// `~/.appstoreconnect/private_keys/AuthKey_<id>.p8` (where Apple's tools look for it).
pub fn default_notary_key_path(key_id: &str) -> Result<PathBuf> {
    let home = dirs::home_dir().context("could not determine the home folder")?;
    Ok(home.join(format!(".appstoreconnect/private_keys/AuthKey_{key_id}.p8")))
}

/// Public selector (SHA-1) of the persistent local signing identity, written by
/// `scripts/setup-local-signing.sh`.
pub fn local_identity_selector_path() -> Result<PathBuf> {
    Ok(releases_home()?.join("local-signing/identity.txt"))
}
