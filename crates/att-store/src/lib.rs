//! Local storage for Azure timetracker 2.0.
//!
//! One SQLite database (`azure-timetracker.sqlite3`, WAL, `synchronous=FULL`) in the data
//! directory replaces the 1.14.x JSON files:
//!
//! - **documents**: one JSON document per state slice (configuration, paused session, Figma
//!   store, offline ledger, edit journal, …). [`Store::put`] skips writes whose JSON is unchanged,
//!   so the engine can persist after every tick without rewriting anything.
//! - **audit**: the app-activity log, append-only and capped (1.14.x kept 2,000 entries).
//! - **weekly_drafts**: weekly report text keyed by `"<workspace>|<week start local>"`.
//! - **worklogs** + **worklog_coverage**: a cache of 7pace worklogs per workspace with the ranges
//!   that were fetched, so pages share downloads. The server stays authoritative: writes always
//!   re-read before acting.
//!
//! Documents hold the serde form of `att-core` types. Because those types also read the Swift
//! encoding, the [`legacy`] importer copies 1.14.x JSON values verbatim.
//!
//! The API is synchronous; the engine calls it from a blocking task.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use att_core::model::WorkLog;
use att_core::time::Interval;
use jiff::Timestamp;
use jiff::tz::TimeZone;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};

pub mod legacy;
mod migrations;

pub const DATABASE_FILE: &str = "azure-timetracker.sqlite3";

/// Document keys. Names match the 1.14.x `SavedState` keys where a slice existed there.
pub mod keys {
    pub const CONFIGURATION: &str = "configuration";
    pub const PENDING_BRANCHES: &str = "pending";
    pub const MEETING_REMINDERS: &str = "meetingReminders";
    pub const PAUSED_SESSION: &str = "pausedSession";
    pub const MEETING_RETURN: &str = "meetingReturn";
    pub const WORK_AWARENESS: &str = "workAwareness";
    pub const TICKET_COMPLETION: &str = "ticketCompletion";
    pub const MICROPHONE_TRACKING: &str = "microphoneTracking";
    pub const QUICK_TICKETS: &str = "quickTickets";
    pub const DAY_REVIEWS: &str = "dayReviews";
    pub const ATTENTION_NOTIFIED: &str = "attentionNotified";
    pub const ATTENTION_DISMISSED: &str = "attentionDismissed";
    pub const FIGMA_STORE: &str = "figmaStore";
    /// Was `offline-drafts.json`.
    pub const OFFLINE_LEDGER: &str = "offlineLedger";
    /// Was `time-edit-history.json`.
    pub const TIME_EDIT_JOURNAL: &str = "timeEditJournal";
    /// Slices from `state.json` the importer copies as documents (`audit` goes to its table).
    pub const LEGACY_STATE_SLICES: &[&str] = &[
        CONFIGURATION,
        PENDING_BRANCHES,
        MEETING_REMINDERS,
        PAUSED_SESSION,
        MEETING_RETURN,
        WORK_AWARENESS,
        TICKET_COMPLETION,
        MICROPHONE_TRACKING,
        QUICK_TICKETS,
        DAY_REVIEWS,
        ATTENTION_NOTIFIED,
        ATTENTION_DISMISSED,
        FIGMA_STORE,
    ];
}

