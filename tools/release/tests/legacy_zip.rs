//! The bridge ZIP: layout like `build-update.py` (minus its allowlist) and the client preflight.

mod support;

use std::fs;

use att_release::legacy::archive::{self, CentralEntry};
use att_release::legacy::preflight::{self, PreflightOptions};
use att_release::legacy::zip;
use support::{AppSpec, VERSION, write_app};

/// Layout and metadata checks only; the macOS tests add ditto and codesign.
const PORTABLE: PreflightOptions = PreflightOptions { use_ditto: false, codesign: false };

fn zip_name() -> String {
    format!("Azure-timetracker-{VERSION}-universal-update.zip")
}

fn build(spec: &AppSpec) -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let app = write_app(temp.path(), spec);
    let out = temp.path().join(zip_name());
    (temp, app, out)
}

fn entries(path: &std::path::Path) -> Vec<CentralEntry> {
    archive::validate(&fs::read(path).unwrap()).unwrap()
}

#[test]
fn zip_layout_matches_the_legacy_builder() {
    let (_temp, app, out) = build(&AppSpec::default());
    let summary = zip::write_update_zip(&app, &out).unwrap();
    let data = fs::read(&out).unwrap();
    assert_eq!(summary.size, data.len() as u64);
    let entries = entries(&out);
    let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
    // Files only, sorted by path components, under the bundle prefix; no five-file allowlist.
    assert_eq!(
        names,
        [
            "Azure timetracker.app/Contents/Helpers/AzureTimetrackerUpdater",
            "Azure timetracker.app/Contents/Info.plist",
            "Azure timetracker.app/Contents/MacOS/AzureTimetracker",
            "Azure timetracker.app/Contents/Resources/icon.icns",
            "Azure timetracker.app/Contents/Resources/locales/en.json",
        ]
    );
    for entry in &entries {
        assert_eq!(entry.method, 8, "{} is deflated", entry.name);
        assert_eq!(entry.flags, 0);
        let executable = entry.name.ends_with("AzureTimetracker")
            || entry.name.ends_with("AzureTimetrackerUpdater");
        assert_eq!(entry.unix_mode, if executable { 0o100755 } else { 0o100644 }, "{}", entry.name);
    }
    // Fixed DOS timestamp 2026-01-01 00:00:00 in every local header, version made by Unix.
    for entry in &entries {
        let local = entry.local_offset as usize;
        assert_eq!(&data[local + 10..local + 14], &[0, 0, 0x21, 0x5c], "{}", entry.name);
        assert_eq!(&data[local + 28..local + 30], &[0, 0], "no extra field");
    }
    let central = data.windows(4).position(|window| window == [0x50, 0x4b, 0x01, 0x02]).unwrap();
    assert_eq!(&data[central + 4..central + 6], &[20, 3]);
}

#[test]
fn zip_is_deterministic() {
    let (temp, app, out) = build(&AppSpec::default());
    zip::write_update_zip(&app, &out).unwrap();
    let again = temp.path().join("again.zip");
    zip::write_update_zip(&app, &again).unwrap();
    assert_eq!(fs::read(&out).unwrap(), fs::read(&again).unwrap());
}

#[test]
fn empty_folders_survive_as_folder_entries() {
    let (_temp, app, out) = build(&AppSpec::default());
    fs::create_dir_all(app.join("Contents/Resources/empty")).unwrap();
    zip::write_update_zip(&app, &out).unwrap();
    let entry = entries(&out).into_iter().find(|entry| entry.name.ends_with("/empty/")).unwrap();
    assert_eq!(entry.method, 0);
    assert_eq!(entry.unix_mode & 0o170000, 0o040000);
    let result = preflight::preflight_zip(&out, Some(&app), PORTABLE).unwrap();
    assert!(result.inventory.contains_key("Contents/Resources/empty/"));
}

#[test]
fn preflight_accepts_the_bundle_and_reports_its_identity() {
    let (_temp, app, out) = build(&AppSpec::default());
    zip::write_update_zip(&app, &out).unwrap();
    let result = preflight::preflight_zip(&out, Some(&app), PORTABLE).unwrap();
    assert_eq!(result.bundle.version, VERSION);
    assert_eq!(result.bundle.build, 25);
    assert_eq!(result.bundle.minimum_macos, "14.0.0");
    assert_eq!(result.entries, 5);
    let release =
        preflight::expected_release(&result, "# 2.0.0\n\nNew app.\n", "2026-10-06T09:00:00Z")
            .unwrap();
    assert_eq!(
        release.url,
        "https://raw.githubusercontent.com/DerpRL/die-keure-azure-timetracker/main/releases/updates/2.0.0/Azure-timetracker-2.0.0-universal-update.zip"
    );
    assert_eq!(release.size as u64, result.size);
}

