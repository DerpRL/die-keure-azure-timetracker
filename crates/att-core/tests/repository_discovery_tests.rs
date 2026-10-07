//! Ported from `Tests/AzureTimetrackerCoreTests/RepositoryDiscoveryTests.swift`, plus new tests
//! for package skipping, ordering, canonical paths, unreadable folders and the Windows verbatim
//! prefix.

use std::fs;
use std::path::{Path, PathBuf};

use att_core::AppError;
use att_core::discovery::{RepositoryDiscovery, strip_verbatim_prefix};
use att_core::model::Repository;

/// Swift `repository(_:_:)`: a repository on `feature/123-task` at `root/path`.
fn repository(root: &Path, path: &str) -> PathBuf {
    let repo = root.join(path);
    fs::create_dir_all(repo.join(".git")).unwrap();
    fs::write(repo.join(".git/HEAD"), "ref: refs/heads/feature/123-task\n").unwrap();
    repo
}

fn canonical(path: &Path) -> String {
    RepositoryDiscovery::canonical_path(&path.to_string_lossy())
}

/// Creates a directory link; `false` where the OS refuses (Windows without the privilege).
fn link_dir(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    let created = std::os::unix::fs::symlink(target, link);
    #[cfg(windows)]
    let created = std::os::windows::fs::symlink_dir(target, link);
    created.is_ok()
}

fn never() -> bool {
    false
}

#[test]
fn nested_repositories_worktrees_and_root() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let parent = repository(root, "group/project");
    let nested = repository(&parent, "nested project");
    let hidden = repository(root, ".hidden/project");
    let worktree = root.join("group/worktree");
    fs::create_dir_all(parent.join(".git/worktrees/test")).unwrap();
    fs::create_dir_all(&worktree).unwrap();
    fs::write(worktree.join(".git"), "gitdir: ../project/.git/worktrees/test\n").unwrap();
    fs::write(parent.join(".git/worktrees/test/HEAD"), "ref: refs/heads/feature/456-other\n")
        .unwrap();
    let result = RepositoryDiscovery::scan(root, never).unwrap();
    let mut found: Vec<String> = result.repositories.iter().map(|repo| repo.path.clone()).collect();
    found.sort();
    let mut expected: Vec<String> =
        [&parent, &nested, &hidden, &worktree].map(|path| canonical(path)).to_vec();
    expected.sort();
    assert_eq!(found, expected);
    assert!(result.issues.is_empty(), "{:?}", result.issues);
    assert_eq!(RepositoryDiscovery::scan(&parent, never).unwrap().repositories.len(), 2);

    let worktree = result.repositories.iter().find(|repo| repo.name() == "worktree").unwrap();
    assert_eq!(worktree.branch, "feature/456-other");
    assert_eq!(worktree.id(), worktree.path);
}

#[test]
fn ignores_git_metadata_and_directory_links_and_reports_invalid_roots() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let repo = repository(root, "project");
    repository(&repo, ".git/should-not-discover");
    link_dir(root, &root.join("loop"));
    link_dir(&repo, &root.join("alias"));
    let broken = root.join("broken/.git");
    fs::create_dir_all(&broken).unwrap();
    let result = RepositoryDiscovery::scan(root, never).unwrap();
    assert_eq!(result.repositories.len(), 1);
    assert_eq!(result.issues.len(), 1, "{:?}", result.issues);
    assert!(result.issues[0].contains("broken"));
    assert!(
        result.issues[0]
            .ends_with("broken: The file “HEAD” couldn’t be opened because there is no such file."),
        "{}",
        result.issues[0]
    );
}

#[test]
fn empty_invalid_and_cancelled_scans() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    assert!(RepositoryDiscovery::scan(root, never).unwrap().repositories.is_empty());
    assert_eq!(RepositoryDiscovery::scan(root, || true).unwrap_err(), AppError::Cancelled);
    assert!(RepositoryDiscovery::scan(root.join("missing"), never).is_err());
}

