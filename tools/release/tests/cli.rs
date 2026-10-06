//! The `att-release` binary itself: help, the stdout contract, and feed → verify → stage on a
//! synthetic Windows-only release in a temporary repository. No real key or identity is used.

mod support;

use std::fs;
use std::path::Path;
use std::process::{Command, Output};

use att_release::{checksum, updater_key};

fn att_release(args: &[&str], dir: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_att-release"))
        .args(args)
        .current_dir(dir)
        .env_remove("TAURI_SIGNING_PRIVATE_KEY")
        .env_remove("TAURI_SIGNING_PRIVATE_KEY_PASSWORD")
        .env_remove("AZURE_TIME_SIGN_IDENTITY")
        .output()
        .unwrap()
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

#[test]
fn help_lists_every_subcommand() {
    let temp = tempfile::tempdir().unwrap();
    let output = att_release(&["--help"], temp.path());
    assert!(output.status.success());
    let help = text(&output.stdout);
    for command in [
        "keygen-v2",
        "build-macos",
        "sign-macos",
        "package-macos",
        "bridge",
        "feed",
        "build-windows",
        "sign-update",
        "stage",
        "verify",
    ] {
        assert!(help.contains(command), "{command} missing from:\n{help}");
    }
}

#[test]
fn keygen_prints_only_the_public_key_on_stdout() {
    let temp = tempfile::tempdir().unwrap();
    let key = temp.path().join("keys/updater-v2.key");
    let output = att_release(&["keygen-v2", "--path", key.to_str().unwrap()], temp.path());
    assert!(output.status.success(), "{}", text(&output.stderr));
    let public = text(&output.stdout);
    assert_eq!(public.trim(), fs::read_to_string(updater_key::public_path(&key)).unwrap());
    assert!(text(&output.stderr).contains("plugins.updater.pubkey"));
    assert!(!text(&output.stdout).contains("untrusted comment"), "only the base64 key is printed");
    let again = att_release(&["keygen-v2", "--path", key.to_str().unwrap()], temp.path());
    assert_eq!(text(&again.stdout), public, "idempotent");
}

#[test]
fn feed_verify_and_stage_a_windows_release() {
    let temp = tempfile::tempdir().unwrap();
    let key = support::updater_key(temp.path());
    let artifacts = temp.path().join("artifacts");
    fs::create_dir_all(&artifacts).unwrap();
    let installer = artifacts.join("Azure-timetracker-2.0.0-x64-setup.exe");
    fs::write(&installer, b"MZ fake installer").unwrap();
    checksum::write_side_file(&installer).unwrap();
    updater_key::sign_file(&key, &installer, "2.0.0").unwrap();
    let notes = temp.path().join("2.0.0.md");
    fs::write(&notes, "# 2.0.0\n\nCross-platform.\n").unwrap();
    let pubkey = temp.path().join("pubkey.txt");
    fs::write(&pubkey, &key.public_b64).unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(repo.join("releases/latest")).unwrap();
    fs::write(repo.join("Cargo.toml"), "[workspace]\n").unwrap();

    let feed = att_release(
        &[
            "feed",
            "--version",
            "2.0.0",
            "--notes",
            notes.to_str().unwrap(),
            "--windows-installer",
            installer.to_str().unwrap(),
            "--pub-date",
            "2026-10-06T09:00:00Z",
            "--pubkey",
            pubkey.to_str().unwrap(),
        ],
        temp.path(),
    );
    assert!(feed.status.success(), "{}", text(&feed.stderr));
    assert_eq!(text(&feed.stdout).trim(), artifacts.join("latest.json").display().to_string());

    let verify = att_release(
        &[
            "--repo",
            repo.to_str().unwrap(),
            "verify",
            artifacts.to_str().unwrap(),
            "--pubkey",
            pubkey.to_str().unwrap(),
        ],
        temp.path(),
    );
    assert!(verify.status.success(), "{}", text(&verify.stderr));
    assert!(text(&verify.stderr).contains("All checks passed for 2.0.0"));

    let stage = att_release(
        &[
            "--repo",
            repo.to_str().unwrap(),
            "stage",
            "2.0.0",
            "--from",
            artifacts.to_str().unwrap(),
            "--pubkey",
            pubkey.to_str().unwrap(),
        ],
        temp.path(),
    );
    assert!(stage.status.success(), "{}", text(&stage.stderr));
    assert!(repo.join("releases/latest/Azure-timetracker-2.0.0-x64-setup.exe").is_file());
    assert!(
        repo.join("releases/updates/2.0.0/Azure-timetracker-2.0.0-x64-setup.exe.sig").is_file()
    );
    assert_eq!(
        fs::read(repo.join("updates/v2/latest.json")).unwrap(),
        fs::read(artifacts.join("latest.json")).unwrap()
    );
    assert!(!repo.join("updates/latest.json").exists(), "no bridge, no legacy feed");

    // A wrong public key fails verification with a non-zero exit code.
    let other = tempfile::tempdir().unwrap();
    let other_key = support::updater_key(other.path());
    let wrong = att_release(
        &[
            "--repo",
            repo.to_str().unwrap(),
            "verify",
            artifacts.to_str().unwrap(),
            "--pubkey",
            &other_key.public_b64,
        ],
        temp.path(),
    );
    assert!(!wrong.status.success());
    assert!(text(&wrong.stderr).contains("signature does not verify"), "{}", text(&wrong.stderr));
}
