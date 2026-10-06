//! Calendar heatmap, hourly grid and cumulative progress. Ported from ExplorerVisuals.swift.
//!
//! Graph data derives from the same filtered, clipped entries as the explorer totals, so every
//! chart adds up to `ExplorerAnalysis::total`.

use std::collections::HashSet;

use jiff::Timestamp;
use serde::Serialize;

use crate::explorer::{ExplorerAnalysis, ExplorerEntry, clock_hour};
use crate::statistics::{DayTable, sum};
use crate::targets::WorkTargets;
use crate::time::{Cal, Interval, diff_secs};

/// Hour grids are readable at a day or week scale; longer windows use the calendar heatmap.
const HOURLY_GRID_MAX_DAYS: usize = 8;

/// One cell of the Monday-first ISO calendar heatmap.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerCalendarDay {
    /// The instant the local day starts.
    pub date: Timestamp,
    /// The part of the day inside the window.
    pub interval: Interval,
    pub seconds: f64,
    /// Distinct worklogs.
    pub entries: i64,
    pub target: f64,
    /// Column: ISO weeks since the week containing the window start.
    pub week: i64,
    /// Row: Monday = 0 … Sunday = 6.
    pub weekday: i64,
    pub future: bool,
}

/// One cell of the hourly grid.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerHeatHour {
    pub interval: Interval,
    /// The start of the cell's local day.
    pub day: Timestamp,
    pub seconds: f64,
    /// Chronological hour since the day started, so a repeated DST hour is a separate slot.
    pub slot: i64,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerProgressPoint {
    pub date: Timestamp,
    pub seconds: f64,
    pub target: f64,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerVisuals {
    pub days: Vec<ExplorerCalendarDay>,
    /// Empty for windows longer than eight days.
    pub hours: Vec<ExplorerHeatHour>,
    /// Cumulative recorded time per bucket, up to `max(now, last entry end)`.
    pub progress: Vec<ExplorerProgressPoint>,
    /// Cumulative target at the end of each day.
    pub target_progress: Vec<ExplorerProgressPoint>,
    pub week_count: i64,
}

impl ExplorerVisuals {
    pub fn new(
        analysis: &ExplorerAnalysis,
        targets: &WorkTargets,
        cal: &Cal,
        now: Timestamp,
    ) -> Self {
        let window = analysis.window;
        let table = DayTable::covering(cal, window);
        let mut grouped: Vec<Vec<&ExplorerEntry>> = (0..table.len()).map(|_| Vec::new()).collect();
        for entry in &analysis.entries {
            if let Some(day) = table.index(entry.start) {
                grouped[day].push(entry);
            }
        }
        let first_weekday = if table.len() > 0 {
            table.date(0).weekday().to_monday_zero_offset() as i64
        } else {
            0
        };
        let valid_targets = targets.is_valid();
        let mut days = Vec::with_capacity(table.len());
        let mut target = 0.0;
        let mut target_progress =
            vec![ExplorerProgressPoint { date: window.start, seconds: 0.0, target: 0.0 }];
        for (index, entries) in grouped.iter().enumerate() {
            let day = table.interval(index);
            let offset = first_weekday + index as i64;
            let schedule =
                if valid_targets { targets.daily_seconds_on(table.date(index)) } else { 0.0 };
            let interval = Interval::new(day.start.max(window.start), day.end.min(window.end));
            let logs: HashSet<&str> = entries.iter().map(|entry| entry.record.id()).collect();
            days.push(ExplorerCalendarDay {
                date: day.start,
                interval,
                seconds: sum(entries.iter().map(|entry| entry.seconds())),
                entries: logs.len() as i64,
                target: schedule,
                week: offset / 7,
                weekday: offset % 7,
                future: day.start > now,
            });
            target += schedule;
            target_progress.push(ExplorerProgressPoint {
                date: interval.end,
                seconds: 0.0,
                target,
            });
        }
        let week_count = days.last().map_or(0, |day: &ExplorerCalendarDay| day.week) + 1;

        let mut hours = Vec::new();
        if days.len() <= HOURLY_GRID_MAX_DAYS {
            for (day, entries) in days.iter().zip(&grouped) {
                let mut position = day.interval.start;
                // Whole elapsed hours, like Foundation's `dateComponents([.hour], from:to:)`.
                let mut slot = (diff_secs(position, day.date) / 3_600.0).floor() as i64;
                while position < day.interval.end {
                    let end = day.interval.end.min(clock_hour(cal, position).0.end);
                    let seconds = sum(entries.iter().map(|entry| {
                        diff_secs(end.min(entry.end), position.max(entry.start)).max(0.0)
                    }));
                    hours.push(ExplorerHeatHour {
                        interval: Interval::new(position, end),
                        day: day.date,
                        seconds,
                        slot,
                    });
                    position = end;
                    slot += 1;
                }
            }
        }

        let last_end = analysis.entries.iter().map(|entry| entry.end).max().unwrap_or(window.start);
        let recorded_through = window.end.min(window.start.max(now.max(last_end)));
        let mut recorded = 0.0;
        let mut progress =
            vec![ExplorerProgressPoint { date: window.start, seconds: 0.0, target: 0.0 }];
        for bucket in analysis.buckets.iter().filter(|bucket| bucket.start < recorded_through) {
            recorded += bucket.seconds();
            progress.push(ExplorerProgressPoint {
                date: bucket.end.min(recorded_through),
                seconds: recorded,
                target: 0.0,
            });
        }
        Self { days, hours, progress, target_progress, week_count }
    }
}
