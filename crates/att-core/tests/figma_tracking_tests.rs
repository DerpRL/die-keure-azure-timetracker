//! FigmaContextTests.swift cases that drive the tracking transaction. They were deferred from
//! `figma_context_tests.rs` until `att_core::tracking` existed.

#[path = "support/tracking.rs"]
mod support;

use att_core::{AppError, tracking};
use support::{StubTracker, state};

/// `FigmaDocument(key: "Alpha12", name: "First design")` in the Swift suite.
const FILE_NAME: &str = "First design";

#[tokio::test]
async fn outdated_context_never_mutates_tracking() {
    let old = state(Some(100));
    let stub = StubTracker::new(old.clone(), state(None));
    let result = tracking::switch_to(
        Some(42),
        &old.identity(),
        Some("design"),
        None,
        None,
        &stub,
        || async { Err::<(), _>(AppError::message("Outdated Figma context")) },
    )
    .await;
    assert_eq!(result.unwrap_err(), AppError::message("Outdated Figma context"));
    assert_eq!(stub.calls().await, ["current"]);
}

#[tokio::test]
async fn ticket_free_design_starts_with_file_comment() {
    for from_running_timer in [false, true] {
        let old = state(from_running_timer.then_some(100));
        let stub = StubTracker::new(old.clone(), state(None));
        let result = tracking::switch_to(
            None,
            &old.identity(),
            Some("design"),
            Some(FILE_NAME),
            None,
            &stub,
            tracking::no_context,
        )
        .await
        .unwrap();
        let track = result.track.as_ref().unwrap();
        assert!(result.running() && track.ticket_id().is_none(), "{from_running_timer}");
        assert_eq!(track.remark.as_deref(), Some(FILE_NAME));
        assert_eq!(track.activity_type_id.as_deref(), Some("design"));
        let expected: &[&str] = if from_running_timer {
            &["current", "stop", "start:unassigned"]
        } else {
            &["current", "start:unassigned"]
        };
        assert_eq!(stub.calls().await, expected, "{from_running_timer}");
    }
}
