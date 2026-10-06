//! `stage <version> --from <dir>`: copies a verified release into the repository, mirroring
//! `scripts/stage-release.py`. Everything is checked before the first file moves:
//!
//! - `releases/latest/*` of older versions moves to `releases/archive/<version>/`;
//! - installers (DMG, NSIS setup) go to `releases/latest/`;
//! - update assets go to `releases/updates/<version>/`, which is immutable once published;
//! - the feed goes to `updates/v2/latest.json`, and only with `--bridge` the signed 1.x manifest
//!   goes to `updates/latest.json`.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use crate::bundle::AppVersion;
use crate::consts::{
    REPO_ARCHIVE_DIR, REPO_LATEST_DIR, REPO_LEGACY_FEED, REPO_UPDATES_DIR, REPO_V2_FEED,
    legacy_zip_name,
};
use crate::legacy::manifest;
use crate::verify::{self, Artifacts, VerifyOptions};
use crate::{checksum, feed, fsx, log};

#[derive(Debug, Clone)]
pub struct StageOptions {
    pub version: String,
    pub from: PathBuf,
    pub repository: PathBuf,
    pub bridge: bool,
    pub verify: VerifyOptions,
}

#[derive(Debug, Clone, Default)]
pub struct StageReport {
    pub archived: Vec<PathBuf>,
    pub copied: Vec<PathBuf>,
    pub unchanged: Vec<PathBuf>,
}

/// `Azure-timetracker-<version>-<kind>` names allowed in `releases/latest/`.
pub fn latest_file_version(name: &str) -> Option<AppVersion> {
    let (version, suffix) = name.strip_prefix("Azure-timetracker-")?.split_once('-')?;
    let version = AppVersion::parse(version).ok()?;
    let base = suffix.strip_suffix(".sha256").unwrap_or(suffix);
    let installer = base == "x64-setup.exe"
        || base
            .strip_prefix("universal-")
            .and_then(|label| label.strip_suffix(".dmg").or_else(|| label.strip_suffix(".pkg")))
            .is_some_and(|label| {
                !label.is_empty() && label.chars().all(|c| c.is_ascii_lowercase() || c == '-')
            });
    installer.then_some(version)
}

enum Write {
    Copy { source: PathBuf, target: PathBuf },
    Move { source: PathBuf, target: PathBuf },
    Remove { path: PathBuf },
}

/// Plans a copy; identical existing bytes are a no-op, different bytes are refused when the
/// target is immutable.
fn plan_copy(
    source: &Path,
    target: &Path,
    immutable: bool,
    plan: &mut Vec<Write>,
    report: &mut StageReport,
) -> Result<()> {
    if target.exists() {
        if fsx::same_bytes(source, target)? {
            report.unchanged.push(target.to_owned());
            return Ok(());
        }
        if immutable {
            bail!(
                "{} is already published with different bytes. Published update assets are immutable; increment the version.",
                target.display()
            );
        }
    }
    plan.push(Write::Copy { source: source.to_owned(), target: target.to_owned() });
    Ok(())
}

fn with_sides(path: &Path, sides: &[&str]) -> Vec<PathBuf> {
    let mut files = vec![path.to_owned()];
    files.extend(sides.iter().map(|suffix| fsx::with_suffix(path, suffix)));
    files
}

