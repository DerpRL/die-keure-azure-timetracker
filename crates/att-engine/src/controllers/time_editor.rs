//! The Time editor page. Port of `TimeEditorModel.swift` and `AppModel.saveTimeEdit`.
//!
//! Every write goes through `WorkLogOperations::apply`, whose journal checkpoints are written to
//! the `timeEditJournal` document before each 7pace request (a checkpoint that cannot be saved
//! fails the operation before anything is sent). No write is ever retried: after a failure the
//! entry must be reloaded, and a change left `applying` or `needsReview` blocks further saves
//! until the user acknowledged it.

use std::collections::{BTreeMap, BTreeSet};
use std::future::ready;
use std::sync::atomic::{AtomicBool, Ordering};

use jiff::Timestamp;
use jiff::civil::Date;
use serde_json::Value;
use uuid::Uuid;

use att_core::model::{TrackingState, WorkLog};
use att_core::service::{TrackingService, WorkLogMutationService};
use att_core::text::NonEmpty;
use att_core::time::{Cal, Interval, add_secs, wire_date};
use att_core::worklog::corrections::{TimeCorrectionIssue, TimeCorrectionKind, TimeCorrections};
use att_core::worklog::edit::{WorkLogConflict, WorkLogEditReview, WorkLogOverlap};
use att_core::worklog::ops::{WorkLogChange, WorkLogChangeStatus, WorkLogOperations, WorkLogPlan};
use att_core::worklog::{WorkLogDraft, WorkLogTimeEdit};
use att_core::{AppError, Result};

use super::view::TimeEditMode;
use super::{detached, done, internal, pages, persist, same_workspace, still_current, visible};
use crate::clients::Clients;
use crate::engine::Engine;
use crate::ipc::IpcError;
use crate::services::Services;

/// Swift's detail for a change the app did not see finish.
pub(crate) const INTERRUPTED_DETAIL: &str = "The app closed during this change. Check the affected entries in 7pace; no request will be replayed.";

/// The correction options of `timeEditor.prepareCorrection` (Swift's buttons, in order).
pub(crate) mod options {
    /// Gap: "Extend earlier task…".
    pub const EXTEND_EARLIER: &str = "extendEarlier";
    /// Gap: "Start later task earlier…".
    pub const START_LATER_EARLIER: &str = "startLaterEarlier";
    /// Overlap: "Remove overlap from earlier…".
    pub const REMOVE_FROM_EARLIER: &str = "removeFromEarlier";
    /// Overlap: "Remove overlap from later…".
    pub const REMOVE_FROM_LATER: &str = "removeFromLater";
    /// Overlap: "Preview boundary…" with a shared boundary.
    pub const BOUNDARY: &str = "boundary";
}

#[derive(Default)]
pub(crate) struct TimeEditorState {
    pub show_corrections: bool,
    pub correction_issues: Vec<TimeCorrectionIssue>,
    pub correction_issue: Option<String>,
    pub correction_loading: bool,
    pub guided_plan: Option<WorkLogPlan>,
    pub idle_interval: Option<Interval>,
    /// The session's idle review this correction belongs to (Swift `workAwareness.correction`).
    pub idle_correction: Option<Uuid>,
    pub separate_idle: bool,
    pub day: Date,
    pub filter: String,
    pub selection: BTreeSet<String>,
    /// The day's entries in 7pace order.
    pub logs: Vec<WorkLog>,
    pub selected: Option<WorkLog>,
    pub start: Timestamp,
    pub end: Timestamp,
    pub mode: TimeEditMode,
    pub split_at: Timestamp,
    pub second_ticket: String,
    pub second_comment: String,
    pub second_activity: String,
    pub merge_logs: Vec<WorkLog>,
    pub undo_record: Option<WorkLogChange>,
    pub review: Option<WorkLogEditReview>,
    pub loading: bool,
    pub working: bool,
    pub issue: Option<String>,
    pub message: Option<String>,
    pub saved_conflicts: Vec<WorkLogConflict>,
    pub saved_overlap_issue: Option<String>,
    /// The whole journal, every workspace (Swift `changes`).
    pub changes: Vec<WorkLogChange>,
    pub journal_issue: Option<String>,
    /// The journal document could not be read: nothing is written (Swift `journalReadable`).
    pub journal_unreadable: bool,
    pub needs_reload: bool,
    /// The connected workspace identity, empty while disconnected.
    pub workspace: String,
    pub configured: bool,
    generation: u64,
    /// The journal in memory differs from the stored one (records turned `needsReview` at load).
    pub(crate) journal_dirty: AtomicBool,
}

impl TimeEditorState {
    /// Swift `recentChanges`: this workspace's journal, newest first.
    pub(crate) fn recent_changes(&self) -> Vec<&WorkLogChange> {
        let mut changes: Vec<&WorkLogChange> = self
            .changes
            .iter()
            .filter(|change| same_workspace(&change.workspace, &self.workspace))
            .collect();
        changes.sort_by_key(|change| std::cmp::Reverse(change.date));
        changes
    }