#[test]
fn selected_paths_do_not_duplicate_or_enable_existing_paused_repositories() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let first = repository(root, "first");
    let second = repository(root, "second");
    let alias = root.join("alias");
    if !link_dir(&first, &alias) {
        eprintln!("skipped: this system cannot create directory links");
        return;
    }
    let mut existing = Repository::new(first.to_string_lossy());
    existing.enabled = false;
    let second_path = second.to_string_lossy().to_string();
    let selection = [alias.to_string_lossy().to_string(), second_path.clone(), second_path];
    let result = RepositoryDiscovery::adding(&selection, std::slice::from_ref(&existing));
    assert_eq!(result.len(), 2);
    assert_eq!(result[0], existing);
    assert!(result[1].enabled);
    assert_eq!(result[1].path, canonical(&second));
}

#[test]
fn invalid_roots_and_cancellation_mid_scan() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    assert_eq!(
        RepositoryDiscovery::scan(root.join("missing"), never).unwrap_err().to_string(),
        "The file “missing” couldn’t be opened because there is no such file."
    );
    fs::write(root.join("file.txt"), "not a folder").unwrap();
    assert_eq!(
        RepositoryDiscovery::scan(root.join("file.txt"), never).unwrap_err().to_string(),
        "Choose a folder to scan for Git repositories."
    );
    repository(root, "a");
    repository(root, "b");
    let mut polls = 0;
    let cancelled = RepositoryDiscovery::scan(root, || {
        polls += 1;
        polls > 2
    });
    assert_eq!(cancelled.unwrap_err(), AppError::Cancelled);
}

#[test]
fn packages_are_skipped_on_macos_only() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    repository(root, "Tool.app/embedded");
    repository(root, "Project.XCODEPROJ");
    repository(root, "plain");
    let names = |skip_packages| {
        let result = RepositoryDiscovery::scan_with(root, skip_packages, never).unwrap();
        result.repositories.iter().map(|repo| repo.name().to_string()).collect::<Vec<_>>()
    };
    assert_eq!(names(true), ["plain"]);
    // Sorted by full path: `…/Tool.app/embedded` comes last.
    assert_eq!(names(false), ["plain", "Project.XCODEPROJ", "embedded"]);
    let skips_on_this_os = cfg!(target_os = "macos");
    let default_names: Vec<String> = RepositoryDiscovery::scan(root, never)
        .unwrap()
        .repositories
        .iter()
        .map(|repo| repo.name().to_string())
        .collect();
    assert_eq!(default_names.len(), if skips_on_this_os { 1 } else { 3 });

    assert!(RepositoryDiscovery::is_package(Path::new("/Applications/Safari.app")));
    assert!(RepositoryDiscovery::is_package(Path::new("Photos Library.photoslibrary")));
    assert!(!RepositoryDiscovery::is_package(Path::new("/code/app")));
    assert!(!RepositoryDiscovery::is_package(Path::new("/code/.app")));
    assert!(!RepositoryDiscovery::is_package(Path::new("/code/my.repo")));
}

#[test]
fn results_are_in_finder_order() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    for name in ["repo10", "Repo2", "repo1"] {
        repository(root, name);
    }
    let names: Vec<String> = RepositoryDiscovery::scan(root, never)
        .unwrap()
        .repositories
        .iter()
        .map(|repo| repo.name().to_string())
        .collect();
    assert_eq!(names, ["repo1", "Repo2", "repo10"]);
}

