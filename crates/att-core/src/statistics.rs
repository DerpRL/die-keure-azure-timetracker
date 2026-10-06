//! Statistics periods, ranges and activity totals. Ported from Statistics.swift.
//!
//! Every range is half-open and starts at a local midnight. Logs count entirely towards the day
//! of their reported start, like History; the live timer is never extrapolated here.
//!
//! Swift keyed days by the instant reached by repeatedly adding one day to the range start. In
//! zones whose DST change happens at midnight that drifts to 01:00 and silently dropped logs, so
//! the port keys days by their civil date instead. Nothing changes for `Europe/Brussels`.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use jiff::{Span, Timestamp, civil::Date};
use serde::{Deserialize, Serialize};

use crate::model::WorkLog;
use crate::targets::WorkTargets;
use crate::text::NonEmpty;
use crate::time::{Cal, Interval};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum StatisticsPeriod {
    Day,
    Week,
    Month,
    Year,
}

impl StatisticsPeriod {
    pub const ALL: [Self; 4] = [Self::Day, Self::Week, Self::Month, Self::Year];

    /// The Swift raw value, also the picker label.
    pub fn label(&self) -> &'static str {
        match self {
            Self::Day => "Day",
            Self::Week => "Week",
            Self::Month => "Month",
            Self::Year => "Year",
        }
    }
}

/// A calendar day, Monday-first ISO week, month or year. Build it with [`StatisticsRange::new`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsRange {
    pub period: StatisticsPeriod,
    pub start: Timestamp,
    pub end: Timestamp,
}

impl StatisticsRange {
    /// The period containing `anchor`.
    pub fn new(period: StatisticsPeriod, anchor: Timestamp, cal: &Cal) -> Self {
        let interval = match period {
            StatisticsPeriod::Day => cal.day_interval(anchor),
            StatisticsPeriod::Week => cal.week_interval(anchor),
            StatisticsPeriod::Month => cal.month_interval(anchor),
            StatisticsPeriod::Year => cal.year_interval(anchor),
        };
        Self { period, start: interval.start, end: interval.end }
    }

    /// The range `amount` periods earlier (negative) or later (positive).
    pub fn shifted(&self, amount: i64, cal: &Cal) -> Self {
        let span = match self.period {
            StatisticsPeriod::Day => Span::new().try_days(amount),
            StatisticsPeriod::Week => Span::new().try_weeks(amount),
            StatisticsPeriod::Month => Span::new().try_months(amount),
            StatisticsPeriod::Year => Span::new().try_years(amount),
        };
        let date = cal.date(self.start);
        let anchor = span.and_then(|span| date.checked_add(span)).unwrap_or(date);
        Self::new(self.period, cal.start_of_date(anchor), cal)
    }

