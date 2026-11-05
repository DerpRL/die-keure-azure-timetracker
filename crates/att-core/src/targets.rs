//! Weekly targets and today/this-week progress. Ported from `WorkTargets` and `TargetProgress`
//! in Productivity.swift. Holiday and exception handling lives in [`crate::holidays`].

use std::collections::{BTreeSet, HashSet};

use jiff::{Timestamp, civil::Date};
use serde::{Deserialize, Serialize};

use crate::holidays::{BelgianHoliday, TargetException, TargetExceptionKind};
use crate::model::{TrackingState, WorkLog};
use crate::text::NonEmpty;
use crate::time::{Cal, Interval, add_secs, diff_secs};

/// Most minutes a single day's target can have.
pub const MAX_DAILY_MINUTES: i32 = 24 * 60;

/// The user's working-time schedule, as whole minutes per weekday so a target like 7h 36m stays
/// exact.
///
/// Reads also accept the formats saved before 2.4: decimal `hoursByWeekday` (1.14 and 2.0–2.3),
/// and `weeklyHours`/`dailyHours` from before per-weekday schedules (`dailyHours` Monday to
/// Friday). Both convert to minutes when read, rounded to the nearest minute, and are written
/// back as `minutesByWeekday` only.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "StoredWorkTargets")]
pub struct WorkTargets {
    /// Regular minutes per weekday, Sunday first, matching Swift weekday numbers (index 0 =
    /// Sunday). Seven entries, each from 0 to 1440 ([`MAX_DAILY_MINUTES`]).
    pub minutes_by_weekday: Vec<i32>,
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub belgian_holidays_enabled: Option<bool>,
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_exceptions: Option<Vec<TargetException>>,
}

/// 1.x and 2.0–2.3 default: 7.6 hours Monday to Friday.
const LEGACY_DAILY_HOURS: f64 = 7.6;

/// Decimal hours to whole minutes, rounded to the nearest minute (7.6 is 456, 7.5 is 450).
fn hours_to_minutes(hours: f64) -> i32 {
    // `as` saturates out-of-range values; they then fail `is_valid`.
    (hours * 60.0).round() as i32
}

/// The JSON a [`WorkTargets`] may be read from: the current `minutesByWeekday`, or one of the
/// older formats. A present `minutesByWeekday` wins.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StoredWorkTargets {
    minutes_by_weekday: Option<Vec<i32>>,
    /// 1.14 and 2.0–2.3: decimal hours per weekday, Sunday first.
    hours_by_weekday: Option<Vec<f64>>,
    /// Before per-weekday schedules: hours Monday to Friday (`weeklyHours` was only their sum).
    daily_hours: f64,
    belgian_holidays_enabled: Option<bool>,
    date_exceptions: Option<Vec<TargetException>>,
}

impl Default for StoredWorkTargets {
    fn default() -> Self {
        Self {
            minutes_by_weekday: None,
            hours_by_weekday: None,
            daily_hours: LEGACY_DAILY_HOURS,
            belgian_holidays_enabled: None,
            date_exceptions: None,
        }
    }
}

impl From<StoredWorkTargets> for WorkTargets {
    fn from(stored: StoredWorkTargets) -> Self {
        let minutes_by_weekday = match (stored.minutes_by_weekday, stored.hours_by_weekday) {
            (Some(minutes), _) => minutes,
            // An incomplete schedule was ignored before too, in favour of `dailyHours`.
            (None, Some(hours)) if hours.len() == 7 => {
                hours.into_iter().map(hours_to_minutes).collect()
            }
            _ => weekdays_only(hours_to_minutes(stored.daily_hours)),
        };
        Self {
            minutes_by_weekday,
            belgian_holidays_enabled: stored.belgian_holidays_enabled,
            date_exceptions: stored.date_exceptions,
        }
    }
}

/// `minutes` Monday to Friday, weekends off (Sunday first).
fn weekdays_only(minutes: i32) -> Vec<i32> {
    (1..=7).map(|day| if day == 1 || day == 7 { 0 } else { minutes }).collect()
}

impl Default for WorkTargets {
    /// 38 hours a week: 7h 36m Monday to Friday.
    fn default() -> Self {
        Self {
            minutes_by_weekday: weekdays_only(hours_to_minutes(LEGACY_DAILY_HOURS)),
            belgian_holidays_enabled: None,
            date_exceptions: None,
        }
    }
}

impl WorkTargets {
    /// The regular schedule's total, in minutes.
    pub fn weekly_target_minutes(&self) -> i64 {
        self.minutes_by_weekday.iter().map(|minutes| i64::from(*minutes)).sum()
    }

