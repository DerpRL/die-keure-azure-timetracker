//! Time awareness: idle time → "Pause & review" (saved before the timer stops), and the
//! forgotten-timer reminder's eligibility.

mod support;

use serde_json::{Value, json};

use att_core::AppError;
use att_core::awareness::WorkAwarenessLedger;
use att_platform::{AppIdentity, PresenceSample};
use support::*;

async fn presence(h: &Harness, idle_seconds: f64, foreground: Option<&str>) {
    *h.t.presence.0.lock().unwrap() = PresenceSample {
        idle_seconds,
        locked: Some(false),
        foreground: foreground.map(|id| AppIdentity {
            id: id.into(),
            name: "Code".into(),
            path: None,
        }),
    };
    att_engine::session::sample_presence(h.engine()).await;
    settle().await;
}

/// Away for `idle` seconds, then back.
async fn idle_then_back(h: &Harness, idle: f64) -> Value {
    presence(h, idle, None).await;
    assert_eq!(h.slice("prompts")["idle"], Value::Null, "prompts only on return");
    h.advance(10.0);
    presence(h, 2.0, None).await;
    h.slice("prompts")["idle"].clone()
}

#[tokio::test]
async fn idle_time_is_reviewed_after_the_review_is_saved() {
    let h = Harness::new(configuration(vec![]));
    h.seven_pace.set_current(running(Some(33984), Some("dev"), None));
    h.start().await;
    h.shell();
    let prompt = idle_then_back(&h, 400.0).await;
    assert_eq!(prompt["reason"], "No keyboard or mouse activity");
    assert_eq!(prompt["session"]["workLogId"], "wl-0");
    assert_eq!(
        h.shell(),
        vec!["show_panel(focus=false)".to_string(), "notify(work-awareness)".to_string()]
    );

    h.seven_pace.take_calls();
    h.ok(json!({"type": "awareness.reviewIdle", "promptId": prompt["id"]})).await;
    assert_eq!(h.seven_pace.writes(), vec!["stop".to_string()]);
    let saved: WorkAwarenessLedger =
        h.t.store.get(att_store::keys::WORK_AWARENESS).unwrap().unwrap();
    assert_eq!(
        saved.correction.as_ref().map(|c| c.id.to_string()).as_deref(),
        prompt["id"].as_str()
    );
    assert_eq!(h.slice("tracking")["paused"]["ticketId"], 33984);
    let calls = h.shell();
    assert!(calls.contains(&"hide_panel".to_string()), "{calls:?}");
    assert!(calls.contains(&"show_main(timeEditor)".to_string()), "{calls:?}");
    assert_eq!(h.slice("app")["visiblePage"], "timeEditor");
}

#[tokio::test]
async fn the_review_is_saved_even_when_the_stop_fails() {
    let h = Harness::new(configuration(vec![]));
    h.seven_pace.set_current(running(Some(33984), Some("dev"), None));
    h.start().await;
    let prompt = idle_then_back(&h, 400.0).await;
    h.seven_pace.server.lock().unwrap().fail_stop = Some(AppError::Network(
        "The connection to contoso.timehub.7pace.com was interrupted.".into(),
    ));
    h.ok(json!({"type": "awareness.reviewIdle", "promptId": prompt["id"]})).await;
    let saved: WorkAwarenessLedger =
        h.t.store.get(att_store::keys::WORK_AWARENESS).unwrap().unwrap();
    assert!(saved.correction.is_some(), "saved before the stop was attempted");
    assert_eq!(
        h.slice("app")["error"],
        "The connection to contoso.timehub.7pace.com was interrupted. Check the timer before continuing; no correction was applied."
    );
    assert_eq!(h.slice("tracking")["running"], true, "reconciled: still running");
    // The prompt stays for another attempt; the saved review shows once it is answered.
    assert_eq!(h.slice("prompts")["idle"]["id"], prompt["id"]);
    assert_eq!(h.slice("prompts")["idleCorrection"], Value::Null);
}

#[tokio::test]
async fn keeping_idle_time_dismisses_the_review() {
    let h = Harness::new(configuration(vec![]));
    h.seven_pace.set_current(running(Some(33984), Some("dev"), None));
    h.start().await;
    idle_then_back(&h, 400.0).await;
    h.shell();
    h.ok(json!({"type": "awareness.keepIdle"})).await;
    assert_eq!(h.slice("prompts")["idle"], Value::Null);
    assert_eq!(h.shell(), vec!["remove_notification(work-awareness)".to_string()]);
    assert!(h.seven_pace.writes().is_empty());
}

