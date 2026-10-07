//! `bridge <app> <out> --notes <file>`: the one-time 2.x release through the 1.x feed.
//!
//! Builds the 1.x-format ZIP, proves with a port of the client checks that 1.13–1.14.x apps will
//! accept it, builds the Swift signer and prints the one command the release owner runs with the
//! real legacy key. This tool never opens that key.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use crate::bundle::{self, AppVersion};
use crate::consts::{LEGACY_FEED_FILE, REPO_LEGACY_FEED, legacy_zip_name};
use crate::legacy::preflight::{self, PreflightOptions};
use crate::legacy::{manifest, swift, zip};
use crate::macos::codesign;
use crate::process::shell_quote;
use crate::{checksum, dates, fsx, log};

#[derive(Debug, Clone)]
pub struct BridgeOptions {
    pub out: PathBuf,
    pub notes: PathBuf,
    pub repository: PathBuf,
    /// Only its path is printed; the file is never opened.
    pub legacy_key_path: PathBuf,
    pub preflight: PreflightOptions,
    pub allow_adhoc: bool,
    /// Build `AzureTimetrackerRelease` with SwiftPM (off in tests).
    pub build_signer: bool,
}

#[derive(Debug, Clone)]
pub struct BridgeOutcome {
    pub zip: PathBuf,
    pub manifest: PathBuf,
    pub signer: PathBuf,
    pub command: String,
}

pub fn bridge(app: &Path, options: &BridgeOptions) -> Result<BridgeOutcome> {
    if cfg!(windows) {
        bail!(
            "Build the bridge release on a Mac: Windows file systems do not keep the execute bits \
             the 1.x update ZIP needs."
        );
    }
    log::step(format!("Checking {}", app.display()));
    let release = bundle::check_release_bundle(app, true)?;
    for warning in bundle::parity_warnings(&release) {
        log::warn(warning);
    }
    if options.preflight.codesign {
        let signature = codesign::check_release_signature(app, options.allow_adhoc)?;
        if signature.adhoc {
            codesign::warn_adhoc("the app has an ad-hoc signature");
        }
        log::ok(format!(
            "{} signature with designated requirement {:?}",
            signature.label(),
            signature.designated_requirement
        ));
    }
    let notes = fs::read_to_string(&options.notes)
        .with_context(|| format!("could not read the release notes {}", options.notes.display()))?;
    manifest::check_notes(&notes).map_err(anyhow::Error::msg)?;

    let published = options.repository.join(REPO_LEGACY_FEED);
    if published.is_file() {
        let envelope =
            manifest::parse_envelope(&fs::read(&published)?).map_err(anyhow::Error::msg)?;
        let current = manifest::verify_envelope(&envelope, &manifest::pinned_public_key())
            .map_err(anyhow::Error::msg)
            .context("the published updates/latest.json does not verify with the pinned 1.x key")?;
        let candidate = manifest::AppRelease {
            version: release.version_text.clone(),
            build: release.build,
            ..current.clone()
        };
        if !manifest::is_newer(&candidate, &current.version, current.build)
            .map_err(anyhow::Error::msg)?
        {
            bail!(
                "the legacy feed already offers {} (build {}); 1.x clients only install a newer version",
                current.version,
                current.build
            );
        }
        if AppVersion::parse(&current.version).is_ok_and(|version| version.0[0] >= 2) {
            log::warn(format!(
                "the legacy feed already carries the {} bridge; this replaces it",
                current.version
            ));
        }
        log::ok(format!(
            "newer than the published legacy release {} (build {})",
            current.version, current.build
        ));
    }

    log::step("Building the 1.x-format update ZIP");
    fs::create_dir_all(&options.out)?;
    let zip_path = options.out.join(legacy_zip_name(&release.version_text));
    let summary = zip::write_update_zip(app, &zip_path)?;
    checksum::write_side_file(&zip_path)?;
    log::ok(format!(
        "{} ({} entries, {} bytes, sha256 {})",
        zip_path.display(),
        summary.entries,
        summary.size,
        summary.sha256
    ));

    log::step("Preflight: the checks a 1.13–1.14.x client applies before installing");
    let result = preflight::preflight_zip(&zip_path, Some(app), options.preflight)?;
    let expected = preflight::expected_release(&result, &notes, &dates::now_utc()?)?;
    log::ok(format!(
        "manifest fields will be valid: version {}, build {}, minimumMacOS {}, size {}, url {}",
        expected.version, expected.build, expected.minimum_macos, expected.size, expected.url
    ));

    let manifest_path = options.out.join(LEGACY_FEED_FILE);
    if manifest_path.is_file() {
        let stale = manifest::parse_envelope(&fs::read(&manifest_path)?)
            .map(|envelope| {
                envelope.release.sha256 != result.sha256
                    || envelope.release.size != result.size as i64
            })
            .unwrap_or(true);
        if stale {
            log::loud(&[
                "legacy-latest.json in the output folder does not describe this ZIP.",
                "Sign again with the command below before verify/stage.",
            ]);
        } else {
            log::ok(
                "the existing legacy-latest.json still matches this ZIP (the ZIP is deterministic)",
            );
        }
    }
    fsx::refuse_inside_repository(
        &options.legacy_key_path,
        Some(&options.repository),
        "The legacy update key",
    )?;
    let signer = if options.build_signer {
        log::step("Building the Swift signer (AzureTimetrackerRelease)");
        swift::build_signer(&options.repository)?
    } else {
        swift::scratch_dir(&options.repository).join("package/release/AzureTimetrackerRelease")
    };
    let command = [
        signer.as_path(),
        app,
        zip_path.as_path(),
        options.legacy_key_path.as_path(),
        options.notes.as_path(),
        manifest_path.as_path(),
    ]
    .iter()
    .map(|path| shell_quote(&path.display().to_string()))
    .collect::<Vec<_>>()
    .join(" ");
    log::step("Next: sign the legacy manifest on the release Mac (this tool does not run it)");
    log::info(
        "Usage: AzureTimetrackerRelease APP ZIP KEY NOTES OUTPUT_JSON. It checks that the key matches the",
    );
    log::info(
        "public key pinned in 1.13-1.14.x, re-verifies the ZIP and the app, then signs the manifest.",
    );
    Ok(BridgeOutcome { zip: zip_path, manifest: manifest_path, signer, command })
}