#[cfg(unix)]
#[test]
fn rejects_symlinks_in_the_bundle() {
    let (_temp, app, out) = build(&AppSpec::default());
    std::os::unix::fs::symlink("icon.icns", app.join("Contents/Resources/alias.icns")).unwrap();
    let error = zip::write_update_zip(&app, &out).unwrap_err().to_string();
    assert!(error.contains("symbolic link"), "{error}");
    assert!(!out.exists());
}

#[cfg(unix)]
#[test]
fn rejects_a_bundle_that_is_itself_a_link_outside() {
    let (temp, app, _out) = build(&AppSpec::default());
    let elsewhere = temp.path().join("elsewhere");
    fs::create_dir(&elsewhere).unwrap();
    let real = elsewhere.join("Azure timetracker.app");
    fs::rename(&app, &real).unwrap();
    std::os::unix::fs::symlink(&real, &app).unwrap();
    let error = zip::write_update_zip(&app, &temp.path().join(zip_name())).unwrap_err().to_string();
    assert!(error.contains("symbolic links to bundles are refused"), "{error}");
}

#[test]
fn rejects_parent_components_and_names_outside_the_bundle() {
    for name in [
        "Azure timetracker.app/../escape",
        "Azure timetracker.app/Contents/../../escape",
        "Other.app/Contents/Info.plist",
        "escape",
    ] {
        assert!(archive::check_name(name).is_err(), "{name:?}");
    }
    assert!(archive::check_name("Azure timetracker.app/Contents/Info.plist").is_ok());
}

#[test]
fn missing_helper_is_rejected() {
    let (_temp, app, out) = build(&AppSpec { helper: false, ..AppSpec::default() });
    let error = zip::write_update_zip(&app, &out).unwrap_err().to_string();
    assert!(
        error.contains("missing Azure timetracker.app/Contents/Helpers/AzureTimetrackerUpdater"),
        "{error}"
    );
}

#[cfg(unix)]
#[test]
fn helper_without_execute_permission_is_rejected() {
    let (_temp, app, out) = build(&AppSpec::default());
    support::set_mode(&app.join("Contents/Helpers/AzureTimetrackerUpdater"), 0o644);
    zip::write_update_zip(&app, &out).unwrap();
    let error = preflight::preflight_zip(&out, Some(&app), PORTABLE).unwrap_err().to_string();
    assert!(error.contains("missing its application or installer helper"), "{error}");
}

#[test]
fn non_integer_build_is_rejected() {
    for number in ["2.0.0", "abc", "0", ""] {
        let (_temp, app, out) = build(&AppSpec { build: number.to_owned(), ..AppSpec::default() });
        zip::write_update_zip(&app, &out).unwrap();
        let error = preflight::preflight_zip(&out, Some(&app), PORTABLE).unwrap_err().to_string();
        assert!(error.contains("CFBundleVersion"), "{number:?}: {error}");
    }
}

#[test]
fn wrong_identifier_or_executable_is_rejected() {
    let specs = [
        AppSpec { identifier: "com.example.other".to_owned(), ..AppSpec::default() },
        AppSpec { executable: "azure-timetracker".to_owned(), ..AppSpec::default() },
        AppSpec { minimum: "14".to_owned(), ..AppSpec::default() },
        AppSpec { version: "2.0".to_owned(), ..AppSpec::default() },
    ];
    for spec in specs {
        let (_temp, app, out) = build(&spec);
        zip::write_update_zip(&app, &out).unwrap();
        let error = preflight::preflight_zip(&out, Some(&app), PORTABLE).unwrap_err().to_string();
        assert!(error.contains("not a valid Azure timetracker application"), "{spec:?}: {error}");
    }
}

#[test]
fn archive_name_must_match_the_url_the_client_downloads() {
    let (temp, app, _out) = build(&AppSpec::default());
    let wrong = temp.path().join("Azure-timetracker-2.0.1-universal-update.zip");
    zip::write_update_zip(&app, &wrong).unwrap();
    let error = preflight::preflight_zip(&wrong, Some(&app), PORTABLE).unwrap_err().to_string();
    assert!(
        error.contains("must be named Azure-timetracker-2.0.0-universal-update.zip"),
        "{error}"
    );
}

#[test]
fn preflight_notices_a_changed_app() {
    let (_temp, app, out) = build(&AppSpec::default());
    zip::write_update_zip(&app, &out).unwrap();
    fs::write(app.join("Contents/Resources/locales/en.json"), b"changed").unwrap();
    let error = preflight::preflight_zip(&out, Some(&app), PORTABLE).unwrap_err().to_string();
    assert!(error.contains("differs"), "{error}");
}

#[test]
fn non_ascii_names_are_refused() {
    let (_temp, app, out) = build(&AppSpec::default());
    fs::write(app.join("Contents/Resources/café.txt"), b"x").unwrap();
    let error = zip::write_update_zip(&app, &out).unwrap_err().to_string();
    assert!(error.contains("non-ASCII"), "{error}");
}
