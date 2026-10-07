//! The 2.x updater: key pair, minisign signatures, feed JSON and the `.app.tar.gz` archive.

mod support;

use std::fs;

#[cfg(unix)]
use att_release::tree;
use att_release::updater_key::{self, KeySource, KeygenOutcome};
use att_release::{feed, tarball};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use support::VERSION;
#[cfg(unix)]
use support::{AppSpec, write_app};

#[test]
fn keygen_creates_a_tauri_format_pair_and_is_idempotent() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("keys/updater-v2.key");
    let (outcome, public) = updater_key::keygen(&path, "", None).unwrap();
    assert_eq!(outcome, KeygenOutcome::Created);
    // Files hold base64 of the minisign text boxes, as `tauri signer generate` writes them.
    let public_text = String::from_utf8(STANDARD.decode(&public).unwrap()).unwrap();
    assert!(public_text.starts_with("untrusted comment: minisign public key: "), "{public_text}");
    assert_eq!(fs::read_to_string(updater_key::public_path(&path)).unwrap(), public);
    let secret_text =
        String::from_utf8(STANDARD.decode(fs::read_to_string(&path).unwrap()).unwrap()).unwrap();
    assert!(secret_text.starts_with("untrusted comment: "), "{secret_text}");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(
            fs::metadata(path.parent().unwrap()).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
    // Idempotent: nothing is regenerated.
    let (again, same) = updater_key::keygen(&path, "", None).unwrap();
    assert_eq!((again, same.as_str()), (KeygenOutcome::AlreadyPresent, public.as_str()));
    // A lost .pub file is rebuilt from the private key.
    fs::remove_file(updater_key::public_path(&path)).unwrap();
    assert_eq!(
        updater_key::keygen(&path, "", None).unwrap(),
        (KeygenOutcome::PublicFileRestored, public.clone())
    );
    // A mismatching .pub file is refused.
    let other = temp.path().join("other.key");
    let (_, other_public) = updater_key::keygen(&other, "", None).unwrap();
    fs::write(updater_key::public_path(&path), other_public).unwrap();
    assert!(updater_key::keygen(&path, "", None).is_err());
}

#[test]
fn keygen_refuses_a_stray_public_key_and_paths_in_a_repository() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("updater-v2.key");
    fs::write(updater_key::public_path(&path), "stray").unwrap();
    let error = updater_key::keygen(&path, "", None).unwrap_err().to_string();
    assert!(error.contains("without its private key"), "{error}");

    let checkout = temp.path().join("checkout");
    fs::create_dir_all(checkout.join(".git")).unwrap();
    let inside = checkout.join("keys/updater-v2.key");
    let error = updater_key::keygen(&inside, "", None).unwrap_err().to_string();
    assert!(error.contains("outside any Git work tree"), "{error}");
    let error = updater_key::keygen(&temp.path().join("repo/updater.key"), "", Some(temp.path()))
        .unwrap_err()
        .to_string();
    assert!(error.contains("outside the Git repository"), "{error}");
    assert!(!inside.exists());
}

#[cfg(unix)]
#[test]
fn signing_refuses_a_key_readable_by_others() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("updater.key");
    updater_key::keygen(&path, "", None).unwrap();
    support::set_mode(&path, 0o644);
    let error = updater_key::load(&KeySource::File(path), "", None).err().unwrap().to_string();
    assert!(error.contains("permissions 600"), "{error}");
}

#[test]
fn password_protected_keys_need_the_password() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("updater.key");
    updater_key::keygen(&path, "correct horse", None).unwrap();
    assert!(updater_key::load(&KeySource::File(path.clone()), "", None).is_err());
    assert!(updater_key::load(&KeySource::File(path), "correct horse", None).is_ok());
}

