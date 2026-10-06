//! macOS-only checks that need codesign, hdiutil, ditto, lipo or swift (all available without
//! Xcode). Signatures here are ad-hoc; the real local certificate is never used.
#![cfg(target_os = "macos")]

mod support;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use att_release::consts::{BUNDLE_ID, CALENDAR_ENTITLEMENT, HELPER_ID, HELPER_PATH};
use att_release::legacy::preflight::{self, PreflightOptions};
use att_release::legacy::{manifest, swift, zip};
use att_release::macos::codesign::{self, Identity, ResolvedIdentity};
use att_release::macos::{dmg, macho, stub};
use att_release::package::{self, PackageOptions, SignOptions};
use att_release::verify::{self, VerifyOptions};
use att_release::{checksum, feed, updater_key};
use support::{
    AppSpec, VERSION, fixture, legacy_test_key, legacy_test_public_key, repository_root,
    sign_legacy, stub_binary, write_app,
};

const PUBLISHED_ZIP: &str = "releases/updates/1.14.2/Azure-timetracker-1.14.2-universal-update.zip";

fn adhoc() -> ResolvedIdentity {
    ResolvedIdentity { identity: Identity::AdHoc, source: "tests use ad-hoc signatures".to_owned() }
}

fn sign_options(dir: &Path) -> SignOptions {
    SignOptions {
        identity: adhoc(),
        helper: Some(stub_binary()),
        entitlements: None,
        work_dir: dir.join("work"),
        require_universal: false,
    }
}

fn signed_app(dir: &Path) -> PathBuf {
    let app = write_app(dir, &AppSpec { mach_o: true, ..AppSpec::default() });
    package::sign_macos(&app, &sign_options(dir)).unwrap();
    app
}

fn verify_options(pubkey: &str) -> VerifyOptions {
    let mut options = VerifyOptions::new(pubkey.to_owned());
    options.legacy_public_key = legacy_test_public_key();
    options.allow_adhoc = true;
    options.require_universal = false;
    options
}

#[test]
fn signs_inner_code_then_helper_then_app_with_hardened_runtime() {
    let temp = tempfile::tempdir().unwrap();
    let app =
        write_app(temp.path(), &AppSpec { mach_o: true, helper: false, ..AppSpec::default() });
    let sidecar = app.join("Contents/MacOS/sidecar");
    fs::copy(stub_binary(), &sidecar).unwrap();
    package::sign_macos(&app, &sign_options(temp.path())).unwrap();

    let info = codesign::signature_info(&app).unwrap();
    assert_eq!(info.identifier.as_deref(), Some(BUNDLE_ID));
    assert!(info.runtime && info.adhoc);
    assert_eq!(info.label(), "unsigned");
    let helper = codesign::signature_info(&app.join(HELPER_PATH)).unwrap();
    assert_eq!(helper.identifier.as_deref(), Some(HELPER_ID));
    assert!(helper.runtime);
    assert!(codesign::signature_info(&sidecar).unwrap().runtime, "nested code is signed too");
    let entitlements = codesign::entitlements(&app).unwrap();
    assert_eq!(
        entitlements.get(CALENDAR_ENTITLEMENT).and_then(plist::Value::as_boolean),
        Some(true)
    );

    let error = codesign::check_release_signature(&app, false).unwrap_err().to_string();
    assert!(error.contains("ad-hoc"), "{error}");
    codesign::check_release_signature(&app, true).unwrap();

    // Signing again is idempotent.
    package::sign_macos(&app, &sign_options(temp.path())).unwrap();
    codesign::verify_deep_strict(&app).unwrap();
}

#[test]
fn signing_refuses_another_bundle_identity() {
    let temp = tempfile::tempdir().unwrap();
    let app = write_app(
        temp.path(),
        &AppSpec { mach_o: true, identifier: "com.example.other".to_owned(), ..AppSpec::default() },
    );
    assert!(package::sign_macos(&app, &sign_options(temp.path())).is_err());
}

