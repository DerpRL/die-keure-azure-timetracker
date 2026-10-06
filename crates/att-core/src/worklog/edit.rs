//! Time edits, overlap detection and the review/save flow. Ported from WorkLogEditing.swift.
//!
//! The Swift app saved recorded time through `WorkLogOperations`. [`WorkLogEditing`] is ported
//! anyway because its advisory-overlap semantics are tested and the 2.0 engine uses them: a failed
//! or incomplete overlap scan becomes a notice (`overlap_issue`) and never blocks the save, while
//! missing permissions, external changes, invalid times and the running entry still block it.
//!
//! Cancellation: Swift re-checked `Task.checkCancellation()` after a failed history query and
//! before the write. In Rust a dropped future never reaches the write, and a history query that
//! reports [`AppError::Cancelled`] is propagated instead of becoming an overlap notice.

use std::collections::BTreeSet;

use jiff::Timestamp;
use serde::{Deserialize, Serialize};

use super::WorkLogTimeEdit;
use crate::error::{AppError, Result};
use crate::model::{TrackingState, WorkLog};
use crate::service::WorkLogEditingService;
use crate::text::NonEmpty;
use crate::time::{Cal, add_secs, diff_secs, wire_date};

/// Prefix of every advisory overlap notice in the review/save flow.
const OVERLAP_INCOMPLETE: &str = "The overlap check could not be completed. ";

impl WorkLogTimeEdit {
    /// Ported from `WorkLogTimeEdit.validate(now:)`: at least one second, at most `Int32.max`
    /// seconds, no time after `now`, and a start that survives the local-string round trip.
    pub fn validate(&self, now: Timestamp, cal: &Cal) -> Result<()> {
        let duration = diff_secs(self.end, self.start);
        if !(1.0..=f64::from(i32::MAX)).contains(&duration) || self.end > now {
            return Err(AppError::message(
                "Choose an end after the start, with no time in the future.",
            ));
        }
        // 7pace receives offset-free local times (`wire_date::local_string`). When clocks go back,
        // the repeated hour's local string parses to only one of its two instants; the other one
        // would be saved an hour off, so it is rejected. Which instant survives is decided by
        // `wire_date::parse`, the same parser that later reads the saved entry back.
        let local = wire_date::local_string(self.start, cal.tz());
        let round_trip = wire_date::parse(&local, Some(cal.tz()));
        if !round_trip.is_some_and(|parsed| diff_secs(parsed, self.start).abs() < 1.0) {
            return Err(AppError::message(
                "This start time is ambiguous during a clock change. Choose an unambiguous local time.",
            ));
        }
        Ok(())
    }

    /// Whether `log` starts within a second of this start and lasts within a second as long.
    pub fn matches(&self, log: &WorkLog, cal: &Cal) -> bool {
        log.date(cal.tz()).is_some_and(|start| diff_secs(start, self.start).abs() < 1.0)
            && (log.length - diff_secs(self.end, self.start)).abs() < 1.0
    }
}

/// Another entry (or the running timer) that shares time with a proposed edit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkLogConflict {
    pub id: String,
    pub ticket_id: Option<i64>,
    pub title: String,
    pub start: Timestamp,
    pub end: Timestamp,
    /// The running 7pace timer, counted as `[start, now]`.
    pub active: bool,
    /// Shared seconds.
    pub overlap: f64,
}

/// Overlap and editability rules. Ported from `WorkLogOverlap`.
pub enum WorkLogOverlap {}

impl WorkLogOverlap {
    /// The running entry cannot be edited, and a running timer without a worklog ID blocks every
    /// edit because the running entry cannot be identified.
    pub fn validate_editable_entry(id: &str, state: &TrackingState) -> Result<()> {
        let active_id = active_work_log_id(state);
        if state.running() && active_id.non_empty().is_none() {
            return Err(AppError::message(
                "7pace has a running timer without a worklog ID. Stop it before editing recorded time.",
            ));
        }
        if active_id == Some(id) {
            return Err(AppError::message(
                "This entry is still running. Stop or pause it before editing.",
            ));
        }
        Ok(())
    }

    /// Entries that share time with `edit`, sorted by start. `excluding` is the entry being
    /// edited. The running timer is reported once, as `[start, now]`, even when the history also
    /// lists its worklog. Entries that only touch the edit's edges do not overlap.
    pub fn conflicts(
        edit: &WorkLogTimeEdit,
        excluding: &str,
        logs: &[WorkLog],
        state: &TrackingState,
        now: Timestamp,
        cal: &Cal,
    ) -> Result<Vec<WorkLogConflict>> {
        Self::validate_editable_entry(excluding, state)?;
        let active_id = active_work_log_id(state);
        let mut result = Vec::new();
        let mut seen = BTreeSet::new();
        for log in logs {
            if log.id == excluding || Some(log.id.as_str()) == active_id || !seen.insert(&log.id) {
                continue;
            }
            let start = match log.date(cal.tz()) {
                Some(start) if log.length.is_finite() && log.length >= 0.0 => start,
                _ => {
                    return Err(AppError::message(
                        "An existing entry has an unreadable time, so overlaps could not be fully checked.",
                    ));
                }
            };
            let end = add_secs(start, log.length);
            let overlap = diff_secs(end.min(edit.end), start.max(edit.start));
            if overlap > 0.0 {
                result.push(WorkLogConflict {
                    id: log.id.clone(),
                    ticket_id: log.work_item_id,
                    title: log.comment.non_empty().unwrap_or("Tracked time").to_string(),
                    start,
                    end,
                    active: false,
                    overlap,
                });
            }
        }
        if let (Some(track), Some(active_id)) = (state.track.as_ref(), active_id) {
            let start = track
                .current_track_started_date_time
                .as_deref()
                .and_then(|text| wire_date::parse(text, Some(cal.tz())));
            let Some(start) = start else {
                return Err(AppError::message(
                    "7pace did not provide the running timer’s start, so its overlaps could not be checked.",
                ));
            };
            let overlap = diff_secs(now.min(edit.end), start.max(edit.start));
            if overlap > 0.0 {
                result.push(WorkLogConflict {
                    id: active_id.to_string(),
                    ticket_id: track.ticket_id(),
                    title: track.title(),
                    start,
                    end: now,
                    active: true,
                    overlap,
                });
            }
        }
        result.sort_by_key(|conflict| conflict.start);
        Ok(result)
    }
}

