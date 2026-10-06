//! Port of StatisticsExplorerTests.swift, plus a full-year performance check.

#[path = "support/insights.rs"]
mod support;

use std::collections::HashMap;
use std::time::Instant;

use att_core::Interval;
use att_core::explorer::{
    ExplorerAnalysis, ExplorerDataset, ExplorerFilter, ExplorerOptions, ExplorerRecord,
    ExplorerResolution, StatisticsZoom,
};
use att_core::explorer_visuals::ExplorerVisuals;
use att_core::model::{ActivityType, WorkLog};
use att_core::statistics::{ActivityStatistics, StatisticsPeriod, StatisticsRange};
use att_core::targets::WorkTargets;
use att_core::time::{add_secs, diff_secs, wire_date};
use support::{cal, date, log, ticket_log};

fn window(from: &str, to: &str) -> Interval {
    Interval::new(date(from), date(to))
}

fn default_window() -> Interval {
    window("2026-10-02T07:00:00Z", "2026-10-02T11:00:00Z")
}

fn now() -> jiff::Timestamp {
    date("2026-12-31T20:00:00Z")
}

fn analyze_with(logs: &[WorkLog], bounds: Interval, options: &ExplorerOptions) -> ExplorerAnalysis {
    ExplorerDataset::new(logs, &cal()).analyze(bounds, options, &cal(), now())
}

fn analyze(logs: &[WorkLog], bounds: Interval) -> ExplorerAnalysis {
    analyze_with(logs, bounds, &ExplorerOptions::default())
}

fn filtered(filter: ExplorerFilter) -> ExplorerOptions {
    ExplorerOptions { filter, ..ExplorerOptions::default() }
}

fn total<T>(items: &[T], seconds: impl Fn(&T) -> f64) -> f64 {
    items.iter().fold(0.0, |sum, item| sum + seconds(item))
}

#[test]
fn zoom_clamps_both_directions_and_preserves_duration() {
    let bounds = default_window();
    let early = StatisticsZoom::bounded(
        Interval::new(add_secs(bounds.start, -3600.0), add_secs(bounds.start, 3600.0)),
        bounds,
    );
    assert_eq!(early.start, bounds.start);
    assert_eq!(early.duration(), 7200.0);
    let late =
        StatisticsZoom::bounded(Interval::new(bounds.end, add_secs(bounds.end, 7200.0)), bounds);
    assert_eq!(late.end, bounds.end);
    assert_eq!(late.duration(), 7200.0);
}

#[test]
fn zoom_minimum_maximum_and_pan() {
    let bounds = default_window();
    let small = StatisticsZoom::scaled(bounds, 0.001, bounds);
    assert_eq!(small.duration(), 900.0);
    assert_eq!(StatisticsZoom::scaled(small, 1000.0, bounds), bounds);
    assert_eq!(StatisticsZoom::shifted(small, 100, bounds).end, bounds.end);
    assert_eq!(StatisticsZoom::shifted(small, -100, bounds).start, bounds.start);
    assert_eq!(StatisticsZoom::scaled(bounds, f64::NAN, bounds), bounds);
}

#[test]
fn zoom_smaller_than_minimum_bounds_still_stays_inside() {
    let start = date("2026-10-02T07:00:00Z");
    let bounds = Interval::new(start, add_secs(start, 60.0));
    assert_eq!(StatisticsZoom::scaled(bounds, 0.1, bounds), bounds);
}

#[test]
fn clipping_has_consistent_totals_everywhere() {
    let logs = [
        WorkLog {
            billable_length: Some(3600.0),
            ..ticket_log("a", "2026-10-02T06:30:00Z", 7200.0, 33984)
        },
        ticket_log("b", "2026-10-02T10:30:00Z", 7200.0, 33630),
    ];
    let data = analyze(&logs, default_window());
    assert_eq!(data.total, 7200.0);
    assert_eq!(data.count, 2);
    assert_eq!(data.billable, 2700.0);
    assert_eq!(data.billable_known_count, 1);
    assert_eq!(total(&data.buckets, |b| b.seconds()), data.total);
    assert_eq!(total(&data.tasks, |t| t.seconds), data.total);
    assert_eq!(total(&data.activities, |a| a.seconds), data.total);
    assert_eq!(total(&data.hours, |h| h.seconds), data.total);
    assert!(data.entries.iter().all(|e| e.clipped()));
}

