//! Port of StatisticsTests.swift.

#[path = "support/insights.rs"]
mod support;

use att_core::model::{ActivityType, WorkLog};
use att_core::statistics::{ActivityStatistics, StatisticsPeriod, StatisticsRange};
use att_core::targets::WorkTargets;
use att_core::time::diff_secs;
use support::{cal, date};

fn range(period: StatisticsPeriod, anchor: &str) -> StatisticsRange {
    StatisticsRange::new(period, date(anchor), &cal())
}

fn week() -> StatisticsRange {
    range(StatisticsPeriod::Week, "2026-09-30T10:00:00Z")
}

fn log(
    id: &str,
    timestamp: &str,
    hours: f64,
    ticket: Option<i64>,
    activity: Option<ActivityType>,
) -> WorkLog {
    WorkLog {
        work_item_id: ticket,
        activity_type: activity,
        ..WorkLog::new(id, timestamp, hours * 3600.0)
    }
}

fn hours(id: &str, hours: f64) -> WorkLog {
    log(id, "2026-09-30T10:00:00Z", hours, None, None)
}

fn calculate_weekly(logs: &[WorkLog], range: &StatisticsRange, weekly: f64) -> ActivityStatistics {
    let targets =
        WorkTargets { weekly_hours: weekly, daily_hours: weekly / 5.0, ..WorkTargets::default() };
    ActivityStatistics::calculate(logs, range, &targets, &cal())
}

fn calculate(logs: &[WorkLog], range: &StatisticsRange) -> ActivityStatistics {
    calculate_weekly(logs, range, 38.0)
}

#[test]
fn week_starts_on_monday_and_handles_year_boundary() {
    let r = range(StatisticsPeriod::Week, "2027-01-01T10:00:00Z");
    assert_eq!(r.start, date("2026-12-27T23:00:00Z"));
    assert_eq!(r.end, date("2027-01-03T23:00:00Z"));
    assert_eq!(r.shifted(1, &cal()).start, r.end);
    assert_eq!(r.shifted(-1, &cal()).end, r.start);
}

#[test]
fn month_navigation_preserves_calendar_months_and_leap_day() {
    let march = range(StatisticsPeriod::Month, "2028-03-31T10:00:00Z");
    let february = march.shifted(-1, &cal());
    assert_eq!(february.start, date("2028-01-31T23:00:00Z"));
    assert_eq!(february.end, date("2028-02-29T23:00:00Z"));
    assert_eq!(calculate(&[], &february).days.len(), 29);
    assert_eq!(february.shifted(1, &cal()), march);
}

#[test]
fn daylight_saving_days_use_calendar_arithmetic() {
    let autumn = calculate(&[], &range(StatisticsPeriod::Week, "2026-10-25T12:00:00Z"));
    assert_eq!(diff_secs(autumn.range.end, autumn.range.start), 169.0 * 3600.0);
    assert_eq!(autumn.days.len(), 7);
    assert_eq!(autumn.target_seconds(), 38.0 * 3600.0);
    let spring = calculate(&[], &range(StatisticsPeriod::Week, "2026-03-29T12:00:00Z"));
    assert_eq!(diff_secs(spring.range.end, spring.range.start), 167.0 * 3600.0);
    assert_eq!(spring.days.len(), 7);
}

#[test]
fn month_targets_use_weekdays_rather_than_four_weeks() {
    let month = range(StatisticsPeriod::Month, "2026-09-30T10:00:00Z");
    let result = calculate(&[], &month);
    assert_eq!(result.days.len(), 30);
    assert_eq!(result.days.iter().filter(|d| d.target_seconds > 0.0).count(), 22);
    assert!((result.target_seconds() / 3600.0 - 167.2).abs() < 0.0001);
    assert_eq!(calculate_weekly(&[], &month, 40.0).target_seconds(), 176.0 * 3600.0);
}

#[test]
fn missing_days_are_zero_and_averages_only_use_tracked_days() {
    let result =
        calculate(&[hours("a", 2.0), log("b", "2026-10-01T09:00:00Z", 4.0, None, None)], &week());
    assert_eq!(result.days.len(), 7);
    assert_eq!(result.days.iter().filter(|d| d.seconds == 0.0).count(), 5);
    assert_eq!(result.total_seconds(), 6.0 * 3600.0);
    assert_eq!(result.average_seconds(), 3.0 * 3600.0);
    assert_eq!(result.sessions(), 2);
    assert_eq!(result.days.last().map(|d| d.cumulative_seconds), Some(result.total_seconds()));
}

#[test]
fn exclusive_end_and_duplicate_ids_never_double_count() {
    let logs = [
        log("first", "2026-09-27T22:00:00Z", 2.0, None, None),
        log("first", "2026-09-27T22:00:00Z", 2.0, None, None),
        log("before", "2026-09-27T21:59:59Z", 1.0, None, None),
        log("end", "2026-10-04T22:00:00Z", 1.0, None, None),
    ];
    let result = calculate(&logs, &week());
    assert_eq!(result.total_seconds(), 7200.0);
    assert_eq!(result.sessions(), 1);
    assert_eq!(result.days[0].seconds, 7200.0);
}

