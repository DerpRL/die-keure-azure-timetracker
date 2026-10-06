//! Command-line entry point. Progress goes to stderr; stdout carries only results (the app path,
//! the public key, the legacy signing command).

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{Context, Result, bail};
use att_release::consts::{self, V2_FEED_FILE};
use att_release::legacy::preflight::PreflightOptions;
use att_release::legacy::swift;
use att_release::macos::codesign;
use att_release::package::{self, PackageOptions, SignOptions};
use att_release::repo::{self, TauriConf};
use att_release::stage::{self, StageOptions};
use att_release::updater_key::{self, KeygenOutcome};
use att_release::verify::{self, VerifyOptions};
use att_release::{bridge, dates, feed, fsx, log, tauri_build};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "att-release",
    version,
    about = "Build, sign, package, verify and stage Azure timetracker 2.x releases (see docs/release.md).",
    after_help = "Release order: keygen-v2 (once) → build-macos → sign-macos → package-macos → \
                  [bridge → AzureTimetrackerRelease → bridge-dry-run] → build-windows (on Windows) → \
                  sign-update → feed → verify → stage → review, commit, push."
)]
struct Cli {
    /// Repository root (default: the checkout this tool was built from).
    #[arg(long, global = true, value_name = "DIR")]
    repo: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Create the v2 updater key pair if missing (run once by the release owner) and print the
    /// public key for tauri.conf.json.
    KeygenV2 {
        /// Private key file; `.pub` is written beside it. Default:
        /// ~/Library/Application Support/Azure timetracker Releases/updater-v2.key.
        #[arg(long, value_name = "FILE")]
        path: Option<PathBuf>,
    },
    /// npm ci + npm run build + tauri build --target universal-apple-darwin --bundles app, unsigned.
    /// Prints the app path.
    BuildMacos,
    /// Add the 1.x helper stub, sign inner code, helper and app (Hardened Runtime, calendar
    /// entitlement, no timestamp) and verify.
    SignMacos {
        /// The `Azure timetracker.app` from build-macos.
        app: PathBuf,
        /// Signing identity (certificate name or SHA-1). Default: AZURE_TIME_SIGN_IDENTITY, then
        /// the local-signing selector file, else ad-hoc with a warning.
        #[arg(long)]
        identity: Option<String>,
        /// Ad-hoc signature for development; never for a release.
        #[arg(long)]
        adhoc: bool,
        /// Use this prebuilt universal stub instead of compiling it.
        #[arg(long, value_name = "FILE")]
        helper: Option<PathBuf>,
        /// Entitlements plist (default: the calendar entitlement 1.14.x used).
        #[arg(long, value_name = "FILE")]
        entitlements: Option<PathBuf>,
    },
    /// DMG (+ .sha256) and the updater archive Azure-timetracker-<v>-universal.app.tar.gz
    /// (+ .sha256, + minisign .sig).
    PackageMacos {
        /// The signed app from sign-macos.
        app: PathBuf,
        /// Artifact folder (outside the repository).
        out: PathBuf,
        /// v2 private key (default: TAURI_SIGNING_PRIVATE_KEY, a path or the key text; password in
        /// TAURI_SIGNING_PRIVATE_KEY_PASSWORD, empty by default).
        #[arg(long, value_name = "FILE")]
        key: Option<PathBuf>,
        /// Accept an ad-hoc-signed app (testing only).
        #[arg(long)]
        allow_adhoc: bool,
    },
    /// The one-time bridge: 1.x-format ZIP + preflight with the 1.x client rules, build the Swift
    /// signer and print the legacy signing command (not run).
    Bridge {
        /// The signed app (the same bundle package-macos packaged).
        app: PathBuf,
        /// Artifact folder (the same one as package-macos).
        out: PathBuf,
        /// Release notes (Markdown) shown by 1.x clients, e.g. releases/notes/2.0.0.md.
        #[arg(long, value_name = "FILE")]
        notes: PathBuf,
        /// Legacy key path to print in the command (default: AZURE_TIME_UPDATE_KEY, then
        /// ~/Library/Application Support/Azure timetracker Releases/update-signing.ed25519). Never opened.
        #[arg(long, value_name = "FILE")]
        legacy_key: Option<PathBuf>,
        /// Accept an ad-hoc-signed app (testing only).
        #[arg(long)]
        allow_adhoc: bool,
    },
    /// Bridge exit test: install the bridge ZIP over a 1.13–1.14.x app (a copy or a test Mac)
    /// with the unmodified 1.14.x client code, as its helper would. Nothing is published.
    BridgeDryRun {
        /// Azure-timetracker-<v>-universal-update.zip from `bridge`.
        zip: PathBuf,
        /// The signed app the ZIP was built from.
        app: PathBuf,
        /// The installed 1.13–1.14.x `Azure timetracker.app` to replace (a backup is kept beside it).
        #[arg(long, value_name = "APP")]
        installed: PathBuf,
    },
    /// Write the Tauri v2 feed latest.json from signed assets.
    Feed {
        /// Release version, e.g. 2.0.0.
        #[arg(long)]
        version: String,
        /// Release notes (Markdown), e.g. releases/notes/2.0.0.md.
        #[arg(long, value_name = "FILE")]
        notes: PathBuf,
        /// Azure-timetracker-<v>-universal.app.tar.gz (its .sig beside it).
        #[arg(long, value_name = "FILE")]
        mac_archive: Option<PathBuf>,
        /// Azure-timetracker-<v>-x64-setup.exe (its .sig beside it).
        #[arg(long, value_name = "FILE")]
        windows_installer: Option<PathBuf>,
        /// Output folder (default: the folder of the first asset).
        #[arg(long, value_name = "DIR")]
        out: Option<PathBuf>,
        /// RFC 3339 publication time (default: now, UTC).
        #[arg(long)]
        pub_date: Option<String>,
        /// Updater public key or a file holding it (default: tauri.conf.json plugins.updater.pubkey).
        #[arg(long)]
        pubkey: Option<String>,
    },
    /// On Windows: frontend build + tauri build --bundles nsis, .sha256, and the updater .sig when
    /// a key is available (otherwise prints the sign-update command for the release Mac).
    BuildWindows {
        /// Output folder (default: <repo>/target/att-release).
        #[arg(long, value_name = "DIR")]
        out: Option<PathBuf>,
        /// v2 private key (default: TAURI_SIGNING_PRIVATE_KEY); without one, sign on the Mac.
        #[arg(long, value_name = "FILE")]
        key: Option<PathBuf>,
    },
    /// Sign an update asset with the v2 key, e.g. the Windows installer copied to the release Mac.
    SignUpdate {
        /// Azure-timetracker-<v>-x64-setup.exe or Azure-timetracker-<v>-universal.app.tar.gz.
        file: PathBuf,
        /// The release version the signature is bound to.
        #[arg(long)]
        version: String,
        /// v2 private key (default: TAURI_SIGNING_PRIVATE_KEY).
        #[arg(long, value_name = "FILE")]
        key: Option<PathBuf>,
    },
    /// Copy a verified release into releases/ and updates/ (archives the previous installers).
    Stage {
        /// Release version, e.g. 2.0.0.
        version: String,
        /// Artifact folder that `verify` accepted.
        #[arg(long, value_name = "DIR")]
        from: PathBuf,
        /// Also publish the signed 1.x manifest to updates/latest.json (bridge release only).
        #[arg(long)]
        bridge: bool,
        /// Accept ad-hoc-signed apps (testing only).
        #[arg(long)]
        allow_adhoc: bool,
        /// Updater public key or a file holding it (default: tauri.conf.json plugins.updater.pubkey).
        #[arg(long)]
        pubkey: Option<String>,
        /// AzureTimetrackerRelease executable (default: build it with SwiftPM when --bridge).
        #[arg(long, value_name = "FILE")]
        legacy_tool: Option<PathBuf>,
    },
    /// Check every artifact in a folder: checksums, signatures, bundles, DMG, feeds, legacy ZIP.
    Verify {
        /// Artifact folder.
        dir: PathBuf,
        /// Accept ad-hoc-signed apps (testing only).
        #[arg(long)]
        allow_adhoc: bool,
        /// Updater public key or a file holding it (default: tauri.conf.json plugins.updater.pubkey).
        #[arg(long)]
        pubkey: Option<String>,
        /// App or 1.x update ZIP whose designated requirement the new app must share, e.g.
        /// releases/updates/1.14.2/Azure-timetracker-1.14.2-universal-update.zip.
        #[arg(long, value_name = "PATH")]
        reference: Option<PathBuf>,
        /// AzureTimetrackerRelease for its key-free verify mode (default: the one `bridge` built).
        #[arg(long, value_name = "FILE")]
        legacy_tool: Option<PathBuf>,
    },
}

