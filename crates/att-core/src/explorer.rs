//! Statistics explorer datasets and analysis. Ported from StatisticsExplorer.swift.
//!
//! All explorer intervals are half-open and zoom stays inside the downloaded period. Entries are
//! clipped to the window and split at local midnight; every total, chart and ranking is derived
//! from the same filtered entries so they always agree.
//!
//! Performance: the dataset parses each log once. An analysis is linear in the number of
//! entries plus buckets (bucket and hour lookups are binary searches over precomputed
//! boundaries), so a year of about 5,000 worklogs analyses in milliseconds.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use jiff::Timestamp;
use serde::{Deserialize, Serialize, Serializer};

use crate::insights::{ContextInsights, ContextSegment, context_key};
use crate::model::WorkLog;
use crate::statistics::{DayTable, by_seconds_then_id, sum};
use crate::targets::WorkTargets;
use crate::text::{NonEmpty, contains_folded};
use crate::time::{Cal, Interval, add_secs, diff_secs, secs};

const NANOS_PER_SECOND: i128 = 1_000_000_000;
const NANOS_PER_HOUR: i128 = 3_600 * NANOS_PER_SECOND;

/// English `Calendar.shortWeekdaySymbols`, Sunday first.
const SHORT_WEEKDAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/// Zoom and pan inside the downloaded period.
pub struct StatisticsZoom;

impl StatisticsZoom {
    /// The smallest window: 15 minutes (or the whole period when that is shorter).
    pub const MINIMUM: f64 = 15.0 * 60.0;

    /// `proposed`, resized to at least the minimum and moved inside `bounds`.
    pub fn bounded(proposed: Interval, bounds: Interval) -> Interval {
        let duration = bounds.duration().min(Self::MINIMUM.max(proposed.duration()));
        let start = bounds.start.max(proposed.start.min(add_secs(bounds.end, -duration)));
        Interval::new(start, add_secs(start, duration))
    }

    /// Zooms around the window's centre; ignores non-finite or non-positive factors.
    pub fn scaled(window: Interval, factor: f64, bounds: Interval) -> Interval {
        if !factor.is_finite() || factor <= 0.0 {
            return window;
        }
        let duration = bounds.duration().min(Self::MINIMUM.max(window.duration() * factor));
        let start = add_secs(window.start, (window.duration() - duration) / 2.0);
        Self::bounded(Interval::new(start, add_secs(start, duration)), bounds)
    }

    /// Moves by whole window lengths (`direction` is usually -1 or 1).
    pub fn shifted(window: Interval, direction: i64, bounds: Interval) -> Interval {
        let start = add_secs(window.start, window.duration() * direction as f64);
        Self::bounded(Interval::new(start, add_secs(start, window.duration())), bounds)
    }
}

/// Bucket size of the time chart. Serialized as the Swift raw value, which is also the label.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ExplorerResolution {
    #[serde(rename = "Monthly")]
    Month,
    #[serde(rename = "Daily")]
    Day,
    #[serde(rename = "Hourly")]
    Hour,
    #[serde(rename = "15 minutes")]
    Quarter,
    #[serde(rename = "5 minutes")]
    Minute,
}

impl ExplorerResolution {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Month => "Monthly",
            Self::Day => "Daily",
            Self::Hour => "Hourly",
            Self::Quarter => "15 minutes",
            Self::Minute => "5 minutes",
        }
    }

    /// Monthly above 100 days, daily above 36 hours, hourly above 6 hours, 15 minutes above an
    /// hour, otherwise 5 minutes.
    pub fn for_duration(seconds: f64) -> Self {
        if seconds > 100.0 * 86_400.0 {
            Self::Month
        } else if seconds > 36.0 * 3_600.0 {
            Self::Day
        } else if seconds > 6.0 * 3_600.0 {
            Self::Hour
        } else if seconds > 3_600.0 {
            Self::Quarter
        } else {
            Self::Minute
        }
    }

    /// The bucket containing `at`. Sub-hour buckets are aligned to the local clock hour.
    pub fn interval(&self, at: Timestamp, cal: &Cal) -> Interval {
        match self {
            Self::Month => cal.month_interval(at),
            Self::Day => cal.day_interval(at),
            Self::Hour => clock_hour(cal, at).0,
            Self::Quarter | Self::Minute => {
                let hour = clock_hour(cal, at).0.start;
                let step = if *self == Self::Quarter { 900.0 } else { 300.0 };
                let start = add_secs(hour, (diff_secs(at, hour) / step).floor() * step);
                Interval::new(start, add_secs(start, step))
            }
        }
    }
}

