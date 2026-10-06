//! Worklog drafts, plans, the change journal and the transactional executor.
//! Ported from WorkLogOperations.swift.
//!
//! [`WorkLogOperations::apply`] writes a [`WorkLogPlan`] the way the Swift app did: validate, read
//! every source again, journal the change *before* the first write and after every step, create
//! replacements first, update retained entries next and delete originals last. Every request is
//! sent once; any failure leaves a `needsReview` record instead of a retry.
//!
//! Cancellation: Swift checked `Task.checkCancellation()` before each write and journalled the
//! cancellation as `needsReview`. A dropped Rust future stops at its next `.await` without running
//! that failure path, so the last checkpoint keeps status `applying`. Callers must treat a record
//! that is still `applying` after its future ended (or after a restart) as needing review, as
//! the Swift time editor did when it reopened the journal.

use std::collections::BTreeSet;

use jiff::Timestamp;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{WorkLogDraft, WorkLogTimeEdit, edit::WorkLogOverlap};
use crate::error::{AppError, Result};
use crate::model::WorkLog;
use crate::service::WorkLogMutationService;
use crate::text::NonEmpty;
use crate::time::{Cal, add_secs, diff_secs, floor_to_second, round_to_second};

impl WorkLogDraft {
    /// A new entry from times the user chose (Swift `init(start:end:ticketID:comment:activityID:
    /// billable:)`). Both ends round *down* to whole seconds so a stop at `now` never lands in the
    /// future. Billable drafts bill their full length; ticket-free drafts need a comment.
    #[allow(clippy::too_many_arguments)] // Mirrors the Swift initialiser plus `now` and `cal`.
    pub fn from_times(
        start: Timestamp,
        end: Timestamp,
        ticket_id: Option<i64>,
        comment: Option<String>,
        activity_id: Option<String>,
        billable: bool,
        now: Timestamp,
        cal: &Cal,
    ) -> Result<Self> {
        if end > now {
            return Err(AppError::message("Choose valid times with no time in the future."));
        }
        let edit = WorkLogTimeEdit::new(floor_to_second(start), floor_to_second(end));
        edit.validate(now, cal)?;
        let seconds = edit.seconds();
        let draft = Self {
            existing_id: None,
            restored_id: None,
            start: edit.start,
            seconds,
            billable_seconds: if billable { seconds } else { 0 },
            ticket_id,
            comment,
            allow_default_activity: activity_id.is_none(),
            activity_id,
            user_id: None,
        };
        draft.validate(now, cal)?;
        Ok(draft)
    }

    /// The draft that reproduces a server entry (Swift `init(_ log:existing:)`). Times round to the
    /// nearest second and a missing billable length defaults to the full length. With
    /// `existing == false` the draft creates a new entry instead of updating `log`.
    pub fn from_log(log: &WorkLog, existing: bool, cal: &Cal) -> Result<Self> {
        let limit = f64::from(i32::MAX);
        let billable = log.billable_length.unwrap_or(log.length);
        let readable = log.length.is_finite()
            && (1.0..=limit).contains(&log.length)
            && billable.is_finite()
            && (0.0..=limit).contains(&billable);
        let Some(date) = log.date(cal.tz()).filter(|_| readable) else {
            return Err(AppError::message("This entry has an invalid time or billable duration."));
        };
        Ok(Self {
            existing_id: existing.then(|| log.id.clone()),
            restored_id: None,
            start: round_to_second(date),
            seconds: log.length.round() as i64,
            billable_seconds: billable.round() as i64,
            ticket_id: log.ticket_id(),
            comment: log.comment.clone(),
            activity_id: log.activity_type.as_ref().map(|activity| activity.id.clone()),
            user_id: log.user.as_ref().and_then(|user| user.id.clone()),
            allow_default_activity: false,
        })
    }

    /// Valid times, a billable length within `0…Int32.max`, and a ticket in `1…Int32.max` or a
    /// comment for ticket-free time.
    pub fn validate(&self, now: Timestamp, cal: &Cal) -> Result<()> {
        self.edit().validate(now, cal)?;
        let limit = i64::from(i32::MAX);
        let target = match self.ticket_id {
            Some(id) => (1..=limit).contains(&id),
            None => self.comment.non_empty().is_some(),
        };
        if !(0..=limit).contains(&self.billable_seconds) || !target {
            return Err(AppError::message(
                "Choose a valid ticket or add a comment for ticket-free time.",
            ));
        }
        Ok(())
    }

