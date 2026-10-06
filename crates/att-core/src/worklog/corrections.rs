//! Gap and overlap corrections. Ported from TimeCorrections.swift.
//!
//! [`TimeCorrections::issues`] finds gaps against the union of recorded time and overlaps between
//! pairs of entries inside a review window. The correction builders return a [`WorkLogPlan`] that
//! is previewed and then written with `WorkLogOperations::apply`, so every correction can be
//! undone. No builder removes a whole entry.

use std::collections::BTreeSet;

use jiff::Timestamp;
use serde::{Deserialize, Serialize};

use super::ops::WorkLogPlan;
use super::{WorkLogDraft, WorkLogTimeEdit};
use crate::error::{AppError, Result};
use crate::model::WorkLog;
use crate::time::{Cal, Interval, add_secs, diff_secs, secs};

/// Swift `TimeCorrectionIssue.Kind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimeCorrectionKind {
    Gap,
    Overlap,
}

impl TimeCorrectionKind {
    pub fn raw(&self) -> &'static str {
        match self {
            Self::Gap => "gap",
            Self::Overlap => "overlap",
        }
    }
}

/// A gap between recorded time, or time recorded twice. Ported from `TimeCorrectionIssue`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeCorrectionIssue {
    pub kind: TimeCorrectionKind,
    pub start: Timestamp,
    pub end: Timestamp,
    /// The entry before a gap, or the earlier of two overlapping entries.
    pub earlier: Option<WorkLog>,
    /// The entry after a gap, or the later of two overlapping entries.
    pub later: Option<WorkLog>,
}

impl TimeCorrectionIssue {
    fn new(
        kind: TimeCorrectionKind,
        start: Timestamp,
        end: Timestamp,
        earlier: Option<&WorkLog>,
        later: Option<&WorkLog>,
    ) -> Self {
        Self { kind, start, end, earlier: earlier.cloned(), later: later.cloned() }
    }

    /// `kind|startSeconds|earlierID|laterID`. The seconds use Swift's `Double` text
    /// (`1790575200.0`), so identities and tie-break ordering match 1.14.x.
    pub fn id(&self) -> String {
        format!(
            "{}|{:?}|{}|{}",
            self.kind.raw(),
            secs(self.start),
            self.earlier.as_ref().map_or("", |log| log.id.as_str()),
            self.later.as_ref().map_or("", |log| log.id.as_str())
        )
    }

    pub fn seconds(&self) -> f64 {
        diff_secs(self.end, self.start)
    }
}

/// Ported from `TimeCorrections`.
pub enum TimeCorrections {}

