//! The Weekly report page. Port of `WeeklyReportModel` (ProductivityModels.swift).
//!
//! Drafts live in the store's `weekly_drafts` table under `"<workspace>|<week start local>"`
//! (Swift L61). Swift wrote the whole drafts file on every keystroke; here text edits are
//! written at most once per [`SAVE_INTERVAL`] (the first edit at once, later ones together),
//! and immediately when the page, the week or the connection changes.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use jiff::Timestamp;
use jiff::civil::Date;
use serde_json::Value;

use att_core::insights::WeeklyReport;
use att_core::model::WorkLog;
use att_core::statistics::{StatisticsPeriod, StatisticsRange};
use att_core::time::{Cal, wire_date};

use super::{
    detached, done, internal, known_titles, pages, persist, request_titles, spawn, still_current,
    visible,
};
use crate::engine::Engine;
use crate::ipc::IpcError;
use crate::services::Services;

/// At most one draft write per half second while typing.
pub(crate) const SAVE_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Debug, Default)]
struct DraftWriter {
    /// `text` differs from the stored draft.
    dirty: bool,
    last_write: Option<Instant>,
    /// A delayed write is pending.
    scheduled: bool,
}

#[derive(Default)]
pub(crate) struct WeeklyState {
    /// Any day of the week shown (Swift `anchor`).
    pub anchor: Date,
    pub loading: bool,
    pub issue: Option<String>,
    pub storage_issue: Option<String>,
    pub message: Option<String>,
    pub synced_at: Option<Timestamp>,
    pub logs: Vec<WorkLog>,
    pub loaded_range: Option<StatisticsRange>,
    pub text: String,
    /// The connected workspace identity; empty while disconnected (drafts are not saved then).
    pub workspace: String,
    pub configured: bool,
    generation: u64,
    /// A draft could not be read: saving is disabled so it is never overwritten (Swift
    /// `storageReadable == false`).
    storage_unreadable: bool,
    /// The key `text` is saved under, fixed when the text was loaded.
    text_key: Option<String>,
    writer: Mutex<DraftWriter>,
}

impl WeeklyState {
    pub(crate) fn range(&self, cal: &Cal) -> StatisticsRange {
        StatisticsRange::new(StatisticsPeriod::Week, cal.start_of_date(self.anchor), cal)
    }

    pub(crate) fn has_data(&self, cal: &Cal) -> bool {
        self.loaded_range == Some(self.range(cal))
    }

    /// `weekly-status-<yyyy-MM-dd>.md`, as Swift's save panel suggested.
    pub(crate) fn export_file_name(&self, cal: &Cal) -> String {
        let start = wire_date::local_string(self.range(cal).start, cal.tz());
        format!("weekly-status-{}.md", start.get(..10).unwrap_or(&start))
    }

    fn writer(&self) -> std::sync::MutexGuard<'_, DraftWriter> {
        self.writer.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn mark_dirty(&mut self) {
        self.writer().dirty = true;
    }

    /// Drops the loaded week (Swift `invalidate()` and part of `changeDate`).
    fn clear_logs(&mut self) {
        self.generation += 1;
        self.loading = false;
        self.logs.clear();
        self.loaded_range = None;
        self.synced_at = None;
    }

    /// Swift `setText(drafts[key] ?? "")`: the saved draft of the current workspace and week.
    fn load_text(&mut self, services: &Services, cal: &Cal) {
        let key = draft_key(&self.workspace, &self.range(cal), cal);
        self.writer().dirty = false;
        self.text = match key.as_deref() {
            Some(key) if !self.storage_unreadable => {
                match persist::read_weekly_draft(services, key) {
                    Ok(text) => text.unwrap_or_default(),
                    Err(error) => {
                        self.storage_unreadable = true;
                        self.storage_issue =
                            Some(format!("Saved drafts could not be read: {error}"));
                        String::new()
                    }
                }
            }
            _ => String::new(),
        };
        self.text_key = key;
    }
}

/// `"<workspace>|<week start as a local wire string>"` (Swift `key`); none without a workspace.
pub(crate) fn draft_key(workspace: &str, range: &StatisticsRange, cal: &Cal) -> Option<String> {
    (!workspace.is_empty())
        .then(|| format!("{workspace}|{}", wire_date::local_string(range.start, cal.tz())))
}

/// Swift `configure(_:)`, after the pending draft of the previous connection was written.
pub(crate) fn configure(
    services: &Services,
    weekly: &mut WeeklyState,
    workspace: Option<String>,
    cal: &Cal,
) {
    flush_state(services, weekly, true);
    weekly.configured = workspace.is_some();
    weekly.workspace = workspace.unwrap_or_default();
    weekly.clear_logs();
    weekly.issue = None;
    weekly.message = None;
    weekly.load_text(services, cal);
}