    /// Whether 7pace stored exactly this draft. Blank comments compare equal, the activity is
    /// ignored when the server may pick its default, and the owner only when the draft names one.
    pub fn matches(&self, log: &WorkLog, cal: &Cal) -> bool {
        self.edit().matches(log, cal)
            && log.ticket_id() == self.ticket_id
            && log.comment.non_empty().unwrap_or("") == self.comment.non_empty().unwrap_or("")
            && (self.allow_default_activity
                || log.activity_type.as_ref().map(|activity| activity.id.as_str())
                    == self.activity_id.as_deref())
            && (self.user_id.is_none()
                || log.user.as_ref().and_then(|user| user.id.as_deref()) == self.user_id.as_deref())
            && (log.billable_length.unwrap_or(log.length) - self.billable_seconds as f64).abs()
                < 1.0
    }
}

/// The entries a change starts from and the drafts it should leave behind. Ported from
/// `WorkLogPlan`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkLogPlan {
    pub title: String,
    #[serde(default)]
    pub before: Vec<WorkLog>,
    #[serde(default)]
    pub desired: Vec<WorkLogDraft>,
    /// The journal record this plan reverts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_of: Option<Uuid>,
}

impl WorkLogPlan {
    /// New start and length for one entry. An entry without an explicit billable length keeps
    /// billing its full (new) length.
    pub fn edit(log: &WorkLog, time: WorkLogTimeEdit, now: Timestamp, cal: &Cal) -> Result<Self> {
        time.validate(now, cal)?;
        let mut draft = WorkLogDraft::from_log(log, true, cal)?;
        draft.start = time.start;
        draft.seconds = time.seconds();
        if log.billable_length.is_none() {
            draft.billable_seconds = time.seconds();
        }
        Ok(Self {
            title: "Edit time".into(),
            before: vec![log.clone()],
            desired: vec![draft],
            undo_of: None,
        })
    }

    /// Splits `log` at `at` (rounded to a second). The first part keeps the entry; the second part
    /// becomes a new entry with its own ticket, comment and activity. Billable time is divided in
    /// proportion and the rounding remainder stays with the second part, so the total is exact.
    pub fn split(
        log: &WorkLog,
        at: Timestamp,
        second_ticket: Option<i64>,
        second_comment: Option<String>,
        second_activity: Option<String>,
        now: Timestamp,
        cal: &Cal,
    ) -> Result<Self> {
        let mut first = WorkLogDraft::from_log(log, true, cal)?;
        let mut second = first.clone();
        let left = diff_secs(at, first.start).round() as i64;
        if left <= 0 || left >= first.seconds {
            return Err(AppError::message("Choose a split time strictly inside the entry."));
        }
        second.existing_id = None;
        second.start = add_secs(first.start, left as f64);
        second.seconds = first.seconds - left;
        let left_billable =
            (first.billable_seconds as f64 * left as f64 / first.seconds as f64).round() as i64;
        second.billable_seconds = first.billable_seconds - left_billable;
        first.billable_seconds = left_billable;
        first.seconds = left;
        second.ticket_id = second_ticket;
        second.comment = second_comment;
        second.allow_default_activity = second_activity.is_none();
        second.activity_id = second_activity;
        first.validate(now, cal)?;
        second.validate(now, cal)?;
        Ok(Self {
            title: "Split entry".into(),
            before: vec![log.clone()],
            desired: vec![first, second],
            undo_of: None,
        })
    }

    /// Merges at least two different, adjacent (within a second) entries with the same ticket,
    /// activity, comment and owner into the earliest one. Gaps and overlaps are never filled or
    /// removed by a merge.
    pub fn merge(logs: &[WorkLog], now: Timestamp, cal: &Cal) -> Result<Self> {
        let mut sorted = logs.to_vec();
        // Unreadable dates sort first, like Swift's `.distantPast` fallback.
        sorted.sort_by_cached_key(|log| log.date(cal.tz()).unwrap_or(Timestamp::MIN));
        let distinct: BTreeSet<&str> = sorted.iter().map(|log| log.id.as_str()).collect();
        if sorted.len() < 2 || distinct.len() != sorted.len() {
            return Err(AppError::message("Select at least two different entries to merge."));
        }
        let mut combined = WorkLogDraft::from_log(&sorted[0], true, cal)?;
        let mut end = combined.edit().end;
        for log in &sorted[1..] {
            let next = WorkLogDraft::from_log(log, true, cal)?;
            if next.ticket_id != combined.ticket_id
                || next.activity_id != combined.activity_id
                || next.comment != combined.comment
                || next.user_id != combined.user_id
            {
                return Err(AppError::message(
                    "Merge entries with the same ticket, activity, comment and owner. Different work stays separate.",
                ));
            }
            if diff_secs(next.start, end).abs() >= 1.0 {
                return Err(AppError::message(
                    "Only adjacent entries can be merged. Gaps and overlapping time are not filled or removed.",
                ));
            }
            combined.seconds += next.seconds;
            combined.billable_seconds += next.billable_seconds;
            end = next.edit().end;
        }
        combined.validate(now, cal)?;
        Ok(Self {
            title: format!("Merge {} entries", sorted.len()),
            before: sorted,
            desired: vec![combined],
            undo_of: None,
        })
    }

