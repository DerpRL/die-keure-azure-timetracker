//! The drag-to-Applications disk image, adapted from `scripts/build-dmg.sh`: compressed and
//! read-only (UDZO, HFS+), an `Applications` link and an installation note that explains the
//! Gatekeeper approval, because releases are not notarized.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use super::codesign::Identity;
use crate::consts::{APP_DIR_NAME, PRODUCT_NAME, dmg_name};
use crate::process::Cmd;
use crate::{fsx, log};

pub const INSTALL_NOTE: &str = "Install Azure timetracker.txt";

/// The signing paragraph of the installation note, by installer label.
pub fn signing_note(label: &str) -> &'static str {
    match label {
        "developer-id" => {
            "The app is Developer ID signed. Notarization is a separate release step; verify it before sharing this image."
        }
        "local-signed" => {
            "The app is signed with the persistent Azure timetracker local certificate, the same identity as 1.14,\n\
             so Keychain items and Calendar and Accessibility permissions carry over. It is not signed with an\n\
             Apple Developer ID and not notarized; that is why macOS asks you to approve the first opening."
        }
        _ => {
            "This app has an ad-hoc development signature and is not notarized. Permission approvals may be\n\
             requested again after an update. Do not distribute this image."
        }
    }
}

/// `14.0.0` → `14`, `14.2.0` → `14.2`.
fn short_macos(minimum: &str) -> String {
    let mut parts: Vec<&str> = minimum.split('.').collect();
    while parts.len() > 1 && parts.last() == Some(&"0") {
        parts.pop();
    }
    parts.join(".")
}

pub fn install_text(version: &str, label: &str, minimum_macos: &str) -> String {
    let image = dmg_name(version, label);
    let note = signing_note(label);
    let macos = short_macos(minimum_macos);
    format!(
        "{PRODUCT_NAME} {version}

1. Quit any existing Azure timetracker using its menu-bar menu.
   Quitting does not stop a timer already running in 7pace.
2. Drag Azure timetracker.app onto the Applications shortcut.
   When upgrading, choose Replace. macOS may ask for administrator authorization.
3. Eject this disk image and open Azure timetracker from Applications.
4. The first time, macOS says it cannot verify the developer, because this build
   is not notarized by Apple. If you trust where you downloaded it from:
   - macOS 15 or later: choose Done, open System Settings > Privacy & Security,
     scroll to Security, choose Open Anyway next to \"Azure timetracker\", confirm
     with your password or Touch ID, then choose Open Anyway again.
   - macOS 14: Control-click the app in Applications, choose Open, then Open.
   This approval is needed once. Later versions are installed by the app itself.
   Do not disable Gatekeeper or remove the quarantine attribute as a workaround.
   Managed Macs may not allow Open Anyway; ask your administrator.
5. Click the clock in the menu bar to open the overview or Settings.
   The app does not appear in the Dock or Command-Tab.

Your existing settings and Keychain credentials are preserved.
For a new setup, use Mobile PIN pairing (or an API token) for 7pace and your own Azure PAT in Settings.

Supports Apple Silicon and Intel; requires macOS {macos} or later.

{note}

Check the download: shasum -a 256 -c {image}.sha256
"
    )
}

/// Builds `<out_dir>/Azure-timetracker-<v>-universal-<label>.dmg` (replacing an unpublished one),
/// signs the image with a certificate identity, and runs `hdiutil verify`.
pub fn create(
    app: &Path,
    out_dir: &Path,
    version: &str,
    label: &str,
    minimum_macos: &str,
    identity: &Identity,
) -> Result<PathBuf> {
    let image = out_dir.join(dmg_name(version, label));
    let stage = tempfile::Builder::new().prefix("att-dmg-").tempdir()?;
    Cmd::new("ditto").arg(app).arg(stage.path().join(APP_DIR_NAME)).run()?;
    fsx::symlink(Path::new("/Applications"), &stage.path().join("Applications"))?;
    std::fs::write(stage.path().join(INSTALL_NOTE), install_text(version, label, minimum_macos))?;
    log::info("hdiutil prints deprecation warnings on macOS 26 and later; they are harmless");
    Cmd::new("hdiutil")
        .args(["create", "-volname"])
        .arg(format!("{PRODUCT_NAME} {version}"))
        .arg("-srcfolder")
        .arg(stage.path())
        .args(["-fs", "HFS+", "-format", "UDZO", "-nospotlight", "-ov"])
        .arg(&image)
        .run()?;
    if let Identity::Certificate { selector, .. } = identity {
        Cmd::new("codesign")
            .args(["--force", identity.timestamp_flag(), "--sign", selector])
            .arg(&image)
            .run()?;
        Cmd::new("codesign").args(["--verify", "--strict"]).arg(&image).output()?;
    }
    verify_image(&image)?;
    Ok(image)
}

pub fn verify_image(image: &Path) -> Result<()> {
    Cmd::new("hdiutil").arg("verify").arg(image).output()?;
    Ok(())
}

/// A read-only, hidden mount that is detached when dropped.
pub struct Mounted {
    pub path: PathBuf,
    _parent: tempfile::TempDir,
}

pub fn attach(image: &Path) -> Result<Mounted> {
    let parent = tempfile::Builder::new().prefix("att-dmg-mount-").tempdir()?;
    let path = parent.path().join("volume");
    std::fs::create_dir(&path)?;
    Cmd::new("hdiutil")
        .args(["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint"])
        .arg(&path)
        .arg(image)
        .output()
        .with_context(|| format!("could not mount {}", image.display()))?;
    if !path.join(APP_DIR_NAME).exists() && std::fs::read_dir(&path)?.next().is_none() {
        bail!("{} mounted empty", image.display());
    }
    Ok(Mounted { path, _parent: parent })
}

impl Drop for Mounted {
    fn drop(&mut self) {
        let detached = Cmd::new("hdiutil").arg("detach").arg(&self.path).quiet().output_any();
        if !detached.is_ok_and(|output| output.status.success()) {
            let _ =
                Cmd::new("hdiutil").args(["detach", "-force"]).arg(&self.path).quiet().output_any();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_names_the_checksum_file_and_minimum() {
        let text = install_text("2.0.0", "local-signed", "14.0.0");
        assert!(text.contains("Azure-timetracker-2.0.0-universal-local-signed.dmg.sha256"));
        assert!(text.contains("requires macOS 14 or later"));
        assert!(text.contains("Open Anyway"));
        assert_eq!(short_macos("14.2.0"), "14.2");
        assert_eq!(short_macos("10.13.0"), "10.13");
    }
}
