//! `Info.plist` checks: an exact port of the 1.13–1.14.x client rules (`AppVersion`,
//! `UpdateBundle` in `Sources/AzureTimetrackerCore/AppUpdates.swift`) plus this tool's stricter
//! release policy.

use std::cmp::Ordering;
use std::fmt;
use std::path::Path;

use anyhow::{Context, Result, bail};

use crate::consts::{
    APP_DIR_NAME, BUNDLE_ID, EXECUTABLE_NAME, EXECUTABLE_PATH, HELPER_PATH, INFO_PLIST_PATH,
};

/// `major.minor.patch`, each an ASCII integer without leading zeros and at most `Int32.max`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct AppVersion(pub [u32; 3]);

impl AppVersion {
    /// Port of `AppVersion.init`: Swift's `isNumber` admits other scripts' digits, but `Int()`
    /// then rejects them, so only ASCII digits pass.
    pub fn parse(text: &str) -> Result<Self, String> {
        let invalid = || "The update has an invalid version number.".to_owned();
        let parts: Vec<&str> = text.split('.').collect();
        if parts.len() != 3 {
            return Err(invalid());
        }
        let mut components = [0u32; 3];
        for (slot, part) in components.iter_mut().zip(&parts) {
            if part.is_empty()
                || !part.bytes().all(|b| b.is_ascii_digit())
                || (part.len() > 1 && part.starts_with('0'))
            {
                return Err(invalid());
            }
            let value: u64 = part.parse().map_err(|_| invalid())?;
            if value > i32::MAX as u64 {
                return Err(invalid());
            }
            *slot = value as u32;
        }
        Ok(Self(components))
    }
}

impl Ord for AppVersion {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.cmp(&other.0)
    }
}

impl PartialOrd for AppVersion {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl fmt::Display for AppVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.0[0], self.0[1], self.0[2])
    }
}

/// What the legacy client reads from `Contents/Info.plist` (`UpdateBundle`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyBundle {
    pub version: String,
    pub build: i64,
    /// Normalised to three components, e.g. `14.0` → `14.0.0`.
    pub minimum_macos: String,
}

/// Swift `Int(String)`: optional sign, ASCII digits, 64-bit range.
fn swift_int(text: &str) -> Option<i64> {
    let digits = text.strip_prefix(['+', '-']).unwrap_or(text);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

pub fn read_info_plist(app: &Path) -> Result<plist::Dictionary> {
    let path = app.join(INFO_PLIST_PATH);
    let value = plist::Value::from_file(&path)
        .with_context(|| format!("could not read {}", path.display()))?;
    value.into_dictionary().with_context(|| format!("{} is not a dictionary", path.display()))
}

fn string<'a>(info: &'a plist::Dictionary, key: &str) -> Option<&'a str> {
    info.get(key).and_then(plist::Value::as_string)
}

/// Port of `UpdateBundle(at:)`. Errors carry the client's message plus the reason.
pub fn legacy_bundle(info: &plist::Dictionary) -> Result<LegacyBundle, String> {
    let invalid = |reason: &str| {
        format!("The update is not a valid Azure timetracker application ({reason}).")
    };
    if string(info, "CFBundleIdentifier") != Some(BUNDLE_ID) {
        return Err(invalid(&format!("CFBundleIdentifier must be {BUNDLE_ID}")));
    }
    if string(info, "CFBundleExecutable") != Some(EXECUTABLE_NAME) {
        return Err(invalid(&format!("CFBundleExecutable must be {EXECUTABLE_NAME}")));
    }
    let minimum = string(info, "LSMinimumSystemVersion")
        .ok_or_else(|| invalid("LSMinimumSystemVersion is missing"))?;
    let version = string(info, "CFBundleShortVersionString")
        .ok_or_else(|| invalid("CFBundleShortVersionString is missing"))?;
    let build_text =
        string(info, "CFBundleVersion").ok_or_else(|| invalid("CFBundleVersion is missing"))?;
    let build = swift_int(build_text).filter(|build| *build > 0).ok_or_else(|| {
        invalid(&format!("CFBundleVersion {build_text:?} is not a positive integer"))
    })?;
    // Swift splits with omitted empty pieces here, so only a clean `X.Y` gains `.0`.
    let minimum_macos = if minimum.split('.').filter(|part| !part.is_empty()).count() == 2 {
        format!("{minimum}.0")
    } else {
        minimum.to_owned()
    };
    AppVersion::parse(&minimum_macos)
        .map_err(|_| invalid(&format!("LSMinimumSystemVersion {minimum:?} is invalid")))?;
    AppVersion::parse(version)
        .map_err(|_| invalid(&format!("CFBundleShortVersionString {version:?} is invalid")))?;
    Ok(LegacyBundle { version: version.to_owned(), build, minimum_macos })
}