/// The 1.14.x audit cap.
pub const AUDIT_CAP: usize = 2_000;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("Local data could not be read or saved: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Local data could not be read or saved: {0}")]
    Io(#[from] std::io::Error),
    #[error("Saved data for “{key}” is unreadable: {source}")]
    Corrupt {
        key: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("Data could not be encoded: {0}")]
    Encode(#[source] serde_json::Error),
    #[error("The database was written by a newer version of Azure timetracker (schema {0}).")]
    TooNew(i64),
}

impl From<StoreError> for att_core::AppError {
    fn from(error: StoreError) -> Self {
        att_core::AppError::Message(error.to_string())
    }
}

pub type Result<T, E = StoreError> = std::result::Result<T, E>;

pub struct Store {
    conn: Mutex<Connection>,
    /// SHA-256 of the last JSON written or read per document, to skip unchanged writes.
    written: Mutex<HashMap<String, [u8; 32]>>,
    path: Option<PathBuf>,
}

fn digest(text: &str) -> [u8; 32] {
    Sha256::digest(text.as_bytes()).into()
}

fn now_text() -> String {
    Timestamp::now().to_string()
}

impl Store {
    /// Opens (or creates) the database in `dir`. On Unix the directory is 0700 and the database 0600.
    pub fn open(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        restrict(dir, 0o700)?;
        let path = dir.join(DATABASE_FILE);
        let existed = path.exists();
        let conn = Connection::open(&path)?;
        if !existed {
            restrict(&path, 0o600)?;
        }
        Self::init(conn, Some(path))
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?, None)
    }

    fn init(mut conn: Connection, path: Option<PathBuf>) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        migrations::run(&mut conn)?;
        Ok(Self { conn: Mutex::new(conn), written: Mutex::new(HashMap::new()), path })
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        // A poisoned lock only means another thread panicked mid-call; SQLite itself is consistent.
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    // -- Documents -------------------------------------------------------------------------

    /// Reads a document. A missing document is `None`; unreadable JSON is an error, never reset.
    pub fn get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        let Some(text) = self.get_raw(key)? else { return Ok(None) };
        let value = serde_json::from_str(&text)
            .map_err(|source| StoreError::Corrupt { key: key.to_string(), source })?;
        self.remember(key, &text);
        Ok(Some(value))
    }

    /// The stored JSON text of a document.
    pub fn get_raw(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn()
            .query_row("SELECT json FROM documents WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    /// Writes a document when its JSON differs from the last version. Returns whether it wrote.
    pub fn put<T: Serialize + ?Sized>(&self, key: &str, value: &T) -> Result<bool> {
        let text = serde_json::to_string(value).map_err(StoreError::Encode)?;
        self.put_raw(key, &text)
    }

    pub fn put_raw(&self, key: &str, json: &str) -> Result<bool> {
        let hash = digest(json);
        if self.written.lock().unwrap_or_else(|e| e.into_inner()).get(key) == Some(&hash) {
            return Ok(false);
        }
        self.conn().execute(
            "INSERT INTO documents (key, json, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
            params![key, json, now_text()],
        )?;
        self.written.lock().unwrap_or_else(|e| e.into_inner()).insert(key.to_string(), hash);
        Ok(true)
    }

    pub fn delete(&self, key: &str) -> Result<()> {
        self.conn().execute("DELETE FROM documents WHERE key = ?1", [key])?;
        self.written.lock().unwrap_or_else(|e| e.into_inner()).remove(key);
        Ok(())
    }

    fn remember(&self, key: &str, text: &str) {
        self.written
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(key.to_string(), digest(text));
    }

    // -- Meta ------------------------------------------------------------------------------

    pub fn meta(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn()
            .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.conn().execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    // -- Audit -----------------------------------------------------------------------------

    /// Appends an entry and trims to `cap` (oldest entries go first).
    pub fn append_audit<T: Serialize>(&self, entry: &T, cap: usize) -> Result<()> {
        let json = serde_json::to_string(entry).map_err(StoreError::Encode)?;
        let conn = self.conn();
        conn.execute("INSERT INTO audit (json) VALUES (?1)", [json])?;
        trim_audit(&conn, cap)?;
        Ok(())
    }

    /// Newest first, at most `limit` entries. Unreadable rows are skipped.
    pub fn audit<T: DeserializeOwned>(&self, limit: usize) -> Result<Vec<T>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT json FROM audit ORDER BY seq DESC LIMIT ?1")?;
        let rows = stmt.query_map([limit as i64], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            if let Ok(value) = serde_json::from_str(&row?) {
                out.push(value);
            }
        }
        Ok(out)
    }

    pub fn audit_count(&self) -> Result<usize> {
        Ok(self.conn().query_row("SELECT COUNT(*) FROM audit", [], |r| r.get::<_, i64>(0))?
            as usize)
    }

    pub fn clear_audit(&self) -> Result<()> {
        self.conn().execute("DELETE FROM audit", [])?;
        Ok(())
    }

    // -- Weekly report drafts --------------------------------------------------------------

    pub fn weekly_draft(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn()
            .query_row("SELECT text FROM weekly_drafts WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn set_weekly_draft(&self, key: &str, text: &str) -> Result<()> {
        self.conn().execute(
            "INSERT INTO weekly_drafts (key, text, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at",
            params![key, text, now_text()],
        )?;
        Ok(())
    }

    pub fn delete_weekly_draft(&self, key: &str) -> Result<()> {
        self.conn().execute("DELETE FROM weekly_drafts WHERE key = ?1", [key])?;
        Ok(())
    }

    // -- Worklog cache ---------------------------------------------------------------------

    /// Replaces the cached logs of `workspace` that start inside `range` with `logs`, and records
    /// the range as fetched at `fetched_at`. Logs whose timestamp cannot be parsed are kept,
    /// anchored at `range.start`, so callers can still count them as omitted.
    pub fn put_worklogs(
        &self,
        workspace: &str,
        range: Interval,
        logs: &[WorkLog],
        tz: &TimeZone,
        fetched_at: Timestamp,
    ) -> Result<()> {
        let (from, to) = (range.start.as_second(), range.end.as_second());
        let fetched = fetched_at.to_string();
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM worklogs WHERE workspace = ?1 AND start_utc >= ?2 AND start_utc < ?3",
            params![workspace, from, to],
        )?;
        {
            let mut insert = tx.prepare(
                "INSERT INTO worklogs (workspace, id, start_utc, json, fetched_at, invalid_date)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(workspace, id) DO UPDATE SET start_utc = excluded.start_utc,
                   json = excluded.json, fetched_at = excluded.fetched_at,
                   invalid_date = excluded.invalid_date",
            )?;
            for log in logs {
                let (start, invalid) = match log.date(tz) {
                    Some(ts) => (ts.as_second(), false),
                    None => (from, true),
                };
                let json = serde_json::to_string(log).map_err(StoreError::Encode)?;
                insert.execute(params![workspace, log.id, start, json, fetched, invalid])?;
            }
        }
        tx.execute(
            "INSERT INTO worklog_coverage (workspace, start_utc, end_utc, fetched_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![workspace, from, to, fetched],
        )?;
        merge_coverage(&tx, workspace)?;
        tx.commit()?;
        Ok(())
    }

    /// Cached logs of `workspace` that start inside `range`, newest first.
    pub fn worklogs(&self, workspace: &str, range: Interval) -> Result<Vec<WorkLog>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT json FROM worklogs WHERE workspace = ?1 AND start_utc >= ?2 AND start_utc < ?3
             ORDER BY start_utc DESC, id",
        )?;
        let rows = stmt
            .query_map(params![workspace, range.start.as_second(), range.end.as_second()], |r| {
                r.get::<_, String>(0)
            })?;
        let mut out = Vec::new();
        for row in rows {
            let text = row?;
            let log = serde_json::from_str(&text)
                .map_err(|source| StoreError::Corrupt { key: "worklogs".into(), source })?;
            out.push(log);
        }
        Ok(out)
    }

    /// When the whole `range` was fetched, the oldest fetch time among the covering ranges.
    pub fn worklog_coverage(&self, workspace: &str, range: Interval) -> Result<Option<Timestamp>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT start_utc, end_utc, fetched_at FROM worklog_coverage
             WHERE workspace = ?1 AND end_utc > ?2 AND start_utc < ?3 ORDER BY start_utc",
        )?;
        let rows = stmt
            .query_map(params![workspace, range.start.as_second(), range.end.as_second()], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
            })?;
        let mut cursor = range.start.as_second();
        let mut oldest: Option<Timestamp> = None;
        for row in rows {
            let (start, end, fetched) = row?;
            if start > cursor {
                return Ok(None);
            }
            cursor = cursor.max(end);
            let fetched: Timestamp = fetched.parse().unwrap_or(Timestamp::UNIX_EPOCH);
            oldest = Some(oldest.map_or(fetched, |o| o.min(fetched)));
        }
        Ok((cursor >= range.end.as_second()).then_some(oldest).flatten())
    }

    /// Drops every cached log and coverage for `workspace` (account switch).
    pub fn clear_worklogs(&self, workspace: &str) -> Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM worklogs WHERE workspace = ?1", [workspace])?;
        conn.execute("DELETE FROM worklog_coverage WHERE workspace = ?1", [workspace])?;
        Ok(())
    }

    /// Forgets coverage so the next read refetches (after a tracking change or a write).
    pub fn invalidate_worklogs(&self, workspace: &str) -> Result<()> {
        self.conn().execute("DELETE FROM worklog_coverage WHERE workspace = ?1", [workspace])?;
        Ok(())
    }
}