#[test]
fn signatures_round_trip_and_bind_data_key_and_version() {
    let temp = tempfile::tempdir().unwrap();
    let key = support::updater_key(temp.path());
    let inline = updater_key::load(
        &KeySource::Inline(fs::read_to_string(temp.path().join("throwaway-updater.key")).unwrap()),
        "",
        None,
    )
    .unwrap();
    assert_eq!(inline.public_b64, key.public_b64);

    let file = temp.path().join(format!("Azure-timetracker-{VERSION}-universal.app.tar.gz"));
    fs::write(&file, b"archive bytes").unwrap();
    let signature = updater_key::sign_file(&key, &file, VERSION).unwrap();
    assert_eq!(
        fs::read_to_string(
            temp.path().join(format!("Azure-timetracker-{VERSION}-universal.app.tar.gz.sig"))
        )
        .unwrap(),
        signature
    );
    let comment =
        updater_key::verify(b"archive bytes", &signature, &key.public_b64, Some(VERSION)).unwrap();
    // The Tauri CLI layout, which the updater plugin parses for `version:`.
    let fields: Vec<&str> = comment.split('\t').collect();
    assert!(fields[0].starts_with("timestamp:"));
    assert_eq!(fields[1], format!("file:Azure-timetracker-{VERSION}-universal.app.tar.gz"));
    assert_eq!(fields[2], format!("version:{VERSION}"));
    // The signature box is what the plugin decodes.
    let text = String::from_utf8(STANDARD.decode(&signature).unwrap()).unwrap();
    assert!(text.starts_with("untrusted comment: signature from tauri secret key\n"), "{text}");

    assert!(updater_key::verify(b"tampered", &signature, &key.public_b64, Some(VERSION)).is_err());
    assert!(
        updater_key::verify(b"archive bytes", &signature, &key.public_b64, Some("2.0.1")).is_err()
    );
    let other = tempfile::tempdir().unwrap();
    let other_key = support::updater_key(other.path());
    assert!(
        updater_key::verify(b"archive bytes", &signature, &other_key.public_b64, Some(VERSION))
            .is_err()
    );
    assert_eq!(updater_key::public_key_id(&key.public_b64).unwrap(), key.key_id());
    assert!(updater_key::public_key_id("PLACEHOLDER").is_err());
}

fn signed_assets(
    dir: &std::path::Path,
) -> (att_release::updater_key::UpdaterKey, std::path::PathBuf, std::path::PathBuf) {
    let key = support::updater_key(dir);
    let mac = dir.join(format!("Azure-timetracker-{VERSION}-universal.app.tar.gz"));
    let windows = dir.join(format!("Azure-timetracker-{VERSION}-x64-setup.exe"));
    fs::write(&mac, b"mac archive").unwrap();
    fs::write(&windows, b"MZ windows installer").unwrap();
    updater_key::sign_file(&key, &mac, VERSION).unwrap();
    updater_key::sign_file(&key, &windows, VERSION).unwrap();
    (key, mac, windows)
}

#[test]
fn feed_has_the_tauri_static_shape() {
    let temp = tempfile::tempdir().unwrap();
    let (key, mac, windows) = signed_assets(temp.path());
    let built = feed::build(
        VERSION,
        "# 2.0.0\n\nNotes.\n",
        "2026-10-06T09:00:00Z",
        Some(&mac),
        Some(&windows),
    )
    .unwrap();
    let json: serde_json::Value = serde_json::from_str(&feed::to_json(&built).unwrap()).unwrap();
    let object = json.as_object().unwrap();
    assert_eq!(object.keys().collect::<Vec<_>>(), ["notes", "platforms", "pub_date", "version"]);
    assert_eq!(json["version"], VERSION);
    assert_eq!(json["pub_date"], "2026-10-06T09:00:00Z");
    let platforms = json["platforms"].as_object().unwrap();
    assert_eq!(
        platforms.keys().collect::<Vec<_>>(),
        ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]
    );
    let base = "https://raw.githubusercontent.com/DerpRL/die-keure-azure-timetracker/main/releases/updates/2.0.0/";
    for target in ["darwin-aarch64", "darwin-x86_64"] {
        assert_eq!(
            platforms[target]["url"],
            format!("{base}Azure-timetracker-2.0.0-universal.app.tar.gz")
        );
        assert_eq!(
            platforms[target]["signature"],
            fs::read_to_string(
                temp.path().join("Azure-timetracker-2.0.0-universal.app.tar.gz.sig")
            )
            .unwrap()
        );
    }
    assert_eq!(
        platforms["windows-x86_64"]["url"],
        format!("{base}Azure-timetracker-2.0.0-x64-setup.exe")
    );
    assert_eq!(platforms["windows-x86_64"].as_object().unwrap().len(), 2);
    assert_eq!(
        feed::check(&built, temp.path(), &key.public_b64).unwrap(),
        ["Azure-timetracker-2.0.0-universal.app.tar.gz", "Azure-timetracker-2.0.0-x64-setup.exe"]
    );
}

