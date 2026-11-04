//! `att-release`: builds, signs, notarizes, packages, verifies and publishes Azure timetracker
//! 2.x releases, including the one-time bridge through the 1.x update feed. See `docs/release.md`.
//!
//! Distribution (decided 2026-11-04, replacing rewrite plan §11 and §15): macOS builds are signed
//! with the Developer ID of team 4M2RD85AL6 and notarized; the Windows installer is cross-compiled
//! on the release Mac and has no Authenticode signature. Installers, update assets and the v2
//! feed are GitHub Release assets. Only the 1.x bridge (ZIP and signed manifest) is committed to
//! the repository, because 1.x clients read raw.githubusercontent.com.

pub mod bridge;
pub mod bundle;
pub mod checksum;
pub mod consts;
pub mod dates;
pub mod feed;
pub mod fsx;
pub mod legacy;
pub mod log;
pub mod macos;
pub mod package;
pub mod process;
pub mod publish;
pub mod repo;
pub mod stage;
pub mod tarball;
pub mod tauri_build;
pub mod tree;
pub mod updater_key;
pub mod verify;