/// The identity of a 2.x app bundle that this tool is willing to release.
#[derive(Debug, Clone)]
pub struct ReleaseBundle {
    pub version: AppVersion,
    pub version_text: String,
    pub build: i64,
    pub minimum_macos: String,
    pub info: plist::Dictionary,
}

/// Release policy: the legacy client rules, a canonical integer build (the bridge manifest
/// stores it as a number), the bundle folder name, and the executable and helper present.
pub fn check_release_bundle(app: &Path, require_helper: bool) -> Result<ReleaseBundle> {
    if app.file_name().and_then(|name| name.to_str()) != Some(APP_DIR_NAME) {
        bail!("expected a bundle named {APP_DIR_NAME:?}, got {}", app.display());
    }
    let info = read_info_plist(app)?;
    let legacy = legacy_bundle(&info).map_err(anyhow::Error::msg)?;
    let build_text = string(&info, "CFBundleVersion").unwrap_or_default();
    if build_text != legacy.build.to_string() || legacy.build > i32::MAX as i64 {
        bail!(
            "CFBundleVersion {build_text:?} must be a plain integer build number up to {} \
             (set bundle.macOS.bundleVersion in tauri.conf.json)",
            i32::MAX
        );
    }
    let executable = app.join(EXECUTABLE_PATH);
    if !executable.is_file() {
        bail!("{} is missing", executable.display());
    }
    if require_helper && !app.join(HELPER_PATH).is_file() {
        bail!("{} is missing; run `att-release sign-macos` first", app.join(HELPER_PATH).display());
    }
    let version = AppVersion::parse(&legacy.version).map_err(anyhow::Error::msg)?;
    Ok(ReleaseBundle {
        version,
        version_text: legacy.version,
        build: legacy.build,
        minimum_macos: legacy.minimum_macos,
        info,
    })
}

/// Soft expectations for parity with 1.14.x; reported as warnings.
pub fn parity_warnings(bundle: &ReleaseBundle) -> Vec<String> {
    let mut warnings = Vec::new();
    if bundle.info.get("LSUIElement").and_then(plist::Value::as_boolean) != Some(true) {
        warnings.push(
            "Info.plist has no LSUIElement=true; 1.14.x stayed out of the Dock and Command-Tab"
                .to_owned(),
        );
    }
    if string(&bundle.info, "NSCalendarsFullAccessUsageDescription").is_none() {
        warnings.push(
            "Info.plist has no NSCalendarsFullAccessUsageDescription; EventKit access will fail"
                .to_owned(),
        );
    }
    if AppVersion::parse(&bundle.minimum_macos)
        .is_ok_and(|minimum| minimum > AppVersion([14, 0, 0]))
    {
        warnings.push(format!(
            "LSMinimumSystemVersion {} is above 14.0: 1.14.x users on older macOS cannot take the bridge update",
            bundle.minimum_macos
        ));
    }
    warnings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_numerically() {
        assert!(AppVersion::parse("1.10.0").unwrap() > AppVersion::parse("1.9.9").unwrap());
        assert!(AppVersion::parse("2.0.0").unwrap() > AppVersion::parse("1.14.2").unwrap());
    }

    #[test]
    fn rejects_invalid_versions() {
        for value in [
            "1.2",
            "1.2.3.4",
            "01.2.3",
            "1.-2.0",
            "1.2.beta",
            "1.2.3 ",
            "1.2.2147483648",
            "١.2.3",
            "+1.2.3",
            "",
        ] {
            assert!(AppVersion::parse(value).is_err(), "{value:?} should be rejected");
        }
        assert!(AppVersion::parse("0.0.0").is_ok());
        assert!(AppVersion::parse("1.2.2147483647").is_ok());
    }

    #[test]
    fn swift_int_matches_swift_parsing() {
        assert_eq!(swift_int("25"), Some(25));
        assert_eq!(swift_int("+25"), Some(25));
        assert_eq!(swift_int("025"), Some(25));
        assert_eq!(swift_int("-3"), Some(-3));
        assert_eq!(swift_int("2.0.0"), None);
        assert_eq!(swift_int(" 25"), None);
        assert_eq!(swift_int("+"), None);
    }
}