#[test]
fn overlap_uses_union_including_nested_and_adjacent_entries() {
    let logs = [
        log("a", "2026-10-02T07:00:00Z", 7200.0),
        log("b", "2026-10-02T07:30:00Z", 1800.0),
        log("c", "2026-10-02T08:30:00Z", 7200.0),
        log("d", "2026-10-02T10:30:00Z", 1800.0),
    ];
    let data = analyze(&logs, default_window());
    assert_eq!(data.total, 18000.0);
    assert_eq!(data.covered, 14400.0);
    assert_eq!(data.overlap(), 3600.0);
}

#[test]
fn half_open_boundaries_and_invalid_duplicates() {
    let valid = log("one", "2026-10-02T07:00:00Z", 3600.0);
    let at = valid.timestamp.as_str();
    let dataset = ExplorerDataset::new(
        &[
            valid.clone(),
            valid.clone(),
            log("end", "2026-10-02T11:00:00Z", 3600.0),
            log("before", "2026-10-02T06:00:00Z", 3600.0),
            log("bad-date", "bad", 1.0),
            log("bad-length", at, f64::INFINITY),
            log("negative", at, -1.0),
            log("too-long", at, i32::MAX as f64 + 1.0),
            log("zero", at, 0.0),
        ],
        &cal(),
    );
    assert_eq!(dataset.omitted, 4);
    let data = dataset.analyze(default_window(), &ExplorerOptions::default(), &cal(), now());
    assert_eq!(data.count, 1);
    assert_eq!(data.total, 3600.0);
}

#[test]
fn midnight_segments_do_not_double_count_entry_or_billable() {
    let night = WorkLog {
        billable_length: Some(3600.0),
        ..ticket_log("night", "2026-10-01T21:30:00Z", 7200.0, 33984)
    };
    let data = analyze(&[night], window("2026-10-01T20:00:00Z", "2026-10-02T02:00:00Z"));
    assert_eq!(data.entries.len(), 2);
    assert_eq!(data.count, 1);
    assert_eq!(data.tracked_days, 2);
    assert_eq!(data.billable, 3600.0);
    assert_eq!(data.tasks[0].days, 2);
    assert_eq!(data.tasks[0].count, 1);
    assert_eq!(data.median, 7200.0);
}

#[test]
fn weekday_filter_clips_overnight_portion() {
    let filter = ExplorerFilter { weekday: Some(6), ..ExplorerFilter::default() }; // Friday
    let data = analyze_with(
        &[log("night", "2026-10-01T21:30:00Z", 7200.0)],
        window("2026-10-01T20:00:00Z", "2026-10-02T02:00:00Z"),
        &filtered(filter),
    );
    assert_eq!(data.total, 5400.0);
    assert_eq!(data.entries.len(), 1);
    assert_eq!(data.tracked_days, 1);
}

#[test]
fn search_title_ticket_comment_and_combined_activity_filter() {
    let dev = ActivityType { id: "dev".into(), name: Some("Development".into()), color: None };
    let logs = [
        WorkLog {
            comment: Some("Café export".into()),
            activity_type: Some(dev),
            ..ticket_log("a", "2026-10-02T07:00:00Z", 3600.0, 33984)
        },
        ticket_log("b", "2026-10-02T08:00:00Z", 3600.0, 33630),
    ];
    let titles = HashMap::from([(33984, "Export reliability".to_string())]);
    let mut options =
        filtered(ExplorerFilter { query: "cafe".into(), ..ExplorerFilter::default() });
    assert_eq!(analyze_with(&logs, default_window(), &options).count, 1);
    options.filter.query = "33984".into();
    assert_eq!(analyze_with(&logs, default_window(), &options).count, 1);
    options.filter.query = "EXPORT RELIABILITY".into();
    options.titles = titles;
    assert_eq!(analyze_with(&logs, default_window(), &options).count, 1);
    options.filter.activity_id = Some("unspecified".into());
    assert_eq!(analyze_with(&logs, default_window(), &options).count, 0);
}

