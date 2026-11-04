//! Notarization with `xcrun notarytool` and an App Store Connect API key, then stapling.
//!
//! The app is notarized (as a ZIP made with `ditto`) and stapled *before* the DMG and the updater
//! archive are made, so every copy of the app carries its ticket; the signed DMG is then notarized
//! and stapled on its own. Stapling adds `Contents/CodeResources` outside the code seal, so the
//! signature stays valid.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::Deserialize;

use crate::consts::{self, NOTARY_ISSUER, NOTARY_KEY_ID};
use crate::process::{Cmd, combined};
use crate::{fsx, log};

/// `notarytool --key/--key-id/--issuer`. Tauri's variable names are honoured.
#[derive(Debug, Clone)]
pub struct Credentials {
    pub key_path: PathBuf,
    pub key_id: String,
    pub issuer: String,
}

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).ok().filter(|value| !value.trim().is_empty()).unwrap_or(default.to_owned())
}

impl Credentials {
    /// `APPLE_API_KEY` (key ID), `APPLE_API_ISSUER` and `APPLE_API_KEY_PATH`, defaulting to
    /// [`NOTARY_KEY_ID`], [`NOTARY_ISSUER`] and `~/.appstoreconnect/private_keys/AuthKey_<id>.p8`.
    pub fn resolve() -> Result<Self> {
        let key_id = env_or("APPLE_API_KEY", NOTARY_KEY_ID);
        let issuer = env_or("APPLE_API_ISSUER", NOTARY_ISSUER);
        let key_path = match std::env::var_os("APPLE_API_KEY_PATH") {
            Some(path) if !path.is_empty() => PathBuf::from(path),
            _ => consts::default_notary_key_path(&key_id)?,
        };
        if !key_path.is_file() {
            bail!(
                "the App Store Connect API key {} is missing. Download AuthKey_{key_id}.p8 from App Store Connect > Users and Access > Integrations > App Store Connect API (it can be downloaded once), store it there with mode 600, or set APPLE_API_KEY_PATH. Pass --no-notarize only for test builds.",
                key_path.display()
            );
        }
        let mode = fsx::mode(&fs::metadata(&key_path)?);
        if mode & 0o077 != 0 {
            log::warn(format!(
                "{} is readable by other users (mode {mode:o}); chmod 600 it",
                key_path.display()
            ));
        }
        Ok(Self { key_path, key_id, issuer })
    }

    fn apply(&self, command: Cmd) -> Cmd {
        command.arg("--key").arg(&self.key_path).args([
            "--key-id",
            &self.key_id,
            "--issuer",
            &self.issuer,
        ])
    }
}

#[derive(Debug, Deserialize)]
struct Submission {
    id: Option<String>,
    status: Option<String>,
    message: Option<String>,
}

/// Submits `file` (ZIP, DMG or PKG), waits for the verdict and fails with Apple's log unless it is
/// `Accepted`.
pub fn submit(file: &Path, credentials: &Credentials) -> Result<()> {
    log::info(format!(
        "submitting {} to Apple's notary service (usually a few minutes)",
        fsx::file_name(file)?
    ));
    let output = credentials
        .apply(Cmd::new("xcrun").args(["notarytool", "submit"]).arg(file))
        .args(["--wait", "--timeout", "1h", "--output-format", "json"])
        .output_any()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let submission: Submission = serde_json::from_str(stdout.trim()).with_context(|| {
        format!("notarytool did not answer with JSON:\n{}", combined(&output).trim())
    })?;
    let id = submission.id.unwrap_or_default();
    match submission.status.as_deref() {
        Some("Accepted") => {
            log::ok(format!("notarized ({id})"));
            Ok(())
        }
        status => {
            let details = if id.is_empty() {
                String::new()
            } else {
                credentials
                    .apply(Cmd::new("xcrun").args(["notarytool", "log", &id]))
                    .quiet()
                    .output_any()
                    .map(|log| combined(&log))
                    .unwrap_or_default()
            };
            bail!(
                "notarization of {} ended with {status:?} ({}){}",
                file.display(),
                submission.message.unwrap_or_default(),
                if details.is_empty() { String::new() } else { format!(":\n{details}") }
            )
        }
    }
}

/// Attaches the ticket and checks it.
pub fn staple(path: &Path) -> Result<()> {
    Cmd::new("xcrun").args(["stapler", "staple"]).arg(path).output()?;
    validate(path)?;
    log::ok(format!("ticket stapled to {}", fsx::file_name(path)?));
    Ok(())
}

/// `stapler validate`: the item carries a valid notarization ticket.
pub fn validate(path: &Path) -> Result<()> {
    Cmd::new("xcrun")
        .args(["stapler", "validate"])
        .arg(path)
        .quiet()
        .output()
        .with_context(|| format!("{} has no valid notarization ticket", path.display()))?;
    Ok(())
}

/// Gatekeeper's verdict for a downloaded copy: `source=Notarized Developer ID`.
pub fn assess(path: &Path, image: bool) -> Result<()> {
    let command = if image {
        Cmd::new("spctl").args([
            "-a",
            "-vv",
            "-t",
            "open",
            "--context",
            "context:primary-signature",
        ])
    } else {
        Cmd::new("spctl").args(["-a", "-vv", "-t", "execute"])
    };
    let output = command.arg(path).quiet().output_any()?;
    let text = combined(&output);
    if !output.status.success() || !text.contains("Notarized Developer ID") {
        bail!("Gatekeeper does not accept {} as notarized:\n{}", path.display(), text.trim());
    }
    Ok(())
}

/// Notarizes and staples an app bundle (submitted as a `ditto` ZIP).
pub fn notarize_app(app: &Path, credentials: &Credentials) -> Result<()> {
    let temporary = tempfile::Builder::new().prefix("att-notarize-").tempdir()?;
    let zip = temporary.path().join("Azure-timetracker-notarize.zip");
    Cmd::new("ditto").args(["-c", "-k", "--keepParent"]).arg(app).arg(&zip).output()?;
    submit(&zip, credentials)?;
    staple(app)
}

/// Notarizes and staples a signed disk image.
pub fn notarize_image(image: &Path, credentials: &Credentials) -> Result<()> {
    submit(image, credentials)?;
    staple(image)
}