#[test]
fn feed_checks_reject_mismatches() {
    let temp = tempfile::tempdir().unwrap();
    let (key, mac, windows) = signed_assets(temp.path());
    let good =
        feed::build(VERSION, "Notes", "2026-10-06T09:00:00Z", Some(&mac), Some(&windows)).unwrap();

    let mut wrong_url = good.clone();
    wrong_url.platforms.get_mut("windows-x86_64").unwrap().url =
        "https://example.com/setup.exe".to_owned();
    assert!(feed::check(&wrong_url, temp.path(), &key.public_b64).is_err());

    let mut wrong_signature = good.clone();
    let mac_signature = good.platforms["darwin-aarch64"].signature.clone();
    wrong_signature.platforms.get_mut("windows-x86_64").unwrap().signature = mac_signature;
    assert!(feed::check(&wrong_signature, temp.path(), &key.public_b64).is_err());

    let mut one_mac = good.clone();
    one_mac.platforms.remove("darwin-x86_64");
    assert!(feed::check(&one_mac, temp.path(), &key.public_b64).is_err());

    let mut wrong_version = good.clone();
    wrong_version.version = "2.0.1".to_owned();
    assert!(feed::check(&wrong_version, temp.path(), &key.public_b64).is_err());

    fs::write(&windows, b"MZ replaced installer").unwrap();
    assert!(
        feed::check(&good, temp.path(), &key.public_b64).is_err(),
        "bytes changed after signing"
    );

    assert!(feed::build(VERSION, "Notes", "yesterday", Some(&mac), None).is_err());
    assert!(feed::build(VERSION, " ", "2026-10-06T09:00:00Z", Some(&mac), None).is_err());
    assert!(
        feed::build("2.0.1", "Notes", "2026-10-06T09:00:00Z", Some(&mac), None).is_err(),
        "file name must match the version"
    );
    assert!(feed::build(VERSION, "Notes", "2026-10-06T09:00:00Z", None, None).is_err());
    assert!(feed::parse(r#"{"version":"2.0.0","notes":"n","pub_date":"2026-10-06T09:00:00Z","platforms":{},"extra":1}"#).is_err());
}

// The archive takes the bundle's modes from the file system, which Windows does not keep.
#[cfg(unix)]
#[test]
fn updater_archive_round_trips_like_the_tauri_plugin() {
    let temp = tempfile::tempdir().unwrap();
    let app = write_app(temp.path(), &AppSpec::default());
    fs::create_dir_all(app.join("Contents/Resources/empty")).unwrap();
    let archive = temp.path().join(format!("Azure-timetracker-{VERSION}-universal.app.tar.gz"));
    tarball::create(&app, &archive).unwrap();

    // Plugin view: every entry sits under one top-level folder, which it strips.
    let decoder = flate2::read::GzDecoder::new(fs::File::open(&archive).unwrap());
    let mut tar = tar::Archive::new(decoder);
    let mut names = Vec::new();
    for entry in tar.entries().unwrap() {
        let entry = entry.unwrap();
        let header = entry.header();
        assert_eq!(header.mtime().unwrap(), 1_767_225_600);
        assert_eq!((header.uid().unwrap(), header.gid().unwrap()), (0, 0));
        names.push((entry.path().unwrap().display().to_string(), header.mode().unwrap()));
    }
    // Folder entries keep GNU tar's trailing slash; the plugin strips the first component anyway.
    assert_eq!(names[0], ("Azure timetracker.app/".to_owned(), 0o755));
    assert!(names.contains(&("Azure timetracker.app/Contents/Resources/empty/".to_owned(), 0o755)));
    assert!(names.iter().all(|(name, _)| name.starts_with("Azure timetracker.app")));
    assert!(
        names
            .contains(&("Azure timetracker.app/Contents/MacOS/AzureTimetracker".to_owned(), 0o755))
    );
    assert!(names.contains(&("Azure timetracker.app/Contents/Info.plist".to_owned(), 0o644)));

    let unpacked = tarball::extract(&archive, &temp.path().join("unpacked")).unwrap();
    assert_eq!(tree::inventory(&app).unwrap(), tree::inventory(&unpacked).unwrap());

    let again = temp.path().join("again.tar.gz");
    tarball::create(&app, &again).unwrap();
    assert_eq!(fs::read(&archive).unwrap(), fs::read(&again).unwrap(), "deterministic");
}

#[cfg(unix)]
#[test]
fn updater_archive_refuses_symlinks() {
    let temp = tempfile::tempdir().unwrap();
    let app = write_app(temp.path(), &AppSpec::default());
    std::os::unix::fs::symlink("Info.plist", app.join("Contents/link")).unwrap();
    assert!(tarball::create(&app, &temp.path().join("x.tar.gz")).is_err());
}

#[test]
fn extraction_refuses_entries_outside_the_app_folder() {
    let temp = tempfile::tempdir().unwrap();
    let archive = temp.path().join("evil.tar.gz");
    {
        let encoder = flate2::write::GzEncoder::new(
            fs::File::create(&archive).unwrap(),
            flate2::Compression::fast(),
        );
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_size(1);
        header.set_mode(0o644);
        header.set_entry_type(tar::EntryType::Regular);
        builder.append_data(&mut header, "Other.app/Contents/Info.plist", &b"x"[..]).unwrap();
        builder.into_inner().unwrap().finish().unwrap();
    }
    let error = tarball::extract(&archive, &temp.path().join("out")).unwrap_err().to_string();
    assert!(error.contains("outside Azure timetracker.app"), "{error}");
}
