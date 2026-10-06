//! End-of-day review schedule and summary. Ported from DayReview.swift.
//!
//! The review never edits or stops anything. Possible gaps are only claimed when every timing
//! is trustworthy: midnight entries (manually assigned daily totals), omitted logs and an
//! unconfirmed timer all hide them.

use std::collections::HashSet;

use jiff::{Span, Timestamp, civil, tz::AmbiguousOffset};
use serde::{Deserialize, Serialize};

use crate::model::TrackingState;
use crate::model::WorkLog;
use crate::text::NonEmpty;
use crate::time::{Cal, add_secs, diff_secs};

/// Persisted in the configuration as `endOfDayReview`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DayReviewPreferences {
    pub enabled: bool,
    /// Minutes after local midnight.
    pub start_minute: i64,
    pub finish_minute: i64,
    /// Swift weekday numbers (1 = Sunday … 7 = Saturday).
    pub weekdays: Vec<i64>,
    pub long_session_minutes: i64,
    pub gap_minutes: i64,
}

impl Default for DayReviewPreferences {
    /// 09:00–17:00, Monday to Friday, long sessions from 3 hours, gaps from 20 minutes.
    fn default() -> Self {
        Self {
            enabled: true,
            start_minute: 9 * 60,
            finish_minute: 17 * 60,
            weekdays: vec![2, 3, 4, 5, 6],
            long_session_minutes: 180,
            gap_minutes: 20,
        }
    }
}

impl DayReviewPreferences {
    pub fn is_valid(&self) -> bool {
        (0..1440).contains(&self.start_minute)
            && (0..1440).contains(&self.finish_minute)
            && self.start_minute < self.finish_minute
            && !self.weekdays.is_empty()
            && self.weekdays.iter().all(|day| (1..=7).contains(day))
            && (30..=720).contains(&self.long_session_minutes)
            && (5..=180).contains(&self.gap_minutes)
    }

    /// The instant `minute` minutes into the local day containing `day`.
    ///
    /// Like Foundation's `date(bySettingHour:minute:second:of:)`: a time skipped by DST resolves
    /// to the end of the gap (02:30 becomes 03:00), a repeated time to its first occurrence.
    pub fn time(&self, minute: i64, day: Timestamp, cal: &Cal) -> Timestamp {
        let midnight = cal.date(day).to_datetime(civil::Time::midnight());
        // Swift trapped on out-of-range minutes; keep counting from midnight instead.
        let local = Span::new()
            .try_minutes(minute)
            .ok()
            .and_then(|span| midnight.checked_add(span).ok())
            .unwrap_or(midnight);
        if let AmbiguousOffset::Gap { before, .. } = cal.tz().to_ambiguous_zoned(local).offset()
            // `before` maps the skipped time past the transition; `preceding` is strictly
            // earlier, so step one nanosecond further to include a gap that starts at `local`.
            && let Ok(later) = before.to_timestamp(local)
            && let Ok(probe) = Timestamp::from_nanosecond(later.as_nanosecond() + 1)
            && let Some(transition) = cal.tz().preceding(probe).next()
        {
            return transition.timestamp();
        }
        cal.at(local)
    }
}

/// Persisted per workspace and local day under [`DayReviewSchedule::key`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayReviewRecord {
    #[serde(
        default,
        with = "crate::time::flex_date::option",
        skip_serializing_if = "Option::is_none"
    )]
    pub prompted_at: Option<Timestamp>,
    #[serde(
        default,
        with = "crate::time::flex_date::option",
        skip_serializing_if = "Option::is_none"
    )]
    pub snoozed_until: Option<Timestamp>,
    #[serde(
        default,
        with = "crate::time::flex_date::option",
        skip_serializing_if = "Option::is_none"
    )]
    pub reviewed_at: Option<Timestamp>,
}

pub struct DayReviewSchedule;

