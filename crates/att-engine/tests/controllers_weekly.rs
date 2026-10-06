//! The Weekly report controller (port of `WeeklyReportModel`): generating with confirmation,
//! debounced draft saves, export, and drafts per workspace and week.

#[path = "support/controllers.rs"]
mod support;

use serde_json::json;

use att_core::model::WorkLog;
use support::*;

/// The draft key of this week (Monday 5 October 2026) in the 2.0 workspace identity.
const KEY: &str = "https://acme.timehub.7pace.com/|2026-10-05T00:00:00";

fn week_logs() -> Vec<WorkLog> {
    vec![
        log("m", "2026-10-05T09:00:00", 3600.0, Some(1), "Built the editor"),
        log("t", "2026-10-06T08:00:00", 1800.0, Some(2), "Reviewed"),
    ]
}

#[tokio::test]
async fn a_draft_is_generated_and_replacing_it_needs_confirmation() {
    let h = Harness::new(week_logs()).await;
    h.show(Some("weeklyReport")).await;
    h.tick().await;
    let weekly = h.wait_for("weekly", |weekly| weekly["hasData"] == true).await;
    assert_eq!(h.seven_pace.calls(), ["work_logs(2026-10-05T00:00:00..2026-10-12T00:00:00)"]);
    assert_eq!(weekly["range"]["start"], "2026-10-04T22:00:00Z");
    assert_eq!((&weekly["text"], &weekly["hasDraft"]), (&json!(""), &json!(false)));
    assert_eq!(weekly["configured"], true);
    assert_eq!(weekly["exportFileName"], "weekly-status-2026-10-05.md");

    h.ok(json!({"type": "weekly.generate", "replace": false})).await;
    let weekly = h.slice("weekly");
    let text = weekly["text"].as_str().unwrap();
    assert!(text.starts_with("# Weekly status · Oct 5, 2026 – Oct 11, 2026"), "{text}");
    assert!(text.contains("- #1 · Ticket 1 — 1h 0m\n  - Built the editor"), "{text}");
    assert_eq!(weekly["message"], "Draft generated. Review outcomes and blockers before sharing.");
    assert_eq!(weekly["hasDraft"], true);
    assert_eq!(h.t.store.weekly_draft(KEY).unwrap().as_deref(), Some(text), "saved at once");

    let error = h.dispatch(json!({"type": "weekly.generate", "replace": false})).await.unwrap_err();
    assert_eq!(error.kind, "needsConfirmation");
    h.ok(json!({"type": "weekly.setText", "text": "My own notes"})).await;
    let error = h.dispatch(json!({"type": "weekly.generate", "replace": false})).await.unwrap_err();
    assert_eq!(error.kind, "needsConfirmation");
    assert_eq!(h.slice("weekly")["text"], "My own notes");
    h.ok(json!({"type": "weekly.generate", "replace": true})).await;
    assert!(h.slice("weekly")["text"].as_str().unwrap().starts_with("# Weekly status"));
}

#[tokio::test]
async fn generating_needs_the_week_to_be_loaded() {
    let h = Harness::new(week_logs()).await;
    h.ok(json!({"type": "weekly.generate", "replace": false})).await;
    assert_eq!(h.slice("weekly")["text"], "");
    h.ok(json!({"type": "weekly.refresh"})).await;
    assert_eq!(h.slice("weekly")["hasData"], true);
}