impl TimeCorrections {
    /// Gaps of at least `minimum_gap` seconds (never under one second) and pairwise overlaps
    /// inside `window`, sorted by start. Gaps are measured against the union of recorded time, so
    /// nested or overlapping sessions never produce false gaps. Duplicate IDs count once and
    /// zero-length entries are ignored. A leading gap has no earlier entry; a trailing gap is
    /// only reported after at least one entry. An unreadable entry fails the whole review rather
    /// than inventing gaps.
    pub fn issues(
        logs: &[WorkLog],
        window: Interval,
        minimum_gap: f64,
        cal: &Cal,
    ) -> Result<Vec<TimeCorrectionIssue>> {
        let mut seen = BTreeSet::new();
        let mut entries: Vec<(&WorkLog, Timestamp, Timestamp)> = Vec::new();
        for log in logs {
            if !seen.insert(log.id.as_str()) {
                continue;
            }
            let readable =
                log.length.is_finite() && (0.0..=f64::from(i32::MAX)).contains(&log.length);
            let Some(start) = log.date(cal.tz()).filter(|_| readable) else {
                return Err(AppError::message(
                    "An entry has unreadable times. Refresh or correct it before reviewing gaps.",
                ));
            };
            if log.length <= 0.0 {
                continue;
            }
            let end = add_secs(start, log.length);
            if start < window.end && end > window.start {
                entries.push((log, start, end));
            }
        }
        entries.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.id.cmp(&b.0.id)));
        let threshold = minimum_gap.max(1.0);
        let mut result = Vec::new();
        let mut covered = window.start;
        let mut previous: Option<&WorkLog> = None;
        for (index, &(log, start, end)) in entries.iter().enumerate() {
            if diff_secs(start, covered) >= threshold {
                result.push(TimeCorrectionIssue::new(
                    TimeCorrectionKind::Gap,
                    covered,
                    start,
                    previous,
                    Some(log),
                ));
            }
            if end > covered {
                covered = end;
                previous = Some(log);
            }
            for &(next, next_start, next_end) in &entries[index + 1..] {
                if next_start >= end {
                    break;
                }
                let left = window.start.max(start.max(next_start));
                let right = window.end.min(end.min(next_end));
                if right > left {
                    result.push(TimeCorrectionIssue::new(
                        TimeCorrectionKind::Overlap,
                        left,
                        right,
                        Some(log),
                        Some(next),
                    ));
                }
            }
        }
        if diff_secs(window.end, covered) >= threshold && previous.is_some() {
            result.push(TimeCorrectionIssue::new(
                TimeCorrectionKind::Gap,
                covered,
                window.end,
                previous,
                None,
            ));
        }
        result.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| a.id().cmp(&b.id())));
        Ok(result)
    }

    /// Extends the earlier entry forward, or starts the later entry earlier, to cover a gap.
    pub fn fill_gap(
        issue: &TimeCorrectionIssue,
        using_earlier: bool,
        now: Timestamp,
        cal: &Cal,
    ) -> Result<WorkLogPlan> {
        let neighbour = if using_earlier { issue.earlier.as_ref() } else { issue.later.as_ref() };
        let Some(log) = neighbour.filter(|_| issue.kind == TimeCorrectionKind::Gap) else {
            return Err(AppError::message("Choose a neighboring entry to fill this gap."));
        };
        let original = WorkLogDraft::from_log(log, true, cal)?;
        let edit = WorkLogTimeEdit::new(
            original.start.min(issue.start),
            original.edit().end.max(issue.end),
        );
        let mut plan = WorkLogPlan::edit(log, edit, now, cal)?;
        plan.title = "Fill gap with neighboring task".into();
        Ok(plan)
    }

    /// Removes `[start, end)` from `log` and keeps the work on both sides (the first part keeps
    /// the entry, a later part becomes a new entry). With `separate`, the interval becomes its own
    /// entry with `separate`'s ticket, comment and activity instead of being removed. Explicit
    /// billable time is apportioned rather than duplicated; with `separate` the rounding remainder
    /// goes to the last part so the billable total is exact. Removing the whole entry is refused.
    pub fn remove_interval(
        log: &WorkLog,
        start: Timestamp,
        end: Timestamp,
        separate: Option<&WorkLogDraft>,
        now: Timestamp,
        cal: &Cal,
    ) -> Result<WorkLogPlan> {
        let source = WorkLogDraft::from_log(log, true, cal)?;
        let source_end = source.edit().end;
        let interval = WorkLogTimeEdit::new(start, end);
        let left = source.start.max(interval.start);
        let right = source_end.min(interval.end);
        if right <= left {
            return Err(AppError::message(
                "The selected interval is outside this entry. Refresh the recorded time.",
            ));
        }
        // (start, end, is the separated interval)
        let mut ranges: Vec<(Timestamp, Timestamp, bool)> = Vec::new();
        if left > source.start {
            ranges.push((source.start, left, false));
        }
        if separate.is_some() {
            ranges.push((left, right, true));
        }
        if right < source_end {
            ranges.push((right, source_end, false));
        }
        if ranges.is_empty() {
            return Err(AppError::message(
                "This would remove the entire entry. Use a narrower interval, or separate the time into its own entry.",
            ));
        }
        let last = ranges.len() - 1;
        let mut allocated = 0;
        let mut desired = Vec::with_capacity(ranges.len());
        for (index, &(range_start, range_end, separated)) in ranges.iter().enumerate() {
            let mut draft = source.clone();
            draft.existing_id =
                if index == 0 && !separated { source.existing_id.clone() } else { None };
            draft.start = range_start;
            draft.seconds = diff_secs(range_end, range_start).round() as i64;
            draft.billable_seconds =
                prorate(source.billable_seconds, draft.seconds, source.seconds);
            if separate.is_some() && index == last {
                draft.billable_seconds = source.billable_seconds - allocated;
            }
            allocated += draft.billable_seconds;
            if let Some(separate) = separate.filter(|_| separated) {
                draft.ticket_id = separate.ticket_id;
                draft.comment = separate.comment.clone();
                draft.activity_id = separate.activity_id.clone();
                draft.allow_default_activity = separate.allow_default_activity;
            }
            draft.validate(now, cal)?;
            desired.push(draft);
        }
        let title = if separate.is_none() {
            "Remove interval from entry"
        } else {
            "Separate idle interval"
        };
        Ok(WorkLogPlan { title: title.into(), before: vec![log.clone()], desired, undo_of: None })
    }

    /// Resolves an overlap between two staggered entries with one shared boundary: the earlier
    /// entry ends and the later one starts at `boundary`, which must lie inside the overlap.
    /// Billable time shrinks in proportion as the duplicated time is removed.
    pub fn move_boundary(
        issue: &TimeCorrectionIssue,
        boundary: Timestamp,
        now: Timestamp,
        cal: &Cal,
    ) -> Result<WorkLogPlan> {
        let (Some(a), Some(b)) = (issue.earlier.as_ref(), issue.later.as_ref()) else {
            return Err(AppError::message("Select two overlapping entries."));
        };
        if issue.kind != TimeCorrectionKind::Overlap {
            return Err(AppError::message("Select two overlapping entries."));
        }
        let first = WorkLogDraft::from_log(a, true, cal)?;
        let second = WorkLogDraft::from_log(b, true, cal)?;
        let staggered = first.start < second.start && first.edit().end < second.edit().end;
        if !staggered || boundary < issue.start || boundary > issue.end {
            return Err(AppError::message(
                "Choose a boundary inside the overlap between two staggered entries.",
            ));
        }
        let left = WorkLogPlan::edit(a, WorkLogTimeEdit::new(first.start, boundary), now, cal)?;
        let right =
            WorkLogPlan::edit(b, WorkLogTimeEdit::new(boundary, second.edit().end), now, cal)?;
        // Preserve billable proportions as duplicate recorded time is removed.
        let mut desired: Vec<WorkLogDraft> =
            left.desired.into_iter().chain(right.desired).collect();
        for (index, draft) in desired.iter_mut().enumerate() {
            let source = if index == 0 { &first } else { &second };
            draft.billable_seconds =
                prorate(source.billable_seconds, draft.seconds, source.seconds);
        }
        Ok(WorkLogPlan {
            title: "Correct overlapping boundary".into(),
            before: vec![a.clone(), b.clone()],
            desired,
            undo_of: None,
        })
    }
}

/// `billable * part / whole`, rounded to the nearest second.
fn prorate(billable: i64, part: i64, whole: i64) -> i64 {
    (billable as f64 * part as f64 / whole as f64).round() as i64
}
