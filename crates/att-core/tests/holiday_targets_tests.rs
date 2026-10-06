//! Port of HolidayTargetsTests.swift.

#[path = "support/insights.rs"]
mod support;

use att_core::Interval;
use att_core::holidays::{BelgianHoliday, TargetException, TargetExceptionKind};
use att_core::targets::{TargetProgress, WorkTargets};
use att_core::time::{add_secs, wire_date};
use jiff::Timestamp;
use support::cal;

/// Swift `date(_:)`: noon in Brussels summer time on a `yyyy-MM-dd` date.
fn date(text: &str) -> Timestamp {
    wire_date::parse(&format!("{text}T12:00:00+02:00"), None).expect("date")
}

fn exception(text: &str, kind: TargetExceptionKind, hours: f64, note: &str) -> TargetException {
    TargetException::new(cal().date(date(text)), kind, hours, note)
}

fn keys(year: i64) -> Vec<String> {
    BelgianHoliday::all(year).iter().map(|h| TargetException::date_key(h.date)).collect()
}

#[test]
fn belgian_dates_2026_and_2027() {
    assert_eq!(
        keys(2026),
        [
            "2026-01-01",
            "2026-04-06",
            "2026-05-01",
            "2026-05-14",
            "2026-05-25",
            "2026-07-21",
            "2026-08-15",
            "2026-11-01",
            "2026-11-11",
            "2026-12-25"
        ]
    );
    let next = keys(2027);
    assert!(next.contains(&"2027-03-29".to_string()));
    assert!(next.contains(&"2027-05-06".to_string()));
    assert!(next.contains(&"2027-05-17".to_string()));
    assert_eq!(next.len(), 10);
}

#[test]
fn holidays_reduce_week_and_do_not_invent_replacement_dates() {
    let targets = WorkTargets::default();
    let week = TargetProgress::week_interval(date("2026-07-21"), &cal());
    assert_eq!(targets.daily_seconds(date("2026-07-21"), &cal()), 0.0);
    assert_eq!(targets.seconds_in(week, &cal()), 4.0 * 7.6 * 3600.0);
    assert_eq!(targets.daily_seconds(date("2026-08-17"), &cal()), 7.6 * 3600.0);
}

#[test]
fn half_day_custom_and_replacement_priority() {
    let mut targets = WorkTargets::default();
    targets.set_hours(8.0, 2);
    targets.set_hours(6.0, 6);
    targets.set_exceptions(vec![
        exception("2026-09-28", TargetExceptionKind::HalfDay, 0.0, ""),
        exception("2026-10-02", TargetExceptionKind::HalfDay, 0.0, ""),
        exception("2026-07-21", TargetExceptionKind::Custom, 2.0, ""),
        exception("2026-08-17", TargetExceptionKind::Replacement, 0.0, ""),
    ]);
    assert_eq!(targets.daily_seconds(date("2026-09-28"), &cal()), 4.0 * 3600.0);
    assert_eq!(targets.daily_seconds(date("2026-10-02"), &cal()), 3.0 * 3600.0);
    assert_eq!(targets.daily_seconds(date("2026-07-21"), &cal()), 2.0 * 3600.0);
    assert_eq!(targets.daily_seconds(date("2026-08-17"), &cal()), 0.0);
}