/// The local clock hour containing `ts` and its hour of day (0–23). A repeated DST hour is its
/// own interval, like Foundation's `dateInterval(of: .hour, for:)`.
///
/// Uses the UTC offset at `ts`, which is exact whenever offsets change by whole hours on an hour
/// boundary (Europe/Brussels and nearly every zone). Around a half-hour DST shift (Lord Howe
/// Island) one bucket can be misaligned by 30 minutes; totals stay exact.
pub(crate) fn clock_hour(cal: &Cal, ts: Timestamp) -> (Interval, usize) {
    let nanos = ts.as_nanosecond();
    let local = nanos + i128::from(cal.tz().to_offset(ts).seconds()) * NANOS_PER_SECOND;
    let start = Timestamp::from_nanosecond(nanos - local.rem_euclid(NANOS_PER_HOUR)).unwrap_or(ts);
    let hour = local.div_euclid(NANOS_PER_HOUR).rem_euclid(24) as usize;
    (Interval::new(start, add_secs(start, 3_600.0)), hour)
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExplorerFilter {
    /// Case- and diacritic-insensitive search in ticket number, title, comment and activity.
    pub query: String,
    pub activity_id: Option<String>,
    pub task_id: Option<String>,
    /// Swift weekday number (1 = Sunday … 7 = Saturday), matched per day segment.
    pub weekday: Option<i64>,
    /// Index into [`ExplorerRecord::BAND_NAMES`], matched on the original log length.
    pub length_band: Option<i64>,
}

impl ExplorerFilter {
    pub fn is_active(&self) -> bool {
        !self.query.trim().is_empty()
            || self.activity_id.is_some()
            || self.task_id.is_some()
            || self.weekday.is_some()
            || self.length_band.is_some()
    }
}

/// A parsed worklog.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerRecord {
    pub log: WorkLog,
    pub start: Timestamp,
    pub end: Timestamp,
    /// `ticket:<id>`, or `free:<utf8 length of activity ID>:<activity ID><comment>`.
    pub task_id: String,
    pub ticket_id: Option<i64>,
    /// `activity:<id>`, or `unspecified`.
    pub activity_id: String,
    pub activity_name: String,
}

impl ExplorerRecord {
    pub const BAND_NAMES: [&'static str; 5] =
        ["Under 15 min", "15–30 min", "30–60 min", "1–2 hours", "2+ hours"];

    pub fn id(&self) -> &str {
        &self.log.id
    }

    pub fn fallback_title(&self) -> String {
        match self.ticket_id {
            Some(id) => format!("Azure ticket #{id}"),
            None => self.log.comment.non_empty().unwrap_or(&self.activity_name).to_string(),
        }
    }

    pub fn length_band(&self) -> i64 {
        Self::band(self.log.length)
    }

    pub fn band(seconds: f64) -> i64 {
        if seconds < 900.0 {
            0
        } else if seconds < 1_800.0 {
            1
        } else if seconds < 3_600.0 {
            2
        } else if seconds < 7_200.0 {
            3
        } else {
            4
        }
    }
}

/// The part of a record inside the window and inside one local day.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerEntry {
    #[cfg_attr(feature = "ts", ts(as = "ExplorerRecord"))]
    #[serde(serialize_with = "serialize_shared")]
    pub record: Arc<ExplorerRecord>,
    pub start: Timestamp,
    pub end: Timestamp,
}

impl ExplorerEntry {
    /// `<log id>:<start as Unix seconds>`, as Swift formatted it (`1790000000.0`).
    pub fn id(&self) -> String {
        format!("{}:{:?}", self.record.id(), secs(self.start))
    }

    pub fn seconds(&self) -> f64 {
        diff_secs(self.end, self.start)
    }

    pub fn clipped(&self) -> bool {
        self.start != self.record.start || self.end != self.record.end
    }
}

