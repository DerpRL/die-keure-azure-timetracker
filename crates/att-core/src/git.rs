//! Branch policy, ticket extraction, Git HEAD reading and debounce. Ported from GitWatcher.swift.
//!
//! Owner during the port: tracking and Git.
//!
//! [`GitProbe`] never runs `git` and never executes hooks. It reads at most two small files: the
//! repository's `.git` entry when that is a `gitdir: <path>` pointer (worktrees and submodules),
//! and `<git dir>/HEAD`.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use fancy_regex::{Regex, RegexBuilder};
use jiff::Timestamp;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::model::{Repository, last_path_component};

/// The default ticket pattern (Swift `Configuration.branchPattern`).
///
/// The optional `AB` separator class holds U+2212 MINUS SIGN next to `#`, `_` and `-`. Keep it:
/// 1.14.x settings contain this exact pattern.
pub const DEFAULT_BRANCH_PATTERN: &str = "(?:^|/)(?:AB[\u{2212}#_-]?)?([1-9][0-9]{0,8})(?=[_-]|$)";

/// `.git/HEAD` must be smaller than this many bytes (Swift `data.count < 8192`).
pub const HEAD_SIZE_LIMIT: usize = 8192;

/// The App activity log keeps the newest 2,000 entries (Swift `AppModel.record`).
pub const AUDIT_LIMIT: usize = 2000;

/// Ticket numbers are 7pace `tfsId`s: positive 32-bit integers.
const MAX_TICKET: i64 = i32::MAX as i64;

/// Backtracking budget for one search with a user pattern (the `fancy_regex` default, made
/// explicit). A pathological pattern then fails instead of hanging; ICU had no limit.
const BACKTRACK_LIMIT: usize = 1_000_000;

/// Upper bound for the compiled size of a user pattern.
const PATTERN_SIZE_LIMIT: usize = 1 << 20;

/// `develop` and `long-feature/*` are integration branches: they suggest a break, never a ticket.
pub enum BranchPolicy {}

impl BranchPolicy {
    pub fn suggests_break(branch: &str) -> bool {
        // Swift `split(separator: "/")` drops empty pieces, so "/develop" is still develop.
        let lowered = branch.to_lowercase();
        let family = lowered.split('/').find(|part| !part.is_empty());
        matches!(family, Some("develop" | "long-feature"))
    }
}

/// Ticket extraction with the user's pattern (Swift `BranchTicket`).
pub enum BranchTicket {}

impl BranchTicket {
    /// The single ticket number in `branch`. `None` for integration branches, for branches
    /// without a ticket and for ambiguous branches that contain two different numbers.
    ///
    /// The break policy runs before the pattern is compiled, as in Swift, so an invalid pattern is
    /// not reported for `develop`. Use [`BranchPattern`] to compile a pattern once and reuse it.
    pub fn extract(branch: &str, pattern: &str) -> Result<Option<i64>> {
        if BranchPolicy::suggests_break(branch) {
            return Ok(None);
        }
        BranchPattern::new(pattern)?.extract(branch)
    }

    /// The live tester text beside Settings → Tracking → Ticket pattern (Pages.swift).
    pub fn tester_result(branch: &str, pattern: &str) -> String {
        match Self::extract(branch, pattern) {
            Ok(Some(id)) => format!("Ticket #{id}"),
            Ok(None) => "No unique ticket found".to_string(),
            Err(error) => format!("Invalid pattern: {error}"),
        }
    }
}

/// A compiled ticket pattern: case-insensitive, with at least one capture group whose first
/// group is the ticket number.
#[derive(Clone, Debug)]
pub struct BranchPattern {
    regex: Regex,
}

impl BranchPattern {
    pub fn new(pattern: &str) -> Result<Self> {
        let regex = RegexBuilder::new(pattern)
            .case_insensitive(true)
            .backtrack_limit(BACKTRACK_LIMIT)
            .delegate_size_limit(PATTERN_SIZE_LIMIT)
            .build()
            // NSRegularExpression's wording, which 1.14.x showed in Settings.
            .map_err(|_| AppError::Message(format!("The value “{pattern}” is invalid.")))?;
        // `captures_len` counts the implicit whole-match group 0.
        if regex.captures_len() < 2 {
            return Err(AppError::message(
                "The branch pattern needs a capture group for the ticket number, such as ([0-9]+).",
            ));
        }
        Ok(Self { regex })
    }

    /// The pattern text.
    pub fn as_str(&self) -> &str {
        self.regex.as_str()
    }

