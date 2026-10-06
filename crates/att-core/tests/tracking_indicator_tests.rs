//! Ported from `Tests/AzureTimetrackerCoreTests/MeetingAndStatusTests.swift` ›
//! TrackingIndicatorTests, plus SlackHuddleTests `standupPauseRoundTripPreservesCommentWithoutFakeTicket`
//! and new tests for Swift JSON compatibility, labels, icons and the tray tooltip.

#[path = "support/tracking.rs"]
mod support;

use att_core::indicator::{
    IndicatorIcon, IndicatorTone, PausedSession, TrackingIndicator, status_description,
};
use att_core::model::TrackingState;
use jiff::Timestamp;
use support::{StateSpec, state};

fn now() -> Timestamp {
    Timestamp::from_second(1_800_000_000).unwrap()
}

fn resolve(
    connected: bool,
    connecting: bool,
    state: Option<&TrackingState>,
    paused: bool,
) -> TrackingIndicator {
    TrackingIndicator::resolve(connected, connecting, state, paused)
}

#[test]
fn pause_requires_confirmed_idle_state() {
    assert_eq!(resolve(true, false, Some(&state(None)), true), TrackingIndicator::Paused);
    assert_eq!(resolve(true, false, Some(&state(Some(33984))), true), TrackingIndicator::Running);
    assert_eq!(resolve(false, false, Some(&state(None)), true), TrackingIndicator::Disconnected);
    assert_eq!(resolve(true, false, None, true), TrackingIndicator::Disconnected);
    assert_eq!(resolve(true, true, Some(&state(None)), true), TrackingIndicator::Connecting);
}

#[test]
fn paused_session_preserves_ticket_activity_and_workspace_across_restart() {
    let paused = PausedSession::new(
        Some(33984),
        Some("meeting"),
        "https://org.timehub.7pace.com",
        now(),
        180.0,
        None,
    );
    let restored: PausedSession =
        serde_json::from_str(&serde_json::to_string(&paused).unwrap()).unwrap();
    assert_eq!(restored, paused);
}

#[test]
fn running_stopped_and_disconnected_are_distinct() {
    assert_eq!(resolve(true, false, Some(&state(Some(33984))), false), TrackingIndicator::Running);
    assert_eq!(resolve(true, false, Some(&state(None)), false), TrackingIndicator::Stopped);
    assert_eq!(
        resolve(false, false, Some(&state(Some(33984))), false),
        TrackingIndicator::Disconnected
    );
    assert_eq!(resolve(true, false, None, false), TrackingIndicator::Disconnected);
    assert_eq!(resolve(false, true, None, false), TrackingIndicator::Connecting);
}

#[test]
fn server_activity_check_gets_an_attention_indicator() {
    let active: TrackingState = serde_json::from_str(
        r#"{"track":{"trackingState":3,"tfsId":17,"activityCheck":{"isRunning":true}}}"#,
    )
    .unwrap();
    assert_eq!(resolve(true, false, Some(&active), false), TrackingIndicator::Attention);
    assert_eq!(resolve(false, false, Some(&active), false), TrackingIndicator::Disconnected);
}

#[test]
fn malformed_remote_state_is_not_shown_as_stopped() {
    let unknown: TrackingState =
        serde_json::from_str(r#"{"track":{"trackingState":"unknown"}}"#).unwrap();
    assert_eq!(resolve(true, false, Some(&unknown), false), TrackingIndicator::Disconnected);
}

/// SlackHuddleTests `standupPauseRoundTripPreservesCommentWithoutFakeTicket`.
#[test]
fn standup_pause_round_trip_preserves_comment_without_fake_ticket() {
    let paused =
        PausedSession::new(None, Some("standup"), "org", now(), 120.0, Some("daily standup"));
    let json = serde_json::to_string(&paused).unwrap();
    assert_eq!(serde_json::from_str::<PausedSession>(&json).unwrap(), paused);
    assert!(!json.contains("ticket"));
}

#[test]
fn paused_sessions_decode_swift_json() {
    // `pausedSession` as Swift 1.14.2 wrote it into state.json (pretty-printed, sorted keys).
    let swift = r#"{
      "activityID" : "standup",
      "elapsedSeconds" : 180.5,
      "pausedAt" : 821692800,
      "remark" : "daily standup",
      "workspace" : "https:\/\/org.timehub.7pace.com"
    }"#;
    let paused: PausedSession = serde_json::from_str(swift).unwrap();
    assert_eq!(
        paused,
        PausedSession::new(
            None,
            Some("standup"),
            "https://org.timehub.7pace.com",
            now(),
            180.5,
            Some("daily standup")
        )
    );
    let compact = r#"{"pausedAt":0,"ticketID":33984,"workspace":"w","elapsedSeconds":0}"#;
    let paused: PausedSession = serde_json::from_str(compact).unwrap();
    assert_eq!(paused.ticket_id, Some(33984));
    assert_eq!((paused.activity_id, paused.remark), (None, None));
    assert_eq!(paused.paused_at.to_string(), "2001-01-01T00:00:00Z");
    assert_eq!(paused.elapsed_seconds, 0.0);
    // `workspace`, `pausedAt` and `elapsedSeconds` are required, as in Swift.
    assert!(serde_json::from_str::<PausedSession>(r#"{"pausedAt":0,"elapsedSeconds":0}"#).is_err());
}

#[test]
fn paused_sessions_write_camel_case_and_rfc3339() {
    let paused = PausedSession::new(Some(33984), Some("dev"), "w", now(), 61.5, Some("Work"));
    let json = serde_json::to_value(&paused).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "ticketId": 33984,
            "remark": "Work",
            "activityId": "dev",
            "workspace": "w",
            "pausedAt": "2027-01-15T08:00:00Z",
            "elapsedSeconds": 61.5
        })
    );
}

