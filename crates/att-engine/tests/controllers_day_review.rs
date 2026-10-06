//! The Day review controller (port of `DayReviewModel.swift`): the selected day plus the day
//! before, the once-a-minute throttle and the summary with targets and preferences.

#[path = "support/controllers.rs"]
mod support;

use std::time::Duration;

use serde_json::{Value, json};

use att_core::AppError;
use att_core::model::WorkLog;
use support::*;

/// Monday 5 October 2026, reviewed on Tuesday.
fn monday_logs() -> Vec<WorkLog> {
    vec![
        // Sunday 23:00 – Monday 01:00: the review keeps its Monday hour.
        log("night", "2026-10-04T23:00:00", 7200.0, Some(1), "Release"),
        log("morning", "2026-10-05T08:00:00", 14_400.0, Some(2), "Morning"),
        log("afternoon", "2026-10-05T13:00:00", 10_800.0, Some(3), "Afternoon"),
    ]
}

fn loaded(review: &Value) -> bool {
    review["loading"] == false && !review["summary"].is_null()
}

#[tokio::test]
async fn the_summary_reviews_the_selected_day_with_targets_and_preferences() {
    let h = Harness::new(monday_logs()).await;
    h.show(Some("dayReview")).await;
    h.ok(json!({"type": "dayReview.setDay", "day": "2026-10-05"})).await;
    let review = h.slice("dayReview");
    assert_eq!(h.seven_pace.calls(), ["work_logs(2026-10-04T00:00:00..2026-10-06T00:00:00)"]);
    assert_eq!(review["selectedDay"], "2026-10-05");
    assert_eq!(review["targetSeconds"], 27_360.0, "7.6 hours on a Monday");
    assert_eq!((&review["longEntryMinutes"], &review["gapMinutes"]), (&json!(180), &json!(20)));
    assert_eq!(review["configured"], true);
    assert_eq!(review["syncedAt"], "2026-10-06T08:00:00Z");

    let summary = &review["summary"];
    assert_eq!(summary["day"], "2026-10-04T22:00:00Z");
    let sessions = summary["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 3);
    assert_eq!(
        (&sessions[0]["id"], &sessions[0]["start"], &sessions[0]["end"]),
        (&json!("night"), &json!("2026-10-04T22:00:00Z"), &json!("2026-10-04T23:00:00Z")),
        "clipped to the reviewed day"
    );
    let long: Vec<&Value> =
        sessions.iter().filter(|s| s["isLong"] == true).map(|s| &s["id"]).collect();
    assert_eq!(long, [&json!("morning"), &json!("afternoon")]);
    assert_eq!(
        summary["gaps"],
        json!([
            {"start": "2026-10-05T10:00:00Z", "end": "2026-10-05T11:00:00Z"},
            {"start": "2026-10-05T14:00:00Z", "end": "2026-10-05T15:00:00Z"}
        ])
    );
    assert_eq!(summary["gapsUnavailable"], false);
    assert_eq!(summary["timerUnconfirmed"], false, "not today");
}

#[tokio::test]
async fn today_without_a_confirmed_timer_hides_gap_estimates() {
    let h =
        Harness::new(vec![log("today", "2026-10-06T08:00:00", 1800.0, Some(1), "Standup")]).await;
    h.reopen("dayReview").await;
    let review = h.wait_for("dayReview", loaded).await;
    assert_eq!(review["selectedDay"], "2026-10-06");
    let summary = &review["summary"];
    assert_eq!(summary["timerUnconfirmed"], true);
    assert_eq!(summary["gapsUnavailable"], true);
    assert_eq!(summary["gaps"], json!([]));
    assert_eq!(summary["sessions"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn automatic_loads_wait_a_minute_and_refresh_always_loads() {
    let h = Harness::new(monday_logs()).await;
    let downloads = || h.seven_pace.calls_to("work_logs");
    h.reopen("dayReview").await;
    eventually("the first download", || downloads() == 1).await;
    h.wait_for("dayReview", loaded).await;

    h.t.clock.advance(59.0);
    h.reopen("dayReview").await;
    settle(Duration::from_millis(50)).await;
    assert_eq!(downloads(), 1);
    h.t.clock.advance(2.0);
    h.reopen("dayReview").await;
    eventually("a second download", || downloads() == 2).await;

    h.ok(json!({"type": "dayReview.refresh"})).await;
    assert_eq!(downloads(), 3);
}

#[tokio::test]
async fn a_failed_refresh_keeps_the_last_loaded_day() {
    let h = Harness::new(monday_logs()).await;
    h.show(Some("dayReview")).await;
    h.ok(json!({"type": "dayReview.setDay", "day": "2026-10-05"})).await;
    h.seven_pace.state.lock().unwrap().fail_work_logs = Some(AppError::Timeout);
    h.ok(json!({"type": "dayReview.refresh"})).await;
    let review = h.slice("dayReview");
    assert_eq!(
        review["issue"],
        "The request timed out. Refresh to see what 7pace recorded before trying again."
    );
    assert_eq!(review["summary"]["sessions"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn choosing_another_day_drops_the_previous_answer() {
    let h = Harness::new(monday_logs()).await;
    h.show(Some("dayReview")).await;
    let hold = h.seven_pace.hold_next("work_logs");
    let engine = h.t.engine.clone();
    let monday = tokio::spawn(async move {
        engine.dispatch(json!({"type": "dayReview.setDay", "day": "2026-10-05"})).await
    });
    eventually("Monday's download started", || h.seven_pace.calls_to("work_logs") == 1).await;
    h.ok(json!({"type": "dayReview.setDay", "day": "2026-10-06"})).await;
    hold.notify_one();
    monday.await.unwrap().unwrap();
    let review = h.slice("dayReview");
    assert_eq!(review["selectedDay"], "2026-10-06");
    assert_eq!(review["summary"]["day"], "2026-10-05T22:00:00Z");
    assert_eq!(review["loading"], false);
}

#[tokio::test]
async fn nothing_loads_without_a_connection() {
    let t = att_engine::testing::TestEngine::with_store(store_with(&configuration()));
    t.engine.dispatch(json!({"type": "app.setVisiblePage", "page": "dayReview"})).await.unwrap();
    att_engine::controllers::tick(&t.engine).await;
    t.engine.dispatch(json!({"type": "dayReview.refresh"})).await.unwrap();
    let review = slice(&t, "dayReview");
    assert_eq!((&review["configured"], &review["loading"]), (&json!(false), &json!(false)));
    assert!(review["summary"].is_null());
}