    /// Swift `requiresReview`.
    pub(crate) fn requires_review(&self) -> bool {
        self.recent_changes().iter().any(|change| {
            matches!(
                change.status,
                WorkLogChangeStatus::NeedsReview | WorkLogChangeStatus::Applying
            )
        })
    }

    /// Swift `visibleLogs`: ticket number (without `#`) or comment contains the filter.
    pub(crate) fn visible_logs(&self) -> Vec<&WorkLog> {
        let query = self.filter.trim().to_lowercase().replace('#', "");
        self.logs
            .iter()
            .filter(|log| {
                query.is_empty()
                    || log.work_item_id.unwrap_or(0).to_string().contains(&query)
                    || log.comment.as_deref().unwrap_or("").to_lowercase().contains(&query)
            })
            .collect()
    }

    /// Swift `proposedPlan()`.
    pub(crate) fn proposed_plan(&self, now: Timestamp, cal: &Cal) -> Result<WorkLogPlan> {
        let Some(selected) = &self.selected else {
            return Err(AppError::message("Choose an entry."));
        };
        match self.mode {
            TimeEditMode::Guided => {
                if let Some(interval) = self.idle_interval {
                    let ticket = ticket_number(&self.second_ticket).ok_or_else(|| {
                        AppError::message("Enter a valid ticket number or leave it blank.")
                    })?;
                    let separate = if self.separate_idle {
                        Some(WorkLogDraft::from_times(
                            interval.start,
                            interval.end,
                            ticket,
                            self.second_comment.non_empty().map(str::to_string),
                            self.second_activity.non_empty().map(str::to_string),
                            false,
                            now,
                            cal,
                        )?)
                    } else {
                        None
                    };
                    return TimeCorrections::remove_interval(
                        selected,
                        interval.start,
                        interval.end,
                        separate.as_ref(),
                        now,
                        cal,
                    );
                }
                self.guided_plan
                    .clone()
                    .ok_or_else(|| AppError::message("Choose a correction to preview."))
            }
            TimeEditMode::Edit => {
                WorkLogPlan::edit(selected, WorkLogTimeEdit::new(self.start, self.end), now, cal)
            }
            TimeEditMode::Split => {
                let ticket = ticket_number(&self.second_ticket).ok_or_else(|| {
                    AppError::message(
                        "Enter a valid ticket number, or leave it empty for comment-only time.",
                    )
                })?;
                WorkLogPlan::split(
                    selected,
                    self.split_at,
                    ticket,
                    self.second_comment.non_empty().map(str::to_string),
                    self.second_activity.non_empty().map(str::to_string),
                    now,
                    cal,
                )
            }
            TimeEditMode::Merge => WorkLogPlan::merge(&self.merge_logs, now, cal),
            TimeEditMode::Undo => {
                let record = self
                    .undo_record
                    .as_ref()
                    .ok_or_else(|| AppError::message("Choose a recent edit."))?;
                WorkLogPlan::undo(record, cal)
            }
        }
    }

    /// Swift `configure(_:)`.
    pub(crate) fn configure(&mut self, workspace: Option<String>) {
        self.show_corrections = false;
        self.correction_issues.clear();
        self.correction_issue = None;
        self.correction_loading = false;
        self.guided_plan = None;
        self.clear_idle();
        self.configured = workspace.is_some();
        self.workspace = workspace.unwrap_or_default();
        self.generation += 1;
        self.logs.clear();
        self.selected = None;
        self.review = None;
        self.selection.clear();
        self.issue = None;
        self.message = None;
        self.saved_conflicts.clear();
        self.saved_overlap_issue = None;
        self.loading = false;
        self.working = false;
        self.needs_reload = false;
        self.merge_logs.clear();
        self.undo_record = None;
    }

    fn clear_idle(&mut self) {
        self.idle_interval = None;
        self.idle_correction = None;
    }
}

/// Swift's ticket field rule: empty, or a number in `1…Int32.max`. `Some(None)` is "no ticket".
fn ticket_number(text: &str) -> Option<Option<i64>> {
    let text = text.trim();
    if text.is_empty() {
        return Some(None);
    }
    text.parse::<i64>().ok().filter(|id| (1..=i64::from(i32::MAX)).contains(id)).map(Some)
}