#[test]
fn paused_session_from_state_and_title() {
    let running = StateSpec::new(Some(33984)).activity("dev").build();
    let paused = PausedSession::from_state(&running, "https://org.timehub.7pace.com", now(), 75.0);
    assert_eq!(
        paused,
        PausedSession::new(
            Some(33984),
            Some("dev"),
            "https://org.timehub.7pace.com",
            now(),
            75.0,
            None
        )
    );
    assert_eq!(paused.title(Some("Improve loading")), "Improve loading");
    assert_eq!(paused.title(None), "Azure ticket #33984");
    let standup = PausedSession::new(None, None, "w", now(), 0.0, Some("daily standup"));
    assert_eq!(standup.title(None), "daily standup");
    assert_eq!(
        PausedSession::new(None, None, "w", now(), 0.0, None).title(None),
        "Paused tracking"
    );
}

#[test]
fn labels_symbols_icons_and_tones() {
    let expected = [
        (
            TrackingIndicator::Running,
            "Tracking",
            "play.circle.fill",
            IndicatorIcon::Running,
            "running",
            IndicatorTone::Success,
        ),
        (
            TrackingIndicator::Stopped,
            "Stopped",
            "stop.circle",
            IndicatorIcon::Stopped,
            "stopped",
            IndicatorTone::Neutral,
        ),
        (
            TrackingIndicator::Paused,
            "Paused",
            "pause.circle.fill",
            IndicatorIcon::Paused,
            "paused",
            IndicatorTone::Warning,
        ),
        (
            TrackingIndicator::Disconnected,
            "Disconnected",
            "exclamationmark.triangle.fill",
            IndicatorIcon::Disconnected,
            "disconnected",
            IndicatorTone::Warning,
        ),
        (
            TrackingIndicator::Connecting,
            "Connecting",
            "arrow.triangle.2.circlepath",
            IndicatorIcon::Connecting,
            "connecting",
            IndicatorTone::Neutral,
        ),
        (
            TrackingIndicator::Attention,
            "Check activity",
            "questionmark.circle.fill",
            IndicatorIcon::Attention,
            "attention",
            IndicatorTone::Warning,
        ),
    ];
    for (indicator, label, symbol, icon, id, tone) in expected {
        assert_eq!(indicator.label(), label);
        assert_eq!(indicator.symbol(), symbol);
        assert_eq!(indicator.icon(), icon);
        assert_eq!(icon.id(), id);
        assert_eq!(icon.tone(), tone);
        assert_eq!(serde_json::to_value(indicator).unwrap(), id);
    }
}

#[test]
fn status_description_matches_the_menu_bar_tooltip() {
    let titles = |id: i64| (id == 33984).then(|| "Improve loading".to_string());
    let running = state(Some(33984));
    assert_eq!(
        status_description(TrackingIndicator::Running, "Connected", Some(&running), None, titles),
        "Azure timetracker — Tracking · Connected\n#33984 · Improve loading"
    );
    // Without a cached title the track's own title is used.
    let other = state(Some(7));
    assert_eq!(
        status_description(TrackingIndicator::Disconnected, "Offline", Some(&other), None, titles),
        "Azure timetracker — Disconnected · Offline\nLast known: #7 · Work item #7"
    );
    // A running ticket-free timer has no second line.
    let mut ticket_free = state(None);
    ticket_free.track.as_mut().unwrap().tracking_state =
        att_core::model::WireValue::text("tracking");
    assert_eq!(
        status_description(
            TrackingIndicator::Running,
            "Connected",
            Some(&ticket_free),
            None,
            titles
        ),
        "Azure timetracker — Tracking · Connected"
    );
    let idle = state(None);
    let paused = PausedSession::new(Some(33984), None, "w", now(), 10.0, None);
    assert_eq!(
        status_description(
            TrackingIndicator::Paused,
            "Connected",
            Some(&idle),
            Some(&paused),
            titles
        ),
        "Azure timetracker — Paused · Connected\n#33984 · Improve loading"
    );
    let paused = PausedSession::new(Some(5), None, "w", now(), 10.0, None);
    assert_eq!(
        status_description(TrackingIndicator::Paused, "Connected", None, Some(&paused), titles),
        "Azure timetracker — Paused · Connected\n#5 · Paused ticket"
    );
    let paused = PausedSession::new(None, None, "w", now(), 10.0, Some("daily standup"));
    assert_eq!(
        status_description(
            TrackingIndicator::Paused,
            "Connected",
            Some(&idle),
            Some(&paused),
            titles
        ),
        "Azure timetracker — Paused · Connected\ndaily standup"
    );
    let paused = PausedSession::new(None, None, "w", now(), 10.0, None);
    assert_eq!(
        status_description(
            TrackingIndicator::Stopped,
            "Connected",
            Some(&idle),
            Some(&paused),
            titles
        ),
        "Azure timetracker — Stopped · Connected\nPaused tracking"
    );
    assert_eq!(
        status_description(TrackingIndicator::Stopped, "Connected", Some(&idle), None, titles),
        "Azure timetracker — Stopped · Connected"
    );
}