#[test]
fn task_filter_and_ticket_free_grouping() {
    let standup = |id: &str, at: &str| WorkLog {
        comment: Some("Daily standup".into()),
        ..log(id, at, 900.0)
    };
    let logs = [
        standup("a", "2026-10-02T07:00:00Z"),
        standup("b", "2026-10-02T08:00:00Z"),
        WorkLog { comment: Some("Planning".into()), ..log("c", "2026-10-02T09:00:00Z", 900.0) },
    ];
    let data = analyze(&logs, default_window());
    assert_eq!(data.tasks.len(), 2);
    assert_eq!(data.tasks[0].count, 2);
    let task = Some(data.tasks[0].id.clone());
    let only = analyze_with(
        &logs,
        default_window(),
        &filtered(ExplorerFilter { task_id: task, ..ExplorerFilter::default() }),
    );
    assert_eq!(only.total, 1800.0);
}

#[test]
fn original_length_band_persists_when_zooming() {
    let filter = ExplorerFilter { length_band: Some(4), ..ExplorerFilter::default() };
    let data = analyze_with(
        &[log("a", "2026-10-02T07:00:00Z", 7200.0)],
        window("2026-10-02T07:30:00Z", "2026-10-02T07:45:00Z"),
        &filtered(filter),
    );
    assert_eq!(data.total, 900.0);
    assert_eq!(data.lengths[4].count, 1);
    assert_eq!(data.lengths[1].count, 0);
    let bands: Vec<_> = [899.0, 900.0, 1800.0, 3600.0, 7200.0].map(ExplorerRecord::band).to_vec();
    assert_eq!(bands, [0, 1, 2, 3, 4]);
}

#[test]
fn adaptive_resolution_and_empty_data() {
    assert_eq!(ExplorerResolution::for_duration(365.0 * 86400.0), ExplorerResolution::Month);
    assert_eq!(ExplorerResolution::for_duration(31.0 * 86400.0), ExplorerResolution::Day);
    assert_eq!(ExplorerResolution::for_duration(86400.0), ExplorerResolution::Hour);
    assert_eq!(ExplorerResolution::for_duration(3.0 * 3600.0), ExplorerResolution::Quarter);
    let data = analyze(&[], window("2026-10-02T07:00:00Z", "2026-10-02T07:15:00Z"));
    assert_eq!(data.resolution, ExplorerResolution::Minute);
    assert_eq!(data.buckets.len(), 3);
    assert_eq!(data.total, 0.0);
    assert_eq!(data.median, 0.0);
    assert_eq!(data.overlap(), 0.0);
}

#[test]
fn hourly_buckets_handle_both_dst_transitions() {
    for (anchor, count) in [("2026-10-25T12:00:00Z", 25), ("2026-03-29T12:00:00Z", 23)] {
        let range = StatisticsRange::new(StatisticsPeriod::Day, date(anchor), &cal());
        let day = log(
            "day",
            &wire_date::local_string(range.start, cal().tz()),
            diff_secs(range.end, range.start),
        );
        let data = analyze(&[day], range.interval());
        assert_eq!(data.buckets.len(), count, "{anchor}");
        assert_eq!(total(&data.buckets, |b| b.seconds()), count as f64 * 3600.0, "{anchor}");
        assert_eq!(total(&data.hours, |h| h.seconds), data.total, "{anchor}");
    }
}