/// Swift `checkpoint(_:)`: replace the record, mark the parent of a completed undo `undone`,
/// write the journal, then apply it in memory.
fn checkpoint(
    services: &Services,
    editor: &mut TimeEditorState,
    record: WorkLogChange,
) -> Result<()> {
    if editor.journal_unreadable {
        return Err(AppError::Message(
            editor.journal_issue.clone().unwrap_or_else(|| "Edit history is unavailable.".into()),
        ));
    }
    let parent = if record.status == WorkLogChangeStatus::Complete { record.undo_of } else { None };
    let mut next: Vec<WorkLogChange> =
        editor.changes.iter().filter(|change| change.id != record.id).cloned().collect();
    next.push(record);
    if let Some(parent) = parent
        && let Some(change) = next.iter_mut().find(|change| change.id == parent)
    {
        change.status = WorkLogChangeStatus::Undone;
    }
    if !services.preview {
        persist::write_journal(services, &next)
            .map_err(|error| AppError::Message(error.to_string()))?;
    }
    editor.changes = next;
    editor.journal_issue = None;
    editor.journal_dirty.store(false, Ordering::SeqCst);
    Ok(())
}

fn checkpoint_journal(engine: &Engine, record: WorkLogChange) -> Result<()> {
    let services = engine.services();
    engine.update(|state| checkpoint(services, &mut state.controllers.time_editor, record))
}

// -- Day and table --------------------------------------------------------------------------------

/// `timeEditor.setDay` (Swift `.onChange(of: editor.day)` reloaded the page).
pub(crate) async fn set_day(engine: &Engine, day: Date) -> Result<Value, IpcError> {
    let reload = engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        let changed = editor.day != day;
        editor.day = day;
        changed && visible(state, pages::TIME_EDITOR)
    });
    if reload {
        load_intent(engine).await?;
    }
    done()
}

/// `timeEditor.setFilter` (Swift `.onChange(of: editor.filter)` cleared the selection).
pub(crate) fn set_filter(engine: &Engine, text: String) -> Result<Value, IpcError> {
    engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        if editor.filter != text {
            editor.filter = text;
            editor.selection.clear();
        }
    });
    done()
}

pub(crate) async fn load_intent(engine: &Engine) -> Result<Value, IpcError> {
    let engine = engine.clone();
    detached(async move { load(&engine).await }).await.ok_or_else(internal)?;
    done()
}

/// Swift `load()`: the day's entries with their editability, unless an edit is open.
pub(crate) async fn load(engine: &Engine) {
    let Some(clients) = engine.clients() else { return };
    let cal = engine.cal();
    let started = engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        if editor.working
            || editor.correction_loading
            || editor.show_corrections
            || editor.selected.is_some()
        {
            return None;
        }
        editor.generation += 1;
        editor.loading = true;
        editor.selected = None;
        editor.review = None;
        editor.issue = None;
        editor.selection.clear();
        Some((editor.generation, editor.day))
    });
    let Some((request, day)) = started else { return };
    let start = cal.start_of_date(day);
    let end = cal.add_days(start, 1);
    let result = clients.seven_pace.work_logs(Some(start), end, true).await;
    let current = still_current(engine, &clients);
    engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        if editor.generation != request {
            return;
        }
        editor.loading = false;
        if !current {
            return;
        }
        match result {
            Ok(logs) => {
                editor.logs = logs
                    .into_iter()
                    .filter(|log| {
                        log.date(cal.tz()).is_some_and(|date| date >= start && date < end)
                    })
                    .collect();
            }
            Err(error) => {
                editor.issue = Some(error.to_string());
                editor.logs.clear();
            }
        }
    });
}

pub(crate) fn set_selection(engine: &Engine, ids: Vec<String>) -> Result<Value, IpcError> {
    engine.update(|state| state.controllers.time_editor.selection = ids.into_iter().collect());
    done()
}

// -- The edit sheet -------------------------------------------------------------------------------

/// Swift `select(_:)`: reads the entry again and opens it for editing.
pub(crate) async fn select(engine: &Engine, log_id: String) -> Result<Value, IpcError> {
    let started = engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        if editor.working {
            return None;
        }
        editor.generation += 1;
        editor.working = true;
        editor.loading = false;
        editor.review = None;
        editor.issue = None;
        editor.message = None;
        editor.saved_conflicts.clear();
        editor.saved_overlap_issue = None;
        Some(editor.generation)
    });
    let Some(request) = started else { return done() };
    let engine = engine.clone();
    detached(async move {
        let cal = engine.cal();
        let result: Result<Option<WorkLog>> = async {
            let Some(clients) = engine.clients() else { return Ok(None) };
            Ok(Some(clients.seven_pace.work_log(&log_id).await?))
        }
        .await;
        engine.update(|state| {
            let editor = &mut state.controllers.time_editor;
            if editor.generation != request {
                return;
            }
            editor.working = false;
            let opened = match result {
                Ok(Some(current)) => open_entry(editor, current, &cal),
                Ok(None) => Ok(()),
                Err(error) => Err(error),
            };
            if let Err(error) = opened {
                editor.issue = Some(error.to_string());
            }
        });
    })
    .await
    .ok_or_else(internal)?;
    done()
}

