//! `stage` on a synthetic repository in a temporary folder: archiving, immutability, feeds and the
//! bridge. macOS tools are off here (the macOS tests cover DMG and codesign checks).

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use att_release::legacy::manifest::AppRelease;
use att_release::legacy::preflight::{self, PreflightOptions};
use att_release::stage::{self, StageOptions};
use att_release::verify::VerifyOptions;
use att_release::{checksum, feed, legacy, tarball, updater_key};
use support::{
    AppSpec, VERSION, legacy_test_key, legacy_test_public_key, sign_legacy, write_app,
    write_legacy_manifest,
};

struct Fixture {
    _temp: tempfile::TempDir,
    repo: PathBuf,
    from: PathBuf,
    pubkey: String,
}

fn write_with_checksum(path: &Path, data: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, data).unwrap();
    checksum::write_side_file(path).unwrap();
}

/// A repository as it looks after 1.14.2, with a legacy feed signed by the throwaway key.
fn write_repository(repo: &Path, legacy_version: &str, legacy_build: i64) {
    let latest = repo.join("releases/latest");
    write_with_checksum(
        &latest.join("Azure-timetracker-1.14.2-universal-local-signed-app.pkg"),
        b"pkg 1.14.2",
    );
    write_with_checksum(
        &latest.join("Azure-timetracker-1.14.2-universal-local-signed.dmg"),
        b"dmg 1.14.2",
    );
    write_with_checksum(
        &repo.join("releases/archive/1.14.1/Azure-timetracker-1.14.1-universal-local-signed.dmg"),
        b"dmg 1.14.1",
    );
    let zip_name = format!("Azure-timetracker-{legacy_version}-universal-update.zip");
    let zip = repo.join("releases/updates").join(legacy_version).join(&zip_name);
    write_with_checksum(&zip, b"zip bytes");
    let release = AppRelease {
        version: legacy_version.to_owned(),
        build: legacy_build,
        minimum_macos: "14.0.0".to_owned(),
        published_at: "2026-10-05T14:48:05Z".to_owned(),
        notes: "# 1.14.2\n".to_owned(),
        url: legacy::manifest::legacy_asset_url(legacy_version),
        sha256: checksum::sha256_bytes(b"zip bytes"),
        size: 9,
        bundle_id: "be.yarne.azure-timetracker".to_owned(),
    };
    fs::create_dir_all(repo.join("updates")).unwrap();
    write_legacy_manifest(
        &repo.join("updates/latest.json"),
        &sign_legacy(&release, &legacy_test_key()),
    );
}

/// Artifacts of 2.0.0 as `package-macos`, `build-windows`/`sign-update`, `feed` and (optionally)
/// `bridge` + the Swift signer would leave them.
fn write_artifacts(from: &Path, key: &updater_key::UpdaterKey, bridge: bool) {
    fs::create_dir_all(from).unwrap();
    let build = tempfile::tempdir().unwrap();
    let app = write_app(build.path(), &AppSpec::default());
    write_with_checksum(
        &from.join(format!("Azure-timetracker-{VERSION}-universal-unsigned.dmg")),
        b"fake dmg",
    );
    let archive = from.join(format!("Azure-timetracker-{VERSION}-universal.app.tar.gz"));
    tarball::create(&app, &archive).unwrap();
    checksum::write_side_file(&archive).unwrap();
    updater_key::sign_file(key, &archive, VERSION).unwrap();
    let installer = from.join(format!("Azure-timetracker-{VERSION}-x64-setup.exe"));
    write_with_checksum(&installer, b"MZ fake nsis installer");
    updater_key::sign_file(key, &installer, VERSION).unwrap();
    let built =
        feed::build(VERSION, "# 2.0.0\n", "2026-10-06T09:00:00Z", Some(&archive), Some(&installer))
            .unwrap();
    fs::write(from.join("latest.json"), feed::to_json(&built).unwrap()).unwrap();
    if bridge {
        let zip = from.join(format!("Azure-timetracker-{VERSION}-universal-update.zip"));
        legacy::zip::write_update_zip(&app, &zip).unwrap();
        checksum::write_side_file(&zip).unwrap();
        let result = preflight::preflight_zip(
            &zip,
            Some(&app),
            PreflightOptions { use_ditto: false, codesign: false },
        )
        .unwrap();
        let release =
            preflight::expected_release(&result, "# 2.0.0\n", "2026-10-06T09:00:00Z").unwrap();
        write_legacy_manifest(
            &from.join("legacy-latest.json"),
            &sign_legacy(&release, &legacy_test_key()),
        );
    }
}

