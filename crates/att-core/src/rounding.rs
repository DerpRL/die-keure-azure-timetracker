//! Optional rounding of saved time to quarter hours (Settings → Targets & reminders → Timer &
//! reminders, off by default).
//!
//! When it is on, every entry the app saves to 7pace lasts a multiple of 15 minutes: timers the
//! app stops, offline drafts and Time editor changes. The rules:
//!
//! - the duration rounds to the nearest quarter hour, 7m 30s or more rounding up, and any tracked
//!   time is at least 15 minutes ([`round_to_quarter_hour`]);
//! - the start stays and the end moves. When the rounded end would be in the future, the entry
//!   moves back towards ending now, but only into free time: its start never moves before the
//!   end of the previous entry. What does not fit ends in the future, at most 15 minutes after
//!   now ([`WorkLogDraft::rounded`], [`latest_end`]);
//! - explicit billable time rounds the same way and never exceeds the new duration;
//! - entries already in 7pace are not changed until the app saves them again, and undo restores
//!   the exact earlier times ([`WorkLogPlan::rounded`]);
//! - rounding up may overlap the next entry; that is allowed, and the overlap checks still report
//!   it. Rounding never moves an entry into the previous one.
//!
//! Timers stopped outside the app (7pace itself, its automatic stop) are not rounded.

use jiff::Timestamp;

use crate::error::{AppError, Result};
use crate::model::{TrackingState, WorkLog};
use crate::service::WorkLogMutationService;
use crate::text::NonEmpty;
use crate::time::{Cal, add_secs, floor_to_second};
use crate::worklog::WorkLogDraft;
use crate::worklog::WorkLogTimeEdit;
use crate::worklog::ops::WorkLogPlan;

/// Fifteen minutes in seconds.
pub const QUARTER_HOUR_SECONDS: i64 = 15 * 60;

/// How the durations of saved entries are rounded.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Rounding {
    /// Saved as tracked, to the second.
    #[default]
    Exact,
    /// Saved as a multiple of 15 minutes.
    QuarterHour,
}

impl Rounding {
    /// The rounding for the Settings switch.
    pub fn from_setting(round_to_quarter_hours: bool) -> Self {
        if round_to_quarter_hours { Self::QuarterHour } else { Self::Exact }
    }

    /// `seconds` with this rounding applied.
    pub fn seconds(self, seconds: i64) -> i64 {
        match self {
            Self::Exact => seconds,
            Self::QuarterHour => round_to_quarter_hour(seconds),
        }
    }
}

/// The nearest multiple of 15 minutes: 7m 30s or more rounds up, so 1h 5m is 1h and 1h 12m is
/// 1h 15m. Any tracked time is at least 15 minutes; zero (or less) stays zero.
pub fn round_to_quarter_hour(seconds: i64) -> i64 {
    if seconds <= 0 {
        return 0;
    }
    let quarters = (seconds + QUARTER_HOUR_SECONDS / 2) / QUARTER_HOUR_SECONDS;
    quarters.max(1) * QUARTER_HOUR_SECONDS
}

/// The latest end a saved entry of `seconds` may have. Rounding up adds at most 15 minutes, so an
/// entry lasting a whole number of quarter hours may end up to 15 minutes after `now` (see the
/// module notes); any other entry must end by `now`. Times the user enters are always checked
/// against `now` itself ([`WorkLogTimeEdit::validate`]).
pub fn latest_end(seconds: i64, now: Timestamp) -> Timestamp {
    if seconds > 0 && seconds % QUARTER_HOUR_SECONDS == 0 {
        add_secs(now, QUARTER_HOUR_SECONDS as f64)
    } else {
        now
    }
}

/// The latest end of the entries in `logs` that start before `start`, skipping `excluding` and
/// entries with an unreadable time.
pub fn previous_end(
    start: Timestamp,
    logs: &[WorkLog],
    excluding: &[&str],
    cal: &Cal,
) -> Option<Timestamp> {
    logs.iter()
        .filter(|log| !excluding.contains(&log.id.as_str()) && log.length.is_finite())
        .filter_map(|log| log.date(cal.tz()).map(|date| (date, add_secs(date, log.length))))
        .filter(|(date, _)| *date < start)
        .map(|(_, end)| end)
        .max()
}

impl WorkLogDraft {
    /// This draft with `rounding` applied to its duration and billable time. The start stays,
    /// unless the rounded end would be after `now`: then the draft moves back towards ending at
    /// `now` (rounded down to a second), but never to before `previous_end`, the end of the entry
    /// before it. A start never moves later. Callers validate the result.
    pub fn rounded(
        &self,
        rounding: Rounding,
        now: Timestamp,
        previous_end: Option<Timestamp>,
    ) -> Self {
        let mut draft = self.clone();
        draft.seconds = rounding.seconds(self.seconds);
        draft.billable_seconds = rounding.seconds(self.billable_seconds).min(draft.seconds);
        let latest = floor_to_second(now);
        if draft.seconds != self.seconds && draft.end() > latest {
            let ending_now = add_secs(latest, -(draft.seconds as f64));
            let earliest = previous_end.map_or(ending_now, |end| end.min(self.start));
            draft.start = ending_now.max(earliest).min(self.start);
        }
        draft
    }
}

