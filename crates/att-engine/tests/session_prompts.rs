//! Prompts: tracking attention, completed tickets, calendar meetings and the meeting return,
//! microphone meetings and the meeting-ended prompt, and the day review.

mod support;

use serde_json::{Value, json};

use att_core::model::{ActivityCheck, TrackingState};
use att_platform::{CalendarEvent, EventStatus, InputOwner};
use support::*;

fn draft_id(h: &Harness) -> String {
    h.slice("flow")["draft"]["id"].as_str().expect("a draft").to_string()
}

fn start_intent(h: &Harness, activity: &str) -> Value {
    json!({"type": "tracking.start", "draftId": draft_id(h), "activityId": activity, "comment": "", "includeTicket": true})
}

// -- tracking attention -------------------------------------------------------------------------

#[tokio::test]
async fn a_server_stop_is_announced_once_and_can_stay_stopped() {
    let h = Harness::new(configuration(vec![]));
    h.seven_pace.set_current(stopped_at_limit(4821));
    h.start().await;
    let attention = h.slice("tracking")["attention"].clone();
    assert_eq!(attention["reason"], "timeLimit");
    assert_eq!(attention["heading"], "7pace stopped your timer at its time limit");
    assert_eq!(attention["stopped"], true);
    assert_eq!(h.slice("connection")["indicator"], "attention");
    h.shell();
    h.tick().await;
    assert_eq!(
        h.shell(),
        vec!["show_panel(focus=false)".to_string(), "notify(tracking-attention)".to_string()]
    );
    h.tick().await;
    h.ok(json!({"type": "connection.refresh"})).await;
    h.tick().await;
    assert!(!h.shell().iter().any(|call| call.starts_with("show_panel")), "announced once");

    h.ok(json!({"type": "attention.keepStopped"})).await;
    assert_eq!(h.slice("tracking")["attention"], Value::Null);
    assert_eq!(h.shell(), vec!["remove_notification(tracking-attention)".to_string()]);
    h.ok(json!({"type": "connection.refresh"})).await;
    assert_eq!(h.slice("tracking")["attention"], Value::Null, "kept stopped stays dismissed");
}

