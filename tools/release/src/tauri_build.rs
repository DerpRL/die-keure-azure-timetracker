//! `build-macos`, `build-windows` and `sign-update`: the Tauri builds without Tauri's own signing
//! (the release tool signs afterwards), and minisign signatures of update assets.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use crate::bundle::{self, AppVersion};
use crate::consts::{
    APP_DIR_NAME, EXECUTABLE_PATH, REPO_DESKTOP_DIR, mac_archive_name, windows_installer_name,
};
use crate::macos::{macho, stub};
use crate::process::{Cmd, node_tool};
use crate::repo::TauriConf;
use crate::updater_key::{self, UpdaterKey};
use crate::{checksum, fsx, log};

/// Signing inputs the Tauri CLI would pick up from the environment.
const TAURI_SIGNING_ENV: [&str; 11] = [
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
    "APPLE_API_KEY",
    "APPLE_API_ISSUER",
    "APPLE_API_KEY_PATH",
];

fn desktop_dir(repository: &Path) -> Result<PathBuf> {
    let dir = repository.join(REPO_DESKTOP_DIR);
    if !dir.join("package.json").is_file() {
        bail!("{} has no package.json; the Tauri shell is not in this checkout", dir.display());
    }
    Ok(dir)
}

fn load_conf(repository: &Path) -> Result<TauriConf> {
    let conf = TauriConf::load(repository)?.with_context(|| {
        format!("{} not found", repository.join(crate::consts::REPO_TAURI_CONF).display())
    })?;
    conf.require_release_ready()?;
    Ok(conf)
}

fn frontend(desktop: &Path) -> Result<()> {
    log::step("Building the frontend");
    Cmd::new(node_tool("npm")).arg("ci").current_dir(desktop).run()?;
    Cmd::new(node_tool("npm")).args(["run", "build"]).current_dir(desktop).run()?;
    Ok(())
}

/// `npx tauri build …` with the project's pinned CLI, without Tauri signing. `--no-sign` is
/// added when the CLI knows it (2.5+); signing environment variables are removed either way.
fn tauri_build(desktop: &Path, args: &[&str]) -> Result<()> {
    let npx = node_tool("npx");
    let help = Cmd::new(&npx).args(["--no", "--", "tauri", "build", "--help"]).current_dir(desktop).quiet().output()
        .context("the Tauri CLI is not installed in apps/desktop (npm ci should install @tauri-apps/cli)")?;
    let mut command =
        Cmd::new(&npx).args(["--no", "--", "tauri", "build"]).args(args).current_dir(desktop);
    if String::from_utf8_lossy(&help.stdout).contains("--no-sign") {
        command = command.arg("--no-sign");
    }
    for key in TAURI_SIGNING_ENV {
        command = command.env_remove(key);
    }
    log::step("Building the Tauri app");
    command.run()
}

/// `cargo metadata` target directory of the Tauri crate, as the Tauri CLI resolves it.
fn target_directory(desktop: &Path) -> Result<PathBuf> {
    let manifest = desktop.join("src-tauri/Cargo.toml");
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let text = Cmd::new(cargo)
        .args(["metadata", "--format-version", "1", "--no-deps", "--manifest-path"])
        .arg(&manifest)
        .quiet()
        .stdout_text()?;
    let value: serde_json::Value = serde_json::from_str(&text)?;
    let dir = value
        .get("target_directory")
        .and_then(|dir| dir.as_str())
        .context("cargo metadata has no target_directory")?;
    Ok(PathBuf::from(dir))
}

/// Builds the universal app and returns its path.
pub fn build_macos(repository: &Path) -> Result<PathBuf> {
    if !cfg!(target_os = "macos") {
        bail!("build-macos runs on macOS");
    }
    let conf = load_conf(repository)?;
    let desktop = desktop_dir(repository)?;
    stub::ensure_rust_targets(&stub::TARGETS)?;
    frontend(&desktop)?;
    tauri_build(&desktop, &["--target", "universal-apple-darwin", "--bundles", "app"])?;
    let app = target_directory(&desktop)?
        .join("universal-apple-darwin/release/bundle/macos")
        .join(APP_DIR_NAME);
    if !app.is_dir() {
        bail!("tauri build did not produce {}", app.display());
    }
    let release = bundle::check_release_bundle(&app, false)?;
    if conf.version() != Some(release.version_text.as_str()) {
        bail!("the app is {}, tauri.conf.json says {:?}", release.version_text, conf.version());
    }
    macho::require_universal(&app.join(EXECUTABLE_PATH))?;
    log::ok(format!(
        "{} {} (build {}), universal",
        app.display(),
        release.version_text,
        release.build
    ));
    Ok(app)
}

