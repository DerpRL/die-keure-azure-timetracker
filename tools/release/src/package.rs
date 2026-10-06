//! `sign-macos` and `package-macos`.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Result, bail};

use crate::bundle;
use crate::consts::{EXECUTABLE_PATH, HELPER_PATH, mac_archive_name};
use crate::macos::codesign::{self, Identity, ResolvedIdentity, SignatureInfo};
use crate::macos::{dmg, macho, stub};
use crate::updater_key::{self, UpdaterKey};
use crate::{checksum, fsx, log, tarball};

#[derive(Debug, Clone)]
pub struct SignOptions {
    pub identity: ResolvedIdentity,
    /// A prebuilt helper stub; otherwise it is compiled into `work_dir`.
    pub helper: Option<PathBuf>,
    pub entitlements: Option<PathBuf>,
    pub work_dir: PathBuf,
    pub require_universal: bool,
}

/// Adds the legacy helper stub, signs inner code, the helper and the app, and verifies.
pub fn sign_macos(app: &Path, options: &SignOptions) -> Result<SignatureInfo> {
    log::step(format!("Checking {}", app.display()));
    let release = bundle::check_release_bundle(app, false)?;
    for warning in bundle::parity_warnings(&release) {
        log::warn(warning);
    }
    if options.require_universal {
        macho::require_universal(&app.join(EXECUTABLE_PATH))?;
    }
    log::ok(format!(
        "{} (build {}), minimum macOS {}",
        release.version_text, release.build, release.minimum_macos
    ));

    log::step(format!("Adding the 1.x compatibility helper at {HELPER_PATH}"));
    let stub = match &options.helper {
        Some(path) => path.clone(),
        None => {
            let out = options.work_dir.join("AzureTimetrackerUpdater");
            stub::build_universal(&options.work_dir.join("stub-build"), &out)?;
            out
        }
    };
    if options.require_universal {
        macho::require_universal(&stub)?;
    }
    let target = app.join(HELPER_PATH);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(&stub, &target)?;
    fsx::set_mode(&target, 0o755)?;

    log::step(format!("Signing with {}", options.identity.source));
    if options.identity.identity == Identity::AdHoc {
        codesign::warn_adhoc(&options.identity.source);
    }
    codesign::sign_app(app, &options.identity.identity, options.entitlements.as_deref())?;
    let info = codesign::signature_info(app)?;
    log::ok(format!(
        "codesign --verify --deep --strict passes; {} signature, designated requirement {}",
        info.label(),
        info.designated_requirement.as_deref().unwrap_or("?")
    ));
    Ok(info)
}

#[derive(Debug, Clone)]
pub struct PackageOutput {
    pub dmg: PathBuf,
    pub archive: PathBuf,
    pub signature: PathBuf,
}

pub struct PackageOptions<'a> {
    pub out: PathBuf,
    pub key: &'a UpdaterKey,
    /// `plugins.updater.pubkey` of the shell; signing with any other key is refused.
    pub expected_pubkey: Option<String>,
    pub allow_adhoc: bool,
    pub require_universal: bool,
    /// Identity for signing the disk image (ad-hoc leaves it unsigned, like 1.x).
    pub dmg_identity: Identity,
}

/// DMG + checksum, updater archive + checksum + minisign signature.
pub fn package_macos(app: &Path, options: &PackageOptions<'_>) -> Result<PackageOutput> {
    log::step(format!("Checking {}", app.display()));
    let release = bundle::check_release_bundle(app, true)?;
    if options.require_universal {
        macho::require_universal(&app.join(EXECUTABLE_PATH))?;
        macho::require_universal(&app.join(HELPER_PATH))?;
    }
    let signature = codesign::check_release_signature(app, options.allow_adhoc)?;
    if signature.adhoc {
        codesign::warn_adhoc("the app has an ad-hoc signature");
    }
    let label = signature.label();
    log::ok(format!("{} (build {}), {label} signature", release.version_text, release.build));
    match &options.expected_pubkey {
        Some(expected) if *expected != options.key.public_b64 => bail!(
            "the signing key (id {}) is not the key in tauri.conf.json plugins.updater.pubkey; installed apps would reject this update",
            options.key.key_id()
        ),
        Some(_) => {
            log::ok(format!("signing key {} matches plugins.updater.pubkey", options.key.key_id()))
        }
        None => log::warn("no plugins.updater.pubkey to compare the signing key with"),
    }
    fs::create_dir_all(&options.out)?;
    let version = &release.version_text;

    log::step("Creating the disk image");
    let dmg_identity = if signature.adhoc { &Identity::AdHoc } else { &options.dmg_identity };
    let image =
        dmg::create(app, &options.out, version, label, &release.minimum_macos, dmg_identity)?;
    checksum::write_side_file(&image)?;
    log::ok(image.display());

    log::step("Creating the updater archive");
    let archive = options.out.join(mac_archive_name(version));
    tarball::create(app, &archive)?;
    checksum::write_side_file(&archive)?;
    updater_key::sign_file(options.key, &archive, version)?;
    let signature_path = fsx::with_suffix(&archive, ".sig");
    log::ok(format!("{} and {}", archive.display(), signature_path.display()));
    Ok(PackageOutput { dmg: image, archive, signature: signature_path })
}
