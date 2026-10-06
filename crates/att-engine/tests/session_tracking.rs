//! Tracking flows: branch change → prompt → activity draft → confirmed start (stop then start,
//! revalidation, no replay after a failure, one reconciling read), pause/resume, manual
//! tracking, integration branches and quick switch.

mod support;

use serde_json::{Value, json};

use att_core::AppError;
use att_core::model::Repository;
use support::*;

fn draft_id(h: &Harness) -> String {
    h.slice("flow")["draft"]["id"].as_str().expect("a draft").to_string()
}

fn audit_titles(h: &Harness) -> Vec<String> {
    h.slice("history")["audit"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["title"].as_str().unwrap().to_string())
        .collect()
}

/// A connected engine watching one repository whose baseline is established.
async fn watching(branch: &str, current: att_core::model::TrackingState) -> (Harness, TempDir, std::path::PathBuf) {
    let dir = TempDir::new();
    let root = dir.repository("webshop", branch);
    let repository = Repository::new(root.to_string_lossy());
    let h = Harness::new(configuration(vec![repository]));
    h.seven_pace.set_current(current);
    h.start().await;
    // Two identical readings commit the baseline without a prompt.
    h.tick().await;
    h.tick().await;
    assert_eq!(h.slice("prompts")["branches"], json!([]));
    h.shell();
    h.seven_pace.take_calls();
    (h, dir, root)
}

async fn switch_branch(h: &Harness, root: &std::path::Path, branch: &str) -> Value {
    set_branch(root, branch);
    h.tick().await;
    assert_eq!(h.slice("prompts")["branches"], json!([]), "one reading is not enough");
    h.tick().await;
    h.slice("prompts")["branches"][0].clone()
}

