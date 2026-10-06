//! Port of ExplorerVisualsTests.swift.

#[path = "support/insights.rs"]
mod support;

use std::collections::HashSet;

use att_core::Interval;
use att_core::explorer::{ExplorerAnalysis, ExplorerDataset, ExplorerFilter, ExplorerOptions};
use att_core::explorer_visuals::ExplorerVisuals;
use att_core::model::WorkLog;
use att_core::statistics::{StatisticsPeriod, StatisticsRange};
use att_core::targets::WorkTargets;
use att_core::time::{diff_secs, wire_date};
use support::{cal, date, log, ticket_log};

fn visuals_with(
    logs: &[WorkLog],
    period: StatisticsPeriod,
    anchor: &str,
    filter: ExplorerFilter,
    now: &str,
) -> (ExplorerAnalysis, ExplorerVisuals) {
    let range = StatisticsRange::new(period, date(anchor), &cal());
    let options = ExplorerOptions { filter, ..ExplorerOptions::default() };
    let analysis =
        ExplorerDataset::new(logs, &cal()).analyze(range.interval(), &options, &cal(), date(now));
    let visuals = ExplorerVisuals::new(&analysis, &WorkTargets::default(), &cal(), date(now));
    (analysis, visuals)
}

fn visuals(
    logs: &[WorkLog],
    period: StatisticsPeriod,
    anchor: &str,
) -> (ExplorerAnalysis, ExplorerVisuals) {
    visuals_with(logs, period, anchor, ExplorerFilter::default(), "2026-10-02T16:00:00Z")
}

fn week(logs: &[WorkLog]) -> (ExplorerAnalysis, ExplorerVisuals) {
    visuals(logs, StatisticsPeriod::Week, "2026-10-02T12:00:00Z")
}

fn total<T>(items: &[T], seconds: impl Fn(&T) -> f64) -> f64 {
    items.iter().fold(0.0, |sum, item| sum + seconds(item))
}

#[test]
fn day_heatmap_keeps_empty_days_and_midnight_clipping() {
    let (analysis, charts) = week(&[log("overnight", "2026-10-01T21:30:00Z", 7200.0)]);
    assert_eq!(charts.days.len(), 7);
    assert_eq!(charts.days.iter().map(|d| d.weekday).collect::<Vec<_>>(), [0, 1, 2, 3, 4, 5, 6]);
    assert_eq!(charts.days[3].seconds, 1800.0);
    assert_eq!(charts.days[4].seconds, 5400.0);
    assert!(charts.days[5].future);
    assert_eq!(total(&charts.days, |d| d.seconds), analysis.total);
    assert_eq!(total(&charts.hours, |h| h.seconds), analysis.total);
    assert_eq!(charts.progress.last().map(|p| p.seconds), Some(analysis.total));
}

#[test]
fn leap_year_calendar_has_every_date_and_correct_columns() {
    let (_, charts) = visuals(&[], StatisticsPeriod::Year, "2028-07-01T12:00:00Z");
    assert_eq!(charts.days.len(), 366);
    assert_eq!(charts.week_count, 53);
    assert_eq!(charts.days[0].weekday, 5); // Saturday 1 January
    assert_eq!(charts.days[59].date, date("2028-02-28T23:00:00Z"));
    assert!(charts.hours.is_empty());
    assert!(charts.days.iter().all(|d| d.week >= 0 && d.week < charts.week_count));
}

#[test]
fn filtered_heatmap_and_progress_match_the_selected_task() {
    let logs = [
        ticket_log("a", "2026-10-01T07:00:00Z", 3600.0, 1),
        ticket_log("b", "2026-10-01T09:00:00Z", 7200.0, 2),
    ];
    let filter = ExplorerFilter { task_id: Some("ticket:1".into()), ..ExplorerFilter::default() };
    let (analysis, charts) = visuals_with(
        &logs,
        StatisticsPeriod::Week,
        "2026-10-02T12:00:00Z",
        filter,
        "2026-10-02T16:00:00Z",
    );
    assert_eq!(total(&charts.days, |d| d.seconds), 3600.0);
    assert_eq!(total(&charts.hours, |h| h.seconds), analysis.total);
    assert_eq!(charts.progress.last().map(|p| p.seconds), Some(3600.0));
    assert_eq!(charts.days.iter().map(|d| d.entries).sum::<i64>(), 1);
}