    pub fn interval(&self) -> Interval {
        Interval::new(self.start, self.end)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsDay {
    /// The instant the local day starts.
    pub date: Timestamp,
    pub seconds: f64,
    pub sessions: i64,
    pub target_seconds: f64,
    pub cumulative_seconds: f64,
    pub cumulative_target: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsActivity {
    /// `activity:<id>`, or `unspecified` for logs without an activity ID.
    pub id: String,
    pub name: String,
    pub seconds: f64,
    pub sessions: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsTicket {
    pub ticket_id: Option<i64>,
    pub seconds: f64,
    pub sessions: i64,
}

impl StatisticsTicket {
    /// The ticket number as text, or `unassigned`.
    pub fn id(&self) -> String {
        self.ticket_id.map_or_else(|| "unassigned".to_string(), |id| id.to_string())
    }
}

/// Uses the worklog's reported date, like History. Does not extrapolate a live timer.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityStatistics {
    pub range: StatisticsRange,
    pub days: Vec<StatisticsDay>,
    pub activities: Vec<StatisticsActivity>,
    pub tickets: Vec<StatisticsTicket>,
    /// Logs with an unreadable date or a non-finite or negative length.
    pub omitted_logs: i64,
}

impl ActivityStatistics {
    pub fn total_seconds(&self) -> f64 {
        sum(self.days.iter().map(|d| d.seconds))
    }

    pub fn target_seconds(&self) -> f64 {
        sum(self.days.iter().map(|d| d.target_seconds))
    }

    pub fn sessions(&self) -> i64 {
        self.days.iter().map(|d| d.sessions).sum()
    }

    pub fn tracked_days(&self) -> i64 {
        self.days.iter().filter(|d| d.seconds > 0.0).count() as i64
    }

    /// Average over tracked days only.
    pub fn average_seconds(&self) -> f64 {
        let days = self.tracked_days();
        if days > 0 { self.total_seconds() / days as f64 } else { 0.0 }
    }

    pub fn target_fraction(&self) -> f64 {
        let target = self.target_seconds();
        if target > 0.0 { self.total_seconds() / target } else { 0.0 }
    }

    pub fn calculate(
        logs: &[WorkLog],
        range: &StatisticsRange,
        targets: &WorkTargets,
        cal: &Cal,
    ) -> Self {
        let table = DayTable::covering(cal, range.interval());
        let valid_targets = targets.is_valid();
        let mut days: Vec<StatisticsDay> = (0..table.len())
            .map(|i| StatisticsDay {
                date: table.start(i),
                seconds: 0.0,
                sessions: 0,
                target_seconds: if valid_targets {
                    targets.daily_seconds_on(table.date(i))
                } else {
                    0.0
                },
                cumulative_seconds: 0.0,
                cumulative_target: 0.0,
            })
            .collect();
        let mut seen = HashSet::new();
        let mut activities: HashMap<String, StatisticsActivity> = HashMap::new();
        let mut tickets: HashMap<Option<i64>, StatisticsTicket> = HashMap::new();
        let mut omitted = 0;
        for log in logs {
            if !seen.insert(log.id.as_str()) {
                continue;
            }
            let Some(date) =
                log.date(cal.tz()).filter(|_| log.length.is_finite() && log.length >= 0.0)
            else {
                omitted += 1;
                continue;
            };
            // API bounds may be inclusive; never count the next period's midnight.
            if date < range.start || date >= range.end {
                continue;
            }
            let Some(index) = table.index(date) else { continue };
            days[index].seconds += log.length;
            days[index].sessions += 1;

            let activity_type = log.activity_type.as_ref();
            let activity_id = activity_type.and_then(|a| a.id.non_empty());
            let key = activity_id
                .map_or_else(|| "unspecified".to_string(), |id| format!("activity:{id}"));
            let name = activity_type.and_then(|a| a.name.non_empty()).unwrap_or(
                if activity_id.is_none() { "Unspecified activity" } else { "Unnamed activity" },
            );
            let activity = activities.entry(key.clone()).or_insert_with(|| StatisticsActivity {
                id: key,
                name: name.to_string(),
                seconds: 0.0,
                sessions: 0,
            });
            if activity.name == "Unnamed activity" && name != "Unnamed activity" {
                activity.name = name.to_string();
            }
            activity.seconds += log.length;
            activity.sessions += 1;

            let ticket_id = log.ticket_id();
            let ticket = tickets.entry(ticket_id).or_insert(StatisticsTicket {
                ticket_id,
                seconds: 0.0,
                sessions: 0,
            });
            ticket.seconds += log.length;
            ticket.sessions += 1;
        }
        let (mut tracked, mut target) = (0.0, 0.0);
        for day in &mut days {
            tracked += day.seconds;
            target += day.target_seconds;
            day.cumulative_seconds = tracked;
            day.cumulative_target = target;
        }
        let mut activities: Vec<_> = activities.into_values().collect();
        activities.sort_by(|a, b| by_seconds_then_id((a.seconds, &a.id), (b.seconds, &b.id)));
        let mut tickets: Vec<_> = tickets.into_values().collect();
        tickets.sort_by(|a, b| by_seconds_then_id((a.seconds, &a.id()), (b.seconds, &b.id())));
        Self { range: *range, days, activities, tickets, omitted_logs: omitted }
    }
}

/// Swift `reduce(0, +)`. `Iterator::sum` starts from `-0.0`, which would leak a negative zero.
pub(crate) fn sum(values: impl IntoIterator<Item = f64>) -> f64 {
    values.into_iter().fold(0.0, |total, value| total + value)
}

/// Most seconds first; equal totals by ascending ID (Swift string order).
pub(crate) fn by_seconds_then_id(a: (f64, &str), b: (f64, &str)) -> Ordering {
    if a.0 == b.0 { a.1.cmp(b.1) } else { b.0.total_cmp(&a.0) }
}

/// The local days that start before `interval.end`, from the day containing `interval.start`,
/// with their boundaries. Lookups are binary searches, so hot loops avoid time-zone conversions.
#[derive(Clone, Debug)]
pub(crate) struct DayTable {
    dates: Vec<Date>,
    /// `dates.len() + 1` boundaries; day `i` is `[bounds[i], bounds[i + 1])`.
    bounds: Vec<Timestamp>,
}

impl DayTable {
    pub(crate) fn covering(cal: &Cal, interval: Interval) -> Self {
        let mut dates = Vec::new();
        let mut bounds = Vec::new();
        let mut date = cal.date(interval.start);
        let mut start = cal.start_of_date(date);
        while start < interval.end {
            let Ok(next) = date.tomorrow() else { break };
            dates.push(date);
            bounds.push(start);
            date = next;
            start = cal.start_of_date(next);
        }
        bounds.push(start);
        Self { dates, bounds }
    }

    pub(crate) fn len(&self) -> usize {
        self.dates.len()
    }

    pub(crate) fn date(&self, index: usize) -> Date {
        self.dates[index]
    }

    pub(crate) fn start(&self, index: usize) -> Timestamp {
        self.bounds[index]
    }

    pub(crate) fn end(&self, index: usize) -> Timestamp {
        self.bounds[index + 1]
    }

    pub(crate) fn interval(&self, index: usize) -> Interval {
        Interval::new(self.start(index), self.end(index))
    }

    /// Swift weekday number of a day: 1 = Sunday … 7 = Saturday.
    pub(crate) fn swift_weekday(&self, index: usize) -> usize {
        self.dates[index].weekday().to_sunday_one_offset() as usize
    }

    /// The day containing `ts`, if the table covers it.
    pub(crate) fn index(&self, ts: Timestamp) -> Option<usize> {
        let days = self.len();
        if days == 0 || ts < self.bounds[0] || ts >= self.bounds[days] {
            return None;
        }
        Some(self.bounds[..days].partition_point(|start| *start <= ts) - 1)
    }
}
