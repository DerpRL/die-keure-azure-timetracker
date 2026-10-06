//! Ported from MicrophoneTrackingEndTests.swift.

#[path = "support/context.rs"]
mod support;

use std::collections::BTreeSet;

use att_core::microphone::{MicrophoneApp, MicrophoneOwner, MicrophoneSession};
use att_core::microphone_end::{
    MicrophoneEndObservation, MicrophoneTrackingLink, MicrophoneTrackingMonitor,
};
use att_core::model::TrackingState;
use jiff::Timestamp;
use support::{at, idle, running, state, swift};

const SLACK: &str = "com.tinyspeck.slackmacgap";
const ZOOM: &str = "us.zoom.xos";

fn started() -> Timestamp {
    at(1_800_000_000.0)
}

fn slack() -> MicrophoneSession {
    MicrophoneSession::new("slack-call", MicrophoneOwner::new(SLACK, "Slack"), started())
}

fn zoom() -> MicrophoneSession {
    MicrophoneSession::new("zoom-call", MicrophoneOwner::new(ZOOM, "Zoom"), started())
}

/// The Swift test helper's labelled arguments and defaults.
struct Poll<'a> {
    sessions: &'a [MicrophoneSession],
    input: &'a [&'a str],
    ended: &'a [&'a str],
    workspace: &'a str,
    fresh: bool,
    confirmed: bool,
}

impl Default for Poll<'_> {
    fn default() -> Self {
        Self {
            sessions: &[],
            input: &[],
            ended: &[],
            workspace: "org",
            fresh: true,
            confirmed: true,
        }
    }
}

fn observe(monitor: &mut MicrophoneTrackingMonitor, state: Option<&TrackingState>, poll: Poll<'_>) {
    let input: BTreeSet<String> = poll.input.iter().map(|id| id.to_string()).collect();
    let ended: BTreeSet<String> = poll.ended.iter().map(|id| id.to_string()).collect();
    monitor.observe(&MicrophoneEndObservation {
        sessions: poll.sessions,
        input_app_ids: &input,
        ended: &ended,
        state,
        workspace: poll.workspace,
        fresh: poll.fresh,
        confirmed: poll.confirmed,
        now: at(1_800_000_600.0),
    });
}

fn tracking() -> TrackingState {
    serde_json::from_str(
        r#"{"track":{"trackingState":"tracking","workLogId":"standup-log","remark":"daily standup","activityTypeId":"standup"}}"#,
    )
    .unwrap()
}

#[test]
fn standalone_ticket_free_meeting_offers_end_without_previous_ticket() {
    let state = tracking();
    let mut monitor = MicrophoneTrackingMonitor::new();
    observe(
        &mut monitor,
        Some(&state),
        Poll { sessions: &[slack()], input: &[SLACK], ..Poll::default() },
    );
    observe(&mut monitor, Some(&state), Poll { ended: &["slack-call"], ..Poll::default() });
    let prompt = monitor.pending().expect("a prompt");
    assert_eq!(prompt.app_names, ["Slack"]);
    assert!(prompt.is_valid(Some(&state), "org"));
    assert_eq!(prompt.ended_at, at(1_800_000_600.0));
    assert!(monitor.links().is_empty());
}

#[test]
fn current_work_can_be_tracked_through_a_call_without_using_start_suggestion() {
    let running = running(33984);
    let mut monitor = MicrophoneTrackingMonitor::new();
    observe(
        &mut monitor,
        Some(&running),
        Poll { sessions: &[slack()], input: &[SLACK], ..Poll::default() },
    );
    observe(&mut monitor, Some(&running), Poll { ended: &["slack-call"], ..Poll::default() });
    assert_eq!(monitor.pending().map(|p| p.tracking_identity.clone()), Some(running.identity()));
}

#[test]
fn idle_and_unbound_timers_do_not_prompt() {
    let mut monitor = MicrophoneTrackingMonitor::new();
    observe(
        &mut monitor,
        Some(&idle()),
        Poll { sessions: &[slack()], input: &[SLACK], ..Poll::default() },
    );
    observe(&mut monitor, Some(&tracking()), Poll { ended: &["slack-call"], ..Poll::default() });
    assert!(monitor.pending().is_none());
}

#[test]
fn short_mute_waits_for_engine_to_confirm_end() {
    let mut monitor = MicrophoneTrackingMonitor::new();
    let state = tracking();
    observe(
        &mut monitor,
        Some(&state),
        Poll { sessions: &[slack()], input: &[SLACK], ..Poll::default() },
    );
    observe(&mut monitor, Some(&state), Poll { sessions: &[slack()], ..Poll::default() });
    assert!(monitor.pending().is_none());
    observe(&mut monitor, Some(&state), Poll { ended: &["slack-call"], ..Poll::default() });
    assert!(monitor.pending().is_some());
}

