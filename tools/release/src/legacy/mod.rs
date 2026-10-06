//! The 1.x update path, used once for the bridge release: 1.13–1.14.x apps read the legacy feed
//! `updates/latest.json`, download a ZIP and install it with their own helper.

pub mod archive;
pub mod dry_run;
pub mod manifest;
pub mod preflight;
pub mod swift;
pub mod zip;
