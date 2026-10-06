//! Schema migrations, tracked with `PRAGMA user_version`.

use rusqlite::Connection;

use crate::{Result, StoreError};

const MIGRATIONS: &[&str] = &[
    // 1: initial schema
    "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
     CREATE TABLE documents (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);
     CREATE TABLE audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
     CREATE TABLE weekly_drafts (key TEXT PRIMARY KEY, text TEXT NOT NULL, updated_at TEXT NOT NULL);
     CREATE TABLE worklogs (
         workspace TEXT NOT NULL,
         id TEXT NOT NULL,
         start_utc INTEGER NOT NULL,
         json TEXT NOT NULL,
         fetched_at TEXT NOT NULL,
         invalid_date INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (workspace, id)
     );
     CREATE INDEX worklogs_by_start ON worklogs (workspace, start_utc);
     CREATE TABLE worklog_coverage (
         workspace TEXT NOT NULL,
         start_utc INTEGER NOT NULL,
         end_utc INTEGER NOT NULL,
         fetched_at TEXT NOT NULL
     );
     CREATE INDEX worklog_coverage_by_start ON worklog_coverage (workspace, start_utc);",
];

pub fn run(conn: &mut Connection) -> Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let latest = MIGRATIONS.len() as i64;
    if version > latest {
        return Err(StoreError::TooNew(version));
    }
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (index + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}
