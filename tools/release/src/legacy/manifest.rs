//! The signed 1.x release manifest (`updates/latest.json`): a port of `AppRelease`,
//! `SignedAppRelease.verified()` and `AppRelease.validate()` from `AppUpdates.swift`.
//!
//! Signing stays with the Swift `AzureTimetrackerRelease` tool and the real key on the release
//! Mac. This module only *verifies*, with the public key, by rebuilding the bytes Swift signs:
//! `JSONEncoder` with `.sortedKeys` and `.withoutEscapingSlashes`. The golden tests check the
//! rebuild against every manifest published since 1.13.0.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::bundle::AppVersion;
use crate::consts::{BUNDLE_ID, LEGACY_PUBLIC_KEY_B64, asset_url, legacy_zip_name};
use crate::dates;

pub const MAX_SIZE: i64 = 200 * 1024 * 1024;
pub const MAX_NOTES_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppRelease {
    pub version: String,
    pub build: i64,
    #[serde(rename = "minimumMacOS")]
    pub minimum_macos: String,
    #[serde(rename = "publishedAt")]
    pub published_at: String,
    pub notes: String,
    pub url: String,
    pub sha256: String,
    pub size: i64,
    #[serde(rename = "bundleID")]
    pub bundle_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedAppRelease {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    pub release: AppRelease,
    pub signature: String,
}

/// `UpdateTrust.assetURL(version:)`.
pub fn legacy_asset_url(version: &str) -> String {
    asset_url(version, &legacy_zip_name(version))
}

pub fn pinned_public_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    // A compile-time constant of the right length; covered by `pinned_key_decodes`.
    let bytes = STANDARD.decode(LEGACY_PUBLIC_KEY_B64).unwrap_or_default();
    if bytes.len() == 32 {
        key.copy_from_slice(&bytes);
    }
    key
}

/// A JSON string as Swift's `JSONEncoder` writes it with `.withoutEscapingSlashes`.
fn push_swift_string(out: &mut String, value: &str) {
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// `AppRelease.signingData()`: compact JSON with sorted keys and unescaped slashes. The keys are
/// plain ASCII, so Foundation's sort order equals byte order.
pub fn signing_data(release: &AppRelease) -> Vec<u8> {
    enum Field<'a> {
        Int(i64),
        Text(&'a str),
    }
    let fields = [
        ("build", Field::Int(release.build)),
        ("bundleID", Field::Text(&release.bundle_id)),
        ("minimumMacOS", Field::Text(&release.minimum_macos)),
        ("notes", Field::Text(&release.notes)),
        ("publishedAt", Field::Text(&release.published_at)),
        ("sha256", Field::Text(&release.sha256)),
        ("size", Field::Int(release.size)),
        ("url", Field::Text(&release.url)),
        ("version", Field::Text(&release.version)),
    ];
    let mut out = String::from("{");
    for (index, (key, value)) in fields.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        push_swift_string(&mut out, key);
        out.push(':');
        match value {
            Field::Int(number) => out.push_str(&number.to_string()),
            Field::Text(text) => push_swift_string(&mut out, text),
        }
    }
    out.push('}');
    out.into_bytes()
}

/// Notes that the Swift signer and every client encode identically: no control characters
/// other than tab, line feed and carriage return.
pub fn check_notes(notes: &str) -> Result<(), String> {
    if notes.len() > MAX_NOTES_BYTES {
        return Err(format!(
            "release notes are {} bytes; the 1.x client accepts at most {MAX_NOTES_BYTES}",
            notes.len()
        ));
    }
    if notes.trim().is_empty() {
        return Err("release notes are empty".to_owned());
    }
    if let Some(c) = notes.chars().find(|c| (*c as u32) < 0x20 && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(format!("release notes contain the control character U+{:04X}", c as u32));
    }
    Ok(())
}

/// Port of `AppRelease.validate()`.
pub fn validate_release(release: &AppRelease) -> Result<(), String> {
    let invalid = |reason: String| {
        format!("The update manifest contains invalid release details ({reason}).")
    };
    AppVersion::parse(&release.version).map_err(|e| invalid(format!("version: {e}")))?;
    AppVersion::parse(&release.minimum_macos).map_err(|e| invalid(format!("minimumMacOS: {e}")))?;
    if release.build <= 0 || release.build > i32::MAX as i64 {
        return Err(invalid(format!("build {} is out of range", release.build)));
    }
    if release.bundle_id != BUNDLE_ID {
        return Err(invalid(format!("bundleID {}", release.bundle_id)));
    }
    let expected = legacy_asset_url(&release.version);
    if release.url != expected {
        return Err(invalid(format!("url must be {expected}")));
    }
    if release.size <= 0 || release.size > MAX_SIZE {
        return Err(invalid(format!("size {} must be 1..=200 MiB", release.size)));
    }
    if release.sha256.len() != 64
        || !release.sha256.bytes().all(|b| b"0123456789abcdef".contains(&b))
    {
        return Err(invalid("sha256 must be 64 lowercase hex digits".to_owned()));
    }
    if !dates::is_internet_date_time(&release.published_at) {
        return Err(invalid(format!("publishedAt {:?}", release.published_at)));
    }
    if release.notes.len() > MAX_NOTES_BYTES {
        return Err(invalid("notes exceed 64 KiB".to_owned()));
    }
    Ok(())
}

/// Port of `SignedAppRelease.verified(publicKey:)`.
pub fn verify_envelope(
    envelope: &SignedAppRelease,
    public_key: &[u8; 32],
) -> Result<AppRelease, String> {
    let untrusted =
        "This update is not signed by the trusted release key. The installed app has not changed."
            .to_owned();
    if envelope.schema_version != 1 {
        return Err(format!("{untrusted} (schemaVersion {})", envelope.schema_version));
    }
    let signature = STANDARD
        .decode(&envelope.signature)
        .map_err(|_| format!("{untrusted} (signature is not base64)"))?;
    let signature: [u8; 64] =
        signature.try_into().map_err(|_| format!("{untrusted} (signature is not 64 bytes)"))?;
    let key = VerifyingKey::from_bytes(public_key)
        .map_err(|_| format!("{untrusted} (invalid public key)"))?;
    key.verify_strict(&signing_data(&envelope.release), &Signature::from_bytes(&signature))
        .map_err(|_| format!("{untrusted} (signature does not verify)"))?;
    validate_release(&envelope.release)?;
    Ok(envelope.release.clone())
}

pub fn parse_envelope(json: &[u8]) -> Result<SignedAppRelease, String> {
    serde_json::from_slice(json)
        .map_err(|error| format!("the legacy manifest is not valid JSON: {error}"))
}

/// `AppRelease.isNewer(than:build:)`.
pub fn is_newer(release: &AppRelease, version: &str, build: i64) -> Result<bool, String> {
    let incoming = AppVersion::parse(&release.version)?;
    let current = AppVersion::parse(version)?;
    Ok(incoming > current || (incoming == current && release.build > build))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_key_decodes() {
        assert_ne!(pinned_public_key(), [0u8; 32]);
        assert!(VerifyingKey::from_bytes(&pinned_public_key()).is_ok());
    }

    #[test]
    fn swift_string_escaping() {
        let mut out = String::new();
        push_swift_string(&mut out, "a/b \"q\" \\ \n\t\r\u{1} • →");
        assert_eq!(out, "\"a/b \\\"q\\\" \\\\ \\n\\t\\r\\u0001 • →\"");
    }
}