#[test]
fn ticket_free_standups_and_unknown_activities_are_retained() {
    let standup = ActivityType::new("standup", "Standup");
    let development = ActivityType::new("dev", "Development");
    let at = "2026-09-30T10:00:00Z";
    let result = calculate(
        &[
            log("a", at, 0.25, None, Some(standup)),
            log("b", at, 2.0, Some(33984), Some(development.clone())),
            log("c", at, 1.0, Some(0), None),
            log("d", at, 1.0, Some(33984), Some(development)),
        ],
        &week(),
    );
    assert_eq!(result.activities[0].name, "Development");
    assert_eq!(result.activities[0].seconds, 10800.0);
    assert!(result.activities.iter().any(|a| a.name == "Standup" && a.seconds == 900.0));
    assert!(result.activities.iter().any(|a| a.name == "Unspecified activity"));
    assert_eq!(result.tickets[0].id(), "33984");
    assert_eq!(result.tickets[0].sessions, 2);
    let last = result.tickets.last().expect("tickets");
    assert_eq!(last.ticket_id, None);
    assert_eq!(last.seconds, 1.25 * 3600.0);
    assert_eq!(result.activities.iter().fold(0.0, |t, a| t + a.seconds), result.total_seconds());
    assert_eq!(result.tickets.iter().fold(0.0, |t, a| t + a.seconds), result.total_seconds());
}

#[test]
fn activity_ids_remain_distinct_when_names_match() {
    let at = "2026-09-30T10:00:00Z";
    let result = calculate(
        &[
            log("a", at, 1.0, None, Some(ActivityType::new("one", "Meeting"))),
            log("b", at, 1.0, None, Some(ActivityType::new("two", "Meeting"))),
        ],
        &week(),
    );
    assert_eq!(result.activities.len(), 2);
    assert_ne!(result.activities[0].id, result.activities[1].id);
}

#[test]
fn invalid_values_are_omitted_without_poisoning_totals() {
    let result = calculate(
        &[
            log("invalid-date", "unknown", 1.0, None, None),
            hours("negative", -1.0),
            hours("infinity", f64::INFINITY),
            hours("nan", f64::NAN),
            hours("valid", 2.0),
            hours("zero", 0.0),
        ],
        &week(),
    );
    assert_eq!(result.omitted_logs, 4);
    assert_eq!(result.total_seconds(), 7200.0);
    assert_eq!(result.sessions(), 2);
    assert_eq!(result.tracked_days(), 1);
}

#[test]
fn weekends_count_as_work_but_never_add_target_hours() {
    let result = calculate(&[log("weekend", "2026-10-03T10:00:00Z", 40.0, None, None)], &week());
    assert_eq!(result.days[5].seconds, 40.0 * 3600.0);
    assert_eq!(result.days[5].target_seconds, 0.0);
    assert_eq!(result.days[4].cumulative_target, result.days[6].cumulative_target);
    assert!(result.target_fraction() > 1.0);
    let empty = calculate(&[], &week());
    assert!(
        empty.average_seconds() == 0.0 && empty.target_fraction() == 0.0 && empty.sessions() == 0
    );
}

// Additional coverage beyond the Swift suite.

#[test]
fn ranges_cover_each_period_and_serialize_period_names() {
    let anchor = "2026-10-25T12:00:00Z";
    let day = range(StatisticsPeriod::Day, anchor);
    assert_eq!(diff_secs(day.end, day.start), 25.0 * 3600.0);
    let year = range(StatisticsPeriod::Year, anchor);
    assert_eq!(year.start, date("2025-12-31T23:00:00Z"));
    assert_eq!(year.shifted(1, &cal()).start, year.end);
    assert_eq!(day.shifted(-1, &cal()).end, day.start);
    let labels: Vec<_> = StatisticsPeriod::ALL.iter().map(|p| p.label()).collect();
    assert_eq!(labels, ["Day", "Week", "Month", "Year"]);
    // The wire form is camelCase like the rest of the UI contract; labels keep the Swift names.
    assert_eq!(serde_json::to_value(StatisticsPeriod::Month).unwrap(), "month");
}

#[test]
fn unnamed_activities_take_a_later_name_and_ties_sort_by_id() {
    let at = "2026-09-30T10:00:00Z";
    let unnamed = ActivityType { id: "x".into(), name: None, color: None };
    let result = calculate(
        &[
            log("a", at, 1.0, Some(20), Some(unnamed)),
            log("b", at, 1.0, Some(100), Some(ActivityType::new("x", "Design"))),
        ],
        &week(),
    );
    assert_eq!(result.activities.len(), 1);
    assert_eq!(result.activities[0].name, "Design");
    // Equal seconds: IDs compare as text, so "100" sorts before "20".
    let ids: Vec<_> = result.tickets.iter().map(|t| t.id()).collect();
    assert_eq!(ids, ["100", "20"]);
}

#[test]
fn invalid_targets_contribute_no_target() {
    let targets = WorkTargets { daily_hours: 25.0, ..WorkTargets::default() };
    let result = ActivityStatistics::calculate(&[], &week(), &targets, &cal());
    assert_eq!(result.target_seconds(), 0.0);
}
