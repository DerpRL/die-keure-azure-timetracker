//! Synthetic fixtures for the integration tests: fake `Azure timetracker.app` bundles with an
//! Info.plist written by the `plist` crate, throwaway updater keys and a throwaway legacy key.
//! Nothing here touches the real keys, the keychain or the repository's release folders.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};

use att_release::legacy::manifest::{self, AppRelease, SignedAppRelease};
use att_release::updater_key::{self, KeySource, UpdaterKey};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use ed25519_dalek::{Signer, SigningKey};

pub const VERSION: &str = "2.0.0";
pub const BUILD: &str = "25";

#[derive(Debug, Clone)]
pub struct AppSpec {
    pub identifier: String,
    pub executable: String,
    pub version: String,
    pub build: String,
    pub minimum: String,
    pub helper: bool,
    /// Use the compiled stub binary (a real Mach-O) as executable and helper, for codesign.
    pub mach_o: bool,
}

impl Default for AppSpec {
    fn default() -> Self {
        Self {
            identifier: "be.yarne.azure-timetracker".to_owned(),
            executable: "AzureTimetracker".to_owned(),
            version: VERSION.to_owned(),
            build: BUILD.to_owned(),
            minimum: "14.0".to_owned(),
            helper: true,
            mach_o: false,
        }
    }
}

pub fn stub_binary() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_legacy-helper-stub"))
}

#[cfg(unix)]
pub fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

#[cfg(not(unix))]
pub fn set_mode(_path: &Path, _mode: u32) {}

pub fn write_info_plist(app: &Path, spec: &AppSpec) {
    let mut info = plist::Dictionary::new();
    info.insert("CFBundleIdentifier".into(), spec.identifier.clone().into());
    info.insert("CFBundleExecutable".into(), spec.executable.clone().into());
    info.insert("CFBundleShortVersionString".into(), spec.version.clone().into());
    info.insert("CFBundleVersion".into(), spec.build.clone().into());
    info.insert("LSMinimumSystemVersion".into(), spec.minimum.clone().into());
    info.insert("CFBundleName".into(), "Azure timetracker".into());
    info.insert("CFBundlePackageType".into(), "APPL".into());
    info.insert("LSUIElement".into(), true.into());
    info.insert("NSCalendarsFullAccessUsageDescription".into(), "Shows your agenda.".into());
    fs::create_dir_all(app.join("Contents")).unwrap();
    plist::Value::Dictionary(info).to_file_xml(app.join("Contents/Info.plist")).unwrap();
}

/// Writes `<parent>/Azure timetracker.app` and returns its path.
pub fn write_app(parent: &Path, spec: &AppSpec) -> PathBuf {
    let app = parent.join("Azure timetracker.app");
    write_info_plist(&app, spec);
    for dir in ["Contents/MacOS", "Contents/Resources/locales", "Contents/Helpers"] {
        fs::create_dir_all(app.join(dir)).unwrap();
    }
    let executable = app.join("Contents/MacOS/AzureTimetracker");
    let helper = app.join("Contents/Helpers/AzureTimetrackerUpdater");
    if spec.mach_o {
        fs::copy(stub_binary(), &executable).unwrap();
    } else {
        fs::write(&executable, b"#!/bin/sh\necho fake Azure timetracker\n").unwrap();
    }
    set_mode(&executable, 0o755);
    if spec.helper {
        if spec.mach_o {
            fs::copy(stub_binary(), &helper).unwrap();
        } else {
            fs::write(&helper, b"#!/bin/sh\nexit 1\n").unwrap();
        }
        set_mode(&helper, 0o755);
    }
    fs::write(app.join("Contents/Resources/icon.icns"), vec![7u8; 4096]).unwrap();
    fs::write(app.join("Contents/Resources/locales/en.json"), br#"{"hello":"world"}"#).unwrap();
    set_mode(&app.join("Contents/Resources/icon.icns"), 0o644);
    set_mode(&app.join("Contents/Resources/locales/en.json"), 0o644);
    app
}

/// A throwaway v2 updater key in `dir`, in the Tauri file format. It is unencrypted so tests skip
/// the scrypt derivation (slow in debug builds); the `keygen` tests cover encrypted keys.
pub fn updater_key(dir: &Path) -> UpdaterKey {
    let path = dir.join("throwaway-updater.key");
    if !path.exists() {
        let pair = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
        fs::write(&path, STANDARD.encode(pair.sk.to_box(None).unwrap().to_string())).unwrap();
        set_mode(&path, 0o600);
    }
    updater_key::load(&KeySource::File(path), "", None).unwrap()
}

/// A fixed throwaway Ed25519 key standing in for the legacy release key.
pub fn legacy_test_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

pub fn legacy_test_public_key() -> [u8; 32] {
    legacy_test_key().verifying_key().to_bytes()
}

/// What `AzureTimetrackerRelease` produces, signed with the throwaway key.
pub fn sign_legacy(release: &AppRelease, key: &SigningKey) -> SignedAppRelease {
    let signature = key.sign(&manifest::signing_data(release));
    SignedAppRelease {
        schema_version: 1,
        release: release.clone(),
        signature: STANDARD.encode(signature.to_bytes()),
    }
}

/// Pretty JSON like the Swift tool writes (`.prettyPrinted, .sortedKeys, .withoutEscapingSlashes`
/// is not reproduced exactly; clients only need valid JSON).
pub fn write_legacy_manifest(path: &Path, envelope: &SignedAppRelease) {
    fs::write(path, serde_json::to_vec_pretty(envelope).unwrap()).unwrap();
}

pub fn fixture(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(relative)
}

pub fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap()
}
