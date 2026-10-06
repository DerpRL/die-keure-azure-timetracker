//! Read-only repository discovery. Ported from RepositoryDiscovery.swift.
//!
//! Owner during the port: tracking and Git.
//!
//! A scan walks a folder depth-first. It never follows symbolic links (or Windows junctions),
//! never enters `.git` directories and, on macOS, skips package directories such as `.app`
//! bundles. Every candidate is checked with [`GitProbe::read`]; nothing is ever written.

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::git::{GitProbe, file_error};
use crate::model::{HostOs, Repository, last_path_component};
use crate::text::natural_cmp;

/// Directory extensions treated as packages on macOS, approximating Foundation's
/// `URLResourceKey.isPackageKey` (Launch Services package types). Compared case-insensitively.
/// Windows and Linux have no package directories, so nothing is skipped there.
pub const MACOS_PACKAGE_EXTENSIONS: &[&str] = &[
    // Applications, app extensions and loadable bundles.
    "app",
    "appex",
    "bundle",
    "component",
    "framework",
    "kext",
    "mdimporter",
    "plugin",
    "prefpane",
    "qlgenerator",
    "saver",
    "vst",
    "vst3",
    "xpc",
    // Developer documents.
    "playground",
    "xcarchive",
    "xcodeproj",
    "xcworkspace",
    // Libraries and package documents.
    "band",
    "fcpbundle",
    "logicx",
    "mpkg",
    "musiclibrary",
    "photoslibrary",
    "pkg",
    "rtfd",
    "scptd",
    "sparsebundle",
    "tvlibrary",
];

/// A repository found by a scan. `path` is canonical (see [`RepositoryDiscovery::canonical_path`]).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredRepository {
    pub path: String,
    /// The branch name, or "Detached HEAD".
    pub branch: String,
}

impl DiscoveredRepository {
    pub fn id(&self) -> &str {
        &self.path
    }

    pub fn name(&self) -> &str {
        last_path_component(&self.path)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryScan {
    /// Sorted in Finder order by path.
    pub repositories: Vec<DiscoveredRepository>,
    /// `"<path>: <reason>"` for every folder that could not be read or is not a valid repository.
    pub issues: Vec<String>,
}

/// Repository scanning and selection (Swift `RepositoryDiscovery`).
pub enum RepositoryDiscovery {}

impl RepositoryDiscovery {
    /// The absolute path with `.` and `..` removed and links resolved, as Swift's
    /// `standardizedFileURL.resolvingSymlinksInPath()`:
    /// - a path that does not exist stays unresolved;
    /// - on macOS `/private/var/…` and `/private/tmp/…` read as `/var/…` and `/tmp/…` when that path
    ///   exists, so the result matches what 1.14.x stored;
    /// - on Windows the `\\?\` verbatim prefix of `std::fs::canonicalize` is removed.
    pub fn canonical_path(path: &str) -> String {
        let standardized = standardize(Path::new(path));
        let resolved = match fs::canonicalize(&standardized) {
            Ok(real) => without_private_prefix(real),
            Err(_) => standardized,
        };
        strip_verbatim_prefix(&resolved.to_string_lossy())
    }

    /// Scans `folder` and everything below it. `cancelled` is polled before every entry; a
    /// cancelled scan returns [`AppError::Cancelled`]. Packages are skipped on macOS only.
    pub fn scan(
        folder: impl AsRef<Path>,
        cancelled: impl FnMut() -> bool,
    ) -> Result<RepositoryScan> {
        Self::scan_with(folder, HostOs::current() == HostOs::Macos, cancelled)
    }

    /// [`scan`](Self::scan) with an explicit package policy.
    pub fn scan_with(
        folder: impl AsRef<Path>,
        skip_packages: bool,
        mut cancelled: impl FnMut() -> bool,
    ) -> Result<RepositoryScan> {
        let root = PathBuf::from(Self::canonical_path(&folder.as_ref().to_string_lossy()));
        let metadata = fs::metadata(&root).map_err(|error| read_error(&root, &error))?;
        if !metadata.is_dir() {
            return Err(AppError::message("Choose a folder to scan for Git repositories."));
        }
        let mut scanner = Scanner::default();
        if cancelled() {
            return Err(AppError::Cancelled);
        }
        scanner.inspect(&root);
        let mut stack = vec![scanner.children(&root)];
        while let Some(level) = stack.last_mut() {
            let Some(path) = level.next() else {
                stack.pop();
                continue;
            };
            if cancelled() {
                return Err(AppError::Cancelled);
            }
            if path.file_name().is_some_and(|name| name == ".git") {
                continue;
            }
            let file_type = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata.file_type(),
                Err(error) => {
                    scanner.issue(&path, &read_error(&path, &error));
                    continue;
                }
            };
            // Links (and Windows junctions) are never followed, which also rules out cycles.
            if file_type.is_symlink() || !file_type.is_dir() {
                continue;
            }
            if skip_packages && Self::is_package(&path) {
                continue;
            }
            scanner.inspect(&path);
            let children = scanner.children(&path);
            stack.push(children);
        }
        let mut result = scanner.result;
        result.repositories.sort_by(|a, b| natural_cmp(&a.path, &b.path).then(a.path.cmp(&b.path)));
        Ok(result)
    }

    /// Whether a directory is a macOS package by its extension ([`MACOS_PACKAGE_EXTENSIONS`]).
    pub fn is_package(path: &Path) -> bool {
        path.extension().and_then(|extension| extension.to_str()).is_some_and(|extension| {
            MACOS_PACKAGE_EXTENSIONS.iter().any(|known| known.eq_ignore_ascii_case(extension))
        })
    }

    /// Selections add new roots without duplicating existing ones (compared by canonical path)
    /// or enabling existing paused repositories. New repositories store the canonical path.
    pub fn adding<I>(paths: I, existing: &[Repository]) -> Vec<Repository>
    where
        I: IntoIterator,
        I::Item: AsRef<str>,
    {
        let mut known: BTreeSet<String> =
            existing.iter().map(|repository| Self::canonical_path(&repository.path)).collect();
        let mut result = existing.to_vec();
        for path in paths {
            let canonical = Self::canonical_path(path.as_ref());
            if known.insert(canonical.clone()) {
                result.push(Repository::new(canonical));
            }
        }
        result
    }
}

/// Removes the verbatim prefix `std::fs::canonicalize` adds on Windows: `\\?\C:\…` becomes
/// `C:\…` and `\\?\UNC\server\share\…` becomes `\\server\share\…`. Other paths are unchanged.
pub fn strip_verbatim_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        let bytes = rest.as_bytes();
        let drive = bytes.len() >= 2
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes.len() == 2 || bytes[2] == b'\\');
        if drive {
            return rest.to_string();
        }
    }
    path.to_string()
}

