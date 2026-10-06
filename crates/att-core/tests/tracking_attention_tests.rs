//! Ported from `Tests/AzureTimetrackerCoreTests/TimeEditingTests.swift` › TrackingAttentionTests,
//! plus new checks for the prompt texts and a prompt that disappeared before the switch.

#[path = "support/tracking.rs"]
mod support;

use att_core::AppError;
use att_core::attention::{AttentionReason, TrackingAttention};
use att_core::model::{TrackingState, WireValue};
use att_core::tracking::{self, no_context};
use support::{StubTracker, state};

/// Swift `stopped(_ reason: Int = 4, log: String = "first")`.
fn stopped(reason: i64, log: &str) -> TrackingState {
    serde_json::from_value(serde_json::json!({
        "track": {
            "trackingState": "clientInputRequired",
            "stoppedTrackType": reason,
            "tfsId": 123,
            "workLogId": log,
            "activityTypeId": "dev",
            "remark": "Work",
            "trackStatusChangeDate": "2026-09-28T11:00:00"
        }
    }))
    .unwrap()
}

fn limit_stop() -> TrackingState {
    stopped(4, "first")
}

#[test]
fn limit_stop_uses_server_reason_and_preserves_task_selection() {
    let prompt = TrackingAttention::from_state(&limit_stop()).expect("a time-limit prompt");
    assert!(prompt.stopped());
    assert_eq!(prompt.reason, AttentionReason::TimeLimit);
    assert_eq!(prompt.ticket_id, Some(123));
    assert_eq!(prompt.activity_id.as_deref(), Some("dev"));
    assert_eq!(prompt.remark.as_deref(), Some("Work"));
    let mut repeated = limit_stop();
    repeated.timestamp = Some(98765);
    assert_eq!(
        TrackingAttention::from_state(&repeated).map(|attention| attention.id),
        Some(prompt.id.clone())
    );
    assert_ne!(
        TrackingAttention::from_state(&stopped(4, "next")).map(|attention| attention.id),
        Some(prompt.id)
    );
}

#[test]
fn manual_stops_other_clients_and_elapsed_time_alone_do_not_trigger_prompt() {
    for reason in [0, 2, 3, 5, 6, 99] {
        assert_eq!(TrackingAttention::from_state(&stopped(reason, "first")), None, "{reason}");
    }
    let mut running = state(Some(123));
    running.track.as_mut().unwrap().current_track_length = Some(8000.0);
    assert_eq!(TrackingAttention::from_state(&running), None);
    assert_eq!(TrackingAttention::from_state(&state(None)), None);
}

#[test]
fn activity_check_and_timeout_are_distinct_prompts() {
    let mut checking = state(Some(123));
    checking.track.as_mut().unwrap().tracking_state = WireValue::Number(3);
    assert_eq!(
        TrackingAttention::from_state(&checking).map(|attention| attention.reason),
        Some(AttentionReason::ActivityCheck)
    );
    assert_eq!(
        TrackingAttention::from_state(&stopped(1, "first")).map(|attention| attention.reason),
        Some(AttentionReason::ActivityTimeout)
    );
}

#[tokio::test]
async fn stale_stop_prompt_cannot_resume_different_stopped_task() {
    let original = limit_stop();
    let actual = stopped(4, "another");
    let fixture = StubTracker::new(actual.clone(), actual);
    let attention = TrackingAttention::from_state(&original);
    let error = tracking::switch_to(
        Some(123),
        "idle",
        Some("dev"),
        Some("Work"),
        attention.as_ref(),
        &fixture,
        no_context,
    )
    .await
    .unwrap_err();
    assert_eq!(error, AppError::RemoteChanged);
    assert_eq!(fixture.calls().await, ["current"]);
}

#[tokio::test]
async fn continuing_confirmed_limit_stop_starts_new_session_without_stopping_again() {
    let original = limit_stop();
    let fixture = StubTracker::new(original.clone(), original.clone());
    let attention = TrackingAttention::from_state(&original);
    let result = tracking::switch_to(
        Some(123),
        "idle",
        Some("dev"),
        Some("Work"),
        attention.as_ref(),
        &fixture,
        no_context,
    )
    .await
    .unwrap();
    assert!(result.running());
    assert_eq!(fixture.calls().await, ["current", "start:123"]);
}

#[tokio::test]
async fn prompt_that_disappeared_blocks_the_switch() {
    // The server no longer reports the stop reason, so the prompt the user answered is gone.
    let attention = TrackingAttention::from_state(&limit_stop());
    let fixture = StubTracker::new(state(None), state(None));
    let error = tracking::switch_to(
        Some(123),
        "idle",
        Some("dev"),
        Some("Work"),
        attention.as_ref(),
        &fixture,
        no_context,
    )
    .await
    .unwrap_err();
    assert_eq!(error, AppError::RemoteChanged);
    assert_eq!(fixture.calls().await, ["current"]);
}

#[test]
fn prompt_texts() {
    let limit = TrackingAttention::from_state(&limit_stop()).unwrap();
    assert_eq!(limit.heading(), "7pace stopped your timer at its time limit");
    assert_eq!(
        limit.detail(),
        "Continue with a new session, or keep this task stopped. Time since the stop will not be added automatically."
    );
    let timeout = TrackingAttention::from_state(&stopped(1, "first")).unwrap();
    assert_eq!(timeout.heading(), "7pace stopped after an unanswered activity check");
    let mut checking = state(Some(123));
    checking.track.as_mut().unwrap().tracking_state = WireValue::text("ActivityCheck");
    let check = TrackingAttention::from_state(&checking).unwrap();
    assert!(!check.stopped());
    assert_eq!(check.heading(), "Still working on this task?");
    assert_eq!(
        check.detail(),
        "7pace needs your response. Continue tracking or stop this session."
    );
    assert_eq!(check.id, "activityCheck|session|2026-09-29T08:00:00Z||123");
}
