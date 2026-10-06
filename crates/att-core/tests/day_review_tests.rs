//! Port of DayReviewTests.swift, plus decode tests for the JSON Swift 1.14.x persisted.

#[path = "support/insights.rs"]
mod support;

use std::collections::BTreeMap;

use att_core::day_review::{
    DayReviewPreferences, DayReviewRecord, DayReviewSchedule, DayReviewSummary,
};
use att_core::model::{TrackingState, WorkLog};
use att_core::time::add_secs;
use jiff::Timestamp;
use serde::Deserialize;
use support::{cal, date, state_with, ticket_log};

/// Thursday 1 October 2026, 17:15 in Brussels.
fn now() -> Timestamp {
    date("2026-10-01T15:15:00Z")
}

fn review_log(id: &str, start: &str, hours: f64) -> WorkLog {
    ticket_log(id, start, hours * 3600.0, 33984)
}

fn summary_with(
    logs: &[WorkLog],
    state: Option<&TrackingState>,
    confirmed: bool,
    sync: Option<Timestamp>,
) -> DayReviewSummary {
    DayReviewSummary::calculate(
        logs,
        now(),
        now(),
        &DayReviewPreferences::default(),
        state,
        Some(sync.unwrap_or_else(now)),
        confirmed,
        &cal(),
    )
}

fn summary(logs: &[WorkLog]) -> DayReviewSummary {
    summary_with(logs, None, true, None)
}

fn is_due(at: &str, preferences: &DayReviewPreferences, record: Option<&DayReviewRecord>) -> bool {
    DayReviewSchedule::is_due(date(at), preferences, record, &cal())
}

#[test]
fn default_reminder_fires_at_local_finish_time_and_only_on_selected_days() {
    let prefs = DayReviewPreferences::default();
    assert!(prefs.is_valid());
    assert!(!is_due("2026-10-01T14:59:59Z", &prefs, None));
    assert!(is_due("2026-10-01T15:00:00Z", &prefs, None));
    assert!(is_due("2026-10-01T20:00:00Z", &prefs, None));
    assert!(!is_due("2026-10-03T15:00:00Z", &prefs, None));
    let off = DayReviewPreferences { enabled: false, ..prefs };
    assert!(!DayReviewSchedule::is_due(now(), &off, None, &cal()));
}

#[test]
fn prompt_snooze_and_completion_survive_round_trip() {
    let prefs = DayReviewPreferences::default();
    let due = |at: Timestamp, record: &DayReviewRecord| {
        DayReviewSchedule::is_due(at, &prefs, Some(record), &cal())
    };
    let mut record = DayReviewRecord { prompted_at: Some(now()), ..DayReviewRecord::default() };
    assert!(!due(now(), &record));
    assert!(DayReviewSchedule::is_pending(now(), Some(&record)));
    record.snoozed_until = Some(add_secs(now(), 1800.0));
    let json = serde_json::to_string(&record).expect("encode");
    record = serde_json::from_str(&json).expect("decode");
    assert!(!DayReviewSchedule::is_pending(now(), Some(&record)));
    assert!(!due(add_secs(now(), 1799.0), &record));
    assert!(due(add_secs(now(), 1800.0), &record));
    record.reviewed_at = Some(now());
    assert!(!DayReviewSchedule::is_pending(add_secs(now(), 1900.0), Some(&record)));
    assert!(!due(add_secs(now(), 1900.0), &record));
}

#[test]
fn explicit_morning_snooze_does_not_wait_until_evening() {
    let morning = date("2026-10-01T08:00:00Z");
    let record = DayReviewRecord {
        prompted_at: Some(morning),
        snoozed_until: Some(add_secs(morning, 1800.0)),
        reviewed_at: None,
    };
    let prefs = DayReviewPreferences::default();
    assert!(DayReviewSchedule::is_due(add_secs(morning, 1800.0), &prefs, Some(&record), &cal()));
}

#[test]
fn review_keys_isolate_workspaces_and_local_days() {
    let first = DayReviewSchedule::key("one", now(), &cal());
    assert_eq!(first, DayReviewSchedule::key("one", date("2026-10-01T21:59:59Z"), &cal()));
    assert_ne!(first, DayReviewSchedule::key("one", date("2026-10-01T22:00:00Z"), &cal()));
    assert_ne!(first, DayReviewSchedule::key("two", now(), &cal()));
}

