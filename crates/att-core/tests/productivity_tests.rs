//! Port of ProductivityTests.swift (TargetProgressTests, ConnectionHealthTests,
//! MeetingReturnTests, QuickTicketsTests, DailyScheduleTests), plus decode tests for the JSON
//! Swift 1.14.x persisted.

#[path = "support/insights.rs"]
mod support;

use att_core::AppError;
use att_core::model::{TrackingState, WorkLog};
use att_core::productivity::{ConnectionHealth, MeetingReturn, QuickTickets};
use att_core::statistics::{ActivityStatistics, StatisticsPeriod, StatisticsRange};
use att_core::targets::{TargetProgress, WorkTargets};
use att_core::time::{add_secs, from_secs, swift_date};
use jiff::Timestamp;
use support::{cal, date, log, state, state_with};

fn progress(
    logs: &[WorkLog],
    state: Option<&TrackingState>,
    last_sync: Option<Timestamp>,
    now: Timestamp,
    extrapolate: bool,
) -> TargetProgress {
    TargetProgress::calculate(logs, state, last_sync, now, extrapolate, &cal())
}

// TargetProgressTests

#[test]
fn target_defaults_and_weekend() {
    let targets = WorkTargets::default();
    assert_eq!(targets.weekly_hours, 38.0);
    assert_eq!(targets.daily_seconds(date("2026-09-29T10:00:00Z"), &cal()), 27360.0);
    assert_eq!(targets.daily_seconds(date("2026-10-03T10:00:00Z"), &cal()), 0.0);
    let invalid = WorkTargets { weekly_hours: f64::INFINITY, ..targets.clone() };
    assert!(!invalid.is_valid());
    let invalid = WorkTargets { daily_hours: 25.0, ..targets };
    assert!(!invalid.is_valid());
}

#[test]
fn monday_week_and_daylight_saving_use_calendar_boundaries() {
    let interval = TargetProgress::week_interval(date("2026-10-25T12:00:00Z"), &cal());
    assert_eq!(interval.start, date("2026-10-18T22:00:00Z"));
    assert_eq!(interval.end, date("2026-10-25T23:00:00Z"));
    assert_eq!(interval.duration(), 169.0 * 3600.0);
}

#[test]
fn active_log_is_counted_once_and_idle_log_is_not_dropped() {
    let now = date("2026-09-29T10:00:00Z");
    let logs = [
        log("done", "2026-09-29T08:00:00Z", 1800.0),
        log("done", "2026-09-29T08:00:00Z", 1800.0),
        log("session", "2026-09-29T09:58:00Z", 120.0),
        log("monday", "2026-09-28T08:00:00Z", 3600.0),
        log("old", "2026-09-27T08:00:00Z", 900.0),
    ];
    let running = state(Some(100));
    let active = progress(&logs, Some(&running), Some(add_secs(now, -30.0)), now, true);
    assert_eq!(active.today, 1950.0);
    assert_eq!(active.week, 5550.0);
    let idle = state(None);
    assert_eq!(progress(&logs, Some(&idle), Some(now), now, true).today, 1920.0);
}

#[test]
fn disconnected_time_does_not_grow() {
    let sync = date("2026-09-29T10:00:00Z");
    let running = state(Some(100));
    let result = progress(&[], Some(&running), Some(sync), add_secs(sync, 3600.0), false);
    assert_eq!(result.today, 120.0);
}

#[test]
fn live_timer_crossing_monday_is_clipped_to_new_week_and_day() {
    let now = date("2026-09-27T22:01:00Z"); // Monday 00:01 Brussels.
    let running = state(Some(100));
    let result = progress(&[], Some(&running), Some(now), now, true);
    assert_eq!(result.today, 60.0);
    assert_eq!(result.week, 60.0);
}

#[test]
fn completed_log_at_exclusive_week_end_is_not_included() {
    let now = date("2026-09-29T10:00:00Z");
    let logs = [log("next", "2026-10-04T22:00:00Z", 3600.0)];
    assert_eq!(progress(&logs, None, None, now, false).week, 0.0);
}

