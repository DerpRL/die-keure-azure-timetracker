//! `bridge-dry-run`: the bridge exit test from the rewrite plan. 1.x clients only read the
//! production feed, so instead of publishing, this replays what their helper does — with the
//! unmodified Swift client code from `Sources/AzureTimetrackerCore` — on a 1.13–1.14.x
//! installation (a copy, or a test Mac). Afterwards, open the app and check that Keychain,
//! Calendar and Accessibility access continue without prompts.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use anyhow::{Context, Result, bail};

use super::preflight::{self, PreflightOptions};
use crate::bundle::{self, AppVersion};
use crate::process::Cmd;
use crate::{fsx, log};

/// The Swift driver, compiled together with the 1.14.x core sources.
pub const DRIVER: &str = include_str!("../../assets/BridgeDryRun.swift");

fn modified(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|meta| meta.modified()).ok()
}

/// Compiles the driver into `work` unless an up-to-date build is there.
pub fn build_driver(repository: &Path, work: &Path) -> Result<PathBuf> {
    let core = repository.join("Sources/AzureTimetrackerCore");
    let mut sources: Vec<PathBuf> = fs::read_dir(&core)
        .with_context(|| format!("{} not found", core.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "swift"))
        .collect();
    sources.sort();
    if sources.is_empty() {
        bail!("no Swift sources in {}", core.display());
    }
    fs::create_dir_all(work)?;
    let driver = work.join("BridgeDryRun.swift");
    let binary = work.join("BridgeDryRun");
    let newest_source = sources.iter().filter_map(|path| modified(path)).max();
    let fresh = fs::read_to_string(&driver).is_ok_and(|text| text == DRIVER)
        && modified(&binary).zip(newest_source).is_some_and(|(built, source)| built >= source);
    if fresh {
        log::info(format!("reusing {}", binary.display()));
        return Ok(binary);
    }
    fs::write(&driver, DRIVER)?;
    Cmd::new("swiftc")
        .args(["-parse-as-library", "-O", "-module-name", "BridgeDryRun"])
        .args(&sources)
        .arg(&driver)
        .arg("-o")
        .arg(&binary)
        .env("CLANG_MODULE_CACHE_PATH", work.join("module-cache"))
        .run()?;
    Ok(binary)
}

/// Installs the bridge ZIP over `installed` the way a 1.13–1.14.x client would.
pub fn dry_run(
    repository: &Path,
    zip: &Path,
    app: &Path,
    installed: &Path,
    work: &Path,
) -> Result<()> {
    let info = bundle::read_info_plist(installed)?;
    let current = bundle::legacy_bundle(&info).map_err(anyhow::Error::msg)?;
    let version = AppVersion::parse(&current.version).map_err(anyhow::Error::msg)?;
    if version < AppVersion([1, 13, 0]) || version >= AppVersion([2, 0, 0]) {
        bail!(
            "{} is {}; the dry run needs an installed 1.13–1.14.x app",
            installed.display(),
            current.version
        );
    }
    fsx::refuse_inside_repository(installed, Some(repository), "The installation to replace")?;
    log::step("Preflight of the ZIP (Rust port of the client checks)");
    preflight::preflight_zip(zip, Some(app), PreflightOptions::host())?;
    log::step("Compiling the 1.14.x client code with the dry-run driver");
    let driver = build_driver(repository, work)?;
    log::step(format!(
        "Replacing {} ({}) like the 1.x helper does",
        installed.display(),
        current.version
    ));
    let staging = tempfile::Builder::new().prefix("att-bridge-dry-run-").tempdir()?;
    Cmd::new(&driver).arg(zip).arg(app).arg(installed).arg(staging.path()).run()?;
    log::step(
        "Done. Open the app now: Keychain items, Calendar and Accessibility should work without new prompts.",
    );
    log::info("The previous app stays beside it as .AzureTimetracker-previous-*.app for recovery.");
    Ok(())
}