#[tokio::test]
async fn continuing_after_a_server_stop_needs_a_confirmed_new_session() {
    let h = Harness::new(configuration(vec![]));
    h.seven_pace.set_current(stopped_at_limit(4821));
    h.start().await;
    h.shell();
    h.ok(json!({"type": "attention.continue"})).await;
    let draft = h.slice("flow")["draft"].clone();
    assert_eq!(draft["source"], "attention");
    assert_eq!(draft["item"]["id"], 4821);
    assert_eq!(draft["preferredActivityId"], "dev");
    assert_eq!(draft["allowsNoTicket"], false);
    assert_eq!(h.slice("flow")["surface"], "panel");
    assert!(h.shell().contains(&"show_panel(focus=true)".to_string()));
    assert!(h.seven_pace.writes().is_empty());
    h.ok(start_intent(&h, "dev")).await;
    // Already stopped by 7pace: only a start, for the same task.
    assert_eq!(h.seven_pace.writes(), vec![r#"start(Some(4821),Some("dev"),None)"#.to_string()]);
    assert_eq!(h.slice("tracking")["attention"], Value::Null);
}

#[tokio::test]
async fn an_activity_check_is_answered_with_a_confirmation() {
    let h = Harness::new(configuration(vec![]));
    let mut state: TrackingState = running(Some(4821), Some("dev"), None);
    state.track.as_mut().unwrap().activity_check =
        Some(ActivityCheck { is_running: Some(true), seconds_left: Some(60) });
    h.seven_pace.set_current(state);
    h.start().await;
    assert_eq!(h.slice("tracking")["attention"]["reason"], "activityCheck");
    assert_eq!(h.slice("tracking")["attention"]["stopped"], false);
    h.ok(json!({"type": "attention.continue"})).await;
    let writes = h.seven_pace.writes();
    assert_eq!(writes.len(), 1);
    assert!(writes[0].starts_with("confirm(Some(\"activityCheck|wl-0|"), "{writes:?}");
    assert_eq!(h.slice("tracking")["attention"], Value::Null);
}

// -- ticket completion ---------------------------------------------------------------------------

#[tokio::test]
async fn a_completed_ticket_prompts_once_and_stop_rechecks_azure() {
    let h = Harness::new(configuration(vec![]));
    h.seven_pace.set_current(running(Some(33984), Some("dev"), None));
    h.azure.complete(33984, "Improve loading", "Done", "Completed");
    h.start().await;
    h.shell();
    h.tick().await;
    let prompt = h.slice("prompts")["ticketCompletion"].clone();
    assert_eq!(prompt["ticketId"], 33984);
    assert_eq!(prompt["workflowState"], "Done");
    assert_eq!(
        h.shell(),
        vec!["show_panel(focus=false)".to_string(), "notify(ticket-completion)".to_string()]
    );
    h.tick().await;
    assert!(h.shell().is_empty(), "announced once");
    // Checks run at most once a minute.
    let workflow_calls = |h: &Harness| {
        h.azure.calls.lock().unwrap().iter().filter(|call| call.starts_with("workflow")).count()
    };
    assert_eq!(workflow_calls(&h), 1);
    h.ok(json!({"type": "completion.stop"})).await;
    assert_eq!(workflow_calls(&h), 2, "revalidated before the stop");
    assert_eq!(h.seven_pace.writes(), vec!["stop".to_string()]);
    assert_eq!(h.slice("prompts")["ticketCompletion"], Value::Null);
}

#[tokio::test]
async fn a_reopened_ticket_is_never_stopped_and_keep_tracking_lasts_the_session() {
    let h = Harness::new(configuration(vec![]));
    h.seven_pace.set_current(running(Some(33984), Some("dev"), None));
    h.azure.complete(33984, "Improve loading", "Done", "Completed");
    h.start().await;
    h.tick().await;
    assert_ne!(h.slice("prompts")["ticketCompletion"], Value::Null);
    // Reopened in Azure meanwhile.
    h.azure.complete(33984, "Improve loading", "Active", "InProgress");
    h.ok(json!({"type": "completion.stop"})).await;
    assert!(h.seven_pace.writes().is_empty());
    assert_eq!(
        h.slice("app")["error"],
        "This ticket is no longer completed. Your timer is unchanged."
    );
    assert_eq!(h.slice("prompts")["ticketCompletion"], Value::Null);

    // Completed again, and "Keep tracking" for this session.
    h.azure.complete(33984, "Improve loading", "Done", "Completed");
    h.advance(61.0);
    h.ok(json!({"type": "connection.refresh"})).await;
    h.tick().await;
    assert_ne!(h.slice("prompts")["ticketCompletion"], Value::Null);
    h.ok(json!({"type": "completion.keep"})).await;
    assert_eq!(h.slice("prompts")["ticketCompletion"], Value::Null);
    h.advance(61.0);
    h.ok(json!({"type": "connection.refresh"})).await;
    h.tick().await;
    assert_eq!(h.slice("prompts")["ticketCompletion"], Value::Null, "kept for this session");
}

// -- calendar meetings and the meeting return -----------------------------------------------------

fn meeting(id: &str, title: &str, start: &str, end: &str) -> CalendarEvent {
    CalendarEvent {
        occurrence_id: id.into(),
        calendar_id: "work".into(),
        title: title.into(),
        start: ts(start),
        end: ts(end),
        all_day: false,
        status: EventStatus::Confirmed,
        declined: false,
        free: false,
        location: Some("Room 2".into()),
        notes: None,
        url: None,
        calendar_color: Some("#2f7de1".into()),
        calendar_title: Some("Work".into()),
    }
}

#[tokio::test]
async fn a_meeting_is_suggested_once_and_offers_a_return_when_it_ends() {
    let mut config = configuration(vec![]);
    config.calendar_enabled = true;
    let h = Harness::new(config);
    *h.t.calendar.events.lock().unwrap() = vec![meeting(
        "occ-1",
        "Sprint review #4790",
        "2026-10-06T07:58:00Z",
        "2026-10-06T08:30:00Z",
    )];
    h.seven_pace.set_current(running(Some(4821), Some("dev"), None));
    h.start().await;
    h.shell();
    h.tick().await;
    let prompt = h.slice("prompts")["meetings"][0].clone();
    assert_eq!(prompt["event"]["title"], "Sprint review #4790");
    assert_eq!(prompt["ticketId"], 4790);
    assert_eq!(
        h.shell(),
        vec!["show_panel(focus=false)".to_string(), "notify(meeting:occ-1)".to_string()]
    );
    let agenda = h.slice("agenda");
    assert_eq!(agenda["events"][0]["isNow"], true);
    assert_eq!(agenda["events"][0]["calendarTitle"], "Work");
    h.tick().await;
    assert!(h.shell().is_empty(), "suggested once per occurrence");

    h.ok(json!({"type": "meeting.begin", "id": "occ-1", "useSuggestedTicket": true})).await;
    let draft = h.slice("flow")["draft"].clone();
    assert_eq!(draft["source"], "meeting");
    assert_eq!(draft["item"]["id"], 4790);
    assert_eq!(draft["meetingTitle"], "Sprint review #4790");
    assert_eq!(draft["preferredActivityId"], "meeting");
    h.ok(start_intent(&h, "meeting")).await;
    assert_eq!(
        h.seven_pace.writes(),
        vec![
            "stop".to_string(),
            r#"start(Some(4790),Some("meeting"),Some("Sprint review #4790"))"#.to_string()
        ]
    );
    assert_eq!(h.slice("prompts")["meetings"], json!([]));
    let plan = h.slice("prompts")["meetingReturn"].clone();
    assert_eq!(plan["ticketId"], 4821);
    assert_eq!(plan["ready"], false);
    assert_eq!(plan["microphone"], false);

    // The meeting ends: "Return to #4821?" once.
    h.advance(31.0 * 60.0);
    h.shell();
    h.tick().await;
    assert_eq!(h.slice("prompts")["meetingReturn"]["ready"], true);
    let calls = h.shell();
    assert!(calls.contains(&"show_panel(focus=false)".to_string()), "{calls:?}");
    assert!(calls.contains(&"notify(meeting-return)".to_string()), "{calls:?}");
    h.seven_pace.take_calls();
    h.ok(json!({"type": "meeting.returnResume"})).await;
    let draft = h.slice("flow")["draft"].clone();
    assert_eq!(draft["source"], "meetingReturn");
    assert_eq!(draft["preferredActivityId"], "dev");
    assert_eq!(draft["resume"], true);
    h.ok(start_intent(&h, "dev")).await;
    assert_eq!(
        h.seven_pace.writes(),
        vec!["stop".to_string(), r#"start(Some(4821),Some("dev"),None)"#.to_string()]
    );
    assert_eq!(h.slice("prompts")["meetingReturn"], Value::Null);
}

#[tokio::test]
async fn declined_free_all_day_and_old_meetings_are_not_suggested() {
    let mut config = configuration(vec![]);
    config.calendar_enabled = true;
    let h = Harness::new(config);
    let mut declined = meeting("a", "Declined", "2026-10-06T07:58:00Z", "2026-10-06T08:30:00Z");
    declined.declined = true;
    let mut free = meeting("b", "Free", "2026-10-06T07:58:00Z", "2026-10-06T08:30:00Z");
    free.free = true;
    let mut all_day = meeting("c", "Holiday", "2026-10-05T22:00:00Z", "2026-10-06T22:00:00Z");
    all_day.all_day = true;
    // Started more than five minutes ago.
    let old = meeting("d", "Started earlier", "2026-10-06T07:50:00Z", "2026-10-06T08:30:00Z");
    *h.t.calendar.events.lock().unwrap() = vec![declined, free, all_day, old];
    h.start().await;
    h.tick().await;
    assert_eq!(h.slice("prompts")["meetings"], json!([]));
    assert_eq!(h.slice("agenda")["events"][0]["allDay"], true, "all-day events first");
}

// -- microphone meetings ------------------------------------------------------------------------

fn slack() -> InputOwner {
    InputOwner {
        id: "com.tinyspeck.slackmacgap".into(),
        name: "Slack".into(),
        pid: Some(42),
        path: None,
    }
}

async fn sample(h: &Harness, owners: Vec<InputOwner>, after: f64) {
    h.advance(after);
    *h.t.microphone.0.lock().unwrap() = Some(owners);
    att_engine::session::sample_microphone(h.engine()).await;
    settle().await;
}

#[tokio::test]
async fn microphone_use_suggests_a_meeting_and_its_end_offers_pause_or_stop() {
    let h = Harness::new(configuration(vec![]));
    h.seven_pace.set_current(running(Some(4821), Some("dev"), None));
    h.start().await;
    h.shell();
    sample(&h, vec![slack()], 0.0).await;
    sample(&h, vec![slack()], 2.0).await;
    assert_eq!(h.slice("prompts")["microphone"], json!([]), "4 s of continuous use first");
    sample(&h, vec![slack()], 2.0).await;
    let session = h.slice("prompts")["microphone"][0].clone();
    assert_eq!(session["owner"]["name"], "Slack");
    let session_id = session["id"].as_str().unwrap().to_string();
    assert_eq!(
        h.shell(),
        vec!["show_panel(focus=false)".to_string(), format!("notify(microphone:{session_id})")]
    );

    h.ok(json!({"type": "microphone.choose", "sessionId": session_id, "standup": false})).await;
    let draft = h.slice("flow")["draft"].clone();
    assert_eq!(draft["source"], "microphone");
    assert_eq!(draft["title"], "Meeting");
    assert_eq!(draft["remark"], "Meeting · Slack");
    assert_eq!(draft["preferredActivityId"], "meeting");
    h.ok(start_intent(&h, "meeting")).await;
    assert_eq!(
        h.seven_pace.writes(),
        vec![
            "stop".to_string(),
            r#"start(None,Some("meeting"),Some("Meeting · Slack"))"#.to_string()
        ]
    );
    assert_eq!(h.slice("prompts")["microphone"], json!([]));
    assert_eq!(h.slice("prompts")["meetingReturn"]["microphone"], true);

    // Input still in use binds the meeting timer; then a minute without input ends the call.
    sample(&h, vec![slack()], 2.0).await;
    for _ in 0..13 {
        sample(&h, vec![], 5.0).await;
    }
    let prompt = h.slice("prompts")["microphoneEnd"].clone();
    assert_eq!(prompt["appNames"], json!(["Slack"]));
    assert_eq!(h.slice("prompts")["canReturnAfterMicrophone"], true);
    assert!(h.shell().contains(&"notify(microphone-end)".to_string()));
    h.seven_pace.take_calls();
    h.ok(json!({"type": "microphone.endPause"})).await;
    assert_eq!(h.seven_pace.writes(), vec!["stop".to_string()]);
    assert_eq!(h.slice("tracking")["paused"]["remark"], "Meeting · Slack");
}

#[tokio::test]
async fn a_failed_microphone_sample_never_ends_a_meeting() {
    let h = Harness::new(configuration(vec![]));
    h.start().await;
    sample(&h, vec![slack()], 0.0).await;
    sample(&h, vec![slack()], 4.0).await;
    assert_eq!(h.slice("prompts")["microphone"].as_array().unwrap().len(), 1);
    // A failed read is "unknown", not "silent".
    *h.t.microphone.0.lock().unwrap() = None;
    for _ in 0..20 {
        h.advance(5.0);
        att_engine::session::sample_microphone(h.engine()).await;
    }
    assert_eq!(h.slice("prompts")["microphone"].as_array().unwrap().len(), 1);
    assert_eq!(h.slice("settings")["microphone"]["fresh"], false);
    assert_eq!(h.slice("settings")["microphone"]["status"], "fake failure");
}

// -- day review ----------------------------------------------------------------------------------

#[tokio::test]
async fn the_day_review_prompts_at_the_finish_time_and_can_be_snoozed_or_marked() {
    let h = Harness::new(configuration(vec![]));
    h.start().await;
    h.tick().await;
    assert_eq!(h.slice("prompts")["dayReview"], Value::Null, "before 17:00");
    // 17:01 in Brussels.
    h.t.clock.set(ts("2026-10-06T15:01:00Z"));
    h.shell();
    h.tick().await;
    let prompt = h.slice("prompts")["dayReview"].clone();
    assert_eq!(prompt["day"], "2026-10-06");
    assert_eq!(prompt["canSnooze"], true);
    assert_eq!(h.slice("app")["pages"][1]["dot"], true);
    let calls = h.shell();
    assert!(calls.contains(&"notify(day-review)".to_string()), "{calls:?}");
    h.tick().await;
    assert!(!h.shell().contains(&"notify(day-review)".to_string()), "prompted once");

    h.ok(json!({"type": "dayReview.snooze"})).await;
    assert_eq!(h.slice("prompts")["dayReview"], Value::Null);
    h.advance(31.0 * 60.0);
    h.tick().await;
    assert_eq!(h.slice("prompts")["dayReview"]["day"], "2026-10-06", "due again after the snooze");
    h.ok(json!({"type": "dayReview.markReviewed", "day": "2026-10-06"})).await;
    assert_eq!(h.slice("prompts")["dayReview"], Value::Null);
    h.advance(3600.0);
    h.tick().await;
    assert_eq!(h.slice("prompts")["dayReview"], Value::Null, "never after the day was reviewed");
    let saved: std::collections::BTreeMap<String, Value> =
        h.t.store.get(att_store::keys::DAY_REVIEWS).unwrap().unwrap();
    let record = &saved[&format!("{WORKSPACE}|2026-10-6")];
    assert!(record.get("reviewedAt").is_some(), "{record}");
}