/// Adapted: `Configuration` is assembled by another module, so a stand-in with the same
/// optional `endOfDayReview` field checks that settings without the key keep the defaults.
#[test]
fn invalid_preferences_are_rejected_and_old_configuration_keeps_defaults() {
    let mut prefs = DayReviewPreferences::default();
    prefs.finish_minute = prefs.start_minute;
    assert!(!prefs.is_valid());
    let prefs = DayReviewPreferences { weekdays: vec![], ..DayReviewPreferences::default() };
    assert!(!prefs.is_valid());
    let prefs = DayReviewPreferences { gap_minutes: 0, ..DayReviewPreferences::default() };
    assert!(!prefs.is_valid());

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct OldConfiguration {
        #[serde(default)]
        end_of_day_review: Option<DayReviewPreferences>,
    }
    let loaded: OldConfiguration =
        serde_json::from_str(r#"{"organization":"org","pollSeconds":60}"#)
            .expect("old configuration");
    assert!(loaded.end_of_day_review.is_none());
    assert_eq!(loaded.end_of_day_review.unwrap_or_default().finish_minute, 1020);
}

#[test]
fn gaps_use_union_of_overlaps_and_ignore_duplicate_ids() {
    let a = review_log("a", "2026-10-01T07:00:00Z", 2.0);
    let b = review_log("b", "2026-10-01T08:00:00Z", 3.0);
    let c = review_log("c", "2026-10-01T12:00:00Z", 3.0);
    let result = summary(&[c, b, a.clone(), a]);
    assert_eq!(result.sessions.len(), 3);
    assert_eq!(result.gaps.len(), 1);
    assert_eq!(result.gaps[0].start, date("2026-10-01T11:00:00Z"));
    assert_eq!(result.gaps[0].end, date("2026-10-01T12:00:00Z"));
    assert_eq!(result.total_seconds(), 8.0 * 3600.0);
}

#[test]
fn leading_trailing_and_minimum_gaps_are_handled() {
    let result = summary(&[
        review_log("a", "2026-10-01T08:00:00Z", 2.0),
        review_log("b", "2026-10-01T10:10:00Z", 3.0),
    ]);
    assert_eq!(result.gaps.len(), 2);
    assert_eq!(result.gaps[0].seconds(), 3600.0);
    assert_eq!(result.gaps[1].end, date("2026-10-01T15:00:00Z"));
    assert!(result.gaps.iter().all(|gap| gap.seconds() >= 20.0 * 60.0));
    let empty = summary(&[]);
    assert!(empty.gaps.len() == 1 && empty.gap_seconds() == 8.0 * 3600.0);
}

#[test]
fn overnight_and_long_entries_are_clipped_to_the_review_day() {
    let result = summary(&[
        review_log("overnight", "2026-09-30T21:00:00Z", 4.0),
        review_log("future", "2026-10-01T22:00:00Z", 2.0),
    ]);
    assert_eq!(result.sessions.len(), 1);
    assert_eq!(result.total_seconds(), 3.0 * 3600.0);
    assert_eq!(result.sessions[0].start, date("2026-09-30T22:00:00Z"));
    assert_eq!(result.long_sessions().len(), 1);
}

#[test]
fn midnight_entries_and_unconfirmed_timers_disable_gap_claims() {
    let midnight = summary(&[review_log("daily-total", "2026-09-30T22:00:00Z", 7.6)]);
    assert!(midnight.gaps_unavailable && midnight.gaps.is_empty());
    let stale = summary_with(&[], None, false, None);
    assert!(stale.timer_unconfirmed && stale.gaps.is_empty());
    assert!(!stale.timer_running);
}

#[test]
fn active_timer_is_counted_once_and_frozen_at_confirmation() {
    let mut running = state_with(Some(33984), "active", None);
    running.track.as_mut().expect("track").current_track_length = Some(7200.0);
    let sync = add_secs(now(), -60.0);
    let result = summary_with(
        &[
            review_log("active", "2026-10-01T13:14:00Z", 1.0),
            review_log("other", "2026-10-01T07:00:00Z", 1.0),
        ],
        Some(&running),
        true,
        Some(sync),
    );
    assert_eq!(result.sessions.len(), 2);
    assert_eq!(result.total_seconds(), 10800.0);
    assert!(result.timer_running);
    let last = result.sessions.last().expect("sessions");
    assert_eq!(last.end, sync);
    assert!(last.is_running);
}

#[test]
fn missing_active_duration_preserves_reported_worklog() {
    let mut running = state_with(Some(33984), "active", None);
    running.track.as_mut().expect("track").current_track_length = None;
    let result = summary_with(
        &[review_log("active", "2026-10-01T13:00:00Z", 1.0)],
        Some(&running),
        true,
        None,
    );
    assert_eq!(result.total_seconds(), 3600.0);
    assert!(result.gaps_unavailable);
}

#[test]
fn malformed_and_zero_entries_do_not_invent_covered_time() {
    let invalid = review_log("invalid", "unknown", 2.0);
    let result = summary(&[invalid, review_log("negative", "2026-10-01T07:00:00Z", -1.0)]);
    assert!(result.omitted_logs == 2 && result.gaps_unavailable);
    let zero = summary(&[review_log("zero", "2026-10-01T10:00:00Z", 0.0)]);
    assert!(zero.gaps.len() == 1 && zero.gap_seconds() == 8.0 * 3600.0);
}

#[test]
fn daylight_saving_reminder_uses_local_clock() {
    let prefs = DayReviewPreferences { weekdays: vec![1], ..DayReviewPreferences::default() };
    assert!(!is_due("2026-10-25T15:59:59Z", &prefs, None));
    assert!(is_due("2026-10-25T16:00:00Z", &prefs, None));
}

// Additional coverage beyond the Swift suite.

#[test]
fn skipped_and_repeated_local_times_match_foundation() {
    let prefs = DayReviewPreferences::default();
    // 02:30 does not exist on 29 March 2026; Foundation's `.nextTime` gives 03:00 CEST.
    assert_eq!(prefs.time(150, date("2026-03-29T10:00:00Z"), &cal()), date("2026-03-29T01:00:00Z"));
    assert_eq!(prefs.time(120, date("2026-03-29T10:00:00Z"), &cal()), date("2026-03-29T01:00:00Z"));
    // 02:30 happens twice on 25 October 2026; the first occurrence (CEST) wins.
    assert_eq!(prefs.time(150, date("2026-10-25T10:00:00Z"), &cal()), date("2026-10-25T00:30:00Z"));
    assert_eq!(
        prefs.time(17 * 60, date("2026-10-25T10:00:00Z"), &cal()),
        date("2026-10-25T16:00:00Z")
    );
}

#[test]
fn running_timer_covers_time_since_confirmation_for_gaps_only() {
    let mut running = state_with(Some(33984), "active", None);
    running.track.as_mut().expect("track").current_track_length = Some(3600.0);
    // Confirmed at 16:00 local after an hour; the review at 17:15 sees no trailing gap.
    let sync = date("2026-10-01T14:00:00Z");
    let result = summary_with(
        &[review_log("morning", "2026-10-01T07:00:00Z", 6.0)],
        Some(&running),
        true,
        Some(sync),
    );
    assert_eq!(result.total_seconds(), 7.0 * 3600.0);
    assert!(result.gaps.is_empty(), "{:?}", result.gaps);
    // Not today: the timer is ignored entirely.
    let yesterday = DayReviewSummary::calculate(
        &[],
        date("2026-09-30T12:00:00Z"),
        now(),
        &DayReviewPreferences::default(),
        Some(&running),
        Some(sync),
        true,
        &cal(),
    );
    assert!(!yesterday.timer_running && yesterday.sessions.is_empty());
    assert_eq!(yesterday.day, date("2026-09-29T22:00:00Z"));
}

#[test]
fn swift_day_review_state_decodes() {
    // `SavedState.dayReviews`: keys are `workspace|y-m-d` without zero padding.
    let swift = r#"{"https:\/\/org.timehub.7pace.com\/|2026-10-1":{"promptedAt":812560500,"reviewedAt":812562612.5},"https:\/\/org.timehub.7pace.com\/|2026-12-24":{"promptedAt":812560500,"snoozedUntil":812562300},"other|2026-9-30":{}}"#;
    let records: BTreeMap<String, DayReviewRecord> =
        serde_json::from_str(swift).expect("Swift records");
    let key = DayReviewSchedule::key("https://org.timehub.7pace.com/", now(), &cal());
    assert_eq!(key, "https://org.timehub.7pace.com/|2026-10-1");
    let record = &records[&key];
    assert_eq!(record.prompted_at, Some(now()));
    assert_eq!(record.reviewed_at, Some(add_secs(date("2026-10-01T15:50:12Z"), 0.5)));
    assert_eq!(record.snoozed_until, None);
    assert_eq!(
        records["https://org.timehub.7pace.com/|2026-12-24"].snoozed_until,
        Some(date("2026-10-01T15:45:00Z"))
    );
    assert_eq!(records["other|2026-9-30"], DayReviewRecord::default());
    assert_eq!(serde_json::to_string(&DayReviewRecord::default()).expect("encode"), "{}");

    let preferences: DayReviewPreferences = serde_json::from_str(
        r#"{"enabled":true,"finishMinute":1020,"gapMinutes":30,"longSessionMinutes":180,"startMinute":510,"weekdays":[2,3,4,5]}"#,
    )
    .expect("Swift preferences");
    assert_eq!(
        preferences,
        DayReviewPreferences {
            start_minute: 510,
            weekdays: vec![2, 3, 4, 5],
            gap_minutes: 30,
            ..DayReviewPreferences::default()
        }
    );
    let defaults: DayReviewPreferences = serde_json::from_str(
        r#"{"enabled":true,"finishMinute":1020,"gapMinutes":20,"longSessionMinutes":180,"startMinute":540,"weekdays":[2,3,4,5,6]}"#,
    )
    .expect("Swift defaults");
    assert_eq!(defaults, DayReviewPreferences::default());
    // Tolerant of missing keys.
    let partial: DayReviewPreferences =
        serde_json::from_str(r#"{"enabled":false}"#).expect("partial");
    assert_eq!(partial, DayReviewPreferences { enabled: false, ..DayReviewPreferences::default() });
}
