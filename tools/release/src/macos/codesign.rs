//! Code signing, mirroring `scripts/sign-app.sh` and `scripts/signing-config.sh`: inner code
//! first, the helper with its own identifier, then the app with Hardened Runtime and the calendar
//! entitlement. Tauri's bundler assumes a Developer ID flow, so it does not sign 2.x releases.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use super::macho;
use crate::consts::{
    self, BUNDLE_ID, CALENDAR_ENTITLEMENT, EXECUTABLE_PATH, HELPER_ID, HELPER_PATH,
};
use crate::process::{Cmd, combined};
use crate::{bundle, fsx, log, tree};

/// The entitlements 1.14.x shipped with (`Resources/App.entitlements`).
pub const ENTITLEMENTS: &str = include_str!("../../assets/App.entitlements");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// The persistent "Azure timetracker Local Signing" certificate: `--timestamp=none`.
    Local,
    /// A Developer ID Application certificate, should one ever exist: secure timestamp.
    DeveloperId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Identity {
    AdHoc,
    Certificate { selector: String, kind: Kind },
}

impl Identity {
    fn selector(&self) -> &str {
        match self {
            Identity::AdHoc => "-",
            Identity::Certificate { selector, .. } => selector,
        }
    }

    pub fn timestamp_flag(&self) -> &'static str {
        match self {
            Identity::Certificate { kind: Kind::DeveloperId, .. } => "--timestamp",
            _ => "--timestamp=none",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedIdentity {
    pub identity: Identity,
    pub source: String,
}

fn kind_from_env() -> Result<Kind> {
    match std::env::var("AZURE_TIME_SIGN_KIND").as_deref() {
        Err(_) | Ok("") | Ok("local") => Ok(Kind::Local),
        Ok("developer-id") => Ok(Kind::DeveloperId),
        Ok(other) => bail!("AZURE_TIME_SIGN_KIND must be `local` or `developer-id`, not {other:?}"),
    }
}

/// `--adhoc`, then `--identity`, then `AZURE_TIME_SIGN_IDENTITY`, then the local selector file
/// written by `scripts/setup-local-signing.sh`, else ad-hoc.
pub fn resolve_identity(adhoc: bool, explicit: Option<&str>) -> Result<ResolvedIdentity> {
    let certificate = |selector: &str, source: String| -> Result<ResolvedIdentity> {
        if selector == "-" {
            return Ok(ResolvedIdentity { identity: Identity::AdHoc, source });
        }
        Ok(ResolvedIdentity {
            identity: Identity::Certificate {
                selector: selector.to_owned(),
                kind: kind_from_env()?,
            },
            source,
        })
    };
    if adhoc {
        return Ok(ResolvedIdentity { identity: Identity::AdHoc, source: "--adhoc".to_owned() });
    }
    if let Some(selector) = explicit {
        return certificate(selector, "--identity".to_owned());
    }
    if let Ok(selector) = std::env::var("AZURE_TIME_SIGN_IDENTITY")
        && !selector.trim().is_empty()
    {
        return certificate(selector.trim(), "AZURE_TIME_SIGN_IDENTITY".to_owned());
    }
    let selector_file = consts::local_identity_selector_path()?;
    if selector_file.is_file() {
        let selector = fs::read_to_string(&selector_file)?.trim().to_owned();
        if !selector.is_empty() {
            return Ok(ResolvedIdentity {
                identity: Identity::Certificate { selector, kind: Kind::Local },
                source: selector_file.display().to_string(),
            });
        }
    }
    Ok(ResolvedIdentity {
        identity: Identity::AdHoc,
        source: "no signing identity configured".to_owned(),
    })
}

pub fn warn_adhoc(source: &str) {
    log::loud(&[
        "AD-HOC SIGNATURE (development only)",
        &format!("Reason: {source}."),
        "An ad-hoc build is NOT the persistent local identity: installing it",
        "loses Keychain access and Calendar/Accessibility grants, and the",
        "bridge update would ask for them again. `stage` refuses ad-hoc apps.",
        "Configure the local certificate (scripts/setup-local-signing.sh) or",
        "set AZURE_TIME_SIGN_IDENTITY for a release.",
    ]);
}

fn is_nested_bundle(name: &str) -> bool {
    [".framework", ".app", ".xpc", ".appex", ".bundle", ".plugin"]
        .iter()
        .any(|ext| name.ends_with(ext))
}

/// Mach-O files and nested bundles inside `Contents`, deepest first, without the main
/// executable and the helper (signed explicitly).
pub fn nested_code(app: &Path) -> Result<Vec<PathBuf>> {
    let mut found = Vec::new();
    for node in tree::ensure_plain_tree(app)? {
        let rel = node.rel();
        if rel == EXECUTABLE_PATH || rel == HELPER_PATH {
            continue;
        }
        let name = node.components.last().cloned().unwrap_or_default();
        let is_code = match node.kind {
            tree::Kind::Dir { .. } => is_nested_bundle(&name),
            tree::Kind::File { .. } => macho::is_macho(&node.path)?,
            _ => false,
        };
        if is_code {
            found.push((node.components.len(), node.path));
        }
    }
    found.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
    Ok(found.into_iter().map(|(_, path)| path).collect())
}

/// Signs the bundle inside-out and checks the result like `sign-app.sh` does.
pub fn sign_app(app: &Path, identity: &Identity, entitlements: Option<&Path>) -> Result<()> {
    let info = bundle::read_info_plist(app)?;
    if info.get("CFBundleIdentifier").and_then(plist::Value::as_string) != Some(BUNDLE_ID) {
        bail!("Unexpected bundle ID; refusing to change app identity (expected {BUNDLE_ID}).");
    }
    if !app.join(HELPER_PATH).is_file() {
        bail!("{} is missing", app.join(HELPER_PATH).display());
    }
    let temporary = tempfile::Builder::new().prefix("att-entitlements-").tempdir()?;
    let entitlements = match entitlements {
        Some(path) => path.to_owned(),
        None => {
            let path = temporary.path().join("App.entitlements");
            fs::write(&path, ENTITLEMENTS)?;
            path
        }
    };
    // Finder information or resource forks make strict verification fail (QA1940).
    Cmd::new("xattr").arg("-cr").arg(app).output_any()?;

    let base = |target: &Path| {
        Cmd::new("codesign")
            .args(["--force", "--options", "runtime", identity.timestamp_flag()])
            .arg("--sign")
            .arg(identity.selector())
            .arg(target)
    };
    for code in nested_code(app)? {
        log::info(format!("signing nested code {}", code.display()));
        base(&code).run()?;
    }
    Cmd::new("codesign")
        .args(["--force", "--options", "runtime", identity.timestamp_flag()])
        .args(["--identifier", HELPER_ID, "--sign", identity.selector()])
        .arg(app.join(HELPER_PATH))
        .run()?;
    Cmd::new("codesign")
        .args(["--force", "--options", "runtime", identity.timestamp_flag()])
        .arg("--entitlements")
        .arg(&entitlements)
        .args(["--identifier", BUNDLE_ID, "--sign", identity.selector()])
        .arg(app)
        .run()?;

    let signature = signature_info(app)?;
    match identity {
        Identity::Certificate { kind: Kind::Local, .. } => {
            if signature.adhoc || signature.authorities.is_empty() {
                bail!("A persistent certificate is required for local signing.");
            }
            if !signature.has_stable_requirement() {
                bail!(
                    "Missing stable certificate requirement: {:?}",
                    signature.designated_requirement
                );
            }
        }
        Identity::Certificate { kind: Kind::DeveloperId, .. } => {
            if !signature
                .authorities
                .iter()
                .any(|authority| authority.starts_with("Developer ID Application:"))
            {
                bail!(
                    "Use Developer ID, or set AZURE_TIME_SIGN_KIND=local for the local certificate."
                );
            }
            Cmd::new("codesign")
                .args(["--verify", "--strict", "-R=anchor apple generic"])
                .arg(app)
                .output()?;
        }
        Identity::AdHoc => {}
    }
    verify_deep_strict(app)?;
    Ok(())
}

pub fn verify_deep_strict(path: &Path) -> Result<()> {
    Cmd::new("codesign").args(["--verify", "--deep", "--strict"]).arg(path).output()?;
    Ok(())
}

#[derive(Debug, Clone, Default)]
pub struct SignatureInfo {
    pub identifier: Option<String>,
    pub adhoc: bool,
    pub runtime: bool,
    pub authorities: Vec<String>,
    pub team_identifier: Option<String>,
    pub designated_requirement: Option<String>,
}

impl SignatureInfo {
    /// A certificate-based designated requirement (not a `cdhash` one), as `verify-release.py`
    /// demanded for local-signed releases.
    pub fn has_stable_requirement(&self) -> bool {
        self.designated_requirement.as_deref().is_some_and(|requirement| {
            (requirement.contains("certificate") || requirement.contains("anchor"))
                && !requirement.contains("cdhash")
        })
    }

    /// The installer label: `developer-id`, `local-signed` or `unsigned` (ad-hoc).
    pub fn label(&self) -> &'static str {
        if self
            .authorities
            .iter()
            .any(|authority| authority.starts_with("Developer ID Application:"))
        {
            "developer-id"
        } else if !self.adhoc && !self.authorities.is_empty() {
            "local-signed"
        } else {
            "unsigned"
        }
    }
}

pub fn parse_signature_details(details: &str, requirement: &str) -> SignatureInfo {
    let mut info = SignatureInfo::default();
    for line in details.lines() {
        if let Some(value) = line.strip_prefix("Identifier=") {
            info.identifier = Some(value.trim().to_owned());
        } else if let Some(value) = line.strip_prefix("Authority=") {
            info.authorities.push(value.trim().to_owned());
        } else if let Some(value) = line.strip_prefix("TeamIdentifier=") {
            let value = value.trim();
            info.team_identifier = (value != "not set").then(|| value.to_owned());
        } else if line.starts_with("Signature=adhoc") {
            info.adhoc = true;
        } else if line.starts_with("CodeDirectory ")
            && let Some(flags) = line.split_whitespace().find(|word| word.starts_with("flags="))
        {
            info.adhoc |= flags.contains("adhoc");
            info.runtime = flags.contains("runtime");
        }
    }
    info.designated_requirement = requirement.lines().find_map(|line| {
        line.split_once("designated => ").map(|(_, requirement)| requirement.trim().to_owned())
    });
    info
}

pub fn signature_info(path: &Path) -> Result<SignatureInfo> {
    let details = Cmd::new("codesign").arg("-dvv").arg(path).output()?;
    let requirement = Cmd::new("codesign").args(["-d", "-r-"]).arg(path).output()?;
    Ok(parse_signature_details(&combined(&details), &combined(&requirement)))
}

pub fn entitlements(path: &Path) -> Result<plist::Dictionary> {
    let output =
        Cmd::new("codesign").args(["-d", "--entitlements", "-", "--xml"]).arg(path).output()?;
    if output.stdout.iter().all(u8::is_ascii_whitespace) {
        return Ok(plist::Dictionary::new());
    }
    plist::Value::from_reader_xml(output.stdout.as_slice())
        .context("codesign printed entitlements that are not a property list")?
        .into_dictionary()
        .context("entitlements are not a dictionary")
}

/// Signature checks shared by `verify` and `stage` for a 2.x bundle.
pub fn check_release_signature(app: &Path, allow_adhoc: bool) -> Result<SignatureInfo> {
    verify_deep_strict(app)?;
    let info = signature_info(app)?;
    if info.identifier.as_deref() != Some(BUNDLE_ID) {
        bail!("code signature identifier is {:?}, expected {BUNDLE_ID}", info.identifier);
    }
    if !info.runtime {
        bail!("the app is not signed with the Hardened Runtime");
    }
    if info.adhoc {
        if !allow_adhoc {
            bail!(
                "the app has an ad-hoc signature; release builds must use the persistent local certificate"
            );
        }
    } else if !info.has_stable_requirement() {
        bail!(
            "the designated requirement is not certificate-based: {:?}",
            info.designated_requirement
        );
    }
    let entitlements = entitlements(app)?;
    if entitlements.get(CALENDAR_ENTITLEMENT).and_then(plist::Value::as_boolean) != Some(true) {
        bail!("the app lacks the {CALENDAR_ENTITLEMENT} entitlement");
    }
    let helper = signature_info(&app.join(HELPER_PATH))?;
    if helper.identifier.as_deref() != Some(HELPER_ID) {
        bail!("the helper is signed as {:?}, expected {HELPER_ID}", helper.identifier);
    }
    let helper_meta = fs::metadata(app.join(HELPER_PATH))?;
    if !fsx::is_executable(&helper_meta) {
        bail!("{HELPER_PATH} is not executable");
    }
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_adhoc_details() {
        let details = "Executable=/x/Contents/MacOS/AzureTimetracker\nIdentifier=be.yarne.azure-timetracker\n\
            CodeDirectory v=20500 size=443 flags=0x10002(adhoc,runtime) hashes=3+7 location=embedded\n\
            Signature=adhoc\nTeamIdentifier=not set\n";
        let requirement = "Executable=/x\n# designated => cdhash H\"4358\" or cdhash H\"023b\"\n";
        let info = parse_signature_details(details, requirement);
        assert_eq!(info.identifier.as_deref(), Some(BUNDLE_ID));
        assert!(info.adhoc && info.runtime);
        assert!(!info.has_stable_requirement());
        assert_eq!(info.label(), "unsigned");
        assert_eq!(info.team_identifier, None);
    }

    #[test]
    fn parses_local_certificate_details() {
        let details = "Identifier=be.yarne.azure-timetracker\n\
            CodeDirectory v=20500 size=443 flags=0x10000(runtime) hashes=3+7 location=embedded\n\
            Authority=Azure timetracker Local Signing\nSigned Time=6 Oct 2026\nTeamIdentifier=not set\n";
        let requirement = "designated => identifier \"be.yarne.azure-timetracker\" and certificate leaf = H\"ab12\"\n";
        let info = parse_signature_details(details, requirement);
        assert!(!info.adhoc && info.runtime);
        assert!(info.has_stable_requirement());
        assert_eq!(info.label(), "local-signed");
        assert_eq!(info.authorities, ["Azure timetracker Local Signing"]);
    }

    #[test]
    fn embedded_entitlements_grant_calendar_access() {
        let value = plist::Value::from_reader_xml(ENTITLEMENTS.as_bytes()).unwrap();
        let dict = value.as_dictionary().unwrap();
        assert_eq!(dict.get(CALENDAR_ENTITLEMENT).and_then(plist::Value::as_boolean), Some(true));
        assert_eq!(dict.len(), 1);
    }
}