/// Absolute, with `.` and `..` removed lexically and trailing separators dropped (Swift
/// `standardizedFileURL`). Relative paths resolve against the current directory, as
/// `URL(fileURLWithPath:)` does.
fn standardize(path: &Path) -> PathBuf {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let mut parts: Vec<Component<'_>> = Vec::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => match parts.last() {
                Some(Component::Normal(_)) => {
                    parts.pop();
                }
                Some(Component::RootDir | Component::Prefix(_)) => {}
                _ => parts.push(component),
            },
            _ => parts.push(component),
        }
    }
    parts.into_iter().collect()
}

/// Foundation reports `/private/var/…` and `/private/tmp/…` as `/var/…` and `/tmp/…` when that
/// path exists, so 1.14.x stored those spellings.
fn without_private_prefix(real: PathBuf) -> PathBuf {
    if HostOs::current() == HostOs::Macos
        && let Some(rest) = real.to_str().and_then(|text| text.strip_prefix("/private/"))
    {
        let public = Path::new("/").join(rest);
        if public.exists() {
            return public;
        }
    }
    real
}

fn read_error(path: &Path, error: &io::Error) -> AppError {
    let text = path.to_string_lossy();
    file_error(last_path_component(&text), error)
}

#[derive(Default)]
struct Scanner {
    result: RepositoryScan,
    seen: BTreeSet<String>,
}

impl Scanner {
    fn inspect(&mut self, directory: &Path) {
        if !directory.join(".git").exists() {
            return;
        }
        match GitProbe::read(directory) {
            Ok(snapshot) => {
                let path = RepositoryDiscovery::canonical_path(&directory.to_string_lossy());
                if self.seen.insert(path.clone()) {
                    let branch = snapshot.label().to_string();
                    self.result.repositories.push(DiscoveredRepository { path, branch });
                }
            }
            Err(error) => self.issue(directory, &error),
        }
    }

    fn issue(&mut self, path: &Path, error: &AppError) {
        self.result.issues.push(format!("{}: {error}", path.to_string_lossy()));
    }

    /// The entries of `directory` in Finder order, so issues are reported deterministically.
    fn children(&mut self, directory: &Path) -> std::vec::IntoIter<PathBuf> {
        let mut entries = Vec::new();
        match fs::read_dir(directory) {
            Ok(listing) => {
                for entry in listing {
                    match entry {
                        Ok(entry) => entries.push(entry.path()),
                        Err(error) => self.issue(directory, &read_error(directory, &error)),
                    }
                }
            }
            Err(error) => self.issue(directory, &read_error(directory, &error)),
        }
        entries.sort_by(|a, b| {
            let (left, right) = (file_name(a), file_name(b));
            natural_cmp(&left, &right).then(a.cmp(b))
        });
        entries.into_iter()
    }
}

fn file_name(path: &Path) -> std::borrow::Cow<'_, str> {
    path.file_name().map(|name| name.to_string_lossy()).unwrap_or_default()
}