pub fn stage(options: &StageOptions) -> Result<StageReport> {
    let version = AppVersion::parse(&options.version).map_err(anyhow::Error::msg)?;
    let mut verify_options = options.verify.clone();
    verify_options.expected_version = Some(options.version.clone());
    let artifacts: Artifacts = verify::verify_dir(&options.from, &verify_options)?;

    log::step("Planning the repository changes");
    let feed_path = artifacts
        .v2_feed
        .as_ref()
        .context("the artifact folder has no latest.json; run `att-release feed` first")?;
    let has_legacy = artifacts.legacy_zip.is_some() || artifacts.legacy_feed.is_some();
    if options.bridge {
        if artifacts.legacy_zip.is_none() || artifacts.legacy_feed.is_none() {
            bail!(
                "--bridge needs {} and its signed legacy-latest.json",
                legacy_zip_name(&options.version)
            );
        }
    } else if has_legacy {
        bail!(
            "legacy bridge artifacts are present; pass --bridge to publish them through updates/latest.json, or remove them"
        );
    }
    let parsed_feed = feed::parse(&fs::read_to_string(feed_path)?)?;
    let has_mac =
        feed::MAC_TARGETS.iter().any(|target| parsed_feed.platforms.contains_key(*target));
    if has_mac && artifacts.dmg.is_none() {
        bail!("the feed offers macOS but there is no DMG to publish as the manual installer");
    }

    let root = &options.repository;
    let latest = root.join(REPO_LATEST_DIR);
    let updates = root.join(REPO_UPDATES_DIR).join(&options.version);
    let mut plan = Vec::new();
    let mut report = StageReport::default();

    // Update assets: immutable, permanent URLs.
    let mut update_files = Vec::new();
    if let Some(path) = &artifacts.mac_archive {
        update_files.extend(with_sides(path, &[".sig", ".sha256"]));
    }
    if let Some(path) = &artifacts.windows_installer {
        update_files.extend(with_sides(path, &[".sig", ".sha256"]));
    }
    if options.bridge
        && let Some(path) = &artifacts.legacy_zip
    {
        update_files.extend(with_sides(path, &[".sha256"]));
    }
    for file in &update_files {
        if !file.is_file() {
            bail!("{} is missing", file.display());
        }
        plan_copy(file, &updates.join(fsx::file_name(file)?), true, &mut plan, &mut report)?;
    }

    // Installers for manual download.
    let mut installers = Vec::new();
    for path in [&artifacts.dmg, &artifacts.windows_installer].into_iter().flatten() {
        installers.extend(with_sides(path, &[".sha256"]));
    }
    let incoming: Vec<String> =
        installers.iter().map(|path| fsx::file_name(path)).collect::<Result<_>>()?;
    if latest.exists() {
        let mut existing: Vec<_> = fs::read_dir(&latest)?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .collect();
        existing.sort();
        for previous in existing {
            let name = fsx::file_name(&previous)?;
            let Some(previous_version) = latest_file_version(&name) else {
                bail!("Unexpected file in releases/latest: {name}");
            };
            if previous_version == version {
                let same = incoming.contains(&name)
                    && fsx::same_bytes(&options.from.join(&name), &previous)?;
                if !same {
                    bail!(
                        "{name}: this version is already staged with different bytes. Increment the version first."
                    );
                }
                continue;
            }
            if previous_version > version {
                bail!("Refusing to replace the newer release {previous_version} with {version}.");
            }
            let archived =
                root.join(REPO_ARCHIVE_DIR).join(previous_version.to_string()).join(&name);
            if archived.exists() {
                if !fsx::same_bytes(&archived, &previous)? {
                    bail!("Archive collision: {}", archived.display());
                }
                plan.push(Write::Remove { path: previous.clone() });
            } else {
                plan.push(Write::Move { source: previous.clone(), target: archived.clone() });
            }
            report.archived.push(archived);
        }
    }
    for file in &installers {
        plan_copy(file, &latest.join(fsx::file_name(file)?), false, &mut plan, &mut report)?;
    }

    // Feeds.
    let v2_target = root.join(REPO_V2_FEED);
    if v2_target.exists() {
        let published = feed::parse(&fs::read_to_string(&v2_target)?)?;
        let published_version =
            AppVersion::parse(&published.version).map_err(anyhow::Error::msg)?;
        if published_version > version {
            bail!("updates/v2/latest.json already offers the newer {published_version}");
        }
        if published_version == version && !fsx::same_bytes(feed_path, &v2_target)? {
            bail!(
                "updates/v2/latest.json already offers {version} with different content; increment the version"
            );
        }
    }
    plan_copy(feed_path, &v2_target, false, &mut plan, &mut report)?;
    if options.bridge
        && let Some(legacy_feed) = &artifacts.legacy_feed
    {
        let legacy_target = root.join(REPO_LEGACY_FEED);
        let incoming =
            manifest::parse_envelope(&fs::read(legacy_feed)?).map_err(anyhow::Error::msg)?;
        if legacy_target.exists() && !fsx::same_bytes(legacy_feed, &legacy_target)? {
            let published =
                manifest::parse_envelope(&fs::read(&legacy_target)?).map_err(anyhow::Error::msg)?;
            let newer = manifest::is_newer(
                &incoming.release,
                &published.release.version,
                published.release.build,
            )
            .map_err(anyhow::Error::msg)?;
            if !newer {
                bail!(
                    "updates/latest.json offers {} (build {}); the bridge must be newer",
                    published.release.version,
                    published.release.build
                );
            }
            if AppVersion::parse(&published.release.version).is_ok_and(|v| v.0[0] >= 2) {
                log::warn(format!(
                    "the legacy feed already carries the {} bridge; replacing it (only for 1.x clients that have not updated yet)",
                    published.release.version
                ));
            }
        }
        plan_copy(legacy_feed, &legacy_target, false, &mut plan, &mut report)?;
    }

    log::step(format!("Writing {} change(s) into {}", plan.len(), root.display()));
    for write in plan {
        match write {
            Write::Move { source, target } => {
                log::info(format!("archive {} -> {}", source.display(), target.display()));
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::rename(&source, &target)
                    .with_context(|| format!("could not move {}", source.display()))?;
            }
            Write::Remove { path } => {
                log::info(format!("already archived, removing {}", path.display()));
                fs::remove_file(&path)?;
            }
            Write::Copy { source, target } => {
                log::info(format!("copy {} -> {}", source.display(), target.display()));
                let data = fs::read(&source)?;
                fsx::write_atomic(&target, &data)?;
                report.copied.push(target);
            }
        }
    }
    // Re-check what landed in the repository.
    for path in &report.copied {
        if path.extension().is_some_and(|ext| ext == "sha256") {
            let artifact = path.with_extension("");
            if artifact.exists() {
                checksum::verify_side_file(&artifact)?;
            }
        }
    }
    log::step(format!(
        "Staged {}: {} copied, {} unchanged, {} archived. Review, commit everything together, then push.",
        options.version,
        report.copied.len(),
        report.unchanged.len(),
        report.archived.len()
    ));
    Ok(report)
}