#[test]
fn unidentified_live_timer_uses_reported_logs_without_double_counting() {
    let now = date("2026-09-29T10:00:00Z");
    let mut unknown = state(Some(100));
    unknown.track.as_mut().expect("track").work_log_id = None;
    let logs = [log("session", "2026-09-29T09:58:00Z", 120.0)];
    assert_eq!(progress(&logs, Some(&unknown), Some(now), now, true).today, 120.0);
}

// ConnectionHealthTests

fn health(
    configured: bool,
    connecting: bool,
    connected: bool,
    last_sync: Option<Timestamp>,
    failure: Option<&AppError>,
    poll: i64,
) -> ConnectionHealth {
    ConnectionHealth::resolve(
        configured,
        connecting,
        connected,
        last_sync,
        failure,
        from_secs(1_800_000_000.0),
        poll,
    )
}

#[test]
fn stale_state_and_polling_intervals() {
    let ago = |seconds: f64| Some(from_secs(1_800_000_000.0 - seconds));
    assert_eq!(health(true, false, true, ago(134.0), None, 60), ConnectionHealth::Confirmed);
    assert_eq!(health(true, false, true, ago(136.0), None, 60), ConnectionHealth::Stale);
    assert_eq!(health(true, false, true, ago(400.0), None, 300), ConnectionHealth::Confirmed);
}

#[test]
fn credentials_and_missing_confirmation_are_explicit() {
    let now = Some(from_secs(1_800_000_000.0));
    let auth = AppError::Authentication("host".into());
    let denied = AppError::AccessDenied("host".into());
    assert_eq!(health(true, false, false, now, Some(&auth), 60), ConnectionHealth::Authentication);
    assert_eq!(health(true, false, false, now, Some(&denied), 60), ConnectionHealth::AccessDenied);
    assert_eq!(health(true, false, true, None, None, 60), ConnectionHealth::Offline);
    assert_eq!(health(false, false, false, None, None, 60), ConnectionHealth::Unconfigured);
    assert_eq!(health(true, true, false, now, Some(&auth), 60), ConnectionHealth::Connecting);
}

// MeetingReturnTests

fn meeting_end() -> Timestamp {
    from_secs(1_800_000_000.0)
}

fn after(
    id: &str,
    end: Timestamp,
    previous: &TrackingState,
    next: &TrackingState,
    existing: Option<&MeetingReturn>,
) -> Option<MeetingReturn> {
    MeetingReturn::after_starting(id, end, previous, next, "org", existing)
}

#[test]
fn remembers_previous_work_only_after_a_real_switch() {
    let end = meeting_end();
    let old = state_with(Some(100), "session", Some("development"));
    let next = state_with(Some(200), "meeting-session", Some("meeting"));
    let plan = after("meeting", end, &old, &next, None).expect("plan");
    assert_eq!(plan.ticket_id, 100);
    assert_eq!(plan.activity_id.as_deref(), Some("development"));
    assert!(!plan.is_due(Some(&next), "org", add_secs(end, -1.0)));
    assert!(plan.is_due(Some(&next), "org", end));
    assert_eq!(after("meeting", end, &old, &old, None), None);
    assert_eq!(after("meeting", end, &state(None), &next, None), None);
}

#[test]
fn manual_switch_stop_expiry_and_workspace_change_invalidate_return() {
    let end = meeting_end();
    let next = state_with(Some(200), "meeting-session", None);
    let plan = after("meeting", end, &state(Some(100)), &next, None).expect("plan");
    assert!(!plan.is_due(Some(&state(None)), "org", end));
    assert!(!plan.is_due(Some(&state(Some(300))), "org", end));
    assert!(!plan.is_due(Some(&next), "other", end));
    assert!(!plan.is_due(Some(&next), "org", add_secs(end, 86400.0)));
}