/// Ten minutes of work in a watched app, refreshing 7pace so the idle state stays confirmed.
async fn work_without_timer(h: &Harness, app: &str, minutes: u32) {
    for step in 0..(minutes * 12) {
        if step % 12 == 0 {
            h.ok(json!({"type": "connection.refresh"})).await;
        }
        presence(h, 3.0, Some(app)).await;
        h.advance(5.0);
    }
    presence(h, 3.0, Some(app)).await;
}

#[tokio::test]
async fn working_without_a_timer_is_noticed_and_can_be_snoozed() {
    let h = Harness::new(configuration(vec![]));
    h.start().await;
    h.shell();
    work_without_timer(&h, "com.microsoft.VSCode", 10).await;
    let reminder = h.slice("prompts")["forgotten"].clone();
    assert_eq!(reminder["appName"], "Code");
    assert!(h.shell().contains(&"notify(work-awareness)".to_string()));
    h.ok(json!({"type": "awareness.deferForgotten", "untilTomorrow": false})).await;
    assert_eq!(h.slice("prompts")["forgotten"], Value::Null);
    // Snoozed: more work does not remind again within 15 minutes.
    work_without_timer(&h, "com.microsoft.VSCode", 10).await;
    assert_eq!(h.slice("prompts")["forgotten"], Value::Null);
}

#[tokio::test]
async fn the_forgotten_timer_needs_a_watched_app_a_workday_and_no_pause() {
    // Not a watched work app.
    let h = Harness::new(configuration(vec![]));
    h.start().await;
    work_without_timer(&h, "com.apple.Safari", 11).await;
    assert_eq!(h.slice("prompts")["forgotten"], Value::Null, "only watched work apps count");

    // A paused session is not forgotten.
    let h = Harness::new(configuration(vec![]));
    h.seven_pace.set_current(running(Some(4821), Some("dev"), None));
    h.start().await;
    h.ok(json!({"type": "tracking.pause"})).await;
    work_without_timer(&h, "com.microsoft.VSCode", 11).await;
    assert_eq!(h.slice("prompts")["forgotten"], Value::Null, "paused tracking suppresses it");

    // Outside the workday (Day review 09:00–17:00).
    let h = Harness::new(configuration(vec![]));
    h.t.clock.set(ts("2026-10-06T17:00:00Z"));
    h.start().await;
    work_without_timer(&h, "com.microsoft.VSCode", 11).await;
    assert_eq!(h.slice("prompts")["forgotten"], Value::Null, "19:00 is outside working hours");

    // Weekend: no target.
    let h = Harness::new(configuration(vec![]));
    h.t.clock.set(ts("2026-10-10T08:00:00Z"));
    h.start().await;
    work_without_timer(&h, "com.microsoft.VSCode", 11).await;
    assert_eq!(h.slice("prompts")["forgotten"], Value::Null, "no target on Saturday");
}

#[tokio::test]
async fn forgotten_tickets_come_from_watched_branches() {
    let dir = TempDir::new();
    let root = dir.repository("webshop", "feature/33984-improve-loading");
    let develop = dir.repository("tools", "develop");
    let h = Harness::new(configuration(vec![
        att_core::model::Repository::new(root.to_string_lossy()),
        att_core::model::Repository::new(develop.to_string_lossy()),
    ]));
    h.start().await;
    h.tick().await;
    let tickets = h.slice("prompts")["forgottenTickets"].clone();
    assert_eq!(tickets, json!([{"repository": "webshop", "ticketId": 33984, "title": null}]));
    // The reminder loads their titles.
    work_without_timer(&h, "com.microsoft.VSCode", 10).await;
    assert_eq!(h.slice("prompts")["forgottenTickets"][0]["title"], "Improve loading");
    h.ok(json!({"type": "awareness.chooseForgottenTicket", "ticketId": 33984})).await;
    assert_eq!(h.slice("flow")["draft"]["item"]["id"], 33984);
    assert_eq!(h.slice("flow")["surface"], "panel");
}
