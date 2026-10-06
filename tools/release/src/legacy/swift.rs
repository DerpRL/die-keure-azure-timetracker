//! The existing Swift `AzureTimetrackerRelease` tool, which signs the legacy manifest with the
//! real Ed25519 key. This module builds it and runs its key-free `verify` mode; signing is printed
//! for the release owner, never run here.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use crate::log;
use crate::process::Cmd;

/// Build folder inside the repository; `.build*/` is ignored by Git.
pub fn scratch_dir(repository: &Path) -> PathBuf {
    repository.join(".build-att-release/swift")
}

fn swift_build(repository: &Path, scratch: &Path, native: bool) -> Cmd {
    let module_cache = scratch.join("module-cache");
    let mut command = Cmd::new("swift")
        .arg("build")
        .arg("--package-path")
        .arg(repository)
        .arg("--scratch-path")
        .arg(scratch.join("package"))
        .arg("--cache-path")
        .arg(scratch.join("cache"))
        .arg("--disable-sandbox");
    if native {
        command = command.args(["--build-system", "native"]);
    }
    command
        .args(["-c", "release", "--product", "AzureTimetrackerRelease"])
        .env("CLANG_MODULE_CACHE_PATH", &module_cache)
        .env("SWIFTPM_MODULECACHE_OVERRIDE", &module_cache)
}

/// `swift build -c release --product AzureTimetrackerRelease` with the flags the 1.x scripts used
/// (`--build-system native` is deprecated in Swift 6.4; without it is the fallback). Returns the
/// executable.
pub fn build_signer(repository: &Path) -> Result<PathBuf> {
    if !repository.join("Package.swift").is_file() {
        bail!(
            "{} has no Package.swift; the Swift signer lives in the repository root",
            repository.display()
        );
    }
    let scratch = scratch_dir(repository);
    let mut native = true;
    if let Err(error) = swift_build(repository, &scratch, true).run() {
        log::warn(format!("{error:#}; retrying with the default SwiftPM build system"));
        native = false;
        swift_build(repository, &scratch, false).run()?;
    }
    let bin = swift_build(repository, &scratch, native).arg("--show-bin-path").stdout_text()?;
    let tool = PathBuf::from(bin.trim()).join("AzureTimetrackerRelease");
    if !tool.is_file() {
        bail!("swift build did not produce {}", tool.display());
    }
    Ok(tool)
}

/// `AzureTimetrackerRelease verify MANIFEST ZIP`: the Swift client code path (signature with the
/// pinned key, manifest rules, archive digest, `ditto` extraction, bundle and code signature).
pub fn verify_with_signer(tool: &Path, manifest: &Path, zip: &Path) -> Result<String> {
    let output = Cmd::new(tool).arg("verify").arg(manifest).arg(zip).output()?;
    String::from_utf8(output.stdout).context("non-UTF-8 output from AzureTimetrackerRelease")
}