#[test]
fn consecutive_meetings_preserve_original_ticket_including_default_activity() {
    let end = meeting_end();
    let first = state_with(Some(200), "first", Some("meeting"));
    let second = state_with(Some(300), "second", Some("meeting"));
    let original = after("meeting", end, &state(Some(100)), &first, None).expect("original");
    let chained = after("second", end, &first, &second, Some(&original)).expect("chained");
    assert_eq!(chained.ticket_id, 100);
    assert_eq!(chained.activity_id, None);
    assert_eq!(chained.meeting_identity, second.identity());
}

#[test]
fn restart_persists_reminder_without_calendar_text() {
    let next = state_with(Some(200), "meeting-session", None);
    let mut plan = after("meeting", meeting_end(), &state(Some(100)), &next, None).expect("plan");
    plan.notified = true;
    let data = serde_json::to_string(&plan).expect("encode");
    assert_eq!(serde_json::from_str::<MeetingReturn>(&data).expect("decode"), plan);
    // The plan never receives the meeting title, so it cannot be persisted.
    assert!(!data.contains("Private meeting title"));
}

#[test]
fn consecutive_meetings_on_same_ticket_and_activity_keep_return() {
    let end = meeting_end();
    let current = state_with(Some(200), "meeting-session", Some("meeting"));
    let plan =
        after("meeting", end, &state_with(Some(100), "session", Some("dev")), &current, None)
            .expect("plan");
    let later_end = add_secs(end, 1800.0);
    let continued = after("second", later_end, &current, &current, Some(&plan)).expect("continued");
    assert_eq!(continued.ticket_id, 100);
    assert_eq!(continued.activity_id.as_deref(), Some("dev"));
    assert_eq!(continued.end, later_end);
    assert_eq!(continued.occurrence_id, "second");
}

// QuickTicketsTests

#[test]
fn recent_is_bounded_unique_and_favorites_appear_first() {
    let mut tickets = QuickTickets::new("org");
    for id in 1..=10 {
        tickets.remember(id);
    }
    tickets.remember(7);
    tickets.toggle_favorite(5);
    assert_eq!(tickets.recent.len(), 8);
    assert_eq!(tickets.ordered_ids().first(), Some(&5));
    assert_eq!(tickets.recent.first(), Some(&7));
    assert_eq!(tickets.ordered_ids().iter().filter(|id| **id == 5).count(), 1);
    tickets.toggle_favorite(5);
    assert!(tickets.favorites.is_empty());
    let json = serde_json::to_string(&tickets).expect("encode");
    assert_eq!(serde_json::from_str::<QuickTickets>(&json).expect("decode"), tickets);
}

// DailyScheduleTests

