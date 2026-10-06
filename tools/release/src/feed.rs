//! The 2.x updater feed (`updates/v2/latest.json`) in the static format of
//! `tauri-plugin-updater`: `version`, `notes`, `pub_date` and `platforms` with a `signature`
//! (the `.sig` file content) and a `url` per `{os}-{arch}` target.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use crate::bundle::AppVersion;
use crate::consts::{asset_url, mac_archive_name, windows_installer_name};
use crate::{dates, fsx, updater_key};

/// The universal archive serves both macOS targets.
pub const MAC_TARGETS: [&str; 2] = ["darwin-aarch64", "darwin-x86_64"];
pub const WINDOWS_TARGET: &str = "windows-x86_64";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Feed {
    pub version: String,
    pub notes: String,
    pub pub_date: String,
    pub platforms: BTreeMap<String, Platform>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Platform {
    pub signature: String,
    pub url: String,
}

fn read_signature(asset: &Path) -> Result<String> {
    let sig = fsx::with_suffix(asset, ".sig");
    let text =
        fs::read_to_string(&sig).with_context(|| format!("missing signature {}", sig.display()))?;
    Ok(text.trim().to_owned())
}

fn expect_name(asset: &Path, expected: &str) -> Result<()> {
    let name = fsx::file_name(asset)?;
    if name != expected {
        bail!("{} must be named {expected} for this version", asset.display());
    }
    Ok(())
}

/// Builds the feed from the signed assets (each with its `.sig` beside it).
pub fn build(
    version: &str,
    notes: &str,
    pub_date: &str,
    mac_archive: Option<&Path>,
    windows_installer: Option<&Path>,
) -> Result<Feed> {
    AppVersion::parse(version).map_err(anyhow::Error::msg)?;
    if notes.trim().is_empty() {
        bail!("release notes are empty");
    }
    if !dates::is_internet_date_time(pub_date) {
        bail!("pub_date {pub_date:?} must look like 2026-10-06T09:30:00Z");
    }
    let mut platforms = BTreeMap::new();
    if let Some(archive) = mac_archive {
        let name = mac_archive_name(version);
        expect_name(archive, &name)?;
        let platform =
            Platform { signature: read_signature(archive)?, url: asset_url(version, &name) };
        for target in MAC_TARGETS {
            platforms.insert(target.to_owned(), platform.clone());
        }
    }
    if let Some(installer) = windows_installer {
        let name = windows_installer_name(version);
        expect_name(installer, &name)?;
        platforms.insert(
            WINDOWS_TARGET.to_owned(),
            Platform { signature: read_signature(installer)?, url: asset_url(version, &name) },
        );
    }
    if platforms.is_empty() {
        bail!("pass --mac-archive and/or --windows-installer");
    }
    Ok(Feed {
        version: version.to_owned(),
        notes: notes.to_owned(),
        pub_date: pub_date.to_owned(),
        platforms,
    })
}

pub fn to_json(feed: &Feed) -> Result<String> {
    Ok(serde_json::to_string_pretty(feed)? + "\n")
}

pub fn parse(json: &str) -> Result<Feed> {
    serde_json::from_str(json).context("the feed is not in the expected format")
}

/// The asset file name a platform entry points at, if the URL has the expected shape.
pub fn asset_file_name(feed: &Feed, target: &str) -> Option<String> {
    let platform = feed.platforms.get(target)?;
    let expected = match target {
        "darwin-aarch64" | "darwin-x86_64" => mac_archive_name(&feed.version),
        WINDOWS_TARGET => windows_installer_name(&feed.version),
        _ => return None,
    };
    (platform.url == asset_url(&feed.version, &expected)).then_some(expected)
}

/// Checks the feed against the assets in `dir` and the updater public key; returns the asset
/// file names it references.
pub fn check(feed: &Feed, dir: &Path, public_b64: &str) -> Result<Vec<String>> {
    AppVersion::parse(&feed.version).map_err(anyhow::Error::msg)?;
    if !dates::is_internet_date_time(&feed.pub_date) {
        bail!("pub_date {:?} is not an RFC 3339 time", feed.pub_date);
    }
    if feed.notes.trim().is_empty() {
        bail!("the feed has no release notes");
    }
    if feed.platforms.is_empty() {
        bail!("the feed has no platforms");
    }
    let mac: Vec<_> =
        MAC_TARGETS.iter().filter(|target| feed.platforms.contains_key(**target)).collect();
    if mac.len() == 1 {
        bail!(
            "the feed must list both {} and {} (one universal archive)",
            MAC_TARGETS[0],
            MAC_TARGETS[1]
        );
    }
    if mac.len() == 2 && feed.platforms[MAC_TARGETS[0]] != feed.platforms[MAC_TARGETS[1]] {
        bail!("{} and {} must point at the same universal archive", MAC_TARGETS[0], MAC_TARGETS[1]);
    }
    let mut assets = Vec::new();
    for (target, platform) in &feed.platforms {
        let name = asset_file_name(feed, target).with_context(|| {
            format!(
                "{target}: unexpected target or URL {} (expected {})",
                platform.url,
                asset_url(&feed.version, "<asset>")
            )
        })?;
        let path = dir.join(&name);
        let data =
            fs::read(&path).with_context(|| format!("{target}: {} is missing", path.display()))?;
        if read_signature(&path)? != platform.signature {
            bail!("{target}: the feed signature differs from {}.sig", name);
        }
        updater_key::verify(&data, &platform.signature, public_b64, Some(&feed.version))
            .with_context(|| format!("{target}: {name}"))?;
        if !assets.contains(&name) {
            assets.push(name);
        }
    }
    Ok(assets)
}