#[test]
fn failures_and_disconnected_state_never_establish_end() {
    let mut monitor = MicrophoneTrackingMonitor::new();
    let state = tracking();
    observe(
        &mut monitor,
        Some(&state),
        Poll { sessions: &[slack()], input: &[SLACK], ..Poll::default() },
    );
    observe(
        &mut monitor,
        Some(&state),
        Poll { ended: &["slack-call"], fresh: false, ..Poll::default() },
    );
    observe(
        &mut monitor,
        Some(&state),
        Poll { ended: &["slack-call"], confirmed: false, ..Poll::default() },
    );
    assert!(monitor.pending().is_none());
    assert_eq!(monitor.links().len(), 1);
    observe(&mut monitor, Some(&state), Poll { ended: &["slack-call"], ..Poll::default() });
    assert!(monitor.pending().is_some());
}

#[test]
fn another_app_still_using_input_defers_ending() {
    let mut monitor = MicrophoneTrackingMonitor::new();
    let state = tracking();
    let both = Poll { sessions: &[slack(), zoom()], input: &[SLACK, ZOOM], ..Poll::default() };
    observe(&mut monitor, Some(&state), both);
    let zoom_only =
        Poll { sessions: &[zoom()], input: &[ZOOM], ended: &["slack-call"], ..Poll::default() };
    observe(&mut monitor, Some(&state), zoom_only);
    assert!(monitor.pending().is_none());
    observe(
        &mut monitor,
        Some(&state),
        Poll { ended: &["slack-call", "zoom-call"], ..Poll::default() },
    );
    assert_eq!(monitor.pending().map(|p| p.app_names.clone()), Some(vec!["Zoom".to_string()]));
}

#[test]
fn newer_timer_during_absence_cannot_be_stopped_by_old_reminder() {
    let mut monitor = MicrophoneTrackingMonitor::new();
    let (old, new) = (tracking(), state(Some(123), "new"));
    observe(
        &mut monitor,
        Some(&old),
        Poll { sessions: &[slack()], input: &[SLACK], ..Poll::default() },
    );
    observe(&mut monitor, Some(&new), Poll { sessions: &[slack()], ..Poll::default() });
    observe(&mut monitor, Some(&new), Poll { ended: &["slack-call"], ..Poll::default() });
    assert!(monitor.pending().is_none());
    assert!(monitor.links().is_empty());
}

#[test]
fn switch_during_active_input_binds_new_timer_and_old_prompt_expires() {
    let mut monitor = MicrophoneTrackingMonitor::new();
    let (old, next) = (tracking(), state(Some(123), "next"));
    observe(
        &mut monitor,
        Some(&old),
        Poll { sessions: &[slack()], input: &[SLACK], ..Poll::default() },
    );
    observe(
        &mut monitor,
        Some(&next),
        Poll { sessions: &[slack()], input: &[SLACK], ..Poll::default() },
    );
    observe(&mut monitor, Some(&next), Poll { ended: &["slack-call"], ..Poll::default() });
    let prompt = monitor.pending().expect("a prompt").clone();
    assert_eq!(prompt.tracking_identity, next.identity());
    assert!(!prompt.is_valid(Some(&old), "org"));
    monitor.reconcile(Some(&old), "org");
    assert!(monitor.pending().is_none());
}

#[test]
fn keep_does_not_repeat_and_input_resumption_dismisses_prompt() {
    let state = tracking();
    let mut monitor = MicrophoneTrackingMonitor::new();
    observe(
        &mut monitor,
        Some(&state),
        Poll { sessions: &[slack()], input: &[SLACK], ..Poll::default() },
    );
    observe(&mut monitor, Some(&state), Poll { ended: &["slack-call"], ..Poll::default() });
    monitor.mark_notified();
    assert_eq!(monitor.pending().map(|p| p.notified), Some(true));
    monitor.dismiss();
    observe(&mut monitor, Some(&state), Poll { ended: &["slack-call"], ..Poll::default() });
    assert!(monitor.pending().is_none());
    observe(
        &mut monitor,
        Some(&state),
        Poll { sessions: &[zoom()], input: &[ZOOM], ..Poll::default() },
    );
    observe(&mut monitor, Some(&state), Poll { ended: &["zoom-call"], ..Poll::default() });
    assert!(monitor.pending().is_some());
    observe(
        &mut monitor,
        Some(&state),
        Poll { input: &[SLACK], ended: &["zoom-call"], ..Poll::default() },
    );
    assert!(monitor.pending().is_none());
}