#[test]
fn daylight_saving_hours_stay_separate_without_losing_time() {
    for (anchor, count) in [("2026-10-25T12:00:00Z", 25), ("2026-03-29T12:00:00Z", 23)] {
        let range = StatisticsRange::new(StatisticsPeriod::Day, date(anchor), &cal());
        let all_day = log(
            "all-day",
            &wire_date::local_string(range.start, cal().tz()),
            diff_secs(range.end, range.start),
        );
        let (analysis, charts) = visuals_with(
            &[all_day],
            StatisticsPeriod::Day,
            anchor,
            ExplorerFilter::default(),
            "2026-12-31T12:00:00Z",
        );
        assert_eq!(charts.hours.len(), count, "{anchor}");
        assert_eq!(
            charts.hours.iter().map(|h| h.slot).collect::<Vec<_>>(),
            (0..count as i64).collect::<Vec<_>>(),
            "{anchor}"
        );
        let ids: HashSet<_> = charts.hours.iter().map(|h| h.interval.start).collect();
        assert_eq!(ids.len(), count, "{anchor}");
        assert_eq!(total(&charts.hours, |h| h.seconds), analysis.total, "{anchor}");
    }
}

#[test]
fn zoomed_partial_days_keep_hour_positions_and_exact_durations() {
    let window = Interval::new(date("2026-10-01T10:30:00Z"), date("2026-10-02T08:15:00Z"));
    let span = log("span", &wire_date::local_string(window.start, cal().tz()), window.duration());
    // Swift used the system clock as `now`; any instant gives the same grid.
    let now = date("2026-10-06T12:00:00Z");
    let analysis = ExplorerDataset::new(&[span], &cal()).analyze(
        window,
        &ExplorerOptions::default(),
        &cal(),
        now,
    );
    let charts = ExplorerVisuals::new(&analysis, &WorkTargets::default(), &cal(), now);
    assert_eq!(charts.hours.first().map(|h| h.slot), Some(12));
    assert_eq!(charts.hours.first().map(|h| h.seconds), Some(1800.0));
    assert_eq!(charts.hours.last().map(|h| h.seconds), Some(900.0));
    assert_eq!(charts.hours.iter().find(|h| h.day == charts.days[1].date).map(|h| h.slot), Some(0));
    assert_eq!(total(&charts.hours, |h| h.seconds), analysis.total);
}

#[test]
fn current_monthly_bucket_retains_recorded_time_before_month_ends() {
    let (analysis, charts) = visuals(
        &[log("october", "2026-10-01T07:00:00Z", 3600.0)],
        StatisticsPeriod::Year,
        "2026-10-02T12:00:00Z",
    );
    let last = charts.progress.last().expect("progress");
    assert_eq!(last.date, date("2026-10-02T16:00:00Z"));
    assert_eq!(last.seconds, analysis.total);
    assert_eq!(last.seconds, 3600.0);
    let target = charts.target_progress.last().expect("target progress");
    assert_eq!(target.date, analysis.window.end);
    assert_eq!(target.target, analysis.target);
}

#[test]
fn empty_and_future_windows_do_not_project_recorded_time() {
    let (_, charts) = visuals(&[], StatisticsPeriod::Month, "2026-12-15T12:00:00Z");
    assert_eq!(charts.progress.len(), 1);
    assert_eq!(charts.progress[0].seconds, 0.0);
    assert!(charts.days.iter().all(|d| d.future && d.seconds == 0.0));
    assert!(charts.target_progress.last().expect("target progress").target > 0.0);
}

#[test]
fn existing_overlaps_remain_visible_in_heatmap_totals() {
    let logs = [log("a", "2026-10-01T07:00:00Z", 3600.0), log("b", "2026-10-01T07:30:00Z", 3600.0)];
    let (analysis, charts) = visuals(&logs, StatisticsPeriod::Day, "2026-10-01T12:00:00Z");
    assert_eq!(analysis.overlap(), 1800.0);
    assert_eq!(charts.hours.iter().find(|h| h.slot == 9).map(|h| h.seconds), Some(5400.0));
    assert_eq!(charts.days[0].seconds, 7200.0);
    assert_eq!(analysis.entries.len(), 2);
}

// Additional coverage beyond the Swift suite.

#[test]
fn heatmap_targets_follow_the_schedule_and_holidays() {
    // Week of Belgian National Day (Tuesday 21 July 2026).
    let (analysis, charts) = visuals(&[], StatisticsPeriod::Week, "2026-07-21T12:00:00Z");
    let targets: Vec<_> = charts.days.iter().map(|d| d.target).collect();
    assert_eq!(targets, [27360.0, 0.0, 27360.0, 27360.0, 27360.0, 0.0, 0.0]);
    assert_eq!(charts.target_progress.len(), 8);
    assert_eq!(charts.target_progress.last().map(|p| p.target), Some(analysis.target));
    assert_eq!(analysis.target, 4.0 * 27360.0);
}