    /// Reverts a completed change: entries that still exist are updated back, removed ones are
    /// recreated (with a new ID, after checking the old one is still gone), and entries the change
    /// created are deleted.
    pub fn undo(record: &WorkLogChange, cal: &Cal) -> Result<Self> {
        if record.status != WorkLogChangeStatus::Complete {
            return Err(AppError::message("Only a confirmed, completed change can be undone."));
        }
        let existing: BTreeSet<&str> = record.after.iter().map(|log| log.id.as_str()).collect();
        let desired = record
            .before
            .iter()
            .map(|log| {
                let mut draft =
                    WorkLogDraft::from_log(log, existing.contains(log.id.as_str()), cal)?;
                if draft.existing_id.is_none() {
                    draft.restored_id = Some(log.id.clone());
                }
                Ok(draft)
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Self {
            title: format!("Undo {}", record.title.to_lowercase()),
            before: record.after.clone(),
            desired,
            undo_of: Some(record.id),
        })
    }
}

/// Journal state of a change. Encodes as the Swift case name (`"needsReview"`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkLogChangeStatus {
    /// Writes may be in flight. Still `applying` after the operation ended means it was
    /// interrupted and must be reviewed.
    #[default]
    Applying,
    Complete,
    /// A step failed or could not be confirmed; nothing is replayed.
    NeedsReview,
    /// The user confirmed they checked a `needsReview` change in 7pace.
    Reviewed,
    /// A later completed change reverted this one.
    Undone,
}

/// One change in the recovery journal (`time-edit-history.json`). Ported from `WorkLogChange`.
///
/// Decodes the Swift journal directly: Swift's `JSONEncoder` dates (seconds since 2001), uppercase
/// UUIDs, omitted `undoOf`. Missing keys with a Swift default (`status`, `detail`) and missing
/// lists decode to those defaults instead of failing the whole journal.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkLogChange {
    pub id: Uuid,
    #[serde(with = "crate::time::flex_date")]
    pub date: Timestamp,
    /// The workspace identity (lower-cased 7pace URL) the change was made in.
    pub workspace: String,
    pub title: String,
    /// The entries as they were before the change.
    #[serde(default)]
    pub before: Vec<WorkLog>,
    /// The entries as last confirmed by 7pace, updated after every step.
    #[serde(default)]
    pub after: Vec<WorkLog>,
    #[serde(default)]
    pub desired: Vec<WorkLogDraft>,
    #[serde(default)]
    pub status: WorkLogChangeStatus,
    #[serde(default = "preparing_change")]
    pub detail: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_of: Option<Uuid>,
}

fn preparing_change() -> String {
    "Preparing change".to_string()
}

impl WorkLogChange {
    /// A fresh `applying` record for `plan`; `after` starts as a copy of `before`.
    pub fn new(plan: &WorkLogPlan, workspace: impl Into<String>, now: Timestamp) -> Self {
        Self {
            id: Uuid::new_v4(),
            date: now,
            workspace: workspace.into(),
            title: plan.title.clone(),
            before: plan.before.clone(),
            after: plan.before.clone(),
            desired: plan.desired.clone(),
            status: WorkLogChangeStatus::Applying,
            detail: preparing_change(),
            undo_of: plan.undo_of,
        }
    }
}

/// The transactional executor. Ported from `WorkLogOperations`.
pub enum WorkLogOperations {}