/// Swift `invalidate()`. While the page is shown the week is downloaded again and the current
/// logs stay until the new ones arrive (Swift cleared them and waited for "Refresh time").
pub(crate) fn invalidate(engine: &Engine) {
    let reload = engine.update(|state| {
        let shown = visible(state, pages::WEEKLY_REPORT);
        let weekly = &mut state.controllers.weekly;
        if shown {
            weekly.generation += 1;
            weekly.loading = false;
        } else {
            weekly.clear_logs();
        }
        shown
    });
    if reload {
        spawn(engine, |engine| async move { load(&engine).await });
    }
}

// -- Week navigation ------------------------------------------------------------------------------

pub(crate) async fn move_by(engine: &Engine, amount: i64) -> Result<Value, IpcError> {
    let cal = engine.cal();
    let date = engine.read(|state| {
        let range = state.controllers.weekly.range(&cal);
        cal.date(range.shifted(amount, &cal).start)
    });
    change_date(engine, date).await
}

pub(crate) async fn jump_to(engine: &Engine, date: Date) -> Result<Value, IpcError> {
    change_date(engine, date).await
}

/// Swift `changeDate(_:)`. Choosing another day of the same week changes nothing (Swift dropped
/// the loaded logs and did not reload them).
async fn change_date(engine: &Engine, date: Date) -> Result<Value, IpcError> {
    let cal = engine.cal();
    let services = engine.services();
    let reload = engine.update(|state| {
        let shown = visible(state, pages::WEEKLY_REPORT);
        let weekly = &mut state.controllers.weekly;
        let before = weekly.range(&cal);
        weekly.anchor = date;
        if weekly.range(&cal) == before {
            return false;
        }
        // The pending text belongs to the previous week's key (`text_key`).
        flush_state(services, weekly, true);
        weekly.clear_logs();
        weekly.issue = None;
        weekly.message = None;
        weekly.load_text(services, &cal);
        shown
    });
    if reload {
        let engine = engine.clone();
        detached(async move { load(&engine).await }).await.ok_or_else(internal)?;
    }
    done()
}

/// "Refresh time".
pub(crate) async fn refresh(engine: &Engine) -> Result<Value, IpcError> {
    let engine = engine.clone();
    detached(async move { load(&engine).await }).await.ok_or_else(internal)?;
    done()
}

/// Swift `load()`: the week's worklogs; missing ticket titles are requested in one batch (Swift's
/// view loaded them one by one).
pub(crate) async fn load(engine: &Engine) {
    let Some(clients) = engine.clients() else { return };
    let cal = engine.cal();
    let (request, expected) = engine.update(|state| {
        let weekly = &mut state.controllers.weekly;
        weekly.generation += 1;
        weekly.loading = true;
        weekly.issue = None;
        (weekly.generation, weekly.range(&cal))
    });
    let result = clients.seven_pace.work_logs(Some(expected.start), expected.end, false).await;
    let current = still_current(engine, &clients);
    let synced = engine.now();
    let missing = engine.update(|state| {
        let known = known_titles(state);
        let weekly = &mut state.controllers.weekly;
        if weekly.generation != request {
            return Vec::new();
        }
        weekly.loading = false;
        if !current {
            return Vec::new();
        }
        let logs = match result {
            Ok(logs) => logs,
            Err(error) => {
                weekly.issue = Some(error.to_string());
                return Vec::new();
            }
        };
        if weekly.range(&cal) != expected {
            return Vec::new();
        }
        let ids: BTreeSet<i64> = logs.iter().filter_map(WorkLog::ticket_id).collect();
        weekly.logs = logs;
        weekly.loaded_range = Some(expected);
        weekly.synced_at = Some(synced);
        ids.into_iter().filter(|id| !known.contains_key(id)).collect()
    });
    request_titles(engine, missing);
}

// -- Draft ----------------------------------------------------------------------------------------

/// Swift `generate(targets:titles:)`. Replacing a draft needs `replace: true` (Swift asked
/// "Replace this week’s draft?" first).
pub(crate) fn generate(engine: &Engine, replace: bool) -> Result<Value, IpcError> {
    let cal = engine.cal();
    let now = engine.now();
    let generated = engine.update(|state| {
        let titles: HashMap<i64, String> = known_titles(state).into_iter().collect();
        let targets = state.config.targets.clone();
        let weekly = &mut state.controllers.weekly;
        if !weekly.has_data(&cal) {
            return Ok(false);
        }
        if !replace && !weekly.text.is_empty() {
            return Err(IpcError::new(
                "needsConfirmation",
                "Replace this week’s draft? This replaces your local draft with a fresh summary of the loaded time.",
            ));
        }
        let range = weekly.range(&cal);
        weekly.text = WeeklyReport::draft(&weekly.logs, &range, &targets, &titles, &cal, now);
        weekly.message =
            Some("Draft generated. Review outcomes and blockers before sharing.".into());
        weekly.mark_dirty();
        Ok(true)
    })?;
    if generated {
        save_soon(engine);
    }
    done()
}