#[test]
fn leap_year_has_twelve_buckets_and_accurate_schedule() {
    let range = StatisticsRange::new(StatisticsPeriod::Year, date("2028-07-01T12:00:00Z"), &cal());
    let data = analyze(&[], range.interval());
    assert_eq!(data.buckets.len(), 12);
    assert_eq!(data.buckets[1].interval().duration(), 29.0 * 86400.0);
    let original = ActivityStatistics::calculate(&[], &range, &WorkTargets::default(), &cal());
    assert_eq!(data.target, original.target_seconds());
}

#[test]
fn context_switches_respect_zoom_and_excluded_overlap() {
    let logs = vec![
        ticket_log("a", "2026-10-02T07:00:00Z", 3600.0, 1),
        ticket_log("b", "2026-10-02T08:00:00Z", 3600.0, 2),
        ticket_log("c", "2026-10-02T09:00:00Z", 3600.0, 3),
    ];
    assert_eq!(analyze(&logs, default_window()).context.switches(), 2);
    let zoomed = analyze(&logs, window("2026-10-02T08:30:00Z", "2026-10-02T09:30:00Z"));
    assert_eq!(zoomed.context.switches(), 1);
    let mut overlapping = logs;
    overlapping.push(ticket_log("d", "2026-10-02T07:30:00Z", 7200.0, 4));
    assert_eq!(analyze(&overlapping, default_window()).context.switches(), 0);
}

#[test]
fn cross_year_week_keeps_context_from_both_years() {
    let logs = [
        ticket_log("a", "2025-12-31T09:00:00Z", 3600.0, 1),
        ticket_log("b", "2025-12-31T10:00:00Z", 3600.0, 2),
        ticket_log("c", "2026-01-01T09:00:00Z", 3600.0, 1),
        ticket_log("d", "2026-01-01T10:00:00Z", 3600.0, 2),
    ];
    let data = analyze(&logs, window("2025-12-29T00:00:00Z", "2026-01-04T23:00:00Z"));
    assert_eq!(data.context.switches(), 2);
}

// Additional coverage beyond the Swift suite.

#[test]
fn ticket_free_task_keys_are_length_prefixed_and_titles_fall_back() {
    let meeting = ActivityType::new("meet", "Meeting");
    let logs = [
        WorkLog {
            activity_type: Some(meeting.clone()),
            comment: Some("Sync".into()),
            ..log("a", "2026-10-02T07:00:00Z", 900.0)
        },
        WorkLog {
            activity_type: Some(meeting),
            comment: Some("  ".into()),
            ..log("b", "2026-10-02T08:00:00Z", 900.0)
        },
        ticket_log("c", "2026-10-02T09:00:00Z", 1800.0, 42),
    ];
    let dataset = ExplorerDataset::new(&logs, &cal());
    let keys: Vec<_> = dataset.records.iter().map(|r| r.task_id.as_str()).collect();
    assert_eq!(keys, ["free:13:activity:meetSync", "free:13:activity:meet", "ticket:42"]);
    let data = dataset.analyze(default_window(), &ExplorerOptions::default(), &cal(), now());
    let titles: Vec<_> = data.tasks.iter().map(|t| t.title.as_str()).collect();
    assert_eq!(titles, ["Azure ticket #42", "Meeting", "Sync"]);
    assert_eq!(
        data.weekdays.iter().map(|p| p.label.as_str()).collect::<Vec<_>>(),
        ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    );
    assert_eq!(data.weekdays[4].seconds, 3600.0);
    assert_eq!(data.hours[9].label, "09:00");
}

