//! `verify <dir>`: checks every artifact of one release without installing or launching anything.
//! `stage` runs the same checks before it writes into the repository.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use crate::bundle::{self, AppVersion};
use crate::consts::{APP_DIR_NAME, EXECUTABLE_PATH, HELPER_PATH, LEGACY_FEED_FILE, V2_FEED_FILE};
use crate::legacy::preflight::{self, Preflight, PreflightOptions};
use crate::legacy::{manifest, swift};
use crate::macos::{codesign, dmg, macho};
use crate::process::Cmd;
use crate::tree::{self, FileFacts};
use crate::{checksum, feed, fsx, log, tarball, updater_key};

#[derive(Debug, Clone)]
pub struct VerifyOptions {
    /// `plugins.updater.pubkey` of the app being released.
    pub pubkey_b64: String,
    /// The 1.x feed key; the pinned production key outside tests.
    pub legacy_public_key: [u8; 32],
    pub allow_adhoc: bool,
    /// Use codesign, hdiutil and ditto (macOS hosts).
    pub macos_tools: bool,
    pub require_universal: bool,
    pub expected_version: Option<String>,
    /// `AzureTimetrackerRelease` for its key-free `verify` mode.
    pub swift_signer: Option<PathBuf>,
    /// An app (or 1.x update ZIP) whose designated requirement the new app must share.
    pub reference: Option<PathBuf>,
}

impl VerifyOptions {
    pub fn new(pubkey_b64: String) -> Self {
        Self {
            pubkey_b64,
            legacy_public_key: manifest::pinned_public_key(),
            allow_adhoc: false,
            macos_tools: cfg!(target_os = "macos"),
            require_universal: true,
            expected_version: None,
            swift_signer: None,
            reference: None,
        }
    }
}

/// The files of one release found in an artifact folder.
#[derive(Debug, Clone, Default)]
pub struct Artifacts {
    pub version: String,
    pub dmg: Option<PathBuf>,
    pub mac_archive: Option<PathBuf>,
    pub windows_installer: Option<PathBuf>,
    pub legacy_zip: Option<PathBuf>,
    pub legacy_feed: Option<PathBuf>,
    pub v2_feed: Option<PathBuf>,
}

impl Artifacts {
    pub fn binaries(&self) -> Vec<&PathBuf> {
        [&self.dmg, &self.mac_archive, &self.windows_installer, &self.legacy_zip]
            .into_iter()
            .flatten()
            .collect()
    }
}

/// Classifies the release files in `dir`; all of them must belong to one version.
pub fn discover(dir: &Path, expected_version: Option<&str>) -> Result<Artifacts> {
    let mut found = Artifacts::default();
    let mut versions = BTreeSet::new();
    let mut dmgs = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(dir)
        .with_context(|| format!("could not list {}", dir.display()))?
        .filter_map(|entry| entry.ok())
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let Ok(name) = entry.file_name().into_string() else { continue };
        if name == V2_FEED_FILE {
            found.v2_feed = Some(path);
            continue;
        }
        if name == LEGACY_FEED_FILE {
            found.legacy_feed = Some(path);
            continue;
        }
        let Some((version, suffix)) =
            name.strip_prefix("Azure-timetracker-").and_then(|rest| rest.split_once('-'))
        else {
            continue;
        };
        if AppVersion::parse(version).is_err() {
            continue;
        }
        match suffix {
            "universal.app.tar.gz" => found.mac_archive = Some(path),
            "x64-setup.exe" => found.windows_installer = Some(path),
            "universal-update.zip" => found.legacy_zip = Some(path),
            other if other.starts_with("universal-") && other.ends_with(".dmg") => dmgs.push(path),
            _ => continue,
        }
        versions.insert(version.to_owned());
    }
    if dmgs.len() > 1 {
        bail!("more than one DMG in {}: {dmgs:?}", dir.display());
    }
    found.dmg = dmgs.pop();
    if let Some(path) = &found.v2_feed {
        versions.insert(feed::parse(&fs::read_to_string(path)?)?.version);
    }
    if let Some(path) = &found.legacy_feed {
        let envelope = manifest::parse_envelope(&fs::read(path)?).map_err(anyhow::Error::msg)?;
        versions.insert(envelope.release.version);
    }
    if let Some(expected) = expected_version {
        versions.insert(expected.to_owned());
    }
    match versions.len() {
        0 => bail!("no release artifacts in {}", dir.display()),
        1 => found.version = versions.into_iter().next().unwrap_or_default(),
        _ => bail!("{} mixes versions {versions:?}", dir.display()),
    }
    Ok(found)
}

#[derive(Default)]
struct Checks {
    failures: Vec<String>,
}

impl Checks {
    fn run<T>(&mut self, what: &str, check: impl FnOnce() -> Result<T>) -> Option<T> {
        match check() {
            Ok(value) => {
                log::ok(what);
                Some(value)
            }
            Err(error) => {
                log::warn(format!("FAILED: {what}: {error:#}"));
                self.failures.push(format!("{what}: {error:#}"));
                None
            }
        }
    }