#[test]
fn package_bridge_feed_and_verify_end_to_end() {
    let temp = tempfile::tempdir().unwrap();
    let app = signed_app(temp.path());
    let key = support::updater_key(temp.path());
    let out = temp.path().join("artifacts");
    let options = PackageOptions {
        out: out.clone(),
        key: &key,
        expected_pubkey: Some(key.public_b64.clone()),
        allow_adhoc: true,
        require_universal: false,
        dmg_identity: Identity::AdHoc,
    };
    let packaged = package::package_macos(&app, &options).unwrap();
    assert_eq!(packaged.dmg.file_name().unwrap(), "Azure-timetracker-2.0.0-universal-unsigned.dmg");
    checksum::verify_side_file(&packaged.dmg).unwrap();

    // DMG layout, read-only and compressed.
    let mount = dmg::attach(&packaged.dmg).unwrap();
    assert_eq!(fs::read_link(mount.path.join("Applications")).unwrap(), Path::new("/Applications"));
    let note = fs::read_to_string(mount.path.join(dmg::INSTALL_NOTE)).unwrap();
    assert!(note.contains("Open Anyway") && note.contains("not notarized"), "{note}");
    assert!(fs::write(mount.path.join("probe"), b"x").is_err(), "the image is read-only");
    drop(mount);
    let info = Command::new("hdiutil").arg("imageinfo").arg(&packaged.dmg).output().unwrap();
    assert!(String::from_utf8_lossy(&info.stdout).contains("UDZO"));

    // Windows asset as build-windows + sign-update leave it.
    let installer = out.join(format!("Azure-timetracker-{VERSION}-x64-setup.exe"));
    fs::write(&installer, b"MZ fake nsis installer").unwrap();
    checksum::write_side_file(&installer).unwrap();
    updater_key::sign_file(&key, &installer, VERSION).unwrap();

    // Bridge ZIP and a manifest signed with a throwaway key in place of the Swift signer.
    let zip_path = out.join(format!("Azure-timetracker-{VERSION}-universal-update.zip"));
    zip::write_update_zip(&app, &zip_path).unwrap();
    checksum::write_side_file(&zip_path).unwrap();
    let result = preflight::preflight_zip(&zip_path, Some(&app), PreflightOptions::host()).unwrap();
    let release =
        preflight::expected_release(&result, "# 2.0.0\n", "2026-10-06T09:00:00Z").unwrap();
    support::write_legacy_manifest(
        &out.join("legacy-latest.json"),
        &sign_legacy(&release, &legacy_test_key()),
    );

    let built = feed::build(
        VERSION,
        "# 2.0.0\n",
        "2026-10-06T09:00:00Z",
        Some(&packaged.archive),
        Some(&installer),
    )
    .unwrap();
    fs::write(out.join("latest.json"), feed::to_json(&built).unwrap()).unwrap();

    let found = verify::verify_dir(&out, &verify_options(&key.public_b64)).unwrap();
    assert!(
        found.dmg.is_some() && found.mac_archive.is_some() && found.windows_installer.is_some()
    );
    assert!(found.legacy_zip.is_some() && found.legacy_feed.is_some() && found.v2_feed.is_some());

    // Ad-hoc apps are refused for releases.
    let mut strict = verify_options(&key.public_b64);
    strict.allow_adhoc = false;
    let error = verify::verify_dir(&out, &strict).unwrap_err().to_string();
    assert!(error.contains("ad-hoc"), "{error}");

    // The designated requirement must match a reference (here: a differently built app).
    let mut reference = verify_options(&key.public_b64);
    let other = tempfile::tempdir().unwrap();
    let other_app = write_app(other.path(), &AppSpec { mach_o: true, ..AppSpec::default() });
    fs::write(other_app.join("Contents/Resources/locales/en.json"), b"{}").unwrap();
    package::sign_macos(&other_app, &sign_options(other.path())).unwrap();
    reference.reference = Some(other_app);
    let error = verify::verify_dir(&out, &reference).unwrap_err().to_string();
    assert!(error.contains("designated requirement"), "{error}");

    // Swapped signatures are caught.
    let archive_sig =
        fs::read(out.join(format!("Azure-timetracker-{VERSION}-universal.app.tar.gz.sig")))
            .unwrap();
    fs::write(out.join(format!("Azure-timetracker-{VERSION}-x64-setup.exe.sig")), archive_sig)
        .unwrap();
    assert!(verify::verify_dir(&out, &verify_options(&key.public_b64)).is_err());
}

#[test]
fn legacy_preflight_extracts_with_ditto_and_checks_the_signature() {
    let temp = tempfile::tempdir().unwrap();
    let app = signed_app(temp.path());
    let zip_path = temp.path().join(format!("Azure-timetracker-{VERSION}-universal-update.zip"));
    zip::write_update_zip(&app, &zip_path).unwrap();
    preflight::preflight_zip(&zip_path, Some(&app), PreflightOptions::host()).unwrap();

    // A resource changed after signing breaks the seal, as the 1.x client would see.
    fs::write(app.join("Contents/Resources/icon.icns"), b"changed after signing").unwrap();
    zip::write_update_zip(&app, &zip_path).unwrap();
    let error =
        preflight::preflight_zip(&zip_path, Some(&app), PreflightOptions::host()).unwrap_err();
    assert!(format!("{error:#}").contains("codesign"), "{error:#}");
}

