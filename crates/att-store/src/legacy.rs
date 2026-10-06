//! One-time import of the 1.14.x JSON files from
//! `~/Library/Application Support/Azure timetracker/`.
//!
//! The Swift app wrote `state.json`, `offline-drafts.json`, `time-edit-history.json` and
//! `weekly-report-drafts.json` with the default `JSONEncoder`. The `att-core` types decode that
//! encoding directly (Swift dates and key spellings), so slices are copied verbatim as documents.
//!
//! Guarantees:
//! - Runs once: success records `legacyImportedAt` in the database.
//! - One transaction: a crash mid-import leaves nothing behind, and the next launch retries.
//! - Never overwrites a 2.0 document that already exists.
//! - Never modifies or deletes the legacy files; it only adds a small marker file next to them.
//! - An unreadable file is reported and skipped; the rest still imports.
//! - Slack huddle data (`slackReminders`) is dropped: the feature was removed in 1.7.

use std::path::{Path, PathBuf};

use jiff::Timestamp;
use rusqlite::{OptionalExtension, params};
use serde::Serialize;
use serde_json::Value;

use crate::{AUDIT_CAP, Result, Store, StoreError, keys};

pub const STATE_FILE: &str = "state.json";
pub const OFFLINE_FILE: &str = "offline-drafts.json";
pub const JOURNAL_FILE: &str = "time-edit-history.json";
pub const WEEKLY_FILE: &str = "weekly-report-drafts.json";
pub const MARKER_FILE: &str = ".imported-by-azure-timetracker-2";
pub const IMPORTED_META: &str = "legacyImportedAt";

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// False when an earlier import already ran or there was nothing to import.
    pub imported: bool,
    pub source: Option<PathBuf>,
    /// Document keys written.
    pub documents: Vec<String>,
    pub audit_entries: usize,
    pub weekly_drafts: usize,
    /// Files or slices that could not be read, with the reason. They stay untouched on disk.
    pub skipped: Vec<String>,
}

fn read_json(path: &Path, skipped: &mut Vec<String>) -> Option<Value> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            skipped.push(format!("{name}: {e}"));
            return None;
        }
    };
    match serde_json::from_slice(&bytes) {
        Ok(value) => Some(value),
        Err(e) => {
            skipped.push(format!("{name}: not valid JSON ({e})"));
            None
        }
    }
}

impl Store {
    /// Whether the 1.14.x import already ran for this database.
    pub fn legacy_imported(&self) -> Result<bool> {
        Ok(self.meta(IMPORTED_META)?.is_some())
    }

    /// Imports `legacy_dir` once. Returns what was imported.
    pub fn import_legacy(&self, legacy_dir: &Path) -> Result<ImportReport> {
        let mut report =
            ImportReport { source: Some(legacy_dir.to_path_buf()), ..Default::default() };
        if self.legacy_imported()? {
            return Ok(report);
        }
        let mut skipped = Vec::new();
        let state = read_json(&legacy_dir.join(STATE_FILE), &mut skipped);
        let offline = read_json(&legacy_dir.join(OFFLINE_FILE), &mut skipped);
        let journal = read_json(&legacy_dir.join(JOURNAL_FILE), &mut skipped);
        let weekly = read_json(&legacy_dir.join(WEEKLY_FILE), &mut skipped);
        if state.is_none() && offline.is_none() && journal.is_none() && weekly.is_none() {
            report.skipped = skipped;
            return Ok(report);
        }

        let mut documents: Vec<(String, String)> = Vec::new();
        let mut audit: Vec<String> = Vec::new();
        match &state {
            Some(Value::Object(map)) => {
                for key in keys::LEGACY_STATE_SLICES {
                    match map.get(*key) {
                        None | Some(Value::Null) => {}
                        Some(value) => documents.push((key.to_string(), value.to_string())),
                    }
                }
                match map.get("audit") {
                    // Swift kept the newest entry first; the table appends oldest first.
                    Some(Value::Array(entries)) => {
                        audit = entries.iter().rev().map(Value::to_string).collect();
                    }
                    None | Some(Value::Null) => {}
                    Some(_) => skipped.push(format!("{STATE_FILE}: audit is not a list")),
                }
            }
            Some(_) => skipped.push(format!("{STATE_FILE}: not a JSON object")),
            None => {}
        }
        if let Some(value) = offline {
            documents.push((keys::OFFLINE_LEDGER.to_string(), value.to_string()));
        }
        if let Some(value) = journal {
            documents.push((keys::TIME_EDIT_JOURNAL.to_string(), value.to_string()));
        }
        let mut drafts: Vec<(String, String)> = Vec::new();
        match weekly {
            Some(Value::Object(map)) => {
                for (key, value) in map {
                    match value {
                        Value::String(text) => drafts.push((key, text)),
                        _ => skipped.push(format!("{WEEKLY_FILE}: draft {key} is not text")),
                    }
                }
            }
            Some(_) => skipped.push(format!("{WEEKLY_FILE}: not a JSON object")),
            None => {}
        }

        let now = Timestamp::now().to_string();
        {
            let mut conn = self.conn();
            let tx = conn.transaction()?;
            for (key, json) in &documents {
                let exists: Option<i64> = tx
                    .query_row("SELECT 1 FROM documents WHERE key = ?1", [key], |r| r.get(0))
                    .optional()?;
                if exists.is_some() {
                    skipped.push(format!("{key}: kept the existing 2.0 data"));
                    continue;
                }
                tx.execute(
                    "INSERT INTO documents (key, json, updated_at) VALUES (?1, ?2, ?3)",
                    params![key, json, now],
                )?;
                report.documents.push(key.clone());
            }
            let keep = audit.len().saturating_sub(AUDIT_CAP);
            for json in audit.iter().skip(keep) {
                tx.execute("INSERT INTO audit (json) VALUES (?1)", [json])?;
                report.audit_entries += 1;
            }
            for (key, text) in &drafts {
                let changed = tx.execute(
                    "INSERT OR IGNORE INTO weekly_drafts (key, text, updated_at) VALUES (?1, ?2, ?3)",
                    params![key, text, now],
                )?;
                report.weekly_drafts += changed;
            }
            tx.execute(
                "INSERT INTO meta (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![IMPORTED_META, now],
            )?;
            tx.execute(
                "INSERT INTO meta (key, value) VALUES ('legacyImportSource', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [legacy_dir.to_string_lossy()],
            )?;
            tx.commit()?;
        }
        // Imported documents must be re-read, not mistaken for unchanged values.
        self.written.lock().unwrap_or_else(|e| e.into_inner()).clear();
        let marker = format!(
            "Imported into Azure timetracker 2 on {now}. These files are no longer updated; \
             1.14.x can still read them.\n"
        );
        if let Err(e) = std::fs::write(legacy_dir.join(MARKER_FILE), marker) {
            tracing::warn!("could not write the legacy import marker: {e}");
        }
        report.imported = true;
        report.skipped = skipped;
        Ok(report)
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(error: serde_json::Error) -> Self {
        StoreError::Encode(error)
    }
}