fn serialize_shared<S: Serializer, T: Serialize>(
    value: &Arc<T>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    T::serialize(value, serializer)
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerTask {
    pub id: String,
    pub ticket_id: Option<i64>,
    pub title: String,
    pub seconds: f64,
    /// Distinct worklogs.
    pub count: i64,
    /// Distinct local days.
    pub days: i64,
    pub last_worked: Timestamp,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerActivity {
    pub id: String,
    pub name: String,
    pub seconds: f64,
}

/// One activity's slice of a stacked bucket.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerSegment {
    pub activity_id: String,
    pub name: String,
    pub bottom: f64,
    pub top: f64,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerBucket {
    pub start: Timestamp,
    pub end: Timestamp,
    /// Stacked by activity ID.
    pub segments: Vec<ExplorerSegment>,
}

impl ExplorerBucket {
    pub fn seconds(&self) -> f64 {
        self.segments.last().map_or(0.0, |segment| segment.top)
    }

    pub fn interval(&self) -> Interval {
        Interval::new(self.start, self.end)
    }
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerPattern {
    /// Swift weekday number, hour of day or length band, depending on the list.
    pub id: i64,
    pub label: String,
    pub seconds: f64,
    /// Weekdays: days of that weekday up to now; lengths: distinct worklogs; hours: 0.
    pub count: i64,
}

/// Everything besides the window that shapes an analysis (Swift's default arguments).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ExplorerOptions {
    pub filter: ExplorerFilter,
    /// Azure titles by ticket number, for search and task titles.
    pub titles: HashMap<i64, String>,
    pub targets: WorkTargets,
    /// Bucket size; chosen from the window length when `None`.
    pub resolution: Option<ExplorerResolution>,
}

/// Dates are parsed once on download; filtering never reparses the API payload.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ExplorerDataset {
    /// Valid, non-empty logs sorted by start, then ID.
    pub records: Vec<Arc<ExplorerRecord>>,
    /// Logs with an unreadable date or a non-finite, negative or over-long length.
    pub omitted: i64,
}

impl ExplorerDataset {
    /// Deduplicates by ID; zero-length logs are dropped without counting as omitted.
    pub fn new(logs: &[WorkLog], cal: &Cal) -> Self {
        let mut seen = HashSet::new();
        let mut records = Vec::new();
        let mut omitted = 0;
        for log in logs {
            if !seen.insert(log.id.as_str()) {
                continue;
            }
            let length = log.length;
            let valid = length.is_finite() && length >= 0.0 && length <= i32::MAX as f64;
            let Some(start) = log.date(cal.tz()).filter(|_| valid) else {
                omitted += 1;
                continue;
            };
            if length <= 0.0 {
                continue;
            }
            let ticket_id = log.ticket_id();
            let activity_type = log.activity_type.as_ref();
            let activity_id = activity_type
                .and_then(|a| a.id.non_empty())
                .map_or_else(|| "unspecified".to_string(), |id| format!("activity:{id}"));
            // Length prefixes keep free-text comments and activity IDs from colliding.
            let task_id = match ticket_id {
                Some(id) => format!("ticket:{id}"),
                None => format!(
                    "free:{}:{activity_id}{}",
                    activity_id.len(),
                    log.comment.non_empty().unwrap_or("")
                ),
            };
            let activity_name =
                activity_type.and_then(|a| a.name.non_empty()).unwrap_or("Unspecified activity");
            records.push(Arc::new(ExplorerRecord {
                log: log.clone(),
                start,
                end: add_secs(start, length),
                task_id,
                ticket_id,
                activity_id,
                activity_name: activity_name.to_string(),
            }));
        }
        records.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| a.id().cmp(b.id())));
        Self { records, omitted }
    }

    /// Filters, clips and summarises the records overlapping `window`.
    pub fn analyze(
        &self,
        window: Interval,
        options: &ExplorerOptions,
        cal: &Cal,
        now: Timestamp,
    ) -> ExplorerAnalysis {
        let filter = &options.filter;
        let query = filter.query.trim();
        let days = DayTable::covering(cal, window);
        let mut keyed: Vec<(Timestamp, String, ExplorerEntry)> = Vec::new();
        for record in &self.records {
            // Records are sorted by start, so nothing later can overlap.
            if record.start >= window.end {
                break;
            }
            if record.end <= window.start
                || filter.activity_id.as_ref().is_some_and(|id| *id != record.activity_id)
                || filter.task_id.as_ref().is_some_and(|id| *id != record.task_id)
                || filter.length_band.is_some_and(|band| band != record.length_band())
            {
                continue;
            }
            if !query.is_empty() {
                let haystack = [
                    record.ticket_id.map(|id| id.to_string()).unwrap_or_default(),
                    record
                        .ticket_id
                        .and_then(|id| options.titles.get(&id))
                        .cloned()
                        .unwrap_or_default(),
                    record.log.comment.clone().unwrap_or_default(),
                    record.activity_name.clone(),
                ]
                .join(" ");
                if !contains_folded(&haystack, query) {
                    continue;
                }
            }
            let mut start = window.start.max(record.start);
            let end = window.end.min(record.end);
            while start < end {
                let Some(day) = days.index(start) else { break };
                let next = end.min(days.end(day));
                if filter.weekday.is_none_or(|weekday| weekday == days.swift_weekday(day) as i64) {
                    let entry = ExplorerEntry { record: Arc::clone(record), start, end: next };
                    keyed.push((start, entry.id(), entry));
                }
                start = next;
            }
        }
        keyed.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
        let entries = keyed.into_iter().map(|(_, _, entry)| entry).collect();
        ExplorerAnalysis::new(entries, window, &days, options, cal, now)
    }
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerAnalysis {
    /// Sorted by start, then entry ID.
    pub entries: Vec<ExplorerEntry>,
    pub window: Interval,
    /// Most time first.
    pub tasks: Vec<ExplorerTask>,
    /// Most time first.
    pub activities: Vec<ExplorerActivity>,
    pub buckets: Vec<ExplorerBucket>,
    /// Monday first.
    pub weekdays: Vec<ExplorerPattern>,
    /// 00:00 to 23:00 in local clock hours; a repeated DST hour adds to its clock hour.
    pub hours: Vec<ExplorerPattern>,
    pub lengths: Vec<ExplorerPattern>,
    pub resolution: ExplorerResolution,
    /// Recorded seconds; overlapping entries count every time.
    pub total: f64,
    /// Clock time covered by at least one entry.
    pub covered: f64,
    /// Distinct worklogs.
    pub count: i64,
    pub tracked_days: i64,
    /// Median of each worklog's seconds inside the window.
    pub median: f64,
    /// 7pace billable time, prorated to the clipped part of each worklog.
    pub billable: f64,
    /// Worklogs with a known billable length (unknown stays distinct from zero).
    pub billable_known_count: i64,
    /// Scheduled target of every local day overlapping the window.
    pub target: f64,
    pub context: ContextInsights,
}

