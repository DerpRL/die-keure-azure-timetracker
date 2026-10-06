//! The 1.13–1.14.x client rules, ported from `Tests/AzureTimetrackerCoreTests/AppUpdateTests.swift`,
//! and golden vectors for the legacy manifest signature bytes.

mod support;

use std::fs;

use att_release::legacy::archive;
use att_release::legacy::manifest::{self, AppRelease};
use ed25519_dalek::SigningKey;
use support::{fixture, legacy_test_key, legacy_test_public_key, sign_legacy};

fn release() -> AppRelease {
    AppRelease {
        version: "1.13.0".to_owned(),
        build: 20,
        minimum_macos: "14.0.0".to_owned(),
        published_at: "2026-10-05T10:00:00Z".to_owned(),
        notes: "Update tests".to_owned(),
        url: manifest::legacy_asset_url("1.13.0"),
        sha256: "a".repeat(64),
        size: 100,
        bundle_id: "be.yarne.azure-timetracker".to_owned(),
    }
}

#[test]
fn compares_versions_numerically_and_builds_only_within_same_version() {
    let release = release();
    assert!(manifest::is_newer(&release, "1.12.0", 200).unwrap());
    assert!(manifest::is_newer(&release, "1.13.0", 19).unwrap());
    assert!(!manifest::is_newer(&release, "1.13.0", 20).unwrap());
    assert!(!manifest::is_newer(&release, "1.14.0", 1).unwrap());
}

#[test]
fn accepts_valid_signature_and_rejects_tampering() {
    let key = legacy_test_key();
    let other = SigningKey::from_bytes(&[9u8; 32]);
    let signed = sign_legacy(&release(), &key);
    // Formatting does not matter: the signature covers the canonical re-encoding.
    let restored = manifest::parse_envelope(&serde_json::to_vec_pretty(&signed).unwrap()).unwrap();
    assert_eq!(manifest::verify_envelope(&restored, &legacy_test_public_key()).unwrap(), release());
    assert!(manifest::verify_envelope(&restored, &other.verifying_key().to_bytes()).is_err());
    let mut tampered = restored.clone();
    tampered.release.notes = "Replaced notes".to_owned();
    assert!(manifest::verify_envelope(&tampered, &legacy_test_public_key()).is_err());
    let mut tampered = restored;
    tampered.schema_version = 2;
    assert!(manifest::verify_envelope(&tampered, &legacy_test_public_key()).is_err());
}

#[test]
fn rejects_invalid_release_even_when_signed() {
    type Change = fn(&mut AppRelease);
    let cases: [(&str, Change); 7] = [
        ("url", |r| r.url = "https://example.com/update.zip".to_owned()),
        ("bundle", |r| r.bundle_id = "other.app".to_owned()),
        ("size", |r| r.size = 201 * 1024 * 1024),
        ("hash", |r| r.sha256 = "A".repeat(64)),
        ("date", |r| r.published_at = "not a date".to_owned()),
        ("build", |r| r.build = 0),
        ("notes", |r| r.notes = "a".repeat(65537)),
    ];
    for (field, change) in cases {
        let mut invalid = release();
        change(&mut invalid);
        let signed = sign_legacy(&invalid, &legacy_test_key());
        assert!(
            manifest::verify_envelope(&signed, &legacy_test_public_key()).is_err(),
            "{field} should be rejected"
        );
    }
}

/// Every manifest published since 1.13.0 verifies with the pinned public key, which proves the
/// Rust rebuild of Swift's signing bytes (sorted keys, unescaped slashes, raw UTF-8 such as •
/// and →, `\n` escapes) matches what the Swift signer signed.
#[test]
fn published_manifests_verify_with_the_pinned_key() {
    for version in ["1.13.0", "1.13.1", "1.14.0", "1.14.1", "1.14.2"] {
        let json = fs::read(fixture(&format!("legacy-feed/{version}.json"))).unwrap();
        let envelope = manifest::parse_envelope(&json).unwrap();
        let verified = manifest::verify_envelope(&envelope, &manifest::pinned_public_key())
            .unwrap_or_else(|error| panic!("{version}: {error}"));
        assert_eq!(verified.version, version);
        let mut tampered = envelope.clone();
        tampered.release.notes.push(' ');
        assert!(manifest::verify_envelope(&tampered, &manifest::pinned_public_key()).is_err());
    }
}

// Minimal stored ZIP fixtures test the parser independently of the writer (as in Swift).
#[derive(Clone)]
struct ZipEntry {
    name: String,
    mode: u32,
    local_name: Option<String>,
    flags: u16,
    expanded: u32,
}

fn entry(name: &str) -> ZipEntry {
    ZipEntry {
        name: format!("Azure timetracker.app/{name}"),
        mode: 0x81ed,
        local_name: None,
        flags: 0,
        expanded: 0,
    }
}

fn put(value: u64, count: usize, into: &mut Vec<u8>) {
    for shift in 0..count {
        into.push(((value >> (shift * 8)) & 255) as u8);
    }
}