fn open_entry(editor: &mut TimeEditorState, current: WorkLog, cal: &Cal) -> Result<()> {
    if current.is_can_edit != Some(true) {
        return Err(AppError::message("7pace does not allow editing this entry."));
    }
    let draft = WorkLogDraft::from_log(&current, true, cal)?;
    editor.start = draft.start;
    editor.end = draft.edit().end;
    // Swift: `Double(draft.seconds / 2)`, an integer division.
    editor.split_at = add_secs(draft.start, (draft.seconds / 2) as f64);
    editor.second_ticket = draft.ticket_id.map(|id| id.to_string()).unwrap_or_default();
    editor.second_comment = draft.comment.clone().unwrap_or_default();
    editor.second_activity = draft.activity_id.clone().unwrap_or_default();
    editor.needs_reload = false;
    editor.clear_idle();
    editor.guided_plan = None;
    editor.mode = TimeEditMode::Edit;
    editor.undo_record = None;
    editor.merge_logs.clear();
    editor.review = None;
    editor.selected = Some(current);
    Ok(())
}

/// Swift `cancel()`.
pub(crate) fn cancel(engine: &Engine) -> Result<Value, IpcError> {
    engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        if editor.working {
            return;
        }
        editor.generation += 1;
        editor.selected = None;
        editor.review = None;
        editor.issue = None;
        editor.needs_reload = false;
        editor.undo_record = None;
        editor.merge_logs.clear();
        editor.guided_plan = None;
        editor.clear_idle();
    });
    done()
}

/// The form fields; each change drops the previous overlap review (Swift `didSet`).
pub(crate) fn set_mode(engine: &Engine, mode: TimeEditMode) -> Result<Value, IpcError> {
    edit_form(engine, |editor| editor.mode = mode)
}

pub(crate) fn set_times(
    engine: &Engine,
    start: Timestamp,
    end: Timestamp,
) -> Result<Value, IpcError> {
    edit_form(engine, |editor| {
        editor.start = start;
        editor.end = end;
    })
}

pub(crate) fn set_split(
    engine: &Engine,
    at: Option<Timestamp>,
    ticket: String,
    comment: String,
    activity_id: String,
) -> Result<Value, IpcError> {
    edit_form(engine, |editor| {
        if let Some(at) = at {
            editor.split_at = at;
        }
        editor.second_ticket = ticket;
        editor.second_comment = comment;
        editor.second_activity = activity_id;
    })
}

pub(crate) fn set_separate_idle(engine: &Engine, separate: bool) -> Result<Value, IpcError> {
    edit_form(engine, |editor| editor.separate_idle = separate)
}

fn edit_form(
    engine: &Engine,
    change: impl FnOnce(&mut TimeEditorState),
) -> Result<Value, IpcError> {
    engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        change(editor);
        editor.review = None;
    });
    done()
}

/// Swift `beginMerge()`: reads the selected entries again and previews the merge.
pub(crate) async fn begin_merge(engine: &Engine) -> Result<Value, IpcError> {
    let started = engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        let candidates: Vec<String> = editor
            .visible_logs()
            .into_iter()
            .filter(|log| editor.selection.contains(&log.id))
            .map(|log| log.id.clone())
            .collect();
        if candidates.len() < 2 || editor.working {
            return None;
        }
        editor.working = true;
        editor.issue = None;
        Some((editor.generation, candidates))
    });
    let Some((request, candidates)) = started else { return done() };
    let engine = engine.clone();
    detached(async move {
        let (now, cal) = (engine.now(), engine.cal());
        let result: Result<Option<Vec<WorkLog>>> = async {
            let Some(clients) = engine.clients() else { return Ok(None) };
            let mut fresh = Vec::with_capacity(candidates.len());
            for id in &candidates {
                fresh.push(clients.seven_pace.work_log(id).await?);
            }
            WorkLogPlan::merge(&fresh, now, &cal)?;
            Ok(Some(fresh))
        }
        .await;
        engine.update(|state| {
            let editor = &mut state.controllers.time_editor;
            if editor.generation != request {
                return;
            }
            editor.working = false;
            match result {
                Ok(Some(fresh)) => {
                    editor.selected = fresh.first().cloned();
                    editor.merge_logs = fresh;
                    editor.mode = TimeEditMode::Merge;
                    editor.review = None;
                    editor.needs_reload = false;
                }
                Ok(None) => {}
                Err(error) => editor.issue = Some(error.to_string()),
            }
        });
    })
    .await
    .ok_or_else(internal)?;
    done()
}

/// Swift `beginUndo(_:)`.
pub(crate) fn begin_undo(engine: &Engine, change_id: Uuid) -> Result<Value, IpcError> {
    let cal = engine.cal();
    engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        let Some(record) = editor.changes.iter().find(|change| change.id == change_id).cloned()
        else {
            return Err(unknown_change());
        };
        if editor.working || !same_workspace(&record.workspace, &editor.workspace) {
            return Ok(());
        }
        match WorkLogPlan::undo(&record, &cal) {
            Ok(_) => {
                editor.selected = record.after.first().cloned();
                editor.undo_record = Some(record);
                editor.mode = TimeEditMode::Undo;
                editor.review = None;
                editor.issue = None;
                editor.needs_reload = false;
            }
            Err(error) => editor.issue = Some(error.to_string()),
        }
        Ok(())
    })?;
    done()
}