impl DayReviewSchedule {
    /// `"<workspace>|<year>-<month>-<day>"` without zero padding, e.g. `org|2026-10-1`, exactly
    /// as 1.14.x stored it.
    pub fn key(workspace: &str, day: Timestamp, cal: &Cal) -> String {
        let date = cal.date(day);
        format!("{workspace}|{}-{}-{}", date.year(), date.month(), date.day())
    }

    /// Due at the finish time on a selected weekday, once; after a snooze, when it ends (even in
    /// the morning). Never after the day was reviewed.
    pub fn is_due(
        now: Timestamp,
        preferences: &DayReviewPreferences,
        record: Option<&DayReviewRecord>,
        cal: &Cal,
    ) -> bool {
        if !preferences.enabled
            || !preferences.is_valid()
            || !preferences.weekdays.contains(&i64::from(cal.swift_weekday(now)))
            || record.is_some_and(|record| record.reviewed_at.is_some())
        {
            return false;
        }
        if let Some(snooze) = record.and_then(|record| record.snoozed_until) {
            return now >= snooze;
        }
        now >= preferences.time(preferences.finish_minute, now, cal)
            && record.is_none_or(|record| record.prompted_at.is_none())
    }

    /// Prompted, not reviewed, and not snoozed into the future.
    pub fn is_pending(now: Timestamp, record: Option<&DayReviewRecord>) -> bool {
        let Some(record) = record.filter(|r| r.prompted_at.is_some() && r.reviewed_at.is_none())
        else {
            return false;
        };
        record.snoozed_until.is_none_or(|snooze| now >= snooze)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSession {
    pub id: String,
    pub start: Timestamp,
    pub end: Timestamp,
    pub ticket_id: Option<i64>,
    pub title: String,
    pub activity: String,
    pub is_running: bool,
    /// Judged on the original length, not the clipped part.
    pub is_long: bool,
}

impl ReviewSession {
    pub fn seconds(&self) -> f64 {
        diff_secs(self.end, self.start).max(0.0)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewGap {
    pub start: Timestamp,
    pub end: Timestamp,
}

impl ReviewGap {
    pub fn seconds(&self) -> f64 {
        diff_secs(self.end, self.start)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayReviewSummary {
    /// The instant the local day starts.
    pub day: Timestamp,
    /// Clipped to the day and to `now`, sorted by start, then ID.
    pub sessions: Vec<ReviewSession>,
    pub gaps: Vec<ReviewGap>,
    pub omitted_logs: i64,
    pub gaps_unavailable: bool,
    pub timer_running: bool,
    pub timer_unconfirmed: bool,
}

impl DayReviewSummary {
    pub fn total_seconds(&self) -> f64 {
        self.sessions.iter().fold(0.0, |total, session| total + session.seconds())
    }

    pub fn long_sessions(&self) -> Vec<&ReviewSession> {
        self.sessions.iter().filter(|session| session.is_long).collect()
    }

    pub fn gap_seconds(&self) -> f64 {
        self.gaps.iter().fold(0.0, |total, gap| total + gap.seconds())
    }

    /// Reviews the local day containing `day`.
    ///
    /// A confirmed running timer with a known worklog ID and duration is counted once (its own
    /// reported log is skipped) and frozen at `confirmed_at`: no speculative seconds are added.
    /// For gap detection only, it covers the time since that confirmation.
    #[allow(clippy::too_many_arguments)] // Mirrors the Swift signature.
    pub fn calculate(
        logs: &[WorkLog],
        day: Timestamp,
        now: Timestamp,
        preferences: &DayReviewPreferences,
        state: Option<&TrackingState>,
        confirmed_at: Option<Timestamp>,
        timer_confirmed: bool,
        cal: &Cal,
    ) -> Self {
        let interval = cal.day_interval(day);
        let end_of_data = interval.end.min(now);
        let today = cal.date(day) == cal.date(now);
        let running = state.is_some_and(TrackingState::running);
        let active = if today && timer_confirmed && running {
            state.and_then(|s| s.track.as_ref())
        } else {
            None
        };
        let duration = active
            .and_then(|track| track.current_track_length)
            .filter(|length| length.is_finite() && *length >= 0.0);
        let active_id = active
            .filter(|_| duration.is_some() && confirmed_at.is_some())
            .and_then(|track| track.work_log_id.non_empty());
        let long_session = preferences.long_session_minutes as f64 * 60.0;
        let mut sessions = Vec::new();
        let mut omitted = 0;
        let mut seen = HashSet::new();
        let mut unknown_timing = false;
        for log in logs {
            if !seen.insert(log.id.as_str()) || Some(log.id.as_str()) == active_id {
                continue;
            }
            let Some(start) =
                log.date(cal.tz()).filter(|_| log.length.is_finite() && log.length >= 0.0)
            else {
                omitted += 1;
                continue;
            };
            let end = add_secs(start, log.length);
            if start >= end_of_data || end <= interval.start {
                continue;
            }
            // Midnight entries can represent manually assigned daily totals. Avoid claiming
            // precise gaps from them.
            if cal.start_of_day(start) == start {
                unknown_timing = true;
            }
            sessions.push(ReviewSession {
                id: log.id.clone(),
                start: start.max(interval.start),
                end: end.min(end_of_data),
                ticket_id: log.ticket_id(),
                title: log.comment.non_empty().unwrap_or("Work session").to_string(),
                activity: log
                    .activity_type
                    .as_ref()
                    .and_then(|a| a.name.non_empty())
                    .unwrap_or("Unspecified activity")
                    .to_string(),
                is_running: false,
                is_long: log.length >= long_session,
            });
        }
        match (active, active_id, confirmed_at, duration) {
            (Some(track), Some(id), Some(confirmed_at), Some(duration)) => {
                // Reconstruct from confirmed elapsed time, never add speculative seconds after
                // the last confirmation.
                let start = add_secs(confirmed_at, -duration);
                let end = confirmed_at.min(end_of_data);
                if end > interval.start && start < end {
                    sessions.push(ReviewSession {
                        id: id.to_string(),
                        start: start.max(interval.start),
                        end,
                        ticket_id: track.ticket_id(),
                        title: track.title(),
                        activity: "Current activity".into(),
                        is_running: true,
                        is_long: duration >= long_session,
                    });
                }
            }
            (Some(_), ..) => unknown_timing = true,
            _ => {}
        }
        sessions.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| a.id.cmp(&b.id)));
        let timer_unconfirmed = today && !timer_confirmed;
        let gaps_unavailable = unknown_timing || omitted > 0 || timer_unconfirmed;
        let mut gaps = Vec::new();
        let workday = preferences.weekdays.contains(&i64::from(cal.swift_weekday(day)));
        if preferences.is_valid() && workday && !gaps_unavailable {
            let minimum = preferences.gap_minutes as f64 * 60.0;
            let work_start = preferences.time(preferences.start_minute, day, cal);
            let work_end = preferences.time(preferences.finish_minute, day, cal).min(end_of_data);
            let mut cursor = work_start;
            for session in &sessions {
                if session.seconds() <= 0.0
                    || session.end <= work_start
                    || session.start >= work_end
                {
                    continue;
                }
                let start = session.start.max(work_start);
                if diff_secs(start, cursor) >= minimum {
                    gaps.push(ReviewGap { start: cursor, end: start });
                }
                // A confirmed running timer covers the remaining seconds since confirmation.
                let covered = if session.is_running { now } else { session.end };
                cursor = cursor.max(covered.min(work_end));
            }
            if diff_secs(work_end, cursor) >= minimum {
                gaps.push(ReviewGap { start: cursor, end: work_end });
            }
        }
        Self {
            day: interval.start,
            sessions,
            gaps,
            omitted_logs: omitted,
            gaps_unavailable,
            timer_running: today && running && timer_confirmed,
            timer_unconfirmed,
        }
    }
}