/// The real 1.14.2 update, which 1.13–1.14.1 clients installed, passes the Rust port of the
/// client checks: layout, ditto extraction, bundle, code signature and the signed manifest.
#[test]
fn the_published_1_14_2_update_passes_the_ported_client_checks() {
    let zip_path = repository_root().join(PUBLISHED_ZIP);
    if !zip_path.is_file() {
        eprintln!("skipped: {} is not in this checkout", zip_path.display());
        return;
    }
    let result = preflight::preflight_zip(&zip_path, None, PreflightOptions::host()).unwrap();
    assert_eq!((result.bundle.version.as_str(), result.bundle.build), ("1.14.2", 24));
    let release = preflight::check_signed_manifest(
        &fixture("legacy-feed/1.14.2.json"),
        &zip_path,
        &manifest::pinned_public_key(),
        &result,
    )
    .unwrap();
    assert_eq!(release.size as u64, result.size);

    // 1.14.2 is signed with the persistent local certificate: the identity 2.x must keep.
    let temp = tempfile::tempdir().unwrap();
    let status = Command::new("/usr/bin/ditto")
        .args(["-x", "-k"])
        .arg(&zip_path)
        .arg(temp.path())
        .status()
        .unwrap();
    assert!(status.success());
    let info = codesign::signature_info(&temp.path().join("Azure timetracker.app")).unwrap();
    assert!(info.has_stable_requirement(), "{:?}", info.designated_requirement);
    assert_eq!(info.label(), "local-signed");
    assert!(
        info.designated_requirement.unwrap().contains("identifier \"be.yarne.azure-timetracker\"")
    );
}

/// Builds the Swift signer like `bridge` does and runs its key-free verify mode on the published
/// release (the Swift client code path). Never signs anything.
#[test]
fn swift_signer_builds_and_verifies_the_published_release() {
    let repository = repository_root();
    let zip_path = repository.join(PUBLISHED_ZIP);
    if !zip_path.is_file() || Command::new("swift").arg("--version").output().is_err() {
        eprintln!("skipped: needs swift and {}", zip_path.display());
        return;
    }
    let tool = swift::build_signer(&repository).unwrap();
    let output =
        swift::verify_with_signer(&tool, &fixture("legacy-feed/1.14.2.json"), &zip_path).unwrap();
    assert!(output.contains("Verified release 1.14.2 (build 24) and archive."), "{output}");
}

/// The bridge exit test: the unmodified 1.14.x client code installs the 2.x ZIP over a copy of
/// the real 1.14.2 app and keeps the previous bundle, as the 1.x helper does.
#[test]
fn bridge_dry_run_replaces_a_copy_of_the_published_1_14_2_app() {
    let repository = repository_root();
    let published = repository.join(PUBLISHED_ZIP);
    if !published.is_file() || Command::new("swiftc").arg("--version").output().is_err() {
        eprintln!("skipped: needs swiftc and {}", published.display());
        return;
    }
    let temp = tempfile::tempdir().unwrap();
    let build = temp.path().join("build");
    fs::create_dir_all(&build).unwrap();
    let app = signed_app(&build);
    let zip_path = temp.path().join(format!("Azure-timetracker-{VERSION}-universal-update.zip"));
    zip::write_update_zip(&app, &zip_path).unwrap();
    let applications = temp.path().join("Applications");
    fs::create_dir_all(&applications).unwrap();
    let status = Command::new("/usr/bin/ditto")
        .args(["-x", "-k"])
        .arg(&published)
        .arg(&applications)
        .status()
        .unwrap();
    assert!(status.success());
    let installed = applications.join("Azure timetracker.app");

    let work = repository.join("target/att-release/bridge-dry-run");
    att_release::legacy::dry_run::dry_run(&repository, &zip_path, &app, &installed, &work).unwrap();

    let now = att_release::bundle::legacy_bundle(
        &att_release::bundle::read_info_plist(&installed).unwrap(),
    )
    .unwrap();
    assert_eq!((now.version.as_str(), now.build), (VERSION, 25));
    let backups: Vec<_> = fs::read_dir(&applications)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.file_name().unwrap().to_string_lossy().starts_with(".AzureTimetracker-previous-")
        })
        .collect();
    assert_eq!(backups.len(), 1);
    let previous = att_release::bundle::legacy_bundle(
        &att_release::bundle::read_info_plist(&backups[0]).unwrap(),
    )
    .unwrap();
    assert_eq!(previous.version, "1.14.2");

    // A 2.x installation is not a valid starting point.
    assert!(
        att_release::legacy::dry_run::dry_run(&repository, &zip_path, &app, &installed, &work)
            .is_err()
    );
}

#[test]
fn helper_stub_is_universal_and_does_nothing() {
    let output = Command::new(stub_binary()).output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("1.13-1.14 updates require this file")
    );

    let installed = Command::new("rustup")
        .args(["target", "list", "--installed"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
        .unwrap_or_default();
    if !stub::TARGETS.iter().all(|target| installed.lines().any(|line| line.trim() == *target)) {
        eprintln!(
            "skipped the universal build: run `rustup target add x86_64-apple-darwin aarch64-apple-darwin`"
        );
        return;
    }
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("AzureTimetrackerUpdater");
    stub::build_universal(&temp.path().join("work"), &out).unwrap();
    macho::require_universal(&out).unwrap();
    assert!(fs::metadata(&out).unwrap().len() < 2 * 1024 * 1024, "tiny");
    let output = Command::new(&out).output().unwrap();
    assert_eq!(output.status.code(), Some(1));
}