fn archive_with(extra: &[ZipEntry]) -> Vec<u8> {
    let mut entries: Vec<ZipEntry> = [
        "Contents/Info.plist",
        "Contents/MacOS/AzureTimetracker",
        "Contents/Helpers/AzureTimetrackerUpdater",
    ]
    .iter()
    .map(|name| entry(name))
    .collect();
    entries.extend_from_slice(extra);
    let (mut data, mut central) = (Vec::new(), Vec::new());
    for entry in &entries {
        let offset = data.len() as u64;
        let name = entry.name.as_bytes();
        let local = entry.local_name.as_deref().unwrap_or(&entry.name).as_bytes();
        put(0x04034b50, 4, &mut data);
        put(20, 2, &mut data);
        put(entry.flags.into(), 2, &mut data);
        data.extend_from_slice(&[0; 14]);
        put(entry.expanded.into(), 4, &mut data);
        put(local.len() as u64, 2, &mut data);
        put(0, 2, &mut data);
        data.extend_from_slice(local);
        put(0x02014b50, 4, &mut central);
        put(0x0314, 2, &mut central);
        put(20, 2, &mut central);
        put(entry.flags.into(), 2, &mut central);
        central.extend_from_slice(&[0; 14]);
        put(entry.expanded.into(), 4, &mut central);
        put(name.len() as u64, 2, &mut central);
        central.extend_from_slice(&[0; 8]);
        put(u64::from(entry.mode) << 16, 4, &mut central);
        put(offset, 4, &mut central);
        central.extend_from_slice(name);
    }
    let offset = data.len() as u64;
    let central_len = central.len() as u64;
    data.extend_from_slice(&central);
    put(0x06054b50, 4, &mut data);
    put(0, 4, &mut data);
    put(entries.len() as u64, 2, &mut data);
    put(entries.len() as u64, 2, &mut data);
    put(central_len, 4, &mut data);
    put(offset, 4, &mut data);
    put(0, 2, &mut data);
    data
}

#[test]
fn authenticates_archive_bytes_and_accepts_expected_layout() {
    let data = archive_with(&[]);
    let entries = archive::validate(&data).unwrap();
    assert_eq!(entries.len(), 3);
    let mut changed = data.clone();
    changed.push(0);
    assert!(archive::validate(&changed).is_err(), "trailing bytes after the end record");
}

#[test]
fn rejects_unsafe_and_duplicate_zip_paths() {
    for path in [
        "../outside",
        "Contents/../outside",
        "Contents/./alias",
        "Contents//alias",
        "Contents/Info.plist",
        "Contents\\alias",
        "Contents/\nmalformed",
    ] {
        assert!(
            archive::validate(&archive_with(&[entry(path)])).is_err(),
            "{path:?} should be rejected"
        );
    }
}

#[test]
fn rejects_symlinks_encryption_local_mismatch_and_expansion_bombs() {
    let link = ZipEntry { mode: 0xa1ff, ..entry("link") };
    let encrypted = ZipEntry { flags: 1, ..entry("encrypted") };
    let mismatch =
        ZipEntry { local_name: Some("Azure timetracker.app/else".to_owned()), ..entry("name") };
    let huge = ZipEntry { expanded: 512 * 1024 * 1024, ..entry("huge") };
    let outside = ZipEntry { name: "Other.app/Contents/Info.plist".to_owned(), ..entry("x") };
    for (label, bad) in [
        ("symlink", link),
        ("encrypted", encrypted),
        ("local name", mismatch),
        ("bomb", huge),
        ("outside", outside),
    ] {
        let error = archive::validate(&archive_with(&[bad])).unwrap_err();
        assert!(
            error.to_string().starts_with("The update archive has an unsupported or unsafe layout"),
            "{label}: {error}"
        );
    }
    let mut truncated = archive_with(&[]);
    truncated.pop();
    assert!(archive::validate(&truncated).is_err());
}

#[test]
fn requires_the_helper_entry() {
    // Same fixture without the helper: the 1.x client refuses it.
    let mut data = archive_with(&[]);
    let needle = b"Azure timetracker.app/Contents/Helpers/AzureTimetrackerUpdater";
    // Rename both copies of the helper entry to another path of the same length.
    let replacement = b"Azure timetracker.app/Contents/Helpers/AzureTimetrackerUpdatex";
    let mut start = 0;
    while let Some(position) =
        data[start..].windows(needle.len()).position(|window| window == needle)
    {
        let at = start + position;
        data[at..at + needle.len()].copy_from_slice(replacement);
        start = at + needle.len();
    }
    let error = archive::validate(&data).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("missing Azure timetracker.app/Contents/Helpers/AzureTimetrackerUpdater"),
        "{error}"
    );
}

#[test]
fn notes_must_encode_identically_for_signer_and_clients() {
    assert!(manifest::check_notes("# 2.0.0\n\n- Tabs\tand CRLF\r\n are fine • →").is_ok());
    assert!(manifest::check_notes("bell \u{7}").is_err());
    assert!(manifest::check_notes("   ").is_err());
    assert!(manifest::check_notes(&"a".repeat(65537)).is_err());
}
