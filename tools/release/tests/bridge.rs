//! `bridge` orchestration in a temporary repository whose legacy feed is the real, signed 1.14.2
//! manifest. Portable checks only (no ditto, codesign or swift); the legacy key path is printed,
//! never opened.

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use att_release::bridge::{self, BridgeOptions};
use att_release::legacy::preflight::PreflightOptions;
use support::{AppSpec, fixture, write_app};

struct Setup {
    _temp: tempfile::TempDir,
    app: PathBuf,
    options: BridgeOptions,
}

fn setup(spec: &AppSpec) -> Setup {
    let temp = tempfile::tempdir().unwrap();
    let repository = temp.path().join("repo");
    fs::create_dir_all(repository.join("updates")).unwrap();
    fs::copy(fixture("legacy-feed/1.14.2.json"), repository.join("updates/latest.json")).unwrap();
    let build = temp.path().join("build");
    fs::create_dir_all(&build).unwrap();
    let app = write_app(&build, spec);
    let notes = temp.path().join("2.0.0.md");
    fs::write(&notes, "# Azure timetracker 2.0.0\n\n- Rebuilt for macOS and Windows.\n").unwrap();
    let options = BridgeOptions {
        out: temp.path().join("out dir"),
        notes,
        repository,
        legacy_key_path: temp.path().join("never opened/update-signing.ed25519"),
        preflight: PreflightOptions { use_ditto: false, codesign: false },
        allow_adhoc: true,
        build_signer: false,
    };
    Setup { _temp: temp, app, options }
}

fn quoted(path: &Path) -> String {
    format!("'{}'", path.display())
}

#[test]
fn bridge_writes_the_zip_and_prints_the_signing_command() {
    let setup = setup(&AppSpec::default());
    let outcome = bridge::bridge(&setup.app, &setup.options).unwrap();
    assert_eq!(outcome.zip.file_name().unwrap(), "Azure-timetracker-2.0.0-universal-update.zip");
    assert!(outcome.zip.is_file());
    assert!(
        setup.options.out.join("Azure-timetracker-2.0.0-universal-update.zip.sha256").is_file()
    );
    // APP ZIP KEY NOTES OUTPUT_JSON, shell-quoted, in that order.
    let expected = [
        outcome.signer.display().to_string(),
        quoted(&setup.app),
        quoted(&outcome.zip),
        quoted(&setup.options.legacy_key_path),
        setup.options.notes.display().to_string(),
        quoted(&setup.options.out.join("legacy-latest.json")),
    ];
    let mut position = 0;
    for part in expected {
        let found = outcome.command[position..]
            .find(&part)
            .unwrap_or_else(|| panic!("{part} missing in {}", outcome.command));
        position += found + part.len();
    }
    assert!(outcome.command.contains("AzureTimetrackerRelease"));
    assert!(!setup.options.legacy_key_path.exists(), "the key path is only printed");
    assert!(!setup.options.out.join("legacy-latest.json").exists(), "nothing is signed");

    // Deterministic: a second run produces the same archive.
    let first = fs::read(&outcome.zip).unwrap();
    bridge::bridge(&setup.app, &setup.options).unwrap();
    assert_eq!(fs::read(&outcome.zip).unwrap(), first);
}

#[test]
fn bridge_must_be_newer_than_the_published_legacy_release() {
    let setup = setup(&AppSpec {
        version: "1.14.2".to_owned(),
        build: "24".to_owned(),
        ..AppSpec::default()
    });
    let error = bridge::bridge(&setup.app, &setup.options).unwrap_err().to_string();
    assert!(error.contains("already offers 1.14.2 (build 24)"), "{error}");
    assert!(
        !setup.options.out.exists() || fs::read_dir(&setup.options.out).unwrap().next().is_none()
    );
}

#[test]
fn bridge_refuses_bad_notes_and_a_key_path_inside_the_repository() {
    let mut setup = setup(&AppSpec::default());
    fs::write(&setup.options.notes, "bell \u{7}").unwrap();
    assert!(
        bridge::bridge(&setup.app, &setup.options)
            .unwrap_err()
            .to_string()
            .contains("control character")
    );
    fs::write(&setup.options.notes, "# 2.0.0\n").unwrap();
    setup.options.legacy_key_path = setup.options.repository.join("update-signing.ed25519");
    let error = bridge::bridge(&setup.app, &setup.options).unwrap_err().to_string();
    assert!(error.contains("outside the Git repository"), "{error}");
}