fn absolute(path: &Path) -> Result<PathBuf> {
    std::fs::canonicalize(path).with_context(|| format!("{} not found", path.display()))
}

fn work_dir(repository: &Path) -> PathBuf {
    repository.join("target/att-release")
}

/// The shell's public key, when tauri.conf.json has a valid one.
fn shell_pubkey(repository: &Path) -> Result<Option<String>> {
    let Some(conf) = TauriConf::load(repository)? else { return Ok(None) };
    match conf.pubkey() {
        Some(key) if updater_key::public_key_id(key).is_ok() => Ok(Some(key.to_owned())),
        _ => {
            log::warn(format!(
                "{} has no valid plugins.updater.pubkey yet (placeholder?)",
                conf.path.display()
            ));
            Ok(None)
        }
    }
}

/// The update ZIP the legacy feed currently points at, if it is in the checkout.
fn published_legacy_zip(repository: &Path) -> Result<Option<PathBuf>> {
    let feed = repository.join(consts::REPO_LEGACY_FEED);
    if !feed.is_file() {
        return Ok(None);
    }
    let envelope = att_release::legacy::manifest::parse_envelope(&std::fs::read(&feed)?)
        .map_err(anyhow::Error::msg)?;
    let version = envelope.release.version;
    let zip = repository
        .join(consts::REPO_UPDATES_DIR)
        .join(&version)
        .join(consts::legacy_zip_name(&version));
    Ok(zip.is_file().then_some(zip))
}