    /// [`BranchTicket::extract`] with this pattern.
    pub fn extract(&self, branch: &str) -> Result<Option<i64>> {
        if BranchPolicy::suggests_break(branch) {
            return Ok(None);
        }
        let mut ids = BTreeSet::new();
        for captures in self.regex.captures_iter(branch) {
            let captures = captures.map_err(|_| {
                AppError::message(
                    "The branch pattern is too complex to check this branch. Simplify the pattern.",
                )
            })?;
            let id = captures.get(1).and_then(|group| group.as_str().parse::<i64>().ok());
            if let Some(id) = id.filter(|id| (1..=MAX_TICKET).contains(id)) {
                ids.insert(id);
            }
        }
        // Ambiguous branches require the user to select a ticket.
        Ok(if ids.len() == 1 { ids.pop_first() } else { None })
    }
}

/// One HEAD reading. `branch` is `None` for a detached HEAD; `head` is the trimmed HEAD text.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub head: String,
}

impl GitSnapshot {
    pub fn new(branch: Option<&str>, head: impl Into<String>) -> Self {
        Self { branch: branch.map(str::to_string), head: head.into() }
    }

    pub fn label(&self) -> &str {
        self.branch.as_deref().unwrap_or("Detached HEAD")
    }
}

/// Reads a repository's HEAD straight from disk (Swift `GitProbe`).
pub enum GitProbe {}

impl GitProbe {
    /// `path` is the working-tree root. Its `.git` is either the Git directory itself or a
    /// `gitdir: <path>` pointer file, absolute or relative to `path`.
    pub fn read(path: impl AsRef<Path>) -> Result<GitSnapshot> {
        let root = path.as_ref();
        let root_text = root.to_string_lossy();
        let name = last_path_component(&root_text);
        let dot_git = root.join(".git");
        // Swift `fileExists(atPath:isDirectory:)` follows links and treats any failure as absent.
        let Ok(metadata) = fs::metadata(&dot_git) else {
            return Err(AppError::Message(format!(
                "No Git repository at {name}. Choose its root folder."
            )));
        };
        let git_dir = if metadata.is_dir() {
            dot_git
        } else {
            let bytes = fs::read(&dot_git).map_err(|error| file_error(".git", &error))?;
            let pointer = decode_utf8(bytes).ok_or_else(|| {
                AppError::message(
                    "The file couldn’t be opened because it isn’t in the correct format.",
                )
            })?;
            let Some(location) = pointer.trim().strip_prefix("gitdir: ") else {
                return Err(AppError::Message(format!("Invalid .git file in {name}.")));
            };
            resolve_gitdir(root, location)
        };
        let raw = read_head(&git_dir.join("HEAD"))?;
        if let Some(branch) = raw.strip_prefix("ref: refs/heads/") {
            let branch = branch.to_string();
            return Ok(GitSnapshot { branch: Some(branch), head: raw });
        }
        if is_object_id(&raw) {
            return Ok(GitSnapshot { branch: None, head: raw });
        }
        Err(head_unreadable())
    }
}

/// Whether a `gitdir:` location is absolute.
///
/// Swift only recognised a leading `/`. Git for Windows writes drive paths (`C:/…`, also `C:\…`)
/// and network shares (`\\server\share\…`), which 1.14.x would have appended to the working tree.
pub fn is_absolute_gitdir(location: &str) -> bool {
    let bytes = location.as_bytes();
    let drive = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\');
    location.starts_with('/') || location.starts_with(r"\\") || drive
}

/// The Git directory named by a `gitdir:` pointer in the working tree at `root`.
pub fn resolve_gitdir(root: &Path, location: &str) -> PathBuf {
    if is_absolute_gitdir(location) { PathBuf::from(location) } else { root.join(location) }
}

/// Foundation's wording for a failed file read: 1.14.x showed `error.localizedDescription` for
/// probe and scan failures. Other failures, such as a file where a folder is expected, get the
/// generic sentence, as in Foundation.
pub(crate) fn file_error(name: &str, error: &io::Error) -> AppError {
    let reason = match error.kind() {
        io::ErrorKind::NotFound => " because there is no such file",
        io::ErrorKind::PermissionDenied => " because you don’t have permission to view it",
        _ => "",
    };
    AppError::Message(format!("The file “{name}” couldn’t be opened{reason}."))
}

fn head_unreadable() -> AppError {
    AppError::message("Git HEAD is temporarily unreadable.")
}