impl WorkLogOperations {
    /// Field-by-field identity of a server entry, including its edit stamp, owner and billable
    /// length (missing billable lengths compare as the full length).
    pub fn unchanged(actual: &WorkLog, expected: &WorkLog) -> bool {
        actual.id == expected.id
            && actual.timestamp == expected.timestamp
            && actual.length == expected.length
            && actual.edited_timestamp == expected.edited_timestamp
            && actual.work_item_id == expected.work_item_id
            && actual.comment == expected.comment
            && actual.activity_type.as_ref().map(|a| a.id.as_str())
                == expected.activity_type.as_ref().map(|a| a.id.as_str())
            && actual.user.as_ref().and_then(|u| u.id.as_deref())
                == expected.user.as_ref().and_then(|u| u.id.as_deref())
            && actual.billable_length.unwrap_or(actual.length)
                == expected.billable_length.unwrap_or(expected.length)
    }

    async fn verify(
        expected: &WorkLog,
        deleting: bool,
        service: &dyn WorkLogMutationService,
    ) -> Result<()> {
        let actual = service.work_log(&expected.id).await?;
        if !Self::unchanged(&actual, expected) {
            return Err(AppError::message(
                "An affected entry changed in 7pace. Refresh before applying this change.",
            ));
        }
        if actual.is_can_edit != Some(true) || (deleting && actual.is_can_delete != Some(true)) {
            return Err(AppError::message(
                "7pace does not allow editing or deleting one of these entries. Check its approval state and permissions.",
            ));
        }
        let state = service.current_tracking().await?.checked()?;
        WorkLogOverlap::validate_editable_entry(&expected.id, &state)
    }

    /// Applies `plan` in `workspace` and returns the completed journal record.
    ///
    /// `checkpoint` persists the journal record. It runs once before any write and again after
    /// every step; when the first checkpoint fails nothing is written. Once writing has started,
    /// any error (including a failed checkpoint) marks the record `needsReview`, checkpoints it
    /// once more (ignoring that result) and returns an error that tells the user to review the
    /// entries. No request is ever retried.
    pub async fn apply<F, Fut>(
        plan: &WorkLogPlan,
        workspace: &str,
        service: &dyn WorkLogMutationService,
        now: Timestamp,
        cal: &Cal,
        mut checkpoint: F,
    ) -> Result<WorkLogChange>
    where
        F: FnMut(WorkLogChange) -> Fut,
        Fut: Future<Output = Result<()>>,
    {
        if plan.before.is_empty() || plan.desired.is_empty() {
            return Err(AppError::message("This change has no entries."));
        }
        for draft in &plan.desired {
            draft.validate(now, cal)?;
        }
        let existing: Vec<&str> =
            plan.desired.iter().filter_map(|draft| draft.existing_id.as_deref()).collect();
        let retained: BTreeSet<&str> = existing.iter().copied().collect();
        let originals: BTreeSet<&str> = plan.before.iter().map(|log| log.id.as_str()).collect();
        if originals.len() != plan.before.len()
            || !retained.is_subset(&originals)
            || retained.len() != existing.len()
        {
            return Err(AppError::message("This change contains duplicate or unknown entries."));
        }
        for log in &plan.before {
            Self::verify(log, !retained.contains(log.id.as_str()), service).await?;
        }
        for draft in &plan.desired {
            if let Some(old_id) = draft.restored_id.as_deref()
                && service.find_work_log(old_id).await?.is_some()
            {
                return Err(AppError::message(
                    "An entry scheduled for restoration already exists. Refresh before undoing.",
                ));
            }
        }
        let mut record = WorkLogChange::new(plan, workspace, now);
        checkpoint(record.clone()).await?;
        let steps = Steps { plan, retained: &retained, originals: &originals, service, cal };
        match steps.run(&mut record, &mut checkpoint).await {
            Ok(()) => Ok(record),
            Err(error) => {
                record.status = WorkLogChangeStatus::NeedsReview;
                record.detail = format!(
                    "{} Some changes may already be saved. No request was retried. {error}",
                    record.detail
                );
                // Best effort: the error below already tells the user to review the entries.
                let _ = checkpoint(record.clone()).await;
                Err(AppError::Message(format!(
                    "{} Review Recent edits and the actual entries in 7pace before continuing.",
                    record.detail
                )))
            }
        }
    }
}

/// The write phase of [`WorkLogOperations::apply`] (the Swift `do` block).
struct Steps<'a> {
    plan: &'a WorkLogPlan,
    retained: &'a BTreeSet<&'a str>,
    originals: &'a BTreeSet<&'a str>,
    service: &'a dyn WorkLogMutationService,
    cal: &'a Cal,
}