#[test]
fn buckets_stack_activities_by_id_and_unknown_billable_stays_distinct_from_zero() {
    let logs = [
        WorkLog {
            activity_type: Some(ActivityType::new("b", "Beta")),
            billable_length: Some(0.0),
            ..log("x", "2026-10-02T07:00:00Z", 600.0)
        },
        WorkLog {
            activity_type: Some(ActivityType::new("a", "Alpha")),
            ..log("y", "2026-10-02T07:05:00Z", 600.0)
        },
    ];
    let data = analyze(&logs, window("2026-10-02T07:00:00Z", "2026-10-02T07:15:00Z"));
    let ids = |index: usize| -> Vec<String> {
        data.buckets[index].segments.iter().map(|s| s.activity_id.clone()).collect()
    };
    assert_eq!(ids(0), ["activity:b"]);
    assert_eq!(ids(1), ["activity:a", "activity:b"]);
    assert_eq!(ids(2), ["activity:a"]);
    let middle = &data.buckets[1].segments;
    assert_eq!(
        (middle[0].bottom, middle[0].top, middle[1].bottom, middle[1].top),
        (0.0, 300.0, 300.0, 600.0)
    );
    assert_eq!(middle[0].name, "Alpha");
    assert_eq!(data.billable, 0.0);
    assert_eq!(data.billable_known_count, 1);
}

#[test]
fn entries_sort_ties_by_swift_entry_id() {
    // Both clipped to the window start; "a:…" sorts after "a1:…" because ':' > '1'.
    let logs =
        [log("a", "2026-10-02T06:00:00Z", 7200.0), log("a1", "2026-10-02T06:30:00Z", 7200.0)];
    let data = analyze(&logs, default_window());
    let ids: Vec<_> = data.entries.iter().map(|e| e.id()).collect();
    assert_eq!(ids, ["a1:1790924400.0", "a:1790924400.0"]);
}

/// About 5,000 worklogs over a year, with overnight and overlapping entries.
fn synthetic_year() -> Vec<WorkLog> {
    let activities = [
        ActivityType::new("dev", "Development"),
        ActivityType::new("meet", "Meeting"),
        ActivityType::new("review", "Review"),
    ];
    let start = date("2026-01-01T07:00:00Z");
    let mut logs = Vec::new();
    for day in 0..365 {
        for slot in 0..14 {
            let index = day * 14 + slot;
            let at = add_secs(start, (day * 86_400 + slot * 2_700) as f64);
            logs.push(WorkLog {
                work_item_id: (index % 5 != 0).then_some(30_000 + (index % 40) as i64),
                comment: Some(format!("Task note {}", index % 17)),
                activity_type: Some(activities[index % 3].clone()),
                billable_length: (index % 4 != 0).then_some(1_800.0),
                ..WorkLog::new(
                    format!("log-{index}"),
                    wire_date::utc_string(at),
                    900.0 + (index % 7) as f64 * 600.0,
                )
            });
        }
    }
    logs
}

#[test]
fn full_year_analysis_is_fast() {
    let logs = synthetic_year();
    assert!(logs.len() >= 5_000);
    let started = Instant::now();
    let dataset = ExplorerDataset::new(&logs, &cal());
    let year = StatisticsRange::new(StatisticsPeriod::Year, date("2026-06-01T12:00:00Z"), &cal());
    let options = ExplorerOptions { targets: WorkTargets::default(), ..ExplorerOptions::default() };
    let data = dataset.analyze(year.interval(), &options, &cal(), date("2026-12-31T23:00:00Z"));
    let visuals =
        ExplorerVisuals::new(&data, &options.targets, &cal(), date("2026-12-31T23:00:00Z"));
    let search = ExplorerOptions {
        filter: ExplorerFilter { query: "note 3".into(), ..ExplorerFilter::default() },
        ..ExplorerOptions::default()
    };
    let searched = dataset.analyze(year.interval(), &search, &cal(), date("2026-12-31T23:00:00Z"));
    let elapsed = started.elapsed();
    assert!(elapsed.as_secs_f64() < 2.0, "full-year analysis took {elapsed:?}");
    assert_eq!(data.count as usize, dataset.records.len());
    assert_eq!(visuals.days.len(), 365);
    assert_eq!(total(&data.buckets, |b| b.seconds()), data.total);
    assert_eq!(total(&visuals.days, |d| d.seconds), data.total);
    assert!(searched.count > 0 && searched.count < data.count);
}