#[tokio::test]
async fn a_branch_change_prompts_and_switches_only_after_confirmation() {
    let (h, _dir, root) =
        watching("feature/4821-card-retry", running(Some(4821), Some("dev"), None)).await;
    let prompt = switch_branch(&h, &root, "feature/33984-improve-loading").await;
    assert_eq!(prompt["change"]["ticketId"], 33984);
    assert_eq!(prompt["change"]["previousBranch"], "feature/4821-card-retry");
    assert_eq!(prompt["ticketTitle"], "Improve loading");
    assert_eq!(prompt["suggestsBreak"], false);
    assert_eq!(h.slice("app")["pages"][0]["badge"], 1);
    let change_id = prompt["change"]["id"].as_str().unwrap().to_string();
    // Default interruption: the panel without focus, a notification while the window is hidden.
    assert_eq!(h.shell(), vec!["show_panel(focus=false)".to_string(), format!("notify({change_id})")]);
    assert!(audit_titles(&h).contains(&"Branch changed".to_string()));

    h.ok(json!({"type": "branch.track", "id": change_id})).await;
    let flow = h.slice("flow");
    assert_eq!(flow["surface"], "panel");
    assert_eq!(flow["draft"]["source"], "branch");
    assert_eq!(flow["draft"]["item"]["id"], 33984);
    assert_eq!(flow["draft"]["allowsNoTicket"], true);
    assert_eq!(flow["draft"]["startableActivityIds"], json!(["dev", "design", "meeting", "standup"]));
    assert!(h.seven_pace.writes().is_empty(), "choosing an activity is read-only");

    let id = draft_id(&h);
    h.ok(json!({"type": "tracking.start", "draftId": id, "activityId": "dev", "comment": "", "includeTicket": true})).await;
    assert_eq!(
        h.seven_pace.writes(),
        vec!["stop".to_string(), r#"start(Some(33984),Some("dev"),Some("feature/33984-improve-loading"))"#.to_string()]
    );
    let tracking = h.slice("tracking");
    assert_eq!(tracking["running"], true);
    assert_eq!(tracking["ticketId"], 33984);
    assert_eq!(h.slice("prompts")["branches"], json!([]), "the suggestion is resolved");
    assert_eq!(h.slice("flow")["surface"], "none");
    assert_eq!(h.slice("flow")["quickTickets"][0]["ticketId"], 33984);
    let audit = h.slice("history")["audit"].clone();
    assert_eq!(audit[0]["title"], "Tracking started");
    assert_eq!(audit[0]["detail"], "#33984 · Improve loading · Development");
}

#[tokio::test]
async fn a_failed_write_is_reconciled_with_one_read_and_never_replayed() {
    let (h, _dir, root) =
        watching("feature/4821-card-retry", running(Some(4821), Some("dev"), None)).await;
    let prompt = switch_branch(&h, &root, "feature/33984-improve-loading").await;
    h.ok(json!({"type": "branch.track", "id": prompt["change"]["id"]})).await;
    h.seven_pace.take_calls();
    h.seven_pace.server.lock().unwrap().fail_start = Some(AppError::Timeout);
    let id = draft_id(&h);
    h.ok(json!({"type": "tracking.start", "draftId": id, "activityId": "dev", "comment": "", "includeTicket": true})).await;
    let calls = h.seven_pace.take_calls();
    let writes: Vec<&String> = calls.iter().filter(|call| !call.starts_with("current") && !call.starts_with("workLogs")).collect();
    assert_eq!(writes.len(), 2, "stop and start, each once: {calls:?}");
    assert_eq!(calls.last().unwrap(), "current", "reconciled with a read: {calls:?}");
    // The stop reached 7pace, the start timed out: the shown state is the server's.
    assert_eq!(h.slice("tracking")["running"], false);
    assert_eq!(
        h.slice("app")["error"],
        "The request timed out. Refresh to see what 7pace recorded before trying again."
    );
    assert_eq!(h.slice("flow")["draft"], Value::Null, "a later attempt needs a new confirmation");
    assert_eq!(audit_titles(&h)[0], "Tracking needs attention");
    // The old draft cannot be replayed.
    h.ok(json!({"type": "tracking.start", "draftId": id, "activityId": "dev", "comment": "", "includeTicket": true})).await;
    assert!(h.seven_pace.writes().is_empty());
}

#[tokio::test]
async fn the_branch_is_read_again_before_the_write() {
    let (h, _dir, root) =
        watching("feature/4821-card-retry", running(Some(4821), Some("dev"), None)).await;
    let prompt = switch_branch(&h, &root, "feature/33984-improve-loading").await;
    h.ok(json!({"type": "branch.track", "id": prompt["change"]["id"]})).await;
    h.seven_pace.take_calls();
    // The user switched again before confirming.
    set_branch(&root, "feature/4790-vat");
    let id = draft_id(&h);
    h.ok(json!({"type": "tracking.start", "draftId": id, "activityId": "dev", "comment": "", "includeTicket": true})).await;
    assert!(h.seven_pace.writes().is_empty());
    assert_eq!(h.slice("app")["error"], "This repository changed branches again. Review the latest suggestion.");
    assert_eq!(h.slice("tracking")["ticketId"], 4821, "the timer is unchanged");
    assert_eq!(h.slice("prompts")["branches"], json!([]));
}

#[tokio::test]
async fn a_changed_remote_timer_prevents_every_write() {
    let (h, _dir, root) =
        watching("feature/4821-card-retry", running(Some(4821), Some("dev"), None)).await;
    let prompt = switch_branch(&h, &root, "feature/33984-improve-loading").await;
    h.ok(json!({"type": "branch.track", "id": prompt["change"]["id"]})).await;
    // Another client switched the timer meanwhile.
    h.seven_pace.set_current(TrackingStateExt::other());
    h.seven_pace.take_calls();
    let id = draft_id(&h);
    h.ok(json!({"type": "tracking.start", "draftId": id, "activityId": "dev", "comment": "", "includeTicket": true})).await;
    assert!(h.seven_pace.writes().is_empty());
    assert_eq!(
        h.slice("app")["error"],
        "Your timer changed in 7pace or another app. The current state has been refreshed; review it and try again."
    );
    assert_eq!(h.slice("tracking")["ticketId"], 4790, "reconciled with the server state");
}

struct TrackingStateExt;

impl TrackingStateExt {
    fn other() -> att_core::model::TrackingState {
        att_core::model::TrackingState::with_track(track(
            Some(4790),
            Some("dev"),
            None,
            "wl-other",
            "2026-10-06T09:59:00",
        ))
    }
}

#[tokio::test]
async fn pause_remembers_the_task_and_resume_needs_a_confirmed_start() {
    let h = Harness::new(configuration(vec![]));
    h.seven_pace.set_current(running(Some(4821), Some("dev"), None));
    h.start().await;
    h.seven_pace.take_calls();
    h.ok(json!({"type": "tracking.pause"})).await;
    assert_eq!(h.seven_pace.writes(), vec!["stop".to_string()]);
    let tracking = h.slice("tracking");
    assert_eq!(tracking["running"], false);
    assert_eq!(tracking["paused"]["ticketId"], 4821);
    assert_eq!(tracking["paused"]["activityId"], "dev");
    assert_eq!(tracking["paused"]["title"], "Card retry");
    assert_eq!(tracking["paused"]["elapsedSeconds"], 600.0);
    assert_eq!(tracking["elapsedBase"], 600.0, "the paused clock stands still");
    assert_eq!(h.slice("connection")["indicator"], "paused");
    assert_eq!(audit_titles(&h)[0], "Tracking paused");

    h.ok(json!({"type": "tracking.resume"})).await;
    let draft = h.slice("flow")["draft"].clone();
    assert_eq!(draft["source"], "resume");
    assert_eq!(draft["resume"], true);
    assert_eq!(draft["allowsNoTicket"], false);
    assert_eq!(draft["preferredActivityId"], "dev");
    h.seven_pace.take_calls();
    let id = draft_id(&h);
    h.ok(json!({"type": "tracking.start", "draftId": id, "activityId": "dev", "comment": "", "includeTicket": false})).await;
    assert_eq!(h.seven_pace.writes(), vec![r#"start(Some(4821),Some("dev"),None)"#.to_string()]);
    assert_eq!(h.slice("tracking")["paused"], Value::Null);
    assert_eq!(h.slice("tracking")["running"], true);
}

#[tokio::test]
async fn a_ticket_free_pause_resumes_with_its_comment_and_can_be_cleared() {
    let h = Harness::new(configuration(vec![]));
    h.seven_pace.set_current(running(None, Some("meeting"), Some("Planning")));
    h.start().await;
    h.ok(json!({"type": "tracking.pause"})).await;
    assert_eq!(h.slice("tracking")["paused"]["title"], "Planning");
    h.ok(json!({"type": "tracking.resume"})).await;
    h.seven_pace.take_calls();
    let id = draft_id(&h);
    h.ok(json!({"type": "tracking.start", "draftId": id, "activityId": "meeting", "comment": "", "includeTicket": true})).await;
    assert_eq!(h.seven_pace.writes(), vec![r#"start(None,Some("meeting"),Some("Planning"))"#.to_string()]);

    h.ok(json!({"type": "tracking.pause"})).await;
    h.ok(json!({"type": "tracking.discardPause"})).await;
    assert_eq!(h.slice("tracking")["paused"], Value::Null);
    assert_eq!(h.slice("connection")["indicator"], "stopped");
}

#[tokio::test]
async fn stand_ups_need_the_standup_activity() {
    let h = Harness::new(configuration(vec![]));
    h.start().await;
    h.shell();
    h.ok(json!({"type": "tracking.openPicker"})).await;
    assert_eq!(h.shell(), vec!["show_main()".to_string()]);
    h.ok(json!({"type": "tracking.chooseManual", "kind": "standup"})).await;
    let flow = h.slice("flow");
    assert_eq!(flow["surface"], "picker");
    assert_eq!(flow["draft"]["standup"], true);
    assert_eq!(flow["draft"]["title"], "Stand-up");
    assert_eq!(flow["draft"]["allowedActivityIds"], json!(["standup"]));
    assert_eq!(flow["draft"]["startableActivityIds"], json!(["standup"]));
    assert_eq!(flow["draft"]["preferredActivityId"], "standup");
    assert_eq!(flow["draft"]["defaultComment"], "daily standup");

    let id = draft_id(&h);
    h.ok(json!({"type": "tracking.start", "draftId": id, "activityId": "dev", "comment": "", "includeTicket": true})).await;
    assert!(h.seven_pace.writes().is_empty());
    assert_eq!(h.slice("app")["error"], "The Standup activity is required to track daily standup.");
    assert_eq!(h.slice("flow")["draft"], Value::Null);

    h.ok(json!({"type": "tracking.openPicker"})).await;
    h.ok(json!({"type": "tracking.chooseManual", "kind": "standup"})).await;
    let id = draft_id(&h);
    h.ok(json!({"type": "tracking.start", "draftId": id, "activityId": "standup", "comment": " ", "includeTicket": true})).await;
    assert_eq!(h.seven_pace.writes(), vec![r#"start(None,Some("standup"),Some("daily standup"))"#.to_string()]);
    let audit = h.slice("history")["audit"].clone();
    assert_eq!(audit[0]["detail"], "daily standup · Standup");
}

#[tokio::test]
async fn integration_branches_offer_pause_or_stop_and_never_a_ticket() {
    let (h, _dir, root) =
        watching("feature/4821-card-retry", running(Some(4821), Some("dev"), None)).await;
    let prompt = switch_branch(&h, &root, "develop").await;
    assert_eq!(prompt["suggestsBreak"], true);
    assert_eq!(prompt["change"]["ticketId"], Value::Null);
    let id = prompt["change"]["id"].clone();
    h.ok(json!({"type": "branch.track", "id": id})).await;
    assert_eq!(h.slice("flow")["draft"], Value::Null);
    assert_eq!(h.slice("app")["error"], "This branch suggests pausing or stopping your current timer.");
    h.ok(json!({"type": "branch.pause", "id": id})).await;
    assert_eq!(h.seven_pace.writes(), vec!["stop".to_string()]);
    assert_eq!(h.slice("tracking")["paused"]["ticketId"], 4821);
    assert_eq!(h.slice("prompts")["branches"], json!([]));

    // Resume, then a long-feature branch: stop without remembering a pause.
    h.ok(json!({"type": "tracking.resume"})).await;
    let draft = draft_id(&h);
    h.ok(json!({"type": "tracking.start", "draftId": draft, "activityId": "dev", "comment": "", "includeTicket": true})).await;
    h.seven_pace.take_calls();
    let prompt = switch_branch(&h, &root, "long-feature/payments").await;
    assert_eq!(prompt["suggestsBreak"], true);
    h.ok(json!({"type": "branch.stop", "id": prompt["change"]["id"]})).await;
    assert_eq!(h.seven_pace.writes(), vec!["stop".to_string()]);
    assert_eq!(h.slice("tracking")["running"], false);
    assert_eq!(h.slice("tracking")["paused"], Value::Null);
    assert_eq!(audit_titles(&h)[0], "Tracking stopped");
}

#[tokio::test]
async fn keeping_a_branch_records_it_and_the_running_ticket_needs_no_prompt() {
    let (h, _dir, root) =
        watching("feature/4821-card-retry", running(Some(4821), Some("dev"), None)).await;
    let prompt = switch_branch(&h, &root, "feature/33984-improve-loading").await;
    h.ok(json!({"type": "branch.keep", "id": prompt["change"]["id"]})).await;
    assert_eq!(h.slice("prompts")["branches"], json!([]));
    assert_eq!(audit_titles(&h)[0], "Kept current tracking");
    // Back on the running ticket's branch: nothing to decide.
    let prompt = switch_branch(&h, &root, "feature/4821-card-retry").await;
    assert_eq!(prompt, Value::Null);
}

#[tokio::test]
async fn quick_switch_offers_favourites_then_recent_tickets_with_titles() {
    let h = Harness::new(configuration(vec![]));
    h.start().await;
    h.ok(json!({"type": "quick.toggleFavorite", "ticketId": 4790})).await;
    h.shell();
    h.ok(json!({"type": "quick.switch"})).await;
    assert_eq!(h.shell(), vec!["show_panel(focus=true)".to_string()]);
    let flow = h.slice("flow");
    assert_eq!(flow["surface"], "panel");
    assert_eq!(flow["quickTickets"][0], json!({"ticketId": 4790, "title": "Invoice VAT number", "favorite": true}));
    h.ok(json!({"type": "tracking.chooseTicket", "ticketId": 4790})).await;
    assert_eq!(h.slice("flow")["draft"]["item"]["id"], 4790);
    assert_eq!(h.slice("flow")["surface"], "panel");
    h.ok(json!({"type": "tracking.cancelPanel"})).await;
    assert_eq!(h.slice("flow")["surface"], "none");
    assert_eq!(h.slice("flow")["draft"], Value::Null);
}

#[tokio::test]
async fn ticket_search_looks_numbers_up_and_closing_the_picker_clears_it() {
    let h = Harness::new(configuration(vec![]));
    h.start().await;
    h.ok(json!({"type": "tracking.openPicker"})).await;
    h.ok(json!({"type": "tracking.search", "query": "#33984"})).await;
    let search = h.slice("flow")["search"].clone();
    assert_eq!(search["results"][0]["title"], "Improve loading");
    assert!(h.azure.calls.lock().unwrap().contains(&"workItem(33984)".to_string()));
    h.ok(json!({"type": "tracking.chooseTicket", "ticketId": 33984})).await;
    assert_eq!(h.slice("flow")["surface"], "picker");
    h.ok(json!({"type": "tracking.closePicker"})).await;
    let flow = h.slice("flow");
    assert_eq!(flow["surface"], "none");
    assert_eq!(flow["draft"], Value::Null);
}

#[tokio::test]
async fn track_again_from_history_opens_the_picker_chooser() {
    let h = Harness::new(configuration(vec![]));
    h.start().await;
    h.ok(json!({"type": "tracking.chooseTicket", "ticketId": 4821})).await;
    let flow = h.slice("flow");
    assert_eq!(flow["surface"], "picker");
    assert_eq!(flow["draft"]["source"], "ticket");
    assert_eq!(flow["draft"]["commentWithTicket"], Value::Null);
    assert_eq!(flow["draft"]["commentWithoutTicket"], "Card retry");
    let id = draft_id(&h);
    h.ok(json!({"type": "tracking.start", "draftId": id, "activityId": "dev", "comment": "", "includeTicket": false})).await;
    // Ticket switched off: the title becomes the comment.
    assert_eq!(h.seven_pace.writes(), vec![r#"start(None,Some("dev"),Some("Card retry"))"#.to_string()]);
}

#[tokio::test]
async fn writes_are_refused_while_another_is_in_flight() {
    let h = std::sync::Arc::new(Harness::new(configuration(vec![])));
    h.seven_pace.set_current(running(Some(4821), Some("dev"), None));
    h.start().await;
    let gate = std::sync::Arc::new(tokio::sync::Semaphore::new(0));
    *h.seven_pace.gate.lock().unwrap() = Some(gate.clone());
    let refresh = {
        let h = h.clone();
        tokio::spawn(async move { h.engine().dispatch(json!({"type": "connection.refresh"})).await })
    };
    settle().await;
    assert_eq!(h.slice("app")["busy"], true);
    let error = h.dispatch(json!({"type": "tracking.stop"})).await.unwrap_err();
    assert_eq!(error.kind, "busy");
    gate.add_permits(10);
    refresh.await.unwrap().unwrap();
    assert_eq!(h.slice("app")["busy"], false);
    assert!(h.seven_pace.writes().is_empty());
}