/// UTF-8 text without a leading byte-order mark, which Foundation's UTF-8 decoding drops.
fn decode_utf8(bytes: Vec<u8>) -> Option<String> {
    let text = String::from_utf8(bytes).ok()?;
    Some(match text.strip_prefix('\u{feff}') {
        Some(rest) => rest.to_string(),
        None => text,
    })
}

/// Reads at most [`HEAD_SIZE_LIMIT`] bytes; a file of that size or larger is rejected.
fn read_head(path: &Path) -> Result<String> {
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|file| file.take(HEAD_SIZE_LIMIT as u64).read_to_end(&mut bytes))
        .map_err(|error| file_error("HEAD", &error))?;
    if bytes.len() >= HEAD_SIZE_LIMIT {
        return Err(head_unreadable());
    }
    let text = decode_utf8(bytes).ok_or_else(head_unreadable)?;
    let raw = text.trim();
    if raw.is_empty() {
        return Err(head_unreadable());
    }
    Ok(raw.to_string())
}

/// A detached HEAD: 40 (SHA-1) to 64 (SHA-256) hex digits, as Swift's `^[0-9a-fA-F]{40,64}$`.
fn is_object_id(raw: &str) -> bool {
    (40..=64).contains(&raw.len()) && raw.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// A confirmed branch switch waiting for the user's decision. Persisted in `state.json` as
/// `pending`; reads the Swift keys `repositoryID` and `ticketID`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchChange {
    pub id: Uuid,
    #[serde(alias = "repositoryID")]
    pub repository_id: Uuid,
    pub repository_name: String,
    pub branch: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_branch: Option<String>,
    #[serde(alias = "ticketID", default, skip_serializing_if = "Option::is_none")]
    pub ticket_id: Option<i64>,
    #[serde(with = "crate::time::flex_date")]
    pub detected_at: Timestamp,
}

impl BranchChange {
    pub fn new(
        repository: &Repository,
        branch: impl Into<String>,
        previous_branch: Option<&str>,
        ticket_id: Option<i64>,
        detected_at: Timestamp,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            repository_id: repository.id,
            repository_name: repository.name().to_string(),
            branch: branch.into(),
            previous_branch: previous_branch.map(str::to_string),
            ticket_id,
            detected_at,
        }
    }

    /// Derived from the branch on every call, so a restored integration-branch suggestion
    /// offers a break even though it still carries the ticket extracted before.
    pub fn suggests_break(&self) -> bool {
        BranchPolicy::suggests_break(&self.branch)
    }
}

/// A committed HEAD change. `old` is `None` for a repository's first reading (its baseline).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BranchTransition {
    pub old: Option<GitSnapshot>,
    pub new: GitSnapshot,
}

/// Requires two matching samples. Git rewrites HEAD atomically, and transient intermediate
/// checkouts should not create an actionable stale notification.
#[derive(Clone, Debug, Default)]
pub struct BranchDebouncer {
    committed: BTreeMap<Uuid, GitSnapshot>,
    candidates: BTreeMap<Uuid, GitSnapshot>,
}

impl BranchDebouncer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn sample(&mut self, snapshot: GitSnapshot, repository: Uuid) -> Option<BranchTransition> {
        if self.committed.get(&repository) == Some(&snapshot) {
            self.candidates.remove(&repository);
            return None;
        }
        if self.candidates.get(&repository) != Some(&snapshot) {
            self.candidates.insert(repository, snapshot);
            return None;
        }
        self.candidates.remove(&repository);
        let old = self.committed.insert(repository, snapshot.clone());
        Some(BranchTransition { old, new: snapshot })
    }

    /// Forgets repositories that are no longer watched.
    pub fn retain(&mut self, ids: &BTreeSet<Uuid>) {
        self.committed.retain(|id, _| ids.contains(id));
        self.candidates.retain(|id, _| ids.contains(id));
    }
}

/// One row of the App activity log. Persisted in `state.json` as `audit`, newest first.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: Uuid,
    #[serde(with = "crate::time::flex_date")]
    pub date: Timestamp,
    pub title: String,
    pub detail: String,
}

impl AuditEntry {
    pub fn new(title: impl Into<String>, detail: impl Into<String>, date: Timestamp) -> Self {
        Self { id: Uuid::new_v4(), date, title: title.into(), detail: detail.into() }
    }
}

/// Inserts `entry` first and drops the oldest rows beyond [`AUDIT_LIMIT`].
pub fn record_audit(log: &mut Vec<AuditEntry>, entry: AuditEntry) {
    log.insert(0, entry);
    log.truncate(AUDIT_LIMIT);
}