fn unknown_change() -> IpcError {
    IpcError::new("notFound", "This change is no longer listed in Recent edits.")
}

/// Swift `checkChanges()`: the optional overlap check against the full history.
pub(crate) async fn check_changes(engine: &Engine) -> Result<Value, IpcError> {
    let (now, cal) = (engine.now(), engine.cal());
    let started = engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        if editor.working || editor.needs_reload {
            return None;
        }
        editor.working = true;
        editor.issue = None;
        editor.review = None;
        Some((editor.generation, editor.proposed_plan(now, &cal)))
    });
    let Some((request, plan)) = started else { return done() };
    let engine = engine.clone();
    detached(async move {
        let result: Result<Option<WorkLogEditReview>> = async {
            let plan = plan?;
            let Some(clients) = engine.clients() else {
                return Err(AppError::message("Connect to 7pace first."));
            };
            let review = overlap_review(&clients, &plan, now, &cal).await?;
            Ok(still_current(&engine, &clients).then_some(review))
        }
        .await;
        engine.update(|state| {
            let editor = &mut state.controllers.time_editor;
            if editor.generation != request {
                return;
            }
            editor.working = false;
            match result {
                Ok(Some(review)) => editor.review = Some(review),
                Ok(None) => {}
                Err(error) => editor.issue = Some(error.to_string()),
            }
        });
    })
    .await
    .ok_or_else(internal)?;
    done()
}

/// Swift `check(_:)`: overlaps of every desired draft with the full history before the latest
/// end, excluding the plan's own sources. A failed check becomes a notice; it never blocks.
async fn overlap_review(
    clients: &Clients,
    plan: &WorkLogPlan,
    now: Timestamp,
    cal: &Cal,
) -> Result<WorkLogEditReview> {
    let (Some(original), Some(first)) = (plan.before.first(), plan.desired.first()) else {
        return Err(AppError::message("This change has no entries."));
    };
    let checked: Result<Vec<WorkLogConflict>> = async {
        let end = plan.desired.iter().map(|draft| draft.edit().end).max().unwrap_or(first.end());
        let history = clients.seven_pace.work_logs_before(end).await?;
        let state = TrackingService::current(clients.seven_pace.as_ref()).await?;
        let sources: BTreeSet<&str> = plan.before.iter().map(|log| log.id.as_str()).collect();
        let others: Vec<WorkLog> =
            history.into_iter().filter(|log| !sources.contains(log.id.as_str())).collect();
        plan_conflicts(plan, &original.id, &others, &state, now, cal)
    }
    .await;
    let (conflicts, overlap_issue) = match checked {
        Ok(conflicts) => (conflicts, None),
        Err(AppError::Cancelled) => return Err(AppError::Cancelled),
        Err(error) => (Vec::new(), Some(format!("Overlap check incomplete. {error}"))),
    };
    Ok(WorkLogEditReview {
        original: original.clone(),
        edit: first.edit(),
        conflicts,
        overlap_issue,
    })
}

/// Conflicts of every desired draft, once per conflicting entry (the last draft's wins, as in
/// Swift's dictionary), sorted by start.
pub(crate) fn plan_conflicts(
    plan: &WorkLogPlan,
    excluding: &str,
    others: &[WorkLog],
    state: &TrackingState,
    now: Timestamp,
    cal: &Cal,
) -> Result<Vec<WorkLogConflict>> {
    let mut found: BTreeMap<String, WorkLogConflict> = BTreeMap::new();
    for draft in &plan.desired {
        for conflict in
            WorkLogOverlap::conflicts(&draft.edit(), excluding, others, state, now, cal)?
        {
            found.insert(conflict.id.clone(), conflict);
        }
    }
    let mut conflicts: Vec<WorkLogConflict> = found.into_values().collect();
    conflicts.sort_by_key(|conflict| conflict.start);
    Ok(conflicts)
}

// -- Saving ---------------------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
enum SaveOutcome {
    /// 7pace confirmed the change.
    Saved { idle_correction: Option<Uuid> },
    /// A write may have happened and the change needs review.
    NeedsReview,
    /// Nothing was written.
    Failed,
    /// The save was not allowed (no entry, working, reload or review needed).
    Refused,
}