fn fixture(bridge_artifacts: bool) -> Fixture {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    let from = temp.path().join("artifacts");
    write_repository(&repo, "1.14.2", 24);
    let key = support::updater_key(temp.path());
    write_artifacts(&from, &key, bridge_artifacts);
    Fixture { pubkey: key.public_b64.clone(), _temp: temp, repo, from }
}

fn options(fixture: &Fixture, bridge: bool) -> StageOptions {
    let mut verify = VerifyOptions::new(fixture.pubkey.clone());
    verify.legacy_public_key = legacy_test_public_key();
    verify.allow_adhoc = true;
    verify.macos_tools = false;
    verify.require_universal = false;
    StageOptions {
        version: VERSION.to_owned(),
        from: fixture.from.clone(),
        repository: fixture.repo.clone(),
        bridge,
        verify,
    }
}

fn listing(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

#[test]
fn stages_a_release_and_archives_the_previous_installers() {
    let fixture = fixture(false);
    let legacy_before = fs::read(fixture.repo.join("updates/latest.json")).unwrap();
    let report = stage::stage(&options(&fixture, false)).unwrap();
    assert_eq!(report.archived.len(), 4);
    assert_eq!(
        listing(&fixture.repo.join("releases/latest")),
        [
            "Azure-timetracker-2.0.0-universal-unsigned.dmg",
            "Azure-timetracker-2.0.0-universal-unsigned.dmg.sha256",
            "Azure-timetracker-2.0.0-x64-setup.exe",
            "Azure-timetracker-2.0.0-x64-setup.exe.sha256",
        ]
    );
    assert_eq!(
        listing(&fixture.repo.join("releases/archive/1.14.2")),
        [
            "Azure-timetracker-1.14.2-universal-local-signed-app.pkg",
            "Azure-timetracker-1.14.2-universal-local-signed-app.pkg.sha256",
            "Azure-timetracker-1.14.2-universal-local-signed.dmg",
            "Azure-timetracker-1.14.2-universal-local-signed.dmg.sha256",
        ]
    );
    assert_eq!(
        listing(&fixture.repo.join("releases/updates/2.0.0")),
        [
            "Azure-timetracker-2.0.0-universal.app.tar.gz",
            "Azure-timetracker-2.0.0-universal.app.tar.gz.sha256",
            "Azure-timetracker-2.0.0-universal.app.tar.gz.sig",
            "Azure-timetracker-2.0.0-x64-setup.exe",
            "Azure-timetracker-2.0.0-x64-setup.exe.sha256",
            "Azure-timetracker-2.0.0-x64-setup.exe.sig",
        ]
    );
    assert_eq!(
        fs::read(fixture.repo.join("updates/v2/latest.json")).unwrap(),
        fs::read(fixture.from.join("latest.json")).unwrap()
    );
    assert_eq!(
        fs::read(fixture.repo.join("updates/latest.json")).unwrap(),
        legacy_before,
        "the legacy feed stays frozen"
    );
    assert!(
        fixture
            .repo
            .join("releases/updates/1.14.2/Azure-timetracker-1.14.2-universal-update.zip")
            .is_file()
    );
}

#[test]
fn staging_again_is_a_no_op() {
    let fixture = fixture(false);
    stage::stage(&options(&fixture, false)).unwrap();
    let again = stage::stage(&options(&fixture, false)).unwrap();
    assert!(again.copied.is_empty(), "{:?}", again.copied);
    assert!(again.archived.is_empty());
    assert_eq!(again.unchanged.len(), 11);
}

#[test]
fn published_update_assets_are_immutable() {
    let fixture = fixture(false);
    stage::stage(&options(&fixture, false)).unwrap();
    let published =
        fixture.repo.join("releases/updates/2.0.0/Azure-timetracker-2.0.0-x64-setup.exe");
    fs::write(&published, b"MZ different bytes").unwrap();
    let latest_before = listing(&fixture.repo.join("releases/latest"));
    let error = stage::stage(&options(&fixture, false)).unwrap_err().to_string();
    assert!(error.contains("immutable"), "{error}");
    assert_eq!(fs::read(&published).unwrap(), b"MZ different bytes", "nothing was overwritten");
    assert_eq!(listing(&fixture.repo.join("releases/latest")), latest_before);
}

#[test]
fn bridge_publishes_the_signed_legacy_manifest() {
    let fixture = fixture(true);
    stage::stage(&options(&fixture, true)).unwrap();
    assert_eq!(
        fs::read(fixture.repo.join("updates/latest.json")).unwrap(),
        fs::read(fixture.from.join("legacy-latest.json")).unwrap()
    );
    let updates = listing(&fixture.repo.join("releases/updates/2.0.0"));
    assert!(updates.contains(&"Azure-timetracker-2.0.0-universal-update.zip".to_owned()));
    assert!(updates.contains(&"Azure-timetracker-2.0.0-universal-update.zip.sha256".to_owned()));
    assert!(fixture.repo.join("updates/v2/latest.json").is_file());
}

#[test]
fn legacy_artifacts_need_the_bridge_flag_and_the_flag_needs_them() {
    let with_legacy = fixture(true);
    let error = stage::stage(&options(&with_legacy, false)).unwrap_err().to_string();
    assert!(error.contains("pass --bridge"), "{error}");
    let without = fixture(false);
    let error = stage::stage(&options(&without, true)).unwrap_err().to_string();
    assert!(error.contains("--bridge needs"), "{error}");
    assert!(!without.repo.join("updates/v2/latest.json").exists());
}

#[test]
fn bridge_must_be_newer_than_the_published_legacy_release() {
    let fixture = fixture(true);
    write_repository(&fixture.repo, "2.0.1", 26);
    let error = stage::stage(&options(&fixture, true)).unwrap_err().to_string();
    assert!(error.contains("the bridge must be newer"), "{error}");
    assert!(!fixture.repo.join("releases/updates/2.0.0").exists(), "refused before writing");
}

#[test]
fn a_tampered_legacy_manifest_is_refused() {
    let fixture = fixture(true);
    let path = fixture.from.join("legacy-latest.json");
    let text = fs::read_to_string(&path).unwrap().replace("# 2.0.0", "# 2.0.0 (edited)");
    fs::write(&path, text).unwrap();
    let error = stage::stage(&options(&fixture, true)).unwrap_err().to_string();
    assert!(error.contains("not signed by the trusted release key"), "{error}");
}

#[test]
fn refuses_newer_unexpected_or_conflicting_installers() {
    let fixture = fixture(false);
    let latest = fixture.repo.join("releases/latest");
    fs::write(latest.join("Azure-timetracker-2.1.0-x64-setup.exe"), b"MZ newer").unwrap();
    assert!(
        stage::stage(&options(&fixture, false)).unwrap_err().to_string().contains("newer release")
    );
    fs::remove_file(latest.join("Azure-timetracker-2.1.0-x64-setup.exe")).unwrap();

    fs::write(latest.join("notes.txt"), b"?").unwrap();
    assert!(
        stage::stage(&options(&fixture, false))
            .unwrap_err()
            .to_string()
            .contains("Unexpected file")
    );
    fs::remove_file(latest.join("notes.txt")).unwrap();

    fs::write(latest.join("Azure-timetracker-2.0.0-x64-setup.exe"), b"MZ other build").unwrap();
    assert!(
        stage::stage(&options(&fixture, false))
            .unwrap_err()
            .to_string()
            .contains("already staged with different bytes")
    );
    // Nothing moved during the refused runs.
    assert!(latest.join("Azure-timetracker-1.14.2-universal-local-signed.dmg").is_file());
}

#[test]
fn checksum_or_signature_problems_stop_staging() {
    let fixture = fixture(false);
    fs::write(
        fixture.from.join("Azure-timetracker-2.0.0-x64-setup.exe"),
        b"MZ swapped after signing",
    )
    .unwrap();
    let error = stage::stage(&options(&fixture, false)).unwrap_err().to_string();
    assert!(error.contains("checksum") && error.contains("signature"), "{error}");
    assert!(!fixture.repo.join("releases/updates/2.0.0").exists());
}

#[test]
fn recognises_installer_names() {
    for (name, version) in [
        ("Azure-timetracker-1.14.2-universal-local-signed-app.pkg", Some("1.14.2")),
        ("Azure-timetracker-1.14.2-universal-local-signed.dmg.sha256", Some("1.14.2")),
        ("Azure-timetracker-2.0.0-x64-setup.exe", Some("2.0.0")),
        ("Azure-timetracker-2.0.0-x64-setup.exe.sig", None),
        ("Azure-timetracker-2.0.0-universal.app.tar.gz", None),
        ("Azure-timetracker-2.0-universal-unsigned.dmg", None),
        ("README.md", None),
    ] {
        assert_eq!(
            stage::latest_file_version(name).map(|v| v.to_string()).as_deref(),
            version,
            "{name}"
        );
    }
}
