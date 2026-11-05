//! Combined views (2.2 layout): `app.setVisiblePage` with `also` makes other pages load and
//! refresh as if they were visible, and leaving the view still flushes their work.

#[path = "support/controllers.rs"]
mod support;

use serde_json::json;

use att_core::model::WorkLog;
use support::*;

/// The weekly draft key of this week (Monday 5 October 2026).
const KEY: &str = "https://acme.timehub.7pace.com/|2026-10-05T00:00:00";

fn week_logs() -> Vec<WorkLog> {
    vec![log("m", "2026-10-05T09:00:00", 3600.0, Some(1), "Built the editor")]
}

async fn show_with(h: &Harness, page: &str, also: serde_json::Value) {
    h.ok(json!({"type": "app.setVisiblePage", "page": page, "also": also})).await;
}

#[tokio::test]
async fn a_page_shown_alongside_loads_when_the_view_appears() {
    let h = Harness::new(week_logs()).await;
    show_with(&h, "statistics", json!(["weeklyReport"])).await;
    h.tick().await;
    let weekly = h.wait_for("weekly", |weekly| weekly["hasData"] == true).await;
    assert_eq!(weekly["summary"]["totalSeconds"], 3600.0);
    assert_eq!(
        h.slice("app")["visiblePage"],
        "statistics",
        "the primary page is the one published"
    );
}

#[tokio::test]
async fn also_is_optional_and_unknown_or_duplicate_pages_are_ignored() {
    let h = Harness::new(week_logs()).await;
    h.ok(json!({"type": "app.setVisiblePage", "page": "overview"})).await;
    show_with(&h, "overview", json!(["not-a-page", "overview", "dayReview", "dayReview"])).await;
    h.tick().await;
    let review = h
        .wait_for("dayReview", |review| review["loading"] == false && !review["summary"].is_null())
        .await;
    assert_eq!(review["configured"], true);
    // A closed window shows nothing, whatever `also` says.
    h.ok(json!({"type": "app.setVisiblePage", "page": null, "also": ["weeklyReport"]})).await;
    h.tick().await;
    assert_eq!(h.slice("weekly")["hasData"], false, "the weekly report never appeared");
}

#[tokio::test]
async fn leaving_a_view_that_showed_the_weekly_report_writes_its_draft() {
    let h = Harness::new(week_logs()).await;
    show_with(&h, "statistics", json!(["weeklyReport"])).await;
    h.tick().await;
    h.wait_for("weekly", |weekly| weekly["hasData"] == true).await;
    let draft = || h.t.store.weekly_draft(KEY).unwrap();
    h.ok(json!({"type": "weekly.setText", "text": "a"})).await;
    h.ok(json!({"type": "weekly.setText", "text": "ab"})).await;
    assert_eq!(draft().as_deref(), Some("a"), "the second edit waits for the interval");

    // Leaving every view that shows the report writes the pending edit at once.
    h.ok(json!({"type": "app.setVisiblePage", "page": "settings"})).await;
    h.tick().await;
    assert_eq!(draft().as_deref(), Some("ab"));
}
