//! The legacy helper stub at `Contents/Helpers/AzureTimetrackerUpdater`.
//!
//! A 1.13–1.14.x app installs an update with the helper of the *installed* (old) bundle, but it
//! refuses a new bundle that has no executable helper (`UpdateInstallation.verifyBundle`). So
//! 2.x carries this placeholder: it prints that it only exists for 1.x updates and exits 1.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use super::macho;
use crate::process::Cmd;
use crate::{fsx, log};

pub const TARGETS: [&str; 2] = ["aarch64-apple-darwin", "x86_64-apple-darwin"];

/// The stub's source, compiled on its own (it has no dependencies).
pub fn source() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src/bin/legacy-helper-stub.rs")
}

/// Installs missing Rust targets with rustup (idempotent).
pub fn ensure_rust_targets(targets: &[&str]) -> Result<()> {
    let installed = Cmd::new("rustup")
        .args(["target", "list", "--installed"])
        .stdout_text()
        .context("rustup is required to build universal macOS binaries")?;
    for target in targets {
        if installed.lines().any(|line| line.trim() == *target) {
            continue;
        }
        log::info(format!("installing the Rust target {target}"));
        Cmd::new("rustup").args(["target", "add", target]).run()?;
    }
    Ok(())
}

/// Builds the universal stub at `out` with `rustc` per architecture and `lipo -create`.
pub fn build_universal(work_dir: &Path, out: &Path) -> Result<()> {
    ensure_rust_targets(&TARGETS)?;
    std::fs::create_dir_all(work_dir)?;
    let source = source();
    if !source.is_file() {
        bail!("{} is missing", source.display());
    }
    let mut slices = Vec::new();
    for target in TARGETS {
        let slice = work_dir.join(format!("AzureTimetrackerUpdater-{target}"));
        Cmd::new("rustc")
            .args([
                "--edition",
                "2024",
                "--crate-type",
                "bin",
                "--crate-name",
                "azure_timetracker_updater",
            ])
            .args([
                "-C",
                "opt-level=s",
                "-C",
                "codegen-units=1",
                "-C",
                "panic=abort",
                "-C",
                "lto=fat",
                "-C",
                "strip=symbols",
            ])
            .args(["--target", target, "-o"])
            .arg(&slice)
            .arg(&source)
            .current_dir(work_dir)
            .run()?;
        slices.push(slice);
    }
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Cmd::new("lipo").arg("-create").arg("-output").arg(out).args(&slices).run()?;
    fsx::set_mode(out, 0o755)?;
    macho::require_universal(out)?;
    Ok(())
}