#[test]
fn old_configuration_decodes_and_exceptions_round_trip() {
    let mut targets: WorkTargets =
        serde_json::from_str(r#"{"weeklyHours":38,"dailyHours":7.6}"#).expect("legacy");
    assert!(
        targets.is_valid() && targets.uses_belgian_holidays() && targets.exceptions().is_empty()
    );
    targets.set_exceptions(vec![exception("2026-12-24", TargetExceptionKind::Leave, 0.0, "Leave")]);
    let json = serde_json::to_string(&targets).expect("encode");
    assert_eq!(serde_json::from_str::<WorkTargets>(&json).expect("decode"), targets);
    targets.set_uses_belgian_holidays(false);
    assert_eq!(targets.daily_seconds(date("2026-07-21"), &cal()), 27360.0);
}

#[test]
fn invalid_hours_dates_and_duplicates_rejected() {
    let mut targets = WorkTargets::default();
    let mut item = exception("2026-10-02", TargetExceptionKind::Custom, 25.0, "");
    targets.set_exceptions(vec![item.clone()]);
    assert!(!targets.is_valid());
    item.hours = 2.0;
    item.id = "2026-02-30".into();
    targets.set_exceptions(vec![item.clone()]);
    assert!(!targets.is_valid());
    item.id = "2026-10-02".into();
    targets.set_exceptions(vec![item.clone(), item]);
    assert!(!targets.is_valid());
}

#[test]
fn dst_civil_dates_and_partial_day_totals() {
    let mut targets = WorkTargets::default();
    targets.set_hours(8.0, 1);
    let day = cal().day_interval(date("2026-03-29"));
    assert_eq!(day.duration(), 23.0 * 3600.0);
    assert_eq!(targets.seconds_in(day, &cal()), 8.0 * 3600.0);
    let half = Interval::new(day.start, add_secs(day.start, day.duration() / 2.0));
    assert_eq!(targets.seconds_in(half, &cal()), 4.0 * 3600.0);
    assert_eq!(TargetException::key(day.end, &cal()), "2026-03-30");
}

// Additional coverage beyond the Swift suite.

#[test]
fn computus_edges_and_shared_dates() {
    // Easter on 22 March (1818) and 25 April (1943), the computus extremes.
    assert!(keys(1818).contains(&"1818-03-23".to_string()));
    assert!(keys(1943).contains(&"1943-04-26".to_string()));
    // Easter 2008 was 23 March, so Ascension fell on Labour Day; the fixed holiday comes first.
    let shared: Vec<_> = BelgianHoliday::all(2008)
        .into_iter()
        .filter(|h| TargetException::date_key(h.date) == "2008-05-01")
        .map(|h| h.name)
        .collect();
    assert_eq!(shared, ["Labour Day", "Ascension Day"]);
    assert!(BelgianHoliday::all(1582).is_empty());
    assert!(BelgianHoliday::all(10_000).is_empty());
    assert_eq!(BelgianHoliday::all(9999).len(), 10);
}

#[test]
fn reasons_name_exceptions_with_notes_and_holidays() {
    let mut targets = WorkTargets::default();
    targets.exceptions_mut().push(exception(
        "2026-12-24",
        TargetExceptionKind::Leave,
        0.0,
        "Family",
    ));
    targets.exceptions_mut().push(exception("2026-12-31", TargetExceptionKind::HalfDay, 0.0, ""));
    assert_eq!(
        targets.reason(date("2026-12-24"), &cal()).as_deref(),
        Some("Full-day leave · Family")
    );
    assert_eq!(targets.reason(date("2026-12-31"), &cal()).as_deref(), Some("Half-day leave"));
    assert_eq!(targets.reason(date("2026-12-25"), &cal()).as_deref(), Some("Christmas Day"));
    assert_eq!(targets.reason(date("2026-11-01"), &cal()).as_deref(), Some("All Saints’ Day"));
    assert_eq!(targets.reason(date("2026-12-28"), &cal()), None);
    targets.set_uses_belgian_holidays(false);
    assert_eq!(targets.reason(date("2026-12-25"), &cal()), None);
}

#[test]
fn exception_keys_are_canonical_dates() {
    let valid = |id: &str| {
        TargetException {
            id: id.into(),
            kind: TargetExceptionKind::Leave,
            hours: 0.0,
            note: String::new(),
        }
        .is_valid()
    };
    assert!(valid("2024-02-29") && valid("0001-01-01") && valid("2026-10-02"));
    for id in [
        "2026-1-2",
        "0000-01-01",
        "12026-01-01",
        " 2026-01-01",
        "2026-01-01 ",
        "+2026-01-01",
        "2025-02-29",
        "2026-13-01",
        "2026-12-32",
        "2026/12/01",
    ] {
        assert!(!valid(id), "{id}");
    }
    let kinds: Vec<_> = TargetExceptionKind::ALL.iter().map(|k| k.raw()).collect();
    assert_eq!(kinds, ["Full-day leave", "Half-day leave", "Replacement holiday", "Custom target"]);
    assert_eq!(
        serde_json::to_value(TargetExceptionKind::Replacement).expect("encode"),
        "Replacement holiday"
    );
}