/// `weekly.setText`: the editor's text, saved soon.
pub(crate) fn set_text(engine: &Engine, text: String) -> Result<Value, IpcError> {
    engine.update(|state| {
        let weekly = &mut state.controllers.weekly;
        if weekly.text != text {
            weekly.text = text;
            weekly.mark_dirty();
        }
    });
    save_soon(engine);
    done()
}

/// Swift `export()`: writes the Markdown to the path the UI's save dialog returned.
pub(crate) async fn export(engine: &Engine, path: String) -> Result<Value, IpcError> {
    let text = engine.read(|state| state.controllers.weekly.text.clone());
    let path = PathBuf::from(path);
    let result = tokio::task::spawn_blocking(move || write_atomically(&path, text.as_bytes()))
        .await
        .map_err(|_| internal())?;
    engine.update(|state| {
        let weekly = &mut state.controllers.weekly;
        match result {
            Ok(()) => weekly.message = Some("Draft exported.".into()),
            Err(error) => weekly.issue = Some(error.to_string()),
        }
    });
    done()
}

/// Swift `write(to:atomically:true)`: a temporary file next to the target, then a rename.
pub(crate) fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let temporary = path.with_file_name(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temporary, bytes)?;
    std::fs::rename(&temporary, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&temporary);
    })
}

// -- Saving ---------------------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
enum Flush {
    /// Nothing to write, or the draft cannot be saved (no workspace, unreadable storage).
    Idle,
    Wrote,
    Failed,
    /// Written too recently; try again after this long.
    Later(Duration),
}

/// Swift `saveDraft()`, throttled unless `force`.
fn flush_state(services: &Services, weekly: &mut WeeklyState, force: bool) -> Flush {
    let mut writer = weekly.writer.lock().unwrap_or_else(|e| e.into_inner());
    if !writer.dirty {
        return Flush::Idle;
    }
    if !force && let Some(last) = writer.last_write {
        let elapsed = last.elapsed();
        if elapsed < SAVE_INTERVAL {
            return Flush::Later(SAVE_INTERVAL - elapsed);
        }
    }
    let Some(key) = weekly.text_key.as_deref().filter(|_| !weekly.storage_unreadable) else {
        writer.dirty = false;
        return Flush::Idle;
    };
    if services.preview {
        writer.dirty = false;
        return Flush::Idle;
    }
    writer.last_write = Some(Instant::now());
    let result = persist::write_weekly_draft(services, key, &weekly.text);
    match result {
        Ok(()) => {
            writer.dirty = false;
            drop(writer);
            weekly.storage_issue = None;
            Flush::Wrote
        }
        Err(error) => {
            drop(writer);
            weekly.storage_issue =
                Some(format!("Draft is in memory but could not be saved: {error}"));
            Flush::Failed
        }
    }
}

/// The per-tick save (`Engine::persist`): writes a pending draft unless one was written less than
/// [`SAVE_INTERVAL`] ago (a delayed write is scheduled then).
pub(crate) fn persist_pending(services: &Services, weekly: &WeeklyState) -> Result<(), IpcError> {
    let mut writer = weekly.writer();
    let due = writer.last_write.is_none_or(|last| last.elapsed() >= SAVE_INTERVAL);
    if !writer.dirty || !due || services.preview || weekly.storage_unreadable {
        return Ok(());
    }
    let Some(key) = weekly.text_key.as_deref() else { return Ok(()) };
    writer.last_write = Some(Instant::now());
    persist::write_weekly_draft(services, key, &weekly.text).map_err(|error| {
        IpcError::new("storage", format!("Draft is in memory but could not be saved: {error}"))
    })?;
    writer.dirty = false;
    Ok(())
}

/// Writes now when allowed, otherwise once the interval has passed.
fn save_soon(engine: &Engine) {
    let services = engine.services();
    let outcome =
        engine.update(|state| flush_state(services, &mut state.controllers.weekly, false));
    if let Flush::Later(wait) = outcome {
        let already = engine.read(|state| {
            std::mem::replace(&mut state.controllers.weekly.writer().scheduled, true)
        });
        if !already {
            spawn(engine, move |engine| async move {
                tokio::time::sleep(wait).await;
                engine.read(|state| state.controllers.weekly.writer().scheduled = false);
                save_soon(&engine);
            });
        }
    }
}

/// Writes a pending draft now (the page, week or connection changes).
pub(crate) fn flush_now(engine: &Engine) {
    let services = engine.services();
    engine.update(|state| flush_state(services, &mut state.controllers.weekly, true));
}

/// Per tick: a pending draft whose delayed write could not be scheduled.
pub(crate) fn flush_if_due(engine: &Engine) {
    let pending = engine.read(|state| {
        let writer = state.controllers.weekly.writer();
        writer.dirty && !writer.scheduled
    });
    if pending {
        save_soon(engine);
    }
}