/// `timeEditor.save`: Swift `AppModel.saveTimeEdit()` around `TimeEditorModel.save()`. Refused
/// with `busy` while another 7pace write runs.
pub(crate) async fn save_time_edit(engine: &Engine) -> Result<Value, IpcError> {
    if engine.preview() {
        return done();
    }
    let Some(busy) = engine.inner.busy.try_acquire() else { return Err(IpcError::busy()) };
    let task_engine = engine.clone();
    let outcome = detached(async move {
        let _busy = busy;
        save(&task_engine).await
    })
    .await
    .ok_or_else(internal)?;
    match outcome {
        SaveOutcome::Saved { idle_correction } => {
            if let Some(id) = idle_correction {
                crate::session::hooks::idle_correction_applied(engine, id);
            }
            super::hooks::invalidate_worklogs(engine);
            engine.record("Tracked time updated", "Saved a time correction in 7pace");
            crate::session::hooks::worklogs_changed(engine).await;
            if engine.read(|state| visible(state, pages::TIME_EDITOR)) {
                load_intent(engine).await?;
            }
        }
        SaveOutcome::NeedsReview => {
            super::hooks::invalidate_worklogs(engine);
            crate::session::hooks::worklogs_changed(engine).await;
        }
        SaveOutcome::Failed | SaveOutcome::Refused => {}
    }
    done()
}

/// Swift `TimeEditorModel.save()`: overlap advice, then one journalled apply. Never retried.
async fn save(engine: &Engine) -> SaveOutcome {
    let Some(clients) = engine.clients() else { return SaveOutcome::Refused };
    let (now, cal) = (engine.now(), engine.cal());
    let started = engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        if editor.selected.is_none()
            || editor.working
            || editor.needs_reload
            || editor.requires_review()
        {
            return None;
        }
        editor.working = true;
        editor.issue = None;
        editor.message = None;
        // Swift: `timeEditor.idleInterval != nil ? workAwareness.correction?.id : nil`.
        let idle = editor.idle_interval.and(editor.idle_correction);
        Some((editor.generation, editor.proposed_plan(now, &cal), editor.workspace.clone(), idle))
    });
    let Some((request, plan, workspace, idle)) = started else { return SaveOutcome::Refused };
    let result: Result<(WorkLogEditReview, WorkLogChange)> = async {
        let plan = plan?;
        let overlaps = overlap_review(&clients, &plan, now, &cal).await?;
        let service: &dyn WorkLogMutationService = clients.seven_pace.as_ref();
        let record = WorkLogOperations::apply(&plan, &workspace, service, now, &cal, |record| {
            ready(checkpoint_journal(engine, record))
        })
        .await?;
        Ok((overlaps, record))
    }
    .await;
    engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        let current = editor.generation == request;
        if current {
            editor.working = false;
        }
        match result {
            Ok((overlaps, record)) => {
                if current {
                    editor.saved_conflicts = overlaps.conflicts;
                    editor.saved_overlap_issue = overlaps.overlap_issue;
                    editor.message = Some(format!(
                        "{} confirmed by 7pace. You can undo this from Recent edits.",
                        record.title
                    ));
                    editor.selected = None;
                    editor.review = None;
                    editor.selection.clear();
                    editor.clear_idle();
                    editor.guided_plan = None;
                }
                SaveOutcome::Saved { idle_correction: idle }
            }
            Err(error) => {
                if current {
                    editor.review = None;
                    editor.needs_reload = true;
                    editor.issue = Some(error.to_string());
                }
                if editor.requires_review() {
                    SaveOutcome::NeedsReview
                } else {
                    SaveOutcome::Failed
                }
            }
        }
    })
}

/// Swift `acknowledge(_:)`: the user checked a change in 7pace. Nothing is undone or retried.
pub(crate) fn acknowledge(engine: &Engine, change_id: Uuid) -> Result<Value, IpcError> {
    let services = engine.services();
    engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        let Some(mut record) = editor.changes.iter().find(|change| change.id == change_id).cloned()
        else {
            return Err(unknown_change());
        };
        if editor.working || !same_workspace(&record.workspace, &editor.workspace) {
            return Ok(());
        }
        record.status = WorkLogChangeStatus::Reviewed;
        record.detail.push_str(" User acknowledged checking the entries in 7pace.");
        if let Err(error) = checkpoint(services, editor, record) {
            editor.journal_issue = Some(error.to_string());
        }
        Ok(())
    })?;
    done()
}

// -- Gaps and overlaps ----------------------------------------------------------------------------

pub(crate) fn show_corrections(engine: &Engine, show: bool) -> Result<Value, IpcError> {
    engine.update(|state| state.controllers.time_editor.show_corrections = show);
    done()
}

