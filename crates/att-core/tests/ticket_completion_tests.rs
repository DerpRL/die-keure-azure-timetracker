//! Ported from TicketCompletionTests.swift. `defaultsAndExplicitOptOutRoundTrip` covers
//! `Configuration.completionRemindersEnabled` and waits for `Configuration`.

#[path = "support/context.rs"]
mod support;

use att_core::completion::TicketCompletionMonitor;
use att_core::model::TrackingState;
use att_core::ticket::TicketWorkflowStatus;
use att_core::time::add_secs;
use jiff::Timestamp;
use support::{at, idle, running, state, swift};

fn now() -> Timestamp {
    at(1_800_000_000.0)
}

fn status(title: &str, state: &str, category: &str) -> TicketWorkflowStatus {
    TicketWorkflowStatus {
        ticket_id: 123,
        title: title.to_string(),
        state: state.to_string(),
        category: category.to_string(),
    }
}

fn completed() -> TicketWorkflowStatus {
    status("Finished task", "Gereed", "Completed")
}

fn active() -> TicketWorkflowStatus {
    status("Task", "Active", "InProgress")
}

fn observe(
    monitor: &mut TicketCompletionMonitor,
    status: &TicketWorkflowStatus,
    tracking: &TrackingState,
) {
    monitor.observe(status, Some(tracking), "org", true, now());
}

#[test]
fn custom_completed_state_prompts_only_for_tracked_ticket() {
    let mut monitor = TicketCompletionMonitor::new();
    observe(&mut monitor, &completed(), &running(456));
    assert!(monitor.pending().is_none());
    observe(&mut monitor, &completed(), &running(123));
    let prompt = monitor.pending().expect("a prompt");
    assert_eq!(prompt.workflow_state, "Gereed");
    assert_eq!(
        (prompt.ticket_id, prompt.title.as_str(), prompt.notified),
        (123, "Finished task", false)
    );
    assert!(prompt.matches(Some(&running(123)), "org"));
    assert!(!prompt.matches(Some(&state(Some(123), "new")), "org"));
    assert!(!prompt.matches(Some(&running(123)), "other"));
    assert!(!prompt.matches(None, "org"));
}

#[test]
fn state_name_alone_never_implies_completion() {
    for category in ["Resolved", "InProgress", "Proposed", "Removed", "Unknown"] {
        let status = status("Task", "Done", category);
        let mut monitor = TicketCompletionMonitor::new();
        observe(&mut monitor, &status, &running(123));
        assert!(monitor.pending().is_none(), "{category}");
    }
}

#[test]
fn idle_and_unconfirmed_states_do_not_prompt() {
    let mut monitor = TicketCompletionMonitor::new();
    monitor.observe(&completed(), Some(&idle()), "org", true, now());
    monitor.observe(&completed(), Some(&running(123)), "org", false, now());
    monitor.observe(&completed(), Some(&running(123)), "", true, now());
    monitor.observe(&completed(), None, "org", true, now());
    assert!(monitor.pending().is_none());
}

#[test]
fn repeated_polling_preserves_prompt_and_notification_identity() {
    let mut monitor = TicketCompletionMonitor::new();
    observe(&mut monitor, &completed(), &running(123));
    let id = monitor.pending().map(|prompt| prompt.id);
    monitor.mark_notified();
    monitor = serde_json::from_str(&serde_json::to_string(&monitor).unwrap()).unwrap();
    observe(&mut monitor, &completed(), &running(123));
    assert_eq!(monitor.pending().map(|prompt| prompt.id), id);
    assert_eq!(monitor.pending().map(|prompt| prompt.notified), Some(true));
}

#[test]
fn keep_survives_restart_but_new_sessions_can_prompt() {
    let mut monitor = TicketCompletionMonitor::new();
    observe(&mut monitor, &completed(), &running(123));
    monitor.keep_tracking(now());
    monitor = serde_json::from_str(&serde_json::to_string(&monitor).unwrap()).unwrap();
    observe(&mut monitor, &completed(), &running(123));
    assert!(monitor.pending().is_none());
    observe(&mut monitor, &completed(), &state(Some(123), "new"));
    assert!(monitor.pending().is_some());
}

