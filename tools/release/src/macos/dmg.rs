//! The drag-to-Applications disk image: compressed and read-only (UDZO, HFS+), with the app, an
//! `Applications` link and a background picture showing where to drag it. Release images are
//! Developer ID signed and notarized.
//!
//! Finder keeps a window's layout (size, icon positions, background) in the volume's `.DS_Store`.
//! The tool builds a writable image, has Finder arrange its window through AppleScript (the
//! method `create-dmg` and Tauri's bundler use) and then compresses it. That step opens a Finder
//! window for a moment and needs the terminal to be allowed to control Finder (System Settings >
//! Privacy & Security > Automation).

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use super::codesign::Identity;
use crate::consts::{APP_DIR_NAME, PRODUCT_NAME, dmg_name};
use crate::process::Cmd;
use crate::{fsx, log};

/// The window background, 660 × 400 points at 1x and 2x (the 2.0 design's "DMG background").
/// Regenerate it with `tools/release/assets/regenerate-dmg-background.sh`.
const BACKGROUND: &[u8] = include_bytes!("../../assets/dmg-background.tiff");
pub const BACKGROUND_DIR: &str = ".background";
pub const BACKGROUND_FILE: &str = "background.tiff";

/// Arranges the window of the volume mounted at `argv[1]`. The 104-point icons and the 660 × 400
/// content size match the drawing in `assets/draw-dmg-background.swift`; the bounds add the
/// 28-point title bar. Positions are icon centres, inside the picture's two tiles.
/// `.background` is hidden and parked below the window, out of view even when Finder shows
/// hidden files.
const LAYOUT_SCRIPT: &str = r#"on run argv
	set root to (POSIX file (item 1 of argv)) as alias
	tell application "Finder"
		set root to folder root
		open root
		set theWindow to container window of root
		set current view of theWindow to icon view
		set toolbar visible of theWindow to false
		set statusbar visible of theWindow to false
		set bounds of theWindow to {200, 120, 860, 548}
		set viewOptions to icon view options of theWindow
		set arrangement of viewOptions to not arranged
		set icon size of viewOptions to 104
		set text size of viewOptions to 13
		set background picture of viewOptions to file ".background:background.tiff" of root
		set position of item "Azure timetracker.app" of root to {165, 198}
		set position of item "Applications" of root to {495, 198}
		try
			set position of item ".background" of root to {165, 900}
		end try
		update root without registering applications
		delay 1
		close theWindow
	end tell
end run
"#;

/// Builds `<out_dir>/azure-timetracker-<v>.dmg` (replacing an unpublished one),
/// signs the image with a certificate identity, and runs `hdiutil verify`.
pub fn create(app: &Path, out_dir: &Path, version: &str, identity: &Identity) -> Result<PathBuf> {
    let image = out_dir.join(dmg_name(version));
    let work = tempfile::Builder::new().prefix("att-dmg-").tempdir()?;
    let stage = work.path().join("stage");
    std::fs::create_dir_all(stage.join(BACKGROUND_DIR))?;
    Cmd::new("ditto").arg(app).arg(stage.join(APP_DIR_NAME)).run()?;
    fsx::symlink(Path::new("/Applications"), &stage.join("Applications"))?;
    std::fs::write(stage.join(BACKGROUND_DIR).join(BACKGROUND_FILE), BACKGROUND)?;

    log::info("hdiutil prints deprecation warnings on macOS 26 and later; they are harmless");
    let writable = work.path().join("writable.dmg");
    Cmd::new("hdiutil")
        .args(["create", "-volname"])
        .arg(format!("{PRODUCT_NAME} {version}"))
        .arg("-srcfolder")
        .arg(&stage)
        .args(["-fs", "HFS+", "-format", "UDRW", "-nospotlight", "-ov"])
        .arg(&writable)
        .run()?;
    arrange_window(&writable, work.path())?;
    Cmd::new("hdiutil")
        .args(["convert", "-format", "UDZO", "-ov", "-o"])
        .arg(&image)
        .arg(&writable)
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

/// Mounts the writable image where Finder can see it, lets Finder write the window layout and
/// detaches it again.
fn arrange_window(writable: &Path, work: &Path) -> Result<()> {
    let mount = work.join("volume");
    std::fs::create_dir(&mount)?;
    let script = work.join("layout.applescript");
    std::fs::write(&script, LAYOUT_SCRIPT)?;
    Cmd::new("hdiutil")
        .args(["attach", "-readwrite", "-noverify", "-noautoopen", "-mountpoint"])
        .arg(&mount)
        .arg(writable)
        .output()
        .with_context(|| format!("could not mount {}", writable.display()))?;
    // The background folder is hidden in Finder (UF_HIDDEN) besides its leading dot.
    let arranged = Cmd::new("chflags")
        .arg("hidden")
        .arg(mount.join(BACKGROUND_DIR))
        .output()
        .context("could not hide the background folder")
        .and_then(|_| {
            Cmd::new("osascript").arg(&script).arg(&mount).output().context(
                "Finder could not arrange the disk image window; allow this terminal to control \
                 Finder in System Settings > Privacy & Security > Automation",
            )
        });
    let saved = arranged.and_then(|_| {
        if !mount.join(".DS_Store").is_file() {
            bail!("Finder did not save the window layout (.DS_Store)");
        }
        // Finder's event log for the writable mount; not part of the release.
        let events = mount.join(".fseventsd");
        if events.exists() {
            std::fs::remove_dir_all(&events)?;
        }
        Ok(())
    });
    let detached = Cmd::new("hdiutil").arg("detach").arg(&mount).quiet().output_any();
    if !detached.is_ok_and(|output| output.status.success()) {
        Cmd::new("hdiutil").args(["detach", "-force"]).arg(&mount).quiet().output()?;
    }
    saved
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