    fn fail(&mut self, what: String) {
        log::warn(format!("FAILED: {what}"));
        self.failures.push(what);
    }
}

/// Bundle identity, version, architectures and (with macOS tools) the code signature.
fn check_app(app: &Path, version: &str, options: &VerifyOptions) -> Result<String> {
    let release = bundle::check_release_bundle(app, true)?;
    if release.version_text != version {
        bail!("the app is version {}, expected {version}", release.version_text);
    }
    for warning in bundle::parity_warnings(&release) {
        log::warn(warning);
    }
    if options.require_universal {
        macho::require_universal(&app.join(EXECUTABLE_PATH))?;
        macho::require_universal(&app.join(HELPER_PATH))?;
    }
    let mut summary = format!(
        "{} (build {}), minimum macOS {}",
        release.version_text, release.build, release.minimum_macos
    );
    if options.macos_tools {
        let signature = codesign::check_release_signature(app, options.allow_adhoc)?;
        summary.push_str(&format!(
            ", {} signature, hardened runtime, calendar entitlement",
            signature.label()
        ));
    }
    let executable = fs::read(app.join(EXECUTABLE_PATH))?;
    let needle = options.pubkey_b64.as_bytes();
    if needle.is_empty() || !executable.windows(needle.len()).any(|window| window == needle) {
        log::warn(
            "the updater public key was not found verbatim in the app binary; make sure the app was built with this plugins.updater.pubkey",
        );
    }
    Ok(summary)
}

fn designated_requirement(path: &Path) -> Result<String> {
    codesign::signature_info(path)?.designated_requirement.context("no designated requirement")
}

/// The reference app, unpacking a 1.x update ZIP with ditto when needed.
fn reference_requirement(reference: &Path) -> Result<String> {
    if reference.extension().is_some_and(|ext| ext == "zip") {
        let temporary = tempfile::Builder::new().prefix("att-reference-").tempdir()?;
        Cmd::new("/usr/bin/ditto")
            .args(["-x", "-k"])
            .arg(reference)
            .arg(temporary.path())
            .output()?;
        return designated_requirement(&temporary.path().join(APP_DIR_NAME));
    }
    designated_requirement(reference)
}