/// Per-worklog totals, in order of first appearance.
struct LogTotal<'a> {
    record: &'a ExplorerRecord,
    seconds: f64,
}

/// Per-task totals while grouping.
struct TaskTotal<'a> {
    record: &'a ExplorerRecord,
    seconds: f64,
    count: i64,
    days: i64,
    last_day: usize,
    last_worked: Timestamp,
}

impl ExplorerAnalysis {
    /// Recorded total minus covered clock time.
    pub fn overlap(&self) -> f64 {
        (self.total - self.covered).max(0.0)
    }

    fn new(
        entries: Vec<ExplorerEntry>,
        window: Interval,
        days: &DayTable,
        options: &ExplorerOptions,
        cal: &Cal,
        now: Timestamp,
    ) -> Self {
        // Every entry lies inside the window and inside one day of `days`.
        let entry_days: Vec<usize> =
            entries.iter().map(|entry| days.index(entry.start).unwrap_or(0)).collect();
        let total = sum(entries.iter().map(ExplorerEntry::seconds));

        let mut log_index: HashMap<&str, usize> = HashMap::new();
        let mut logs: Vec<LogTotal> = Vec::new();
        let mut task_index: HashMap<&str, usize> = HashMap::new();
        let mut tasks: Vec<TaskTotal> = Vec::new();
        let mut activity_index: HashMap<&str, usize> = HashMap::new();
        let mut activities: Vec<ExplorerActivity> = Vec::new();
        let (mut covered, mut last_end) = (0.0, window.start);
        let mut billable = 0.0;
        let mut weekday_seconds = [0.0; 8];
        let mut hour_seconds = [0.0; 24];
        let mut band_seconds = [0.0; 5];
        for (entry, &day) in entries.iter().zip(&entry_days) {
            let record: &ExplorerRecord = &entry.record;
            let seconds = entry.seconds();
            let first_of_log = match log_index.get(record.id()) {
                Some(&index) => {
                    logs[index].seconds += seconds;
                    false
                }
                None => {
                    log_index.insert(record.id(), logs.len());
                    logs.push(LogTotal { record, seconds });
                    true
                }
            };
            match task_index.get(record.task_id.as_str()) {
                Some(&index) => {
                    let task = &mut tasks[index];
                    task.seconds += seconds;
                    task.count += i64::from(first_of_log);
                    if task.last_day != day {
                        task.days += 1;
                        task.last_day = day;
                    }
                    task.last_worked = task.last_worked.max(entry.end);
                }
                None => {
                    task_index.insert(&record.task_id, tasks.len());
                    tasks.push(TaskTotal {
                        record,
                        seconds,
                        count: 1,
                        days: 1,
                        last_day: day,
                        last_worked: entry.end,
                    });
                }
            }
            match activity_index.get(record.activity_id.as_str()) {
                Some(&index) => activities[index].seconds += seconds,
                None => {
                    activity_index.insert(&record.activity_id, activities.len());
                    activities.push(ExplorerActivity {
                        id: record.activity_id.clone(),
                        name: record.activity_name.clone(),
                        seconds,
                    });
                }
            }
            covered += diff_secs(entry.end, last_end.max(entry.start)).max(0.0);
            last_end = last_end.max(entry.end);
            if let Some(known) = known_billable(&record.log) {
                billable += known.min(record.log.length) * seconds / record.log.length;
            }
            weekday_seconds[days.swift_weekday(day)] += seconds;
            let mut position = entry.start;
            while position < entry.end {
                let (hour, clock) = clock_hour(cal, position);
                let next = entry.end.min(hour.end);
                hour_seconds[clock] += diff_secs(next, position);
                position = next;
            }
            band_seconds[record.length_band() as usize] += seconds;
        }
        // Entries are sorted by start, so their days never decrease.
        let tracked_days = count_distinct_sorted(&entry_days);

        let mut durations: Vec<f64> = logs.iter().map(|log| log.seconds).collect();
        durations.sort_by(f64::total_cmp);
        let median = match durations.len() {
            0 => 0.0,
            n => (durations[(n - 1) / 2] + durations[n / 2]) / 2.0,
        };
        let billable_known_count =
            logs.iter().filter(|log| known_billable(&log.record.log).is_some()).count() as i64;
        let mut band_counts = [0i64; 5];
        for log in &logs {
            band_counts[log.record.length_band() as usize] += 1;
        }

        let mut tasks: Vec<ExplorerTask> = tasks
            .into_iter()
            .map(|task| ExplorerTask {
                id: task.record.task_id.clone(),
                ticket_id: task.record.ticket_id,
                title: task
                    .record
                    .ticket_id
                    .and_then(|id| options.titles.get(&id).cloned())
                    .unwrap_or_else(|| task.record.fallback_title()),
                seconds: task.seconds,
                count: task.count,
                days: task.days,
                last_worked: task.last_worked,
            })
            .collect();
        tasks.sort_by(|a, b| by_seconds_then_id((a.seconds, &a.id), (b.seconds, &b.id)));
        activities.sort_by(|a, b| by_seconds_then_id((a.seconds, &a.id), (b.seconds, &b.id)));

        let resolution =
            options.resolution.unwrap_or(ExplorerResolution::for_duration(window.duration()));
        let buckets = buckets(&entries, window, resolution, &activities, cal);

        let mut occurrences = [0i64; 8];
        let mut target = 0.0;
        let valid_targets = options.targets.is_valid();
        for index in 0..days.len() {
            if days.start(index) <= now {
                occurrences[days.swift_weekday(index)] += 1;
            }
            if valid_targets {
                target += options.targets.daily_seconds_on(days.date(index));
            }
        }
        let weekdays = [2, 3, 4, 5, 6, 7, 1]
            .map(|weekday: usize| ExplorerPattern {
                id: weekday as i64,
                label: SHORT_WEEKDAYS[weekday - 1].to_string(),
                seconds: weekday_seconds[weekday],
                count: occurrences[weekday],
            })
            .to_vec();
        let hours = (0..24)
            .map(|hour| ExplorerPattern {
                id: hour as i64,
                label: format!("{hour:02}:00"),
                seconds: hour_seconds[hour],
                count: 0,
            })
            .collect();
        let lengths = (0..5)
            .map(|band| ExplorerPattern {
                id: band as i64,
                label: ExplorerRecord::BAND_NAMES[band].to_string(),
                seconds: band_seconds[band],
                count: band_counts[band],
            })
            .collect();

        // Context uses the same filtered, clipped entries (Swift re-parsed clipped copies of the
        // logs per calendar year; the segments are identical, minus that round trip's loss of
        // sub-second precision and of the repeated DST hour).
        let mut by_day: Vec<Vec<ContextSegment>> = (0..days.len()).map(|_| Vec::new()).collect();
        for (entry, &day) in entries.iter().zip(&entry_days) {
            let end = entry.end.min(now);
            if entry.start < end {
                by_day[day].push(ContextSegment {
                    start: entry.start,
                    end,
                    context: context_key(&entry.record.log),
                });
            }
        }
        let context = ContextInsights::from_segments(days, by_day, 0);

        Self {
            count: logs.len() as i64,
            entries,
            window,
            tasks,
            activities,
            buckets,
            weekdays,
            hours,
            lengths,
            resolution,
            total,
            covered,
            tracked_days,
            median,
            billable,
            billable_known_count,
            target,
            context,
        }
    }
}