#[test]
fn reopened_ticket_clears_prompt_and_allows_later_completion() {
    let mut monitor = TicketCompletionMonitor::new();
    observe(&mut monitor, &completed(), &running(123));
    monitor.keep_tracking(now());
    observe(&mut monitor, &active(), &running(123));
    observe(&mut monitor, &completed(), &running(123));
    assert!(monitor.pending().is_some());
    observe(&mut monitor, &active(), &running(123));
    assert!(monitor.pending().is_none());
}

#[test]
fn stop_switch_and_workspace_changes_invalidate_prompt() {
    for (tracking, scope) in [(idle(), "org"), (running(456), "org"), (running(123), "other")] {
        let mut monitor = TicketCompletionMonitor::new();
        observe(&mut monitor, &completed(), &running(123));
        monitor.reconcile(Some(&tracking), scope);
        assert!(monitor.pending().is_none(), "{scope} {}", tracking.identity());
    }
}

#[test]
fn keep_lasts_thirty_days_and_clear_prompt_does_not_keep() {
    let mut monitor = TicketCompletionMonitor::new();
    observe(&mut monitor, &completed(), &running(123));
    monitor.keep_tracking(now());
    let month = TicketCompletionMonitor::KEEP_SECONDS;
    monitor.observe(&completed(), Some(&running(123)), "org", true, add_secs(now(), month - 1.0));
    assert!(monitor.pending().is_none());
    monitor.observe(&completed(), Some(&running(123)), "org", true, add_secs(now(), month));
    assert!(monitor.pending().is_some());
    monitor.clear_prompt();
    assert!(monitor.pending().is_none());
    observe(&mut monitor, &completed(), &running(123));
    assert!(monitor.pending().is_some(), "clearing is not a decision");
    // The completed category is matched ignoring case.
    let mut other = TicketCompletionMonitor::new();
    observe(&mut other, &status("Task", "Klaar", "COMPLETED"), &running(123));
    assert!(other.pending().is_some());
}

#[test]
fn swift_ticket_completion_state_decodes_including_dismissed_sessions() {
    // `ticketCompletion` in the 1.14.x state.json, including the private `dismissed` map.
    let kept = running(123).identity();
    let other = state(Some(123), "other").identity();
    let json = format!(
        r#"{{"pending":{{"id":"3F2504E0-4F89-11D3-9A0C-0305E82C3301","scope":"org","trackingIdentity":"{other}","ticketID":123,"title":"Finished task","workflowState":"Gereed","notified":true}},
            "dismissed":{{"org|{kept}":{kept_at}}}}}"#,
        kept_at = swift(add_secs(now(), -3600.0)),
    );
    let mut monitor: TicketCompletionMonitor = serde_json::from_str(&json).unwrap();
    let prompt = monitor.pending().expect("a prompt").clone();
    assert_eq!(prompt.id.to_string(), "3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    assert_eq!((prompt.ticket_id, prompt.notified), (123, true));
    assert!(prompt.matches(Some(&state(Some(123), "other")), "org"));
    // The stored "Keep tracking" still applies to its session.
    let written = serde_json::to_value(&monitor).unwrap();
    assert_eq!(written["pending"]["ticketId"], 123);
    assert!(written["dismissed"][format!("org|{kept}")].is_string());
    assert_eq!(serde_json::from_value::<TicketCompletionMonitor>(written).unwrap(), monitor);
    observe(&mut monitor, &completed(), &running(123));
    assert!(monitor.pending().is_none());
    // Without a prompt or decisions, every key is optional.
    let empty: TicketCompletionMonitor = serde_json::from_str(r#"{"dismissed":{}}"#).unwrap();
    assert_eq!(empty, TicketCompletionMonitor::default());
    assert_eq!(serde_json::from_str::<TicketCompletionMonitor>("{}").unwrap(), empty);
}