#[test]
fn legacy_settings_retain_targets_and_convert_on_first_edit() {
    let mut targets: WorkTargets =
        serde_json::from_str(r#"{"weeklyHours":38,"dailyHours":7.6}"#).expect("legacy");
    assert!(targets.hours_by_weekday.is_none() && targets.weekly_target_hours() == 38.0);
    assert!(targets.hours(2) == 7.6 && targets.hours(1) == 0.0);
    targets.set_hours(6.0, 6);
    assert_eq!(targets.hours_by_weekday, Some(vec![0.0, 7.6, 7.6, 7.6, 7.6, 6.0, 0.0]));
    assert!((targets.weekly_target_hours() - 36.4).abs() < 0.0001);
    let json = serde_json::to_string(&targets).expect("encode");
    assert_eq!(serde_json::from_str::<WorkTargets>(&json).expect("decode"), targets);
}

#[test]
fn custom_schedule_drives_daily_weekly_and_monthly_charts() {
    let mut targets = WorkTargets {
        hours_by_weekday: Some(vec![0.0, 8.0, 8.0, 8.0, 8.0, 6.0, 0.0]),
        ..WorkTargets::default()
    };
    let anchor = date("2026-10-02T12:00:00Z");
    assert_eq!(targets.weekly_target_hours(), 38.0);
    assert_eq!(targets.daily_seconds(anchor, &cal()), 21600.0);
    let week = ActivityStatistics::calculate(
        &[],
        &StatisticsRange::new(StatisticsPeriod::Week, anchor, &cal()),
        &targets,
        &cal(),
    );
    let days: Vec<_> = week.days.iter().map(|d| d.target_seconds).collect();
    assert_eq!(days, [28800.0, 28800.0, 28800.0, 28800.0, 21600.0, 0.0, 0.0]);
    assert_eq!(week.target_seconds(), 38.0 * 3600.0);
    let month = ActivityStatistics::calculate(
        &[],
        &StatisticsRange::new(StatisticsPeriod::Month, anchor, &cal()),
        &targets,
        &cal(),
    );
    assert_eq!(month.target_seconds(), 166.0 * 3600.0);
    targets.set_hours(2.0, 7);
    assert_eq!(targets.weekly_target_hours(), 40.0);
    assert_eq!(targets.daily_seconds(add_secs(anchor, 86400.0), &cal()), 7200.0);
}

#[test]
fn validates_each_day_and_allows_days_off() {
    let mut t = WorkTargets { hours_by_weekday: Some(vec![0.0; 7]), ..WorkTargets::default() };
    assert!(t.is_valid() && t.weekly_target_hours() == 0.0);
    for value in [f64::NAN, f64::INFINITY, -1.0, 24.1] {
        t.hours_by_weekday = Some(vec![0.0, 8.0, 8.0, value, 8.0, 6.0, 0.0]);
        assert!(!t.is_valid(), "{value}");
    }
    t.hours_by_weekday = Some(vec![8.0]);
    assert!(!t.is_valid());
    t.hours_by_weekday = Some(vec![24.0; 7]);
    assert!(t.is_valid());
}

// Decoding the JSON 1.14.x wrote (`JSONEncoder` with sorted keys, dates as seconds since 2001).

#[test]
fn swift_work_targets_decode_with_schedule_and_exceptions() {
    let swift = r#"{"belgianHolidaysEnabled":false,"dailyHours":7.6,"dateExceptions":[{"hours":0,"id":"2026-12-24","kind":"Full-day leave","note":"Leave"},{"hours":2,"id":"2026-10-02","kind":"Custom target","note":""},{"hours":0,"id":"2026-09-28","kind":"Half-day leave","note":""},{"hours":0,"id":"2026-08-17","kind":"Replacement holiday","note":"Assumption"}],"hoursByWeekday":[0,7.6,7.6,7.6,7.6,6,0],"weeklyHours":36.4}"#;
    let targets: WorkTargets = serde_json::from_str(swift).expect("Swift targets");
    assert!(targets.is_valid());
    assert!(!targets.uses_belgian_holidays());
    assert_eq!(targets.exceptions().len(), 4);
    assert_eq!(
        targets.reason(date("2026-12-24T12:00:00Z"), &cal()).as_deref(),
        Some("Full-day leave · Leave")
    );
    assert_eq!(targets.daily_seconds(date("2026-10-02T12:00:00Z"), &cal()), 7200.0);
    assert_eq!(targets.daily_seconds(date("2026-09-28T12:00:00Z"), &cal()), 7.6 * 1800.0);
    assert_eq!(targets.daily_seconds(date("2026-08-17T12:00:00Z"), &cal()), 0.0);
    // Writing keeps the Swift keys and raw values.
    let written = serde_json::to_value(&targets).expect("encode");
    assert_eq!(written["dateExceptions"][1]["kind"], "Custom target");
    assert_eq!(written["hoursByWeekday"][5], 6.0);
    assert_eq!(serde_json::from_value::<WorkTargets>(written).expect("round trip"), targets);
}

#[test]
fn swift_default_and_partial_work_targets_decode() {
    let defaults: WorkTargets =
        serde_json::from_str(r#"{"dailyHours":7.6,"weeklyHours":38}"#).expect("defaults");
    assert_eq!(defaults, WorkTargets::default());
    // Missing keys fall back to the defaults instead of failing.
    let partial: WorkTargets = serde_json::from_str(r#"{"weeklyHours":40}"#).expect("partial");
    assert_eq!((partial.weekly_hours, partial.daily_hours), (40.0, 7.6));
    let written = serde_json::to_string(&WorkTargets::default()).expect("encode");
    assert_eq!(written, r#"{"weeklyHours":38.0,"dailyHours":7.6}"#);
}

#[test]
fn swift_meeting_returns_decode() {
    let calendar = r#"{"activityID":"development","end":812539800,"meetingIdentity":"meeting-session|200|2026-09-29T08:00:00Z","notified":true,"occurrenceID":"occurrence-key","ticketID":100,"workspace":"https:\/\/org.timehub.7pace.com\/"}"#;
    let plan: MeetingReturn = serde_json::from_str(calendar).expect("calendar return");
    assert_eq!(plan.occurrence_id, "occurrence-key");
    assert_eq!(plan.end, date("2026-10-01T09:30:00Z"));
    assert_eq!(plan.ticket_id, 100);
    assert_eq!(plan.activity_id.as_deref(), Some("development"));
    assert_eq!(plan.workspace, "https://org.timehub.7pace.com/");
    assert!(plan.notified && plan.microphone_session_id.is_none());

    // Microphone sessions without an end use `Date.distantFuture`; the Slack keys are dropped.
    let microphone = r#"{"end":63113904000,"meetingIdentity":"call|300|2026-09-29T08:00:00Z","microphoneAppID":"us.zoom.xos","microphoneSessionID":"session-1","notified":false,"occurrenceID":"microphone:session-1","slackCallID":"call","slackTeamID":"team","slackWasJoined":true,"ticketID":100,"workspace":"org"}"#;
    let mic: MeetingReturn = serde_json::from_str(microphone).expect("microphone return");
    assert_eq!(mic.end, MeetingReturn::open_end());
    assert_eq!(mic.end.to_string(), "4001-01-01T00:00:00Z");
    assert_eq!(mic.microphone_app_id.as_deref(), Some("us.zoom.xos"));
    assert_eq!(mic.microphone_session_id.as_deref(), Some("session-1"));
    assert_eq!(mic.activity_id, None);
    let running = state_with(Some(300), "call", None);
    assert!(mic.is_valid(Some(&running), "org", date("2026-10-06T12:00:00Z")));

    let written = serde_json::to_value(&mic).expect("encode");
    assert_eq!(written["occurrenceId"], "microphone:session-1");
    assert_eq!(written["end"], "4001-01-01T00:00:00Z");
    assert!(written.get("slackCallID").is_none());
    assert_eq!(serde_json::from_value::<MeetingReturn>(written).expect("round trip"), mic);
    assert_eq!(swift_date::from_timestamp(MeetingReturn::open_end()), 63_113_904_000.0);
}

#[test]
fn swift_quick_tickets_decode() {
    let swift = r#"{"favorites":[33630],"recent":[12,33630,33984],"workspace":"https:\/\/org.timehub.7pace.com\/"}"#;
    let tickets: QuickTickets = serde_json::from_str(swift).expect("Swift quick tickets");
    assert_eq!(tickets.workspace, "https://org.timehub.7pace.com/");
    assert_eq!(tickets.ordered_ids(), [33630, 12, 33984]);
    let empty: QuickTickets = serde_json::from_str(r#"{"workspace":"org"}"#).expect("tolerant");
    assert_eq!(empty, QuickTickets::new("org"));
}

#[test]
fn connection_health_labels_and_symbols() {
    assert_eq!(ConnectionHealth::Connecting.label(), "Connecting to 7pace…");
    assert_eq!(ConnectionHealth::Stale.label(), "7pace status is out of date");
    assert_eq!(ConnectionHealth::AccessDenied.symbol(), "key.fill");
    assert_eq!(ConnectionHealth::Offline.symbol(), "exclamationmark.icloud");
    assert_eq!(
        serde_json::to_value(ConnectionHealth::AccessDenied).expect("encode"),
        "accessDenied"
    );
}

#[test]
fn favorites_are_capped_at_twenty() {
    let mut tickets = QuickTickets::new("org");
    for id in 0..25 {
        tickets.toggle_favorite(id);
    }
    assert_eq!(tickets.favorites.len(), 20);
    assert_eq!(tickets.favorites.last(), Some(&19));
}