#[test]
fn canonical_paths_are_standardized_and_resolved() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let real = root.join("real");
    fs::create_dir_all(real.join("sub")).unwrap();
    let base = canonical(root);
    let separator = std::path::MAIN_SEPARATOR;
    let expected = format!("{base}{separator}real{separator}sub");
    assert_eq!(canonical(&root.join("real/./x/../sub/")), expected);
    assert_eq!(canonical(&real.join("sub")), expected);
    if link_dir(&real, &root.join("link")) {
        assert_eq!(canonical(&root.join("link/sub")), expected);
        // Missing paths stay unresolved, like Foundation: the root as given, which on Windows
        // can be an 8.3 short name (`RUNNER~1`) that only resolving would expand.
        let given = root.to_string_lossy();
        assert_eq!(
            canonical(&root.join("link/missing")),
            format!("{given}{separator}link{separator}missing")
        );
    }
    // Relative paths are resolved against the current directory.
    let relative = RepositoryDiscovery::canonical_path("some/../relative-att-path");
    assert!(Path::new(&relative).is_absolute(), "{relative}");
    assert!(relative.ends_with("relative-att-path"), "{relative}");
}

#[cfg(target_os = "macos")]
#[test]
fn macos_private_prefix_reads_like_foundation() {
    assert_eq!(RepositoryDiscovery::canonical_path("/private/tmp"), "/tmp");
    assert_eq!(RepositoryDiscovery::canonical_path("/tmp"), "/tmp");
    assert_eq!(RepositoryDiscovery::canonical_path("/tmp/./att-missing/../x/"), "/tmp/x");
    let temp = tempfile::tempdir().unwrap();
    let canonical = canonical(temp.path());
    assert!(!canonical.starts_with("/private/"), "{canonical}");
    let private = format!("/private{canonical}/att-missing");
    assert_eq!(RepositoryDiscovery::canonical_path(&private), private);
}

#[cfg(unix)]
#[test]
fn unreadable_folders_are_reported_and_skipped() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    repository(root, "visible");
    let locked = root.join("locked");
    repository(&locked, "inside");
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    let readable_anyway = fs::read_dir(&locked).is_ok();
    let result = RepositoryDiscovery::scan(root, never);
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
    if readable_anyway {
        eprintln!("skipped: permissions are not enforced for this user");
        return;
    }
    let result = result.unwrap();
    assert_eq!(result.repositories.len(), 1);
    assert_eq!(result.issues.len(), 1, "{:?}", result.issues);
    assert!(
        result.issues[0].ends_with(
            "locked: The file “locked” couldn’t be opened because you don’t have permission to view it."
        ),
        "{}",
        result.issues[0]
    );
}

#[test]
fn verbatim_prefixes_are_removed() {
    assert_eq!(strip_verbatim_prefix(r"\\?\C:\Users\me\repo"), r"C:\Users\me\repo");
    assert_eq!(strip_verbatim_prefix(r"\\?\d:\"), r"d:\");
    assert_eq!(strip_verbatim_prefix(r"\\?\UNC\server\share\repo"), r"\\server\share\repo");
    for unchanged in [
        r"\\?\Volume{0a1b2c3d-0000-0000-0000-100000000000}\repo",
        r"\\server\share\repo",
        r"C:\Users\me\repo",
        "/Users/me/repo",
        "",
    ] {
        assert_eq!(strip_verbatim_prefix(unchanged), unchanged);
    }
}

#[test]
fn repositories_decode_swift_json() {
    // `configuration.repositories` as Swift 1.14.2 wrote it: uppercase UUIDs, escaped slashes.
    let swift = r#"[{"enabled" : false, "id" : "C7B0B9A2-1D7E-4B8F-9E54-3A7D2E8F1B6C", "path" : "\/Users\/me\/Campus"}]"#;
    let repositories: Vec<Repository> = serde_json::from_str(swift).unwrap();
    assert_eq!(repositories[0].id.to_string(), "c7b0b9a2-1d7e-4b8f-9e54-3a7d2e8f1b6c");
    assert_eq!(repositories[0].path, "/Users/me/Campus");
    assert_eq!(repositories[0].name(), "Campus");
    assert!(!repositories[0].enabled);
    // Selecting the same folder again keeps the existing entry paused and adds nothing.
    let result = RepositoryDiscovery::adding(["/Users/me/Campus/"], &repositories);
    assert_eq!(result, repositories);
}