pub fn verify_dir(dir: &Path, options: &VerifyOptions) -> Result<Artifacts> {
    let artifacts = discover(dir, options.expected_version.as_deref())?;
    let version = artifacts.version.clone();
    log::step(format!("Verifying the {version} artifacts in {}", dir.display()));
    let mut checks = Checks::default();
    let file_label =
        |path: &Path| fsx::file_name(path).unwrap_or_else(|_| path.display().to_string());

    for path in artifacts.binaries() {
        checks.run(&format!("checksum file of {}", file_label(path)), || {
            checksum::verify_side_file(path).map(|_| ())
        });
    }
    for path in [&artifacts.mac_archive, &artifacts.windows_installer].into_iter().flatten() {
        checks.run(
            &format!(
                "updater signature of {} (v2 key, signed version {version})",
                file_label(path)
            ),
            || {
                let signature =
                    fs::read_to_string(fsx::with_suffix(path, ".sig")).context("missing .sig")?;
                updater_key::verify(
                    &fs::read(path)?,
                    signature.trim(),
                    &options.pubkey_b64,
                    Some(&version),
                )
                .map(|_| ())
            },
        );
    }
    match &artifacts.v2_feed {
        Some(path) => {
            checks.run("v2 feed: shape, URLs, version and signatures", || {
                let parsed = feed::parse(&fs::read_to_string(path)?)?;
                let referenced = feed::check(&parsed, dir, &options.pubkey_b64)?;
                for asset in
                    [&artifacts.mac_archive, &artifacts.windows_installer].into_iter().flatten()
                {
                    let name = fsx::file_name(asset)?;
                    if !referenced.contains(&name) {
                        bail!("{name} is not referenced by the feed");
                    }
                }
                Ok(())
            });
        }
        None => log::info(format!(
            "no {V2_FEED_FILE} here; run `att-release feed` once all assets are signed"
        )),
    }
    if let Some(installer) = &artifacts.windows_installer {
        checks.run(
            "the Windows installer is a PE executable (Authenticode-unsigned by design)",
            || {
                let head = fs::read(installer)?;
                if !head.starts_with(b"MZ") {
                    bail!("{} does not start with an MZ header", installer.display());
                }
                Ok(())
            },
        );
    }

    let temporary = tempfile::Builder::new().prefix("att-verify-").tempdir()?;
    let mut inventories: Vec<(String, BTreeMap<String, FileFacts>)> = Vec::new();
    let mut new_app: Option<PathBuf> = None;
    if let Some(archive) = &artifacts.mac_archive {
        let unpacked = checks.run("the updater archive unpacks like the Tauri updater (one app folder, files and folders only)", || {
            tarball::extract(archive, &temporary.path().join("updater"))
        });
        if let Some(app) = unpacked {
            if let Some(summary) =
                checks.run("app in the updater archive", || check_app(&app, &version, options))
            {
                log::info(summary);
            }
            if let Some(inventory) =
                checks.run("inventory of the updater archive", || tree::inventory(&app))
            {
                inventories.push(("the updater archive".to_owned(), inventory));
            }
            new_app = Some(app);
        }
    }
    let mut _mount = None;
    if let Some(image) = &artifacts.dmg {
        if options.macos_tools {
            let mounted = checks.run(
                &format!("hdiutil verify and read-only mount of {}", file_label(image)),
                || {
                    dmg::verify_image(image)?;
                    dmg::attach(image)
                },
            );
            if let Some(mount) = mounted {
                let app = mount.path.join(APP_DIR_NAME);
                checks.run("DMG layout: app, Applications link and installation note", || {
                    let link = fs::read_link(mount.path.join("Applications"))
                        .context("no Applications link")?;
                    if link != Path::new("/Applications") {
                        bail!("Applications points at {}", link.display());
                    }
                    if !mount.path.join(dmg::INSTALL_NOTE).is_file() {
                        bail!("missing {}", dmg::INSTALL_NOTE);
                    }
                    Ok(())
                });
                if let Some(summary) =
                    checks.run("app in the DMG", || check_app(&app, &version, options))
                {
                    log::info(summary);
                }
                if let Some(inventory) =
                    checks.run("inventory of the DMG app", || tree::inventory(&app))
                {
                    inventories.push(("the DMG".to_owned(), inventory));
                }
                new_app.get_or_insert(app);
                _mount = Some(mount);
            }
        } else {
            log::info("DMG contents not checked: needs hdiutil and codesign on macOS");
        }
    }
    let mut legacy: Option<Preflight> = None;
    if let Some(zip) = &artifacts.legacy_zip {
        let options =
            PreflightOptions { use_ditto: options.macos_tools, codesign: options.macos_tools };
        legacy = checks.run("legacy ZIP preflight (1.13–1.14.x client rules)", || {
            preflight::preflight_zip(zip, None, options)
        });
        if let Some(preflight) = &legacy {
            inventories.push(("the legacy ZIP".to_owned(), preflight.inventory.clone()));
        }
    }
    if let Some((first_name, first)) = inventories.first() {
        for (name, inventory) in inventories.iter().skip(1) {
            checks.run(&format!("identical app bytes in {first_name} and {name}"), || {
                let problems = tree::differences(first_name, first, name, inventory);
                if problems.is_empty() { Ok(()) } else { bail!("{}", problems.join("; ")) }
            });
        }
    }
    match (&artifacts.legacy_feed, &artifacts.legacy_zip, &legacy) {
        (Some(manifest_path), Some(zip), Some(preflight)) => {
            checks.run(
                "legacy manifest: Ed25519 signature, client rules, size, digest and bundle match",
                || {
                    preflight::check_signed_manifest(
                        manifest_path,
                        zip,
                        &options.legacy_public_key,
                        preflight,
                    )
                    .map(|_| ())
                },
            );
            match &options.swift_signer {
                Some(tool) => {
                    checks.run("AzureTimetrackerRelease verify (Swift client code path)", || {
                        swift::verify_with_signer(tool, manifest_path, zip)
                            .map(|output| log::info(output.trim()))
                    });
                }
                None => {
                    log::info("Swift `AzureTimetrackerRelease verify` skipped (pass --legacy-tool)")
                }
            }
        }
        (Some(_), _, _) => {
            checks.fail(format!("{LEGACY_FEED_FILE} needs a valid legacy ZIP beside it"))
        }
        (None, Some(_), _) => log::info(format!(
            "no {LEGACY_FEED_FILE} yet: run the AzureTimetrackerRelease command printed by `bridge`"
        )),
        (None, None, _) => {}
    }
    if let Some(reference) = &options.reference {
        match &new_app {
            Some(app) if options.macos_tools => {
                checks.run(
                    &format!(
                        "same designated requirement as {} (Keychain and permission continuity)",
                        reference.display()
                    ),
                    || {
                        let expected = reference_requirement(reference)?;
                        let actual = designated_requirement(app)?;
                        if expected != actual {
                            bail!("{actual:?} differs from {expected:?}");
                        }
                        Ok(())
                    },
                );
            }
            _ => log::info(
                "designated requirement not compared (needs a macOS app artifact and codesign)",
            ),
        }
    }
    if !checks.failures.is_empty() {
        bail!("{} check(s) failed:\n  {}", checks.failures.len(), checks.failures.join("\n  "));
    }
    log::step(format!("All checks passed for {version}. Nothing was installed or launched."));
    Ok(artifacts)
}