/// The running timer's worklog ID; `None` while idle.
fn active_work_log_id(state: &TrackingState) -> Option<&str> {
    if !state.running() {
        return None;
    }
    state.track.as_ref().and_then(|track| track.work_log_id.as_deref())
}

/// The fresh entry and overlap advice for a proposed edit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkLogEditReview {
    /// The entry as 7pace returned it during the review.
    pub original: WorkLog,
    pub edit: WorkLogTimeEdit,
    pub conflicts: Vec<WorkLogConflict>,
    /// Why the advisory overlap check is incomplete; never blocks saving.
    pub overlap_issue: Option<String>,
}

/// A confirmed time edit with the overlaps found just before it was saved.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkLogEditResult {
    pub saved: WorkLog,
    pub conflicts: Vec<WorkLogConflict>,
    pub overlap_issue: Option<String>,
}

/// The review/save flow for a single time edit. Ported from `WorkLogEditing`.
pub enum WorkLogEditing {}

impl WorkLogEditing {
    /// Re-reads the entry and the tracking state, and checks overlaps with the full history.
    pub async fn review(
        original: &WorkLog,
        edit: WorkLogTimeEdit,
        service: &dyn WorkLogEditingService,
        now: Timestamp,
        cal: &Cal,
    ) -> Result<WorkLogEditReview> {
        edit.validate(now, cal)?;
        let mut logs = Vec::new();
        let mut overlap_issue = None;
        match service.work_logs_before(edit.end).await {
            Ok(found) => logs = found,
            Err(AppError::Cancelled) => return Err(AppError::Cancelled),
            Err(error) => overlap_issue = Some(format!("{OVERLAP_INCOMPLETE}{error}")),
        }
        // Read the edited entry after the potentially long history query.
        let current = service.work_log(&original.id).await?;
        if current.is_can_edit != Some(true) {
            return Err(AppError::message(
                "7pace does not allow editing this entry. Its week may be locked, or your account may lack permission.",
            ));
        }
        let unchanged = current.id == original.id
            && current.timestamp == original.timestamp
            && current.length == original.length
            && current.edited_timestamp == original.edited_timestamp
            && current.work_item_id == original.work_item_id
            && current.comment == original.comment
            && activity_id(&current) == activity_id(original)
            && current.billable_length == original.billable_length;
        if !unchanged {
            return Err(AppError::message(
                "This entry changed in 7pace. Reload it before editing so another change is not overwritten.",
            ));
        }
        let state = service.current_tracking().await?.checked()?;
        // Editing a live entry is separate from the advisory overlap check.
        WorkLogOverlap::validate_editable_entry(&original.id, &state)?;
        let mut conflicts = Vec::new();
        if overlap_issue.is_none() {
            match WorkLogOverlap::conflicts(&edit, &original.id, &logs, &state, now, cal) {
                Ok(found) => conflicts = found,
                Err(error) => overlap_issue = Some(format!("{OVERLAP_INCOMPLETE}{error}")),
            }
        }
        Ok(WorkLogEditReview { original: current, edit, conflicts, overlap_issue })
    }

    /// Reviews again (never trusting an earlier review), writes once and confirms the result.
    /// A failed or mismatched write is reported, never retried.
    pub async fn save(
        original: &WorkLog,
        edit: WorkLogTimeEdit,
        service: &dyn WorkLogEditingService,
        now: Timestamp,
        cal: &Cal,
    ) -> Result<WorkLogEditResult> {
        let fresh = Self::review(original, edit, service, now, cal).await?;
        let saved = service.update_work_log_time(&fresh.original.id, &fresh.edit).await?;
        if saved.id != fresh.original.id || !fresh.edit.matches(&saved, cal) {
            return Err(AppError::message(
                "7pace did not confirm the requested time. Reload the entry before trying again.",
            ));
        }
        Ok(WorkLogEditResult {
            saved,
            conflicts: fresh.conflicts,
            overlap_issue: fresh.overlap_issue,
        })
    }
}

fn activity_id(log: &WorkLog) -> Option<&str> {
    log.activity_type.as_ref().map(|activity| activity.id.as_str())
}
