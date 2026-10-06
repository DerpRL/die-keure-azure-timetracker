//! `att-release`: builds, signs, packages, verifies and stages Azure timetracker 2.x releases,
//! including the one-time bridge through the 1.x update feed. See `docs/release.md`.
//!
//! Distribution decisions (rewrite plan §11, §15): no Apple Developer Program, no Windows
//! code-signing certificate, no GitHub Releases. macOS builds are signed with the persistent local
//! certificate; installers, update assets and feeds are committed to the repository and served
//! from raw.githubusercontent.com.

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
pub mod repo;
pub mod stage;
pub mod tarball;
pub mod tauri_build;
pub mod tree;
pub mod updater_key;
pub mod verify;