/// Builds the NSIS installer into `out` as `Azure-timetracker-<v>-x64-setup.exe` with its
/// checksum, and signs it for the updater when a key is given.
pub fn build_windows(repository: &Path, out: &Path, key: Option<&UpdaterKey>) -> Result<PathBuf> {
    if !cfg!(windows) {
        bail!("build-windows runs on Windows");
    }
    let conf = load_conf(repository)?;
    let version = conf.version().context("tauri.conf.json has no version")?.to_owned();
    let desktop = desktop_dir(repository)?;
    frontend(&desktop)?;
    tauri_build(&desktop, &["--bundles", "nsis"])?;
    let nsis = target_directory(&desktop)?.join("release/bundle/nsis");
    let suffix = format!("_{version}_x64-setup.exe");
    let candidates: Vec<_> = fs::read_dir(&nsis)
        .with_context(|| format!("tauri build did not produce {}", nsis.display()))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(&suffix))
        })
        .collect();
    let [built] = candidates.as_slice() else {
        bail!("expected one *{suffix} in {}, found {candidates:?}", nsis.display());
    };
    fs::create_dir_all(out)?;
    let installer = out.join(windows_installer_name(&version));
    fsx::copy_file(built, &installer)?;
    checksum::write_side_file(&installer)?;
    log::ok(format!("{} and its .sha256", installer.display()));
    match key {
        Some(key) => {
            check_key_matches(key, &conf)?;
            updater_key::sign_file(key, &installer, &version)?;
            log::ok(format!("{}.sig", installer.display()));
        }
        None => {
            log::step(
                "Not signed for the updater (no key on this machine). Copy the installer and its .sha256 to the release Mac and run:",
            );
            log::info(format!(
                "cargo run -p att-release -- sign-update '{}' --version {version} --key \"$HOME/Library/Application Support/Azure timetracker Releases/updater-v2.key\"",
                fsx::file_name(&installer)?
            ));
        }
    }
    log::warn(
        "the installer has no Authenticode signature (decided); SmartScreen asks for More info > Run anyway on first install",
    );
    Ok(installer)
}

fn check_key_matches(key: &UpdaterKey, conf: &TauriConf) -> Result<()> {
    match conf.pubkey() {
        Some(pubkey) if pubkey == key.public_b64 => {
            log::ok(format!("signing key {} matches plugins.updater.pubkey", key.key_id()));
            Ok(())
        }
        _ => bail!(
            "the signing key (id {}) is not plugins.updater.pubkey in {}",
            key.key_id(),
            conf.path.display()
        ),
    }
}

/// Signs an update asset (`.app.tar.gz` or `-x64-setup.exe`) for `version`.
pub fn sign_update(
    file: &Path,
    version: &str,
    key: &UpdaterKey,
    expected_pubkey: Option<&str>,
) -> Result<PathBuf> {
    AppVersion::parse(version).map_err(anyhow::Error::msg)?;
    let name = fsx::file_name(file)?;
    if name != mac_archive_name(version) && name != windows_installer_name(version) {
        bail!("{name} is not an update asset of {version}");
    }
    match expected_pubkey {
        Some(expected) if expected != key.public_b64 => {
            bail!(
                "the signing key (id {}) is not plugins.updater.pubkey; installed apps would reject this update",
                key.key_id()
            )
        }
        Some(_) => log::ok(format!("signing key {} matches plugins.updater.pubkey", key.key_id())),
        None => log::warn("no plugins.updater.pubkey to compare the signing key with"),
    }
    if checksum::side_file(file).exists() {
        checksum::verify_side_file(file)?;
        log::ok("checksum file matches");
    } else {
        checksum::write_side_file(file)?;
    }
    updater_key::sign_file(key, file, version)?;
    let signature = fsx::with_suffix(file, ".sig");
    log::ok(signature.display());
    Ok(signature)
}
