//! Everything a 1.13–1.14.x client checks before it installs an update
//! (`AppRelease.verifyArchive`, `UpdateInstallation.extract` and `verifyBundle`), run against a
//! candidate ZIP before anything is signed or published.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail};

use super::manifest::{self, AppRelease};
use super::{archive, zip};
use crate::bundle::{self, LegacyBundle};
use crate::consts::{APP_DIR_NAME, BUNDLE_ID, EXECUTABLE_PATH, HELPER_PATH, legacy_zip_name};
use crate::macos::codesign;
use crate::process::Cmd;
use crate::tree::{self, FileFacts};
use crate::{checksum, fsx, log};

#[derive(Debug, Clone, Copy)]
pub struct PreflightOptions {
    /// Extract with `/usr/bin/ditto -x -k` as the client does; otherwise the portable extractor.
    pub use_ditto: bool,
    /// Run `codesign --verify --deep --strict` on the extracted bundle.
    pub codesign: bool,
}

impl PreflightOptions {
    /// Full checks on macOS; layout and metadata only elsewhere.
    pub fn host() -> Self {
        let macos = cfg!(target_os = "macos");
        Self { use_ditto: macos, codesign: macos }
    }
}

#[derive(Debug, Clone)]
pub struct Preflight {
    pub bundle: LegacyBundle,
    pub size: u64,
    pub sha256: String,
    pub entries: usize,
    pub inventory: BTreeMap<String, FileFacts>,
}

/// Runs the client's archive, extraction and bundle checks. With `source_app`, the extracted
/// bundle must also be byte-identical to it.
pub fn preflight_zip(
    zip_path: &Path,
    source_app: Option<&Path>,
    options: PreflightOptions,
) -> Result<Preflight> {
    let data =
        fs::read(zip_path).with_context(|| format!("could not read {}", zip_path.display()))?;
    let size = data.len() as u64;
    if size == 0 || size > manifest::MAX_SIZE as u64 {
        bail!("{} is {size} bytes; the 1.x client accepts 1 byte to 200 MiB", zip_path.display());
    }
    let entries = archive::validate(&data)?;
    log::ok(format!("ZIP layout passes the 1.x client rules ({} entries)", entries.len()));

    let temporary = tempfile::Builder::new().prefix("att-legacy-preflight-").tempdir()?;
    let staging = temporary.path().join("install");
    let app = if options.use_ditto {
        fs::create_dir(&staging)?;
        fsx::set_mode(&staging, 0o700)?;
        Cmd::new("/usr/bin/ditto").args(["-x", "-k"]).arg(zip_path).arg(&staging).output()?;
        staging.join(APP_DIR_NAME)
    } else {
        zip::extract(&data, &entries, &staging)?
    };
    // The client walks the whole extraction folder and refuses any symbolic link.
    tree::ensure_plain_tree(&staging)?;
    let top: Vec<_> = fs::read_dir(&staging)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name())
        .collect();
    if top.len() != 1 || top[0] != APP_DIR_NAME {
        bail!("the ZIP must contain exactly one top-level {APP_DIR_NAME:?}, found {top:?}");
    }

    let info = bundle::read_info_plist(&app)?;
    let legacy = bundle::legacy_bundle(&info).map_err(anyhow::Error::msg)?;
    let expected_name = legacy_zip_name(&legacy.version);
    if fsx::file_name(zip_path)? != expected_name {
        bail!("the archive must be named {expected_name}: the 1.x client only downloads that URL");
    }
    for relative in [EXECUTABLE_PATH, HELPER_PATH] {
        let path = app.join(relative);
        let meta =
            fs::metadata(&path).ok().filter(|meta| meta.is_file() && fsx::is_executable(meta));
        if meta.is_none() {
            bail!(
                "The update is missing its application or installer helper ({relative} must be an executable file)."
            );
        }
    }
    log::ok(format!(
        "bundle {BUNDLE_ID} {} (build {}), minimum macOS {}, executable and helper present",
        legacy.version, legacy.build, legacy.minimum_macos
    ));
    if options.codesign {
        codesign::verify_deep_strict(&app)?;
        log::ok("codesign --verify --deep --strict passes on the extracted bundle");
    }
    let inventory = tree::inventory(&app)?;
    if inventory != zip::inventory(&data, &entries)? {
        bail!("the extracted files differ from the archive entries");
    }
    if let Some(source) = source_app {
        let expected = tree::inventory(source)?;
        let problems = tree::differences("the signed app", &expected, "the ZIP", &inventory);
        if !problems.is_empty() {
            bail!("the ZIP does not reproduce the app byte for byte:\n  {}", problems.join("\n  "));
        }
        log::ok("the extracted bundle is byte-identical to the signed app");
    }
    Ok(Preflight {
        bundle: legacy,
        size,
        sha256: checksum::sha256_bytes(&data),
        entries: entries.len(),
        inventory,
    })
}

/// The release a manifest for this ZIP will describe; validated with the client's rules.
pub fn expected_release(
    preflight: &Preflight,
    notes: &str,
    published_at: &str,
) -> Result<AppRelease> {
    manifest::check_notes(notes).map_err(anyhow::Error::msg)?;
    let release = AppRelease {
        version: preflight.bundle.version.clone(),
        build: preflight.bundle.build,
        minimum_macos: preflight.bundle.minimum_macos.clone(),
        published_at: published_at.to_owned(),
        notes: notes.to_owned(),
        url: manifest::legacy_asset_url(&preflight.bundle.version),
        sha256: preflight.sha256.clone(),
        size: preflight.size as i64,
        bundle_id: BUNDLE_ID.to_owned(),
    };
    manifest::validate_release(&release).map_err(anyhow::Error::msg)?;
    Ok(release)
}

/// A signed manifest for `zip_path`: signature with `public_key`, client validation, archive
/// size and digest, and the bundle inside matching version, build and minimum macOS.
pub fn check_signed_manifest(
    manifest_path: &Path,
    zip_path: &Path,
    public_key: &[u8; 32],
    preflight: &Preflight,
) -> Result<AppRelease> {
    let json = fs::read(manifest_path)
        .with_context(|| format!("could not read {}", manifest_path.display()))?;
    let envelope = manifest::parse_envelope(&json).map_err(anyhow::Error::msg)?;
    let release = manifest::verify_envelope(&envelope, public_key).map_err(anyhow::Error::msg)?;
    let data = fs::read(zip_path)?;
    if release.size != data.len() as i64 || release.sha256 != checksum::sha256_bytes(&data) {
        bail!(
            "The update download failed its checksum check (manifest size/sha256 do not match {}).",
            zip_path.display()
        );
    }
    let bundle = &preflight.bundle;
    if bundle.version != release.version
        || bundle.build != release.build
        || bundle.minimum_macos != release.minimum_macos
    {
        bail!("The downloaded app version does not match its signed release manifest.");
    }
    Ok(release)
}