impl Steps<'_> {
    fn deleting(&self, log: &WorkLog) -> bool {
        !self.retained.contains(log.id.as_str())
    }

    async fn run<F, Fut>(&self, record: &mut WorkLogChange, checkpoint: &mut F) -> Result<()>
    where
        F: FnMut(WorkLogChange) -> Fut,
        Fut: Future<Output = Result<()>>,
    {
        let service = self.service;
        // Preserve every source until replacements have been confirmed. Each request is sent once.
        for draft in self.plan.desired.iter().filter(|draft| draft.existing_id.is_none()) {
            for log in &self.plan.before {
                WorkLogOperations::verify(log, self.deleting(log), service).await?;
            }
            record.detail = "Creating a replacement entry; if interrupted, check 7pace before doing anything else.".into();
            checkpoint(record.clone()).await?;
            let created = service.create_work_log(draft).await?;
            record.after.push(created.clone());
            checkpoint(record.clone()).await?;
            if !is_swift_uuid(&created.id)
                || self.originals.contains(created.id.as_str())
                || !draft.matches(&created, self.cal)
            {
                return Err(AppError::message(
                    "7pace did not confirm the replacement entry as requested.",
                ));
            }
        }
        for draft in &self.plan.desired {
            let Some(id) = draft.existing_id.as_deref() else { continue };
            // `apply` checked that every retained ID is one of the originals.
            let Some(original) = self.plan.before.iter().find(|log| log.id == id) else {
                return Err(AppError::message(
                    "This change contains duplicate or unknown entries.",
                ));
            };
            WorkLogOperations::verify(original, false, service).await?;
            record.detail = format!("Updating entry {id}.");
            checkpoint(record.clone()).await?;
            let saved = service.replace_work_log_time(id, draft).await?;
            record.after.retain(|log| log.id != id);
            record.after.push(saved.clone());
            checkpoint(record.clone()).await?;
            if saved.id != id || !draft.matches(&saved, self.cal) {
                return Err(AppError::message(
                    "7pace did not confirm the updated entry as requested.",
                ));
            }
        }
        for original in self.plan.before.iter().filter(|log| self.deleting(log)) {
            // Recheck replacements as well as the source before removing redundant time.
            let replacements: Vec<WorkLog> = record
                .after
                .iter()
                .filter(|saved| {
                    saved.id != original.id
                        && (self.retained.contains(saved.id.as_str())
                            || !self.originals.contains(saved.id.as_str()))
                })
                .cloned()
                .collect();
            for saved in &replacements {
                let actual = service.work_log(&saved.id).await?;
                if !WorkLogOperations::unchanged(&actual, saved) {
                    return Err(AppError::message(
                        "A replacement entry changed before the merge finished. Check the change history.",
                    ));
                }
            }
            WorkLogOperations::verify(original, true, service).await?;
            record.detail = format!("Removing original entry {}.", original.id);
            checkpoint(record.clone()).await?;
            service.delete_work_log(&original.id).await?;
            // Only a 404 (`None`) confirms the removal.
            if service.find_work_log(&original.id).await?.is_some() {
                return Err(AppError::message(
                    "7pace did not confirm removal of the original entry.",
                ));
            }
            record.after.retain(|log| log.id != original.id);
            checkpoint(record.clone()).await?;
        }
        record.status = WorkLogChangeStatus::Complete;
        record.detail = "Confirmed by 7pace".into();
        checkpoint(record.clone()).await
    }
}

/// Swift `UUID(uuidString:) != nil`: only the hyphenated 8-4-4-4-12 form, in either case.
/// (`Uuid::try_parse` alone also accepts the simple, braced and URN forms.)
pub fn is_swift_uuid(text: &str) -> bool {
    text.len() == 36 && Uuid::try_parse(text).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swift_uuid_check_accepts_only_the_hyphenated_form() {
        assert!(is_swift_uuid("33333333-3333-3333-3333-333333333333"));
        assert!(is_swift_uuid("abcdefab-3333-3333-3333-33333333ABCD"));
        assert!(!is_swift_uuid("33333333333333333333333333333333"));
        assert!(!is_swift_uuid("{33333333-3333-3333-3333-333333333333}"));
        assert!(!is_swift_uuid("urn:uuid:33333333-3333-3333-3333-333333333333"));
        assert!(!is_swift_uuid("not-a-uuid"));
    }
}