impl WorkLogPlan {
    /// This plan with `rounding` applied to every entry it creates or changes, earliest first. A
    /// desired draft that leaves its source entry as it is stays unrounded, and an undo is never
    /// rounded, so it restores the exact earlier times. `others` are the surrounding entries
    /// (the plan's own sources are skipped); with the plan's earlier drafts they bound how far a
    /// start may move back.
    pub fn rounded(
        mut self,
        rounding: Rounding,
        others: &[WorkLog],
        now: Timestamp,
        cal: &Cal,
    ) -> Result<Self> {
        if rounding == Rounding::Exact || self.undo_of.is_some() {
            return Ok(self);
        }
        let sources: Vec<&str> = self.before.iter().map(|log| log.id.as_str()).collect();
        let mut order: Vec<usize> = (0..self.desired.len()).collect();
        order.sort_by_key(|&index| self.desired[index].start);
        let mut placed: Vec<WorkLogTimeEdit> = Vec::new();
        for index in order {
            let draft = &self.desired[index];
            let unchanged = draft.existing_id.as_deref().is_some_and(|id| {
                self.before.iter().any(|log| log.id == id && draft.matches(log, cal))
            });
            if !unchanged {
                let earlier = placed.iter().filter(|edit| edit.start < draft.start);
                let previous = previous_end(draft.start, others, &sources, cal)
                    .into_iter()
                    .chain(earlier.map(|edit| edit.end))
                    .max();
                let rounded = draft.rounded(rounding, now, previous);
                rounded.validate(now, cal)?;
                self.desired[index] = rounded;
            }
            placed.push(self.desired[index].edit());
        }
        Ok(self)
    }
}

/// The worklog of the timer that stopped between `before` and `after`: `before` ran with a
/// worklog ID and `after` no longer runs that worklog.
pub fn stopped_entry(before: &TrackingState, after: &TrackingState) -> Option<String> {
    let id = before
        .track
        .as_ref()
        .filter(|_| before.running())
        .and_then(|track| track.work_log_id.non_empty())?;
    let still_running = after.running()
        && after.track.as_ref().and_then(|track| track.work_log_id.as_deref()) == Some(id);
    (!still_running).then(|| id.to_string())
}

/// Rounds the entry 7pace wrote for a timer the app just stopped. Returns the saved entry, or
/// `None` when nothing was written: rounding is off, the entry is gone, or it already lasts a
/// rounded duration. The write is a single update; a failure leaves the entry as 7pace saved it.
pub async fn round_stopped_entry<S>(
    log_id: &str,
    rounding: Rounding,
    service: &S,
    now: Timestamp,
    cal: &Cal,
) -> Result<Option<WorkLog>>
where
    S: WorkLogMutationService + ?Sized,
{
    if rounding == Rounding::Exact {
        return Ok(None);
    }
    let Some(log) = service.find_work_log(log_id).await? else { return Ok(None) };
    let draft = WorkLogDraft::from_log(&log, true, cal)?;
    let mut rounded = draft.rounded(rounding, now, None);
    if rounded == draft {
        return Ok(None);
    }
    if rounded.start < draft.start {
        // Moving back: only into free time after the previous entry.
        let earlier = service.work_logs_before(draft.start).await?;
        rounded = draft.rounded(rounding, now, previous_end(draft.start, &earlier, &[log_id], cal));
    }
    rounded.validate(now, cal)?;
    let saved = service.replace_work_log_time(log_id, &rounded).await?;
    if !rounded.edit().matches(&saved, cal) {
        return Err(AppError::message(
            "7pace did not confirm the rounded time. Check the entry in the Timesheet.",
        ));
    }
    Ok(Some(saved))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE: i64 = 60;
    const HOUR: i64 = 60 * MINUTE;

    #[test]
    fn rounds_to_the_nearest_quarter_hour() {
        let cases = [
            (0, 0),
            (-5, 0),
            (1, 15 * MINUTE),
            (7 * MINUTE + 29, 15 * MINUTE),
            (7 * MINUTE + 30, 15 * MINUTE),
            (15 * MINUTE, 15 * MINUTE),
            (22 * MINUTE + 29, 15 * MINUTE),
            (22 * MINUTE + 30, 30 * MINUTE),
            (30 * MINUTE, 30 * MINUTE),
            (45 * MINUTE, 45 * MINUTE),
            (HOUR, HOUR),
            (HOUR + 5 * MINUTE, HOUR),
            (HOUR + 7 * MINUTE + 29, HOUR),
            (HOUR + 7 * MINUTE + 30, HOUR + 15 * MINUTE),
            (HOUR + 12 * MINUTE, HOUR + 15 * MINUTE),
            (9 * HOUR + 52 * MINUTE + 30, 10 * HOUR),
            (40 * HOUR + 7 * MINUTE, 40 * HOUR),
        ];
        for (seconds, expected) in cases {
            assert_eq!(round_to_quarter_hour(seconds), expected, "{seconds}s");
        }
    }

    #[test]
    fn exact_rounding_keeps_seconds() {
        assert_eq!(Rounding::Exact.seconds(HOUR + 5 * MINUTE + 3), HOUR + 5 * MINUTE + 3);
        assert_eq!(Rounding::QuarterHour.seconds(HOUR + 5 * MINUTE + 3), HOUR);
        assert_eq!(Rounding::from_setting(false), Rounding::Exact);
        assert_eq!(Rounding::from_setting(true), Rounding::QuarterHour);
        assert_eq!(Rounding::default(), Rounding::Exact);
    }
}