#[tokio::test]
async fn edits_are_written_at_most_twice_a_second_and_when_the_page_closes() {
    let h = Harness::new(week_logs()).await;
    h.show(Some("weeklyReport")).await;
    h.tick().await;
    let draft = || h.t.store.weekly_draft(KEY).unwrap();

    h.ok(json!({"type": "weekly.setText", "text": "a"})).await;
    assert_eq!(draft().as_deref(), Some("a"), "the first edit is written at once");
    h.ok(json!({"type": "weekly.setText", "text": "ab"})).await;
    h.ok(json!({"type": "weekly.setText", "text": "abc"})).await;
    assert_eq!(draft().as_deref(), Some("a"), "later edits wait for the interval");
    eventually("the delayed write", || draft().as_deref() == Some("abc")).await;

    h.ok(json!({"type": "weekly.setText", "text": "abcd"})).await;
    assert_eq!(draft().as_deref(), Some("abc"));
    // Leaving the page writes the pending edit immediately.
    h.show(Some("overview")).await;
    h.tick().await;
    assert_eq!(draft().as_deref(), Some("abcd"));
    assert!(h.slice("weekly")["storageIssue"].is_null());
}

#[tokio::test]
async fn the_draft_exports_to_the_chosen_file() {
    let h = Harness::new(week_logs()).await;
    h.ok(json!({"type": "weekly.setText", "text": "# Notes\n"})).await;
    let path = std::env::temp_dir().join(format!("att-weekly-{}.md", uuid::Uuid::new_v4()));
    h.ok(json!({"type": "weekly.exportMarkdown", "path": path.to_string_lossy()})).await;
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "# Notes\n");
    assert_eq!(h.slice("weekly")["message"], "Draft exported.");
    std::fs::remove_file(&path).unwrap();

    let missing = std::env::temp_dir().join(format!("att-missing-{}", uuid::Uuid::new_v4()));
    let path = missing.join("report.md");
    h.ok(json!({"type": "weekly.exportMarkdown", "path": path.to_string_lossy()})).await;
    assert!(!h.slice("weekly")["issue"].is_null());
    assert!(!missing.exists());
}

#[tokio::test]
async fn drafts_belong_to_their_week_and_survive_a_restart() {
    let store = store_with(&configuration());
    // A 1.14.x draft for the previous week, keyed by the workspace URL as typed.
    store
        .set_weekly_draft("https://acme.timehub.7pace.com|2026-09-28T00:00:00", "Last week")
        .unwrap();
    let h = Harness::on(store.clone(), FakeSevenPace::with_logs(week_logs())).await;
    h.ok(json!({"type": "weekly.setText", "text": "This week"})).await;
    h.ok(json!({"type": "weekly.setText", "text": "This week, edited"})).await;

    h.ok(json!({"type": "weekly.move", "amount": -1})).await;
    let weekly = h.slice("weekly");
    assert_eq!(weekly["range"]["start"], "2026-09-27T22:00:00Z");
    assert_eq!(weekly["text"], "Last week");
    // The pending edit of this week was written when the week changed.
    assert_eq!(store.weekly_draft(KEY).unwrap().as_deref(), Some("This week, edited"));

    h.ok(json!({"type": "weekly.move", "amount": 1})).await;
    assert_eq!(h.slice("weekly")["text"], "This week, edited");
    // Another day of the same week keeps everything.
    h.ok(json!({"type": "weekly.refresh"})).await;
    h.ok(json!({"type": "weekly.jumpTo", "date": "2026-10-08"})).await;
    let weekly = h.slice("weekly");
    assert_eq!((&weekly["text"], &weekly["hasData"]), (&json!("This week, edited"), &json!(true)));

    drop(h);
    let h = Harness::on(store, FakeSevenPace::with_logs(week_logs())).await;
    assert_eq!(h.slice("weekly")["text"], "This week, edited");
}

#[tokio::test]
async fn drafts_need_a_connected_workspace() {
    let t = att_engine::testing::TestEngine::with_store(store_with(&configuration()));
    t.engine.dispatch(json!({"type": "weekly.setText", "text": "Offline notes"})).await.unwrap();
    assert_eq!(t.store.weekly_draft(KEY).unwrap(), None);
    let weekly = slice(&t, "weekly");
    assert_eq!((&weekly["configured"], &weekly["text"]), (&json!(false), &json!("Offline notes")));
}