fn trim_audit(conn: &Connection, cap: usize) -> Result<()> {
    conn.execute(
        "DELETE FROM audit WHERE seq NOT IN (SELECT seq FROM audit ORDER BY seq DESC LIMIT ?1)",
        [cap as i64],
    )?;
    Ok(())
}

/// Collapses overlapping or touching coverage rows, keeping the oldest fetch time of each merge.
fn merge_coverage(conn: &Connection, workspace: &str) -> Result<()> {
    let rows: Vec<(i64, i64, String)> = {
        let mut stmt = conn.prepare(
            "SELECT start_utc, end_utc, fetched_at FROM worklog_coverage WHERE workspace = ?1
             ORDER BY start_utc, end_utc",
        )?;
        stmt.query_map([workspace], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<_>>()?
    };
    let mut merged: Vec<(i64, i64, String)> = Vec::new();
    for (start, end, fetched) in rows {
        match merged.last_mut() {
            Some(last) if start <= last.1 => {
                last.1 = last.1.max(end);
                if fetched < last.2 {
                    last.2 = fetched;
                }
            }
            _ => merged.push((start, end, fetched)),
        }
    }
    conn.execute("DELETE FROM worklog_coverage WHERE workspace = ?1", [workspace])?;
    for (start, end, fetched) in merged {
        conn.execute(
            "INSERT INTO worklog_coverage (workspace, start_utc, end_utc, fetched_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![workspace, start, end, fetched],
        )?;
    }
    Ok(())
}

#[cfg(unix)]
fn restrict(path: &Path, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn restrict(_path: &Path, _mode: u32) -> std::io::Result<()> {
    // %APPDATA% is already limited to the user by its ACL.
    Ok(())
}
