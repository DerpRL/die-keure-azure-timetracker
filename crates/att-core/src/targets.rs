//! Weekly targets and today/this-week progress. Ported from `WorkTargets` and `TargetProgress`
//! in Productivity.swift. Holiday and exception handling lives in [`crate::holidays`].

use std::collections::{BTreeSet, HashSet};

use jiff::{Timestamp, civil::Date};
use serde::{Deserialize, Serialize};

use crate::holidays::{BelgianHoliday, TargetException, TargetExceptionKind};
use crate::model::{TrackingState, WorkLog};
use crate::text::NonEmpty;
use crate::time::{Cal, Interval, add_secs, diff_secs};

/// The user's working-time schedule. Persisted in the configuration as Swift wrote it.
///
/// Settings written before per-weekday schedules have only `weeklyHours` and `dailyHours`; they
/// keep working (`dailyHours` Monday to Friday) and convert to `hoursByWeekday` on the first
/// [`WorkTargets::set_hours`].
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkTargets {
    pub weekly_hours: f64,
    pub daily_hours: f64,
    /// Sunday first, matching Swift weekday numbers (index 0 = Sunday).
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hours_by_weekday: Option<Vec<f64>>,
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub belgian_holidays_enabled: Option<bool>,
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_exceptions: Option<Vec<TargetException>>,
}

impl Default for WorkTargets {
    /// 38 hours a week: 7.6 hours Monday to Friday.
    fn default() -> Self {
        Self {
            weekly_hours: 38.0,
            daily_hours: 7.6,
            hours_by_weekday: None,
            belgian_holidays_enabled: None,
            date_exceptions: None,
        }
    }
}

impl WorkTargets {
    pub fn weekly_target_hours(&self) -> f64 {
        match &self.hours_by_weekday {
            Some(hours) => hours.iter().fold(0.0, |total, h| total + h),
            None => self.weekly_hours,
        }
    }

    /// Regular hours for a Swift weekday (1 = Sunday … 7 = Saturday); 0 outside that range.
    pub fn hours(&self, weekday: i64) -> f64 {
        if !(1..=7).contains(&weekday) {
            return 0.0;
        }
        if let Some(hours) = self.hours_by_weekday.as_ref().filter(|h| h.len() == 7) {
            return hours[weekday as usize - 1];
        }
        if weekday == 1 || weekday == 7 { 0.0 } else { self.daily_hours }
    }

    /// Sets one weekday and converts legacy settings to a full schedule.
    pub fn set_hours(&mut self, hours: f64, weekday: i64) {
        if !(1..=7).contains(&weekday) {
            return;
        }
        let mut schedule: Vec<f64> = (1..=7).map(|day| self.hours(day)).collect();
        schedule[weekday as usize - 1] = hours;
        self.weekly_hours = schedule.iter().fold(0.0, |total, h| total + h);
        self.hours_by_weekday = Some(schedule);
    }

    pub fn is_valid(&self) -> bool {
        let exceptions = self.exceptions();
        let unique: BTreeSet<&str> = exceptions.iter().map(|item| item.id.as_str()).collect();
        if !exceptions.iter().all(TargetException::is_valid) || unique.len() != exceptions.len() {
            return false;
        }
        if let Some(hours) = &self.hours_by_weekday {
            return hours.len() == 7
                && hours.iter().all(|h| h.is_finite() && (0.0..=24.0).contains(h));
        }
        self.weekly_hours.is_finite()
            && self.daily_hours.is_finite()
            && (1.0..=168.0).contains(&self.weekly_hours)
            && (0.1..=24.0).contains(&self.daily_hours)
    }

    /// Target seconds for the local day containing `at`.
    pub fn daily_seconds(&self, at: Timestamp, cal: &Cal) -> f64 {
        self.daily_seconds_on(cal.date(at))
    }

    /// Precedence: a date exception, then a Belgian holiday, then the regular weekday hours.
    pub fn daily_seconds_on(&self, date: Date) -> f64 {
        let regular = self.hours(date.weekday().to_sunday_one_offset() as i64);
        if let Some(item) = self.exception_on(date) {
            return match item.kind {
                TargetExceptionKind::Leave | TargetExceptionKind::Replacement => 0.0,
                TargetExceptionKind::HalfDay => regular * 1800.0,
                TargetExceptionKind::Custom => item.hours * 3600.0,
            };
        }
        if self.uses_belgian_holidays() && BelgianHoliday::on(date).is_some() {
            return 0.0;
        }
        regular * 3600.0
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