    /// Regular minutes for a Swift weekday (1 = Sunday … 7 = Saturday); 0 outside that range.
    pub fn minutes(&self, weekday: i64) -> i32 {
        if !(1..=7).contains(&weekday) {
            return 0;
        }
        self.minutes_by_weekday.get(weekday as usize - 1).copied().unwrap_or(0)
    }

    /// Sets one weekday's regular minutes.
    pub fn set_minutes(&mut self, minutes: i32, weekday: i64) {
        if !(1..=7).contains(&weekday) {
            return;
        }
        let mut schedule: Vec<i32> = (1..=7).map(|day| self.minutes(day)).collect();
        schedule[weekday as usize - 1] = minutes;
        self.minutes_by_weekday = schedule;
    }

    pub fn is_valid(&self) -> bool {
        let exceptions = self.exceptions();
        let unique: BTreeSet<&str> = exceptions.iter().map(|item| item.id.as_str()).collect();
        if !exceptions.iter().all(TargetException::is_valid) || unique.len() != exceptions.len() {
            return false;
        }
        self.minutes_by_weekday.len() == 7
            && self
                .minutes_by_weekday
                .iter()
                .all(|minutes| (0..=MAX_DAILY_MINUTES).contains(minutes))
    }

    /// Target seconds for the local day containing `at`.
    pub fn daily_seconds(&self, at: Timestamp, cal: &Cal) -> f64 {
        self.daily_seconds_on(cal.date(at))
    }

    /// Precedence: a date exception, then a Belgian holiday, then the regular weekday hours.
    pub fn daily_seconds_on(&self, date: Date) -> f64 {
        let regular = f64::from(self.minutes(date.weekday().to_sunday_one_offset() as i64));
        if let Some(item) = self.exception_on(date) {
            return match item.kind {
                TargetExceptionKind::Leave | TargetExceptionKind::Replacement => 0.0,
                TargetExceptionKind::HalfDay => regular * 30.0,
                // Whole minutes, so 7.6 hours is 7h 36m rather than a few microseconds less.
                TargetExceptionKind::Custom => f64::from(hours_to_minutes(item.hours)) * 60.0,
            };
        }
        if self.uses_belgian_holidays() && BelgianHoliday::on(date).is_some() {
            return 0.0;
        }
        regular * 60.0
    }
}

/// Recorded seconds today and this ISO week.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct TargetProgress {
    pub today: f64,
    pub week: f64,
}

impl TargetProgress {
    /// The Monday-to-Monday ISO week containing `at`.
    pub fn week_interval(at: Timestamp, cal: &Cal) -> Interval {
        cal.week_interval(at)
    }

    /// Logs count toward the day and week of their start. A running timer is added once, and only
    /// when 7pace reported its worklog ID; its own reported log is then skipped. Its start is
    /// reconstructed as `lastSync − currentTrackLength`; it ends at `lastSync`, or at
    /// `max(now, lastSync)` when `extrapolate` is set (the connection is confirmed).
    pub fn calculate(
        logs: &[WorkLog],
        state: Option<&TrackingState>,
        last_sync: Option<Timestamp>,
        now: Timestamp,
        extrapolate: bool,
        cal: &Cal,
    ) -> Self {
        let day = cal.day_interval(now);
        let week = cal.week_interval(now);
        // Without a stable worklog ID, use reported worklogs only: adding the live duration
        // could count an already returned worklog twice.
        let active = state
            .filter(|state| state.running())
            .and_then(|state| state.track.as_ref())
            .filter(|track| track.work_log_id.non_empty().is_some());
        let active_id = active.and_then(|track| track.work_log_id.as_deref());
        let (mut today, mut this_week) = (0.0, 0.0);
        let mut seen = HashSet::new();
        for log in logs {
            if !seen.insert(log.id.as_str()) || Some(log.id.as_str()) == active_id {
                continue;
            }
            let Some(date) = log.date(cal.tz()).filter(|_| log.length.is_finite()) else {
                continue;
            };
            if day.contains(date) {
                today += log.length.max(0.0);
            }
            if week.contains(date) {
                this_week += log.length.max(0.0);
            }
        }
        if let (Some(active), Some(sync)) = (active, last_sync) {
            let seconds = active.current_track_length.unwrap_or(0.0).max(0.0);
            let end = if extrapolate { now.max(sync) } else { sync };
            // Reconstruct the confirmed duration, then add only time since that confirmation.
            let start = add_secs(sync, -seconds);
            let overlap = |interval: &Interval| {
                diff_secs(end.min(interval.end), start.max(interval.start)).max(0.0)
            };
            today += overlap(&day);
            this_week += overlap(&week);
        }
        Self { today, week: this_week }
    }
}