fn default_signer(repository: &Path) -> Option<PathBuf> {
    let candidate = swift::scratch_dir(repository).join("package/release/AzureTimetrackerRelease");
    candidate.is_file().then_some(candidate)
}

fn run(cli: Cli) -> Result<()> {
    let repository = repo::root(cli.repo.as_deref())?;
    match cli.command {
        Command::KeygenV2 { path } => {
            let path = match path {
                Some(path) => path,
                None => consts::default_v2_key_path()?,
            };
            log::step(format!("Updater key pair at {}", path.display()));
            let (outcome, public) =
                updater_key::keygen(&path, &updater_key::password_from_env(), Some(&repository))?;
            match outcome {
                KeygenOutcome::Created => log::ok(
                    "created a new key pair (private key mode 600). Back up both files now.",
                ),
                KeygenOutcome::AlreadyPresent => {
                    log::ok("the key pair already exists; nothing changed")
                }
                KeygenOutcome::PublicFileRestored => {
                    log::ok("the private key exists; its .pub file was written again")
                }
            }
            log::info(format!("Public key file: {}", updater_key::public_path(&path).display()));
            log::info(
                "Put the public key below in apps/desktop/src-tauri/tauri.conf.json at plugins.updater.pubkey:",
            );
            println!("{public}");
        }
        Command::BuildMacos => {
            let app = tauri_build::build_macos(&repository)?;
            log::step("Next: att-release sign-macos <app>");
            println!("{}", app.display());
        }
        Command::SignMacos { app, identity, adhoc, helper, entitlements } => {
            let app = absolute(&app)?;
            let options = SignOptions {
                identity: codesign::resolve_identity(adhoc, identity.as_deref())?,
                helper,
                entitlements,
                work_dir: work_dir(&repository),
                require_universal: true,
            };
            package::sign_macos(&app, &options)?;
            log::step(format!(
                "Signed {}. Next: att-release package-macos <app> <out>",
                app.display()
            ));
        }
        Command::PackageMacos { app, out, key, allow_adhoc } => {
            let app = absolute(&app)?;
            let source = updater_key::resolve_key_source(key.as_deref())?;
            log::step(format!("Loading the v2 updater key from {}", source.describe()));
            let key =
                updater_key::load(&source, &updater_key::password_from_env(), Some(&repository))?;
            let dmg_identity = codesign::resolve_identity(false, None)?.identity;
            let options = PackageOptions {
                out,
                key: &key,
                expected_pubkey: shell_pubkey(&repository)?,
                allow_adhoc,
                require_universal: true,
                dmg_identity,
            };
            let output = package::package_macos(&app, &options)?;
            log::step(format!(
                "Packaged {} and {}",
                output.dmg.display(),
                output.archive.display()
            ));
        }
        Command::Bridge { app, out, notes, legacy_key, allow_adhoc } => {
            let app = absolute(&app)?;
            let notes = absolute(&notes)?;
            std::fs::create_dir_all(&out)?;
            let out = absolute(&out)?;
            let legacy_key_path = match (legacy_key, std::env::var_os("AZURE_TIME_UPDATE_KEY")) {
                (Some(path), _) => path,
                (None, Some(path)) if !path.is_empty() => PathBuf::from(path),
                _ => consts::default_legacy_key_path()?,
            };
            let options = bridge::BridgeOptions {
                out,
                notes,
                repository: repository.clone(),
                legacy_key_path,
                preflight: PreflightOptions::host(),
                allow_adhoc,
                build_signer: true,
            };
            let outcome = bridge::bridge(&app, &options)?;
            log::info("Run on the release Mac, then `att-release verify` on the output folder:");
            println!("{}", outcome.command);
        }
        Command::BridgeDryRun { zip, app, installed } => {
            att_release::legacy::dry_run::dry_run(
                &repository,
                &absolute(&zip)?,
                &absolute(&app)?,
                &absolute(&installed)?,
                &work_dir(&repository).join("bridge-dry-run"),
            )?;
        }
        Command::Feed { version, notes, mac_archive, windows_installer, out, pub_date, pubkey } => {
            let notes = std::fs::read_to_string(&notes)
                .with_context(|| format!("could not read {}", notes.display()))?;
            let pub_date = match pub_date {
                Some(date) => date,
                None => dates::now_utc()?,
            };
            let built = feed::build(
                &version,
                &notes,
                &pub_date,
                mac_archive.as_deref(),
                windows_installer.as_deref(),
            )?;
            let out = match out.or_else(|| {
                mac_archive
                    .as_ref()
                    .or(windows_installer.as_ref())
                    .and_then(|path| path.parent().map(Path::to_owned))
            }) {
                Some(dir) => dir,
                None => bail!("pass --out"),
            };
            match repo::resolve_pubkey(pubkey.as_deref(), &repository) {
                Ok((key, source)) => {
                    feed::check(&built, &out, &key)?;
                    log::ok(format!("every signature verifies with {source}"));
                }
                Err(error) => log::warn(format!("signatures not checked: {error:#}")),
            }
            let path = out.join(V2_FEED_FILE);
            fsx::write_atomic(&path, feed::to_json(&built)?.as_bytes())?;
            log::step(format!("Wrote {} for {} target(s)", path.display(), built.platforms.len()));
            println!("{}", path.display());
        }
        Command::BuildWindows { out, key } => {
            let out = out.unwrap_or_else(|| work_dir(&repository));
            let key = if key.is_some() || std::env::var_os("TAURI_SIGNING_PRIVATE_KEY").is_some() {
                let source = updater_key::resolve_key_source(key.as_deref())?;
                Some(updater_key::load(
                    &source,
                    &updater_key::password_from_env(),
                    Some(&repository),
                )?)
            } else {
                None
            };
            let installer = tauri_build::build_windows(&repository, &out, key.as_ref())?;
            println!("{}", installer.display());
        }
        Command::SignUpdate { file, version, key } => {
            let source = updater_key::resolve_key_source(key.as_deref())?;
            let key =
                updater_key::load(&source, &updater_key::password_from_env(), Some(&repository))?;
            let expected = shell_pubkey(&repository)?;
            let signature =
                tauri_build::sign_update(&absolute(&file)?, &version, &key, expected.as_deref())?;
            println!("{}", signature.display());
        }
        Command::Stage { version, from, bridge, allow_adhoc, pubkey, legacy_tool } => {
            let (pubkey, source) = repo::resolve_pubkey(pubkey.as_deref(), &repository)?;
            log::info(format!("updater public key: {source}"));
            let mut verify = VerifyOptions::new(pubkey);
            verify.allow_adhoc = allow_adhoc;
            if bridge {
                verify.swift_signer = Some(match legacy_tool {
                    Some(tool) => tool,
                    None => swift::build_signer(&repository)?,
                });
                // Keychain and permission continuity: same designated requirement as the
                // currently published 1.x app.
                if !allow_adhoc {
                    verify.reference = published_legacy_zip(&repository)?;
                    match &verify.reference {
                        Some(zip) => log::info(format!("identity reference: {}", zip.display())),
                        None => log::warn(
                            "no published 1.x update ZIP to compare the signing identity with",
                        ),
                    }
                }
            }
            let options =
                StageOptions { version, from: absolute(&from)?, repository, bridge, verify };
            stage::stage(&options)?;
        }
        Command::Verify { dir, allow_adhoc, pubkey, reference, legacy_tool } => {
            let (pubkey, source) = repo::resolve_pubkey(pubkey.as_deref(), &repository)?;
            log::info(format!("updater public key: {source}"));
            let mut options = VerifyOptions::new(pubkey);
            options.allow_adhoc = allow_adhoc;
            options.reference = reference;
            options.swift_signer = legacy_tool.or_else(|| default_signer(&repository));
            verify::verify_dir(&absolute(&dir)?, &options)?;
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::FAILURE
        }
    }
}
