//! The 2.4 Settings redesign: "Resume after meetings", "Show the timer in the menu bar" and the
//! day review reminder timing (`beforeEnd`, `atEnd`, `nextMorning`).

use att_core::Cal;
use att_core::Configuration;
use att_core::day_review::{
    DayReviewPreferences, DayReviewRecord, DayReviewReminder, DayReviewSchedule,
};
use jiff::Timestamp;
use jiff::civil::date;
use serde_json::{Value, json};

fn cal() -> Cal {
    Cal::brussels()
}

fn at(text: &str) -> Timestamp {
    text.parse().expect("timestamp")
}

fn preferences(reminder: DayReviewReminder) -> DayReviewPreferences {
    DayReviewPreferences { reminder, ..DayReviewPreferences::default() }
}

fn is_due(
    when: &str,
    preferences: &DayReviewPreferences,
    record: Option<&DayReviewRecord>,
) -> bool {
    DayReviewSchedule::is_due(at(when), preferences, record, &cal())
}

#[test]
fn new_settings_default_on_and_old_settings_keep_todays_behaviour() {
    let defaults = Configuration::default();
    assert!(defaults.resume_after_meetings);
    assert!(defaults.menu_bar_timer);
    assert_eq!(defaults.day_review.reminder, DayReviewReminder::AtEnd);

    // Settings saved by 2.3 have none of the keys.
    let old: Configuration = serde_json::from_value(json!({
        "organization": "contoso",
        "miniTimer": true,
        "endOfDayReview": {"enabled": true, "startMinute": 480, "finishMinute": 990, "weekdays": [2, 3]},
    }))
    .expect("2.3 settings");
    assert!(old.resume_after_meetings);
    assert!(old.menu_bar_timer);
    assert_eq!(old.day_review.reminder, DayReviewReminder::AtEnd);
    assert_eq!(old.day_review.finish_minute, 990);
}

#[test]
fn the_new_settings_use_camel_case_keys_and_values() {
    let config = Configuration {
        resume_after_meetings: false,
        menu_bar_timer: false,
        day_review: preferences(DayReviewReminder::NextMorning),
        ..Configuration::default()
    };
    let value = serde_json::to_value(&config).expect("encode");
    assert_eq!(value["resumeAfterMeetings"], false);
    assert_eq!(value["menuBarTimer"], false);
    assert_eq!(value["dayReview"]["reminder"], "nextMorning");
    assert_eq!(serde_json::from_value::<Configuration>(value).expect("decode"), config);

    for (reminder, text) in [
        (DayReviewReminder::BeforeEnd, "beforeEnd"),
        (DayReviewReminder::AtEnd, "atEnd"),
        (DayReviewReminder::NextMorning, "nextMorning"),
    ] {
        assert_eq!(serde_json::to_value(reminder).expect("encode"), Value::from(text));
        assert_eq!(
            serde_json::from_value::<DayReviewReminder>(json!(text)).expect("decode"),
            reminder
        );
    }
}

// Thursday 1 October 2026 in Brussels (UTC+2): 09:00 is 07:00Z, 17:00 is 15:00Z.

#[test]
fn before_end_reminds_fifteen_minutes_before_the_finish_time() {
    let prefs = preferences(DayReviewReminder::BeforeEnd);
    assert_eq!(prefs.reviewed_day(at("2026-10-01T14:45:00Z"), &cal()), Some(date(2026, 10, 1)));
    assert!(!is_due("2026-10-01T14:44:59Z", &prefs, None));
    assert!(is_due("2026-10-01T14:45:00Z", &prefs, None));
    assert!(!is_due("2026-10-03T14:45:00Z", &prefs, None), "Saturday is not a review day");
    let prompted =
        DayReviewRecord { prompted_at: Some(at("2026-10-01T14:45:00Z")), ..Default::default() };
    assert!(!is_due("2026-10-01T15:30:00Z", &prefs, Some(&prompted)), "once");
}

#[test]
fn at_end_reminds_at_the_finish_time() {
    let prefs = preferences(DayReviewReminder::AtEnd);
    assert_eq!(prefs, DayReviewPreferences::default());
    assert_eq!(prefs.reviewed_day(at("2026-10-01T15:00:00Z"), &cal()), Some(date(2026, 10, 1)));
    assert!(!is_due("2026-10-01T14:59:59Z", &prefs, None));
    assert!(is_due("2026-10-01T15:00:00Z", &prefs, None));
    assert_eq!(prefs.reminder_time(at("2026-10-01T08:00:00Z"), &cal()), at("2026-10-01T15:00:00Z"));
}

#[test]
fn next_morning_reminds_at_the_next_review_days_start_about_the_previous_one() {
    let prefs = preferences(DayReviewReminder::NextMorning);
    // Thursday morning reviews Wednesday; Monday morning reviews Friday; no reminder at weekends.
    assert_eq!(prefs.reviewed_day(at("2026-10-01T07:00:00Z"), &cal()), Some(date(2026, 9, 30)));
    assert_eq!(prefs.reviewed_day(at("2026-10-05T07:00:00Z"), &cal()), Some(date(2026, 10, 2)));
    assert_eq!(prefs.reviewed_day(at("2026-10-03T07:00:00Z"), &cal()), None);
    assert_eq!(prefs.reminder_time(at("2026-10-01T12:00:00Z"), &cal()), at("2026-10-01T07:00:00Z"));
    assert!(!is_due("2026-10-01T06:59:59Z", &prefs, None));
    assert!(is_due("2026-10-01T07:00:00Z", &prefs, None));
    assert!(!is_due("2026-10-04T07:00:00Z", &prefs, None), "Sunday");

    // The record is the previous review day's: reviewed the evening before, no reminder.
    let reviewed =
        DayReviewRecord { reviewed_at: Some(at("2026-09-30T15:10:00Z")), ..Default::default() };
    assert!(!is_due("2026-10-01T07:00:00Z", &prefs, Some(&reviewed)));
    let snoozed = DayReviewRecord {
        prompted_at: Some(at("2026-10-01T07:00:00Z")),
        snoozed_until: Some(at("2026-10-01T07:30:00Z")),
        ..Default::default()
    };
    assert!(!is_due("2026-10-01T07:29:59Z", &prefs, Some(&snoozed)));
    assert!(is_due("2026-10-01T07:30:00Z", &prefs, Some(&snoozed)));

    // Only Mondays selected: Monday reviews the Monday before.
    let mondays = DayReviewPreferences { weekdays: vec![2], ..prefs };
    assert_eq!(mondays.reviewed_day(at("2026-10-05T07:00:00Z"), &cal()), Some(date(2026, 9, 28)));
}