/// A finite, non-negative billable length.
fn known_billable(log: &WorkLog) -> Option<f64> {
    log.billable_length.filter(|value| value.is_finite() && *value >= 0.0)
}

/// Distinct values of a non-decreasing list.
fn count_distinct_sorted(values: &[usize]) -> i64 {
    values.windows(2).filter(|pair| pair[0] != pair[1]).count() as i64
        + i64::from(!values.is_empty())
}

/// Buckets from the window start, each ending at the resolution's next boundary, with every
/// activity's seconds stacked in activity-ID order.
fn buckets(
    entries: &[ExplorerEntry],
    window: Interval,
    resolution: ExplorerResolution,
    activities: &[ExplorerActivity],
    cal: &Cal,
) -> Vec<ExplorerBucket> {
    let mut bounds: Vec<Interval> = Vec::new();
    let mut cursor = window.start;
    while cursor < window.end {
        let next = window.end.min(resolution.interval(cursor, cal).end);
        if next <= cursor {
            break;
        }
        bounds.push(Interval::new(cursor, next));
        cursor = next;
    }
    let mut ordered: Vec<&ExplorerActivity> = activities.iter().collect();
    ordered.sort_by(|a, b| a.id.cmp(&b.id));
    let position: HashMap<&str, usize> =
        ordered.iter().enumerate().map(|(index, activity)| (activity.id.as_str(), index)).collect();
    // Sparse per-bucket totals: (activity position, seconds), summed in entry order.
    let mut totals: Vec<Vec<(usize, f64)>> = vec![Vec::new(); bounds.len()];
    for entry in entries {
        let Some(&activity) = position.get(entry.record.activity_id.as_str()) else { continue };
        let first = bounds.partition_point(|bucket| bucket.end <= entry.start);
        for (bucket, totals) in bounds[first..].iter().zip(&mut totals[first..]) {
            if bucket.start >= entry.end {
                break;
            }
            let seconds = diff_secs(bucket.end.min(entry.end), bucket.start.max(entry.start));
            match totals.iter_mut().find(|(index, _)| *index == activity) {
                Some((_, total)) => *total += seconds,
                None => totals.push((activity, seconds)),
            }
        }
    }
    bounds
        .into_iter()
        .zip(totals)
        .map(|(bucket, mut totals)| {
            totals.sort_by_key(|(index, _)| *index);
            let mut accumulated = 0.0;
            let segments = totals
                .into_iter()
                .filter(|(_, value)| *value > 0.0)
                .map(|(index, value)| {
                    let segment = ExplorerSegment {
                        activity_id: ordered[index].id.clone(),
                        name: ordered[index].name.clone(),
                        bottom: accumulated,
                        top: accumulated + value,
                    };
                    accumulated += value;
                    segment
                })
                .collect();
            ExplorerBucket { start: bucket.start, end: bucket.end, segments }
        })
        .collect()
}