/// Swift `loadCorrections(preferences:)`: gaps and overlaps in the elapsed workday (Day review
/// preferences), refused while a running timer crosses the window.
pub(crate) async fn load_corrections(engine: &Engine) -> Result<Value, IpcError> {
    let started = engine.update(|state| {
        let preferences = state.config.day_review.clone();
        let editor = &mut state.controllers.time_editor;
        if editor.working {
            return None;
        }
        editor.show_corrections = true;
        editor.loading = false;
        editor.correction_loading = true;
        editor.correction_issue = None;
        editor.correction_issues.clear();
        editor.generation += 1;
        Some((editor.generation, editor.day, preferences))
    });
    let Some((request, day, preferences)) = started else { return done() };
    let engine = engine.clone();
    detached(async move {
        let (now, cal) = (engine.now(), engine.cal());
        let result: Result<Vec<TimeCorrectionIssue>> = async {
            let day_start = cal.start_of_date(day);
            let end = now.min(preferences.time(preferences.finish_minute, day_start, &cal));
            let start = preferences.time(preferences.start_minute, day_start, &cal);
            if end <= start {
                return Err(AppError::message(
                    "There is no elapsed workday to review for this date.",
                ));
            }
            let Some(clients) = engine.clients() else {
                return Err(AppError::message("Connect to 7pace first."));
            };
            let entries = clients.seven_pace.work_logs_before(cal.add_days(day_start, 1)).await?;
            let state = TrackingService::current(clients.seven_pace.as_ref()).await?.checked()?;
            if state.running() {
                let active_start = state
                    .track
                    .as_ref()
                    .and_then(|track| track.current_track_started_date_time.as_deref())
                    .and_then(|text| wire_date::parse(text, Some(cal.tz())));
                if !active_start.is_some_and(|active| active >= end) {
                    return Err(AppError::message(
                        "Pause or stop the timer that crosses this review window, so its boundaries are confirmed.",
                    ));
                }
            }
            TimeCorrections::issues(
                &entries,
                Interval::new(start, end),
                (preferences.gap_minutes * 60) as f64,
                &cal,
            )
        }
        .await;
        engine.update(|state| {
            let editor = &mut state.controllers.time_editor;
            if editor.generation != request {
                return;
            }
            editor.correction_loading = false;
            match result {
                Ok(issues) => editor.correction_issues = issues,
                Err(error) => editor.correction_issue = Some(error.to_string()),
            }
        });
    })
    .await
    .ok_or_else(internal)?;
    done()
}

/// The plan behind a correction option (Swift `CorrectionIssueCard` buttons). `boundary`
/// defaults to the middle of the overlap, the Swift picker's initial value.
pub(crate) fn correction_plan(
    issue: &TimeCorrectionIssue,
    option: &str,
    boundary: Option<Timestamp>,
    now: Timestamp,
    cal: &Cal,
) -> Result<WorkLogPlan> {
    let trim = |log: Option<&WorkLog>| match log
        .filter(|_| issue.kind == TimeCorrectionKind::Overlap)
    {
        Some(log) => TimeCorrections::remove_interval(log, issue.start, issue.end, None, now, cal),
        None => Err(AppError::message("Select two overlapping entries.")),
    };
    match option {
        options::EXTEND_EARLIER => TimeCorrections::fill_gap(issue, true, now, cal),
        options::START_LATER_EARLIER => TimeCorrections::fill_gap(issue, false, now, cal),
        options::REMOVE_FROM_EARLIER => trim(issue.earlier.as_ref()),
        options::REMOVE_FROM_LATER => trim(issue.later.as_ref()),
        options::BOUNDARY => {
            let middle = add_secs(issue.start, issue.seconds() / 2.0);
            TimeCorrections::move_boundary(issue, boundary.unwrap_or(middle), now, cal)
        }
        _ => Err(AppError::message("Choose one of the offered corrections.")),
    }
}

/// The options offered for an issue: those with a valid plan.
pub(crate) fn correction_options(
    issue: &TimeCorrectionIssue,
    now: Timestamp,
    cal: &Cal,
) -> Vec<String> {
    let candidates: &[&str] = match issue.kind {
        TimeCorrectionKind::Gap => &[options::EXTEND_EARLIER, options::START_LATER_EARLIER],
        TimeCorrectionKind::Overlap => {
            &[options::REMOVE_FROM_EARLIER, options::REMOVE_FROM_LATER, options::BOUNDARY]
        }
    };
    candidates
        .iter()
        .filter(|option| correction_plan(issue, option, None, now, cal).is_ok())
        .map(|option| (*option).to_string())
        .collect()
}