#[test]
fn restarts_preserve_associations_and_prompt_deduplication() {
    let state = tracking();
    let mut monitor = MicrophoneTrackingMonitor::new();
    observe(
        &mut monitor,
        Some(&state),
        Poll { sessions: &[slack()], input: &[SLACK], ..Poll::default() },
    );
    monitor = serde_json::from_str(&serde_json::to_string(&monitor).unwrap()).unwrap();
    assert_eq!(
        monitor.links().get("slack-call").map(MicrophoneTrackingLink::session),
        Some(slack())
    );
    observe(&mut monitor, Some(&state), Poll { ended: &["slack-call"], ..Poll::default() });
    monitor.mark_notified();
    let restored: MicrophoneTrackingMonitor =
        serde_json::from_str(&serde_json::to_string(&monitor).unwrap()).unwrap();
    assert_eq!(restored, monitor);
    assert_eq!(restored.pending().map(|p| p.notified), Some(true));
}

#[test]
fn stopped_tracking_workspace_changes_and_disabled_categories_clear_bindings() {
    let state = tracking();
    let mut monitor = MicrophoneTrackingMonitor::new();
    observe(
        &mut monitor,
        Some(&state),
        Poll { sessions: &[slack()], input: &[SLACK], ..Poll::default() },
    );
    monitor.restrict(&BTreeSet::from([MicrophoneApp::Zoom]), "org");
    assert!(monitor.links().is_empty());
    observe(
        &mut monitor,
        Some(&state),
        Poll { sessions: &[slack()], input: &[SLACK], ..Poll::default() },
    );
    observe(
        &mut monitor,
        Some(&state),
        Poll { ended: &["slack-call"], workspace: "other", ..Poll::default() },
    );
    assert!(monitor.pending().is_none());
    observe(
        &mut monitor,
        Some(&state),
        Poll { sessions: &[slack()], input: &[SLACK], ..Poll::default() },
    );
    observe(&mut monitor, Some(&idle()), Poll { ended: &["slack-call"], ..Poll::default() });
    assert!(monitor.pending().is_none());
    assert!(monitor.links().is_empty());
}

#[test]
fn windows_owners_bind_and_restrict_by_executable_category() {
    let state = tracking();
    let teams = MicrophoneSession::new(
        "teams-call",
        MicrophoneOwner::new("ms-teams.exe", "Microsoft Teams"),
        started(),
    );
    let mut monitor = MicrophoneTrackingMonitor::new();
    observe(
        &mut monitor,
        Some(&state),
        Poll { sessions: &[teams], input: &["ms-teams.exe"], ..Poll::default() },
    );
    monitor.restrict(&BTreeSet::from([MicrophoneApp::Teams]), "org");
    assert_eq!(monitor.links().len(), 1);
    observe(&mut monitor, Some(&state), Poll { ended: &["teams-call"], ..Poll::default() });
    assert_eq!(
        monitor.pending().map(|p| p.app_names.clone()),
        Some(vec!["Microsoft Teams".to_string()])
    );
}

#[test]
fn swift_microphone_tracking_state_decodes() {
    // `microphoneTracking` in the 1.14.x state.json, with Swift keys and dates.
    let state = tracking();
    let json = format!(
        r#"{{"links":{{"slack-call":{{"sessionID":"slack-call","appID":"{SLACK}","appName":"Slack","started":{started},"workspace":"org","trackingIdentity":"{identity}"}}}},
            "pending":{{"id":"E621E1F8-C36C-495A-93FC-0C247A3E6E5F","workspace":"org","trackingIdentity":"{identity}","appNames":["Zoom"],"endedAt":{ended},"notified":true}}}}"#,
        started = swift(started()),
        identity = state.identity(),
        ended = swift(at(1_800_000_300.0)),
    );
    let monitor: MicrophoneTrackingMonitor = serde_json::from_str(&json).unwrap();
    assert_eq!(
        monitor.links().get("slack-call").map(MicrophoneTrackingLink::session),
        Some(slack())
    );
    let prompt = monitor.pending().expect("a prompt");
    assert_eq!(prompt.id.to_string(), "e621e1f8-c36c-495a-93fc-0c247a3e6e5f");
    assert_eq!(prompt.app_names, ["Zoom"]);
    assert!(prompt.notified);
    assert_eq!(prompt.ended_at, at(1_800_000_300.0));
    assert!(prompt.is_valid(Some(&state), "org"));
    // Writes camelCase keys and RFC 3339 dates, and reads them back.
    let written = serde_json::to_value(&monitor).unwrap();
    assert_eq!(written["links"]["slack-call"]["sessionId"], "slack-call");
    assert_eq!(written["links"]["slack-call"]["appId"], SLACK);
    assert!(written["pending"]["endedAt"].is_string());
    assert_eq!(serde_json::from_value::<MicrophoneTrackingMonitor>(written).unwrap(), monitor);
    // A monitor without a prompt, or without any keys, also loads.
    let empty: MicrophoneTrackingMonitor = serde_json::from_str(r#"{"links":{}}"#).unwrap();
    assert_eq!(empty, MicrophoneTrackingMonitor::default());
    assert_eq!(serde_json::from_str::<MicrophoneTrackingMonitor>("{}").unwrap(), empty);
    assert_eq!(serde_json::to_string(&empty).unwrap(), r#"{"links":{}}"#);
}