/// `timeEditor.prepareCorrection`: Swift `prepareCorrection(_:)` with the plan of one option.
pub(crate) async fn prepare_correction(
    engine: &Engine,
    issue_id: String,
    option: String,
    boundary: Option<Timestamp>,
) -> Result<Value, IpcError> {
    let (now, cal) = (engine.now(), engine.cal());
    let plan = engine.read(|state| {
        let editor = &state.controllers.time_editor;
        let issue = editor.correction_issues.iter().find(|issue| issue.id() == issue_id)?;
        Some(correction_plan(issue, &option, boundary, now, &cal))
    });
    let plan = match plan {
        None => {
            return Err(IpcError::new(
                "notFound",
                "This correction is no longer listed. Refresh the review.",
            ));
        }
        Some(plan) => plan?,
    };
    let started = engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        if editor.working {
            return None;
        }
        editor.working = true;
        editor.correction_issue = None;
        Some(editor.generation)
    });
    let Some(request) = started else { return done() };
    let engine = engine.clone();
    detached(async move {
        let result: Result<()> = async {
            let Some(clients) = engine.clients() else {
                return Err(AppError::message("Connect to 7pace first."));
            };
            for original in &plan.before {
                let actual = clients.seven_pace.work_log(&original.id).await?;
                if !WorkLogOperations::unchanged(&actual, original) {
                    return Err(AppError::message(
                        "An entry changed. Refresh the correction review.",
                    ));
                }
            }
            Ok(())
        }
        .await;
        engine.update(|state| {
            let editor = &mut state.controllers.time_editor;
            if editor.generation != request {
                return;
            }
            editor.working = false;
            match result {
                Ok(()) => {
                    editor.selected = plan.before.first().cloned();
                    editor.guided_plan = Some(plan);
                    editor.clear_idle();
                    editor.mode = TimeEditMode::Guided;
                    editor.review = None;
                    editor.issue = None;
                    editor.needs_reload = false;
                    editor.show_corrections = false;
                }
                Err(error) => editor.correction_issue = Some(error.to_string()),
            }
        });
    })
    .await
    .ok_or_else(internal)?;
    done()
}

/// Swift `openIdleCorrection` + `prepareIdleCorrection(id:start:end:)`: the editor shows the
/// stopped session's entry with the idle interval to remove or separate.
pub(crate) async fn prepare_idle(
    engine: &Engine,
    correction: Option<Uuid>,
    work_log_id: Option<String>,
    start: Timestamp,
    end: Timestamp,
) {
    let cal = engine.cal();
    let started = engine.update(|state| {
        let editor = &mut state.controllers.time_editor;
        editor.day = cal.date(start);
        if editor.working {
            return None;
        }
        editor.working = true;
        editor.selected = None;
        editor.issue = None;
        Some(editor.generation)
    });
    let Some(request) = started else { return };
    let engine = engine.clone();
    detached(async move {
        let result: Result<(WorkLog, WorkLogDraft, Interval)> = async {
            let Some(clients) = engine.clients() else {
                return Err(AppError::message("Connect to 7pace first."));
            };
            let Some(id) = work_log_id.filter(|id| !id.trim().is_empty()) else {
                return Err(AppError::message(
                    "The stopped session has no 7pace worklog to correct. Check its recorded time in the Time editor.",
                ));
            };
            let log = clients.seven_pace.work_log(&id).await?;
            let state = TrackingService::current(clients.seven_pace.as_ref()).await?.checked()?;
            WorkLogOverlap::validate_editable_entry(&id, &state)?;
            if log.is_can_edit != Some(true) {
                return Err(AppError::message("7pace does not allow editing this entry."));
            }
            let draft = WorkLogDraft::from_log(&log, true, &cal)?;
            let lower = draft.start.max(start);
            let upper = draft.edit().end.min(end);
            if upper <= lower {
                return Err(AppError::message(
                    "The idle interval is no longer inside this entry. Check its recorded time.",
                ));
            }
            Ok((log, draft, Interval::new(lower, upper)))
        }
        .await;
        engine.update(|state| {
            let editor = &mut state.controllers.time_editor;
            if editor.generation != request {
                return;
            }
            editor.working = false;
            match result {
                Ok((log, draft, interval)) => {
                    editor.idle_interval = Some(interval);
                    editor.idle_correction = correction;
                    editor.guided_plan = None;
                    editor.separate_idle = false;
                    editor.second_ticket.clear();
                    editor.second_comment = "Idle time".into();
                    editor.second_activity = draft.activity_id.unwrap_or_default();
                    editor.mode = TimeEditMode::Guided;
                    editor.selected = Some(log);
                    editor.review = None;
                    editor.needs_reload = false;
                    editor.show_corrections = false;
                }
                Err(error) => editor.issue = Some(error.to_string()),
            }
        });
    })
    .await;
}

/// For the slice: the advisory overlaps of the pending change with the loaded day's entries and
/// the confirmed timer (Swift `TimeEditorView.loadedConflicts`).
pub(crate) fn loaded_conflicts(
    editor: &TimeEditorState,
    state: Option<&TrackingState>,
    now: Timestamp,
    cal: &Cal,
) -> Vec<WorkLogConflict> {
    let (Ok(plan), Some(state)) = (editor.proposed_plan(now, cal), state) else {
        return Vec::new();
    };
    let Some(first) = plan.before.first() else { return Vec::new() };
    let sources: BTreeSet<&str> = plan.before.iter().map(|log| log.id.as_str()).collect();
    let others: Vec<WorkLog> =
        editor.logs.iter().filter(|log| !sources.contains(log.id.as_str())).cloned().collect();
    plan_conflicts(&plan, &first.id, &others, state, now, cal).unwrap_or_default()
}
