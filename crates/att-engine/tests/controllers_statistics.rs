//! The Statistics controller (port of `StatisticsModel.swift`): downloads, refresh throttling,
//! stale results, zoom, filters, entry pages and ticket-title batches.

#[path = "support/controllers.rs"]
mod support;

use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::{Value, json};

use att_core::AppError;
use att_core::model::WorkLog;
use att_engine::controllers::testing;
use support::*;

/// Tuesday 6 October 2026 is "now"; the week runs Monday 5 – Sunday 11 October.
fn week_logs() -> Vec<WorkLog> {
    vec![
        // Overnight from Sunday: 30 minutes count on Monday.
        log("a", "2026-10-04T23:30:00", 3600.0, Some(1), "Late fix"),
        log("b", "2026-10-05T09:00:00", 3600.0, Some(1), "Development"),
        log("c", "2026-10-06T08:00:00", 1800.0, Some(2), "Review"),
        // Before the downloaded range.
        log("d", "2026-10-03T10:00:00", 3600.0, Some(3), "Saturday"),
    ]
}

fn ready(stats: &Value) -> bool {
    !stats["analysis"].is_null() && stats["analyzing"] == false && stats["loading"] == false
}

fn task_title(stats: &Value, ticket: i64) -> String {
    stats["analysis"]["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|task| task["ticketId"] == ticket)
        .map(|task| task["title"].as_str().unwrap().to_string())
        .unwrap_or_default()
}

#[tokio::test]
async fn the_week_and_its_preceding_day_load_when_the_page_appears() {
    let h = Harness::new(week_logs()).await;
    h.show(Some("statistics")).await;
    h.tick().await;
    let stats = h.wait_for("statistics", ready).await;

    assert_eq!(h.seven_pace.calls(), ["work_logs(2026-10-04T00:00:00..2026-10-12T00:00:00)"]);
    assert_eq!(stats["period"], "week");
    assert_eq!(stats["range"]["start"], "2026-10-04T22:00:00Z");
    assert_eq!(stats["bounds"], stats["window"]);
    assert_eq!(stats["isZoomed"], false);
    assert_eq!(stats["configured"], true);
    assert_eq!(stats["syncedAt"], "2026-10-06T08:00:00Z");
    assert_eq!(stats["targetComparable"], true);
    let analysis = &stats["analysis"];
    assert_eq!(analysis["total"], 7200.0, "the overnight entry counts its Monday half");
    assert_eq!(analysis["count"], 3);
    assert_eq!(analysis["entryCount"], 3);
    assert!(analysis.get("entries").is_none(), "entries are paged, never published");
    assert_eq!(analysis["entriesPreview"].as_array().unwrap().len(), 3);
    assert_eq!(task_title(&stats, 1), "Azure ticket #1");
    assert_eq!(
        stats["availableActivities"],
        json!([{"id": "activity:dev", "name": "Development", "seconds": 0.0}])
    );
    assert!(!stats["visuals"].is_null());
}

#[tokio::test]
async fn refreshes_wait_five_minutes_and_a_failed_refresh_keeps_the_data() {
    let h = Harness::new(week_logs()).await;
    let downloads = || h.seven_pace.calls_to("work_logs");
    h.reopen("statistics").await;
    h.wait_for("statistics", ready).await;
    assert_eq!(downloads(), 1);

    // Showing the page again within five minutes reuses the download (Swift `lastAttempt`).
    h.t.clock.advance(299.0);
    h.reopen("statistics").await;
    settle(Duration::from_millis(50)).await;
    assert_eq!(downloads(), 1);

    h.t.clock.advance(2.0);
    h.reopen("statistics").await;
    eventually("a second download", || downloads() == 2).await;
    h.wait_for("statistics", ready).await;

    // A forced refresh that fails keeps the last downloaded worklogs.
    h.seven_pace.state.lock().unwrap().fail_work_logs =
        Some(AppError::message("7pace is unavailable"));
    h.ok(json!({"type": "statistics.refresh"})).await;
    let stats = h.slice("statistics");
    assert_eq!(stats["issue"], "7pace is unavailable");
    assert_eq!(stats["analysis"]["total"], 7200.0);
    assert_eq!(downloads(), 3);

    // After a failure the next automatic attempt waits a minute.
    h.t.clock.advance(59.0);
    h.reopen("statistics").await;
    settle(Duration::from_millis(50)).await;
    assert_eq!(downloads(), 3);
    h.t.clock.advance(2.0);
    h.reopen("statistics").await;
    eventually("a retry", || downloads() == 4).await;
    let stats = h.wait_for("statistics", |stats| ready(stats) && stats["issue"].is_null()).await;
    assert_eq!(stats["analysis"]["count"], 3);
}

#[tokio::test]
async fn a_stale_download_is_dropped_when_the_period_or_the_connection_changes() {
    let h = Harness::new(week_logs()).await;
    h.show(Some("statistics")).await;

    let hold = h.seven_pace.hold_next("work_logs");
    let engine = h.t.engine.clone();
    let current_week =
        tokio::spawn(async move { engine.dispatch(json!({"type": "statistics.refresh"})).await });
    eventually("the first download started", || h.seven_pace.calls_to("work_logs") == 1).await;
    // The user moves to the previous week while the first download hangs.
    h.ok(json!({"type": "statistics.move", "amount": -1})).await;
    hold.notify_one();
    current_week.await.unwrap().unwrap();
    let stats = h.wait_for("statistics", ready).await;
    assert_eq!(
        h.seven_pace.calls()[1],
        "work_logs(2026-09-27T00:00:00..2026-10-05T00:00:00)",
        "the previous week plus its preceding day"
    );
    assert_eq!(stats["range"]["start"], "2026-09-27T22:00:00Z");
    assert_eq!(stats["analysis"]["window"]["start"], "2026-09-27T22:00:00Z");
    // Saturday's entry and the first half of Sunday night's: the current week was dropped.
    assert_eq!(stats["analysis"]["count"], 2);
    assert_eq!(stats["analysis"]["total"], 5400.0);

    // A download from before a reconnect never lands.
    h.show(None).await;
    let hold = h.seven_pace.hold_next("work_logs");
    let engine = h.t.engine.clone();
    let stale =
        tokio::spawn(async move { engine.dispatch(json!({"type": "statistics.refresh"})).await });
    eventually("the stale download started", || h.seven_pace.calls_to("work_logs") == 3).await;
    testing::install_clients(&h.t.engine, Some(clients(&h.seven_pace, None))).await;
    hold.notify_one();
    stale.await.unwrap().unwrap();
    settle(Duration::from_millis(200)).await;
    let stats = h.slice("statistics");
    assert!(stats["analysis"].is_null(), "{stats:#}");
    assert!(stats["syncedAt"].is_null());
    assert_eq!(stats["loading"], false);
}

#[tokio::test]
async fn zoom_filters_and_entry_pages_follow_the_window() {
    let h = Harness::new(week_logs()).await;
    h.show(Some("statistics")).await;
    h.ok(json!({"type": "statistics.refresh"})).await;
    h.wait_for("statistics", ready).await;

    // Monday, local time.
    h.ok(json!({"type": "statistics.zoomTo", "start": "2026-10-04T22:00:00Z", "end": "2026-10-05T22:00:00Z"}))
        .await;
    let stats = h
        .wait_for("statistics", |stats| {
            ready(stats) && stats["analysis"]["window"]["end"] == "2026-10-05T22:00:00Z"
        })
        .await;
    assert_eq!((stats["isZoomed"].clone(), stats["zoomDepth"].clone()), (json!(true), json!(1)));
    assert_eq!(stats["targetComparable"], false);
    assert_eq!(stats["analysis"]["total"], 5400.0);
    assert_eq!(stats["analysis"]["resolution"], "Hourly");

    h.ok(json!({"type": "statistics.scale", "factor": 0.5})).await;
    let stats = h
        .wait_for("statistics", |stats| {
            ready(stats) && stats["analysis"]["window"]["start"] == "2026-10-05T04:00:00Z"
        })
        .await;
    assert_eq!(stats["window"]["end"], "2026-10-05T16:00:00Z", "zoomed around the centre");
    assert_eq!(stats["zoomDepth"], 2);

    h.ok(json!({"type": "statistics.back"})).await;
    let stats = h.slice("statistics");
    assert_eq!(stats["window"]["start"], "2026-10-04T22:00:00Z");
    assert_eq!(stats["zoomDepth"], 1);
    h.ok(json!({"type": "statistics.resetZoom"})).await;
    let stats = h.wait_for("statistics", |stats| ready(stats) && stats["isZoomed"] == false).await;
    assert_eq!(stats["zoomDepth"], 0);
    assert_eq!(stats["analysis"]["total"], 7200.0);

    h.ok(json!({"type": "statistics.setFilter", "filter": {"query": "", "taskId": "ticket:2"}}))
        .await;
    let stats =
        h.wait_for("statistics", |stats| ready(stats) && stats["analysis"]["count"] == 1).await;
    assert_eq!(stats["analysis"]["total"], 1800.0);
    assert_eq!(stats["targetComparable"], false);
    let page = h.ok(json!({"type": "statistics.entries", "offset": 0, "limit": 10})).await;
    assert_eq!(page["total"], 1);
    assert_eq!(page["entries"][0]["record"]["log"]["id"], "c");

    h.ok(json!({"type": "statistics.clearFilters"})).await;
    h.wait_for("statistics", |stats| ready(stats) && stats["analysis"]["count"] == 3).await;
    // Entries overlapping Monday, one per page.
    let page = h
        .ok(json!({"type": "statistics.entries", "offset": 1, "limit": 1,
            "start": "2026-10-04T22:00:00Z", "end": "2026-10-05T22:00:00Z"}))
        .await;
    assert_eq!((page["total"].clone(), page["offset"].clone()), (json!(2), json!(1)));
    assert_eq!(page["entries"].as_array().unwrap().len(), 1);
    assert_eq!(page["entries"][0]["record"]["log"]["id"], "b");

    // Typing in the search field analyses once (120 ms debounce).
    let runs = testing::statistics_analyses(&h.t.engine);
    for query in ["d", "de", "dev", "deve", "devel"] {
        h.ok(json!({"type": "statistics.setFilter", "filter": {"query": query}})).await;
    }
    let stats =
        h.wait_for("statistics", |stats| ready(stats) && stats["filter"]["query"] == "devel").await;
    settle(Duration::from_millis(200)).await;
    assert_eq!(testing::statistics_analyses(&h.t.engine), runs + 1);
    assert_eq!(stats["analysis"]["count"], 3, "every entry is Development");
}

#[tokio::test]
async fn missing_titles_are_requested_in_one_batch_and_analysed_once_when_they_arrive() {
    let h = Harness::new(week_logs()).await;
    h.seven_pace.add(log("e", "2026-10-06T08:30:00", 600.0, Some(3), "Ticket three"));
    testing::use_title_seam(&h.t.engine);
    testing::set_titles(&h.t.engine, BTreeMap::from([(1, "Known ticket".to_string())]));
    h.show(Some("statistics")).await;
    h.ok(json!({"type": "statistics.refresh"})).await;
    let stats = h.wait_for("statistics", ready).await;
    assert_eq!(testing::title_requests(&h.t.engine), [vec![2, 3]]);
    assert_eq!(task_title(&stats, 1), "Known ticket");
    assert_eq!(task_title(&stats, 2), "Azure ticket #2");
    let runs = testing::statistics_analyses(&h.t.engine);

    // Nothing arrived: no analysis.
    h.tick().await;
    settle(Duration::from_millis(200)).await;
    assert_eq!(testing::statistics_analyses(&h.t.engine), runs);

    // Part of the batch: keep waiting.
    let mut titles = BTreeMap::from([(1, "Known ticket".to_string()), (2, "Two".to_string())]);
    testing::set_titles(&h.t.engine, titles.clone());
    h.tick().await;
    settle(Duration::from_millis(200)).await;
    assert_eq!(testing::statistics_analyses(&h.t.engine), runs);

    // The whole batch: one analysis with every title.
    titles.insert(3, "Three".into());
    testing::set_titles(&h.t.engine, titles);
    h.tick().await;
    let stats = h.wait_for("statistics", |stats| task_title(stats, 3) == "Three").await;
    assert_eq!(task_title(&stats, 2), "Two");
    for _ in 0..3 {
        h.tick().await;
    }
    settle(Duration::from_millis(200)).await;
    assert_eq!(testing::statistics_analyses(&h.t.engine), runs + 1);
    assert_eq!(testing::title_requests(&h.t.engine).len(), 1);
}

#[tokio::test]
async fn an_inaccessible_title_ends_the_batch_after_a_quiet_period() {
    let h = Harness::new(week_logs()).await;
    testing::use_title_seam(&h.t.engine);
    h.show(Some("statistics")).await;
    h.ok(json!({"type": "statistics.refresh"})).await;
    h.wait_for("statistics", ready).await;
    assert_eq!(testing::title_requests(&h.t.engine), [vec![1, 2]]);
    let runs = testing::statistics_analyses(&h.t.engine);

    // Ticket 1 arrives; ticket 2 never does.
    testing::set_titles(&h.t.engine, BTreeMap::from([(1, "One".to_string())]));
    h.tick().await;
    h.t.clock.advance(9.0);
    h.tick().await;
    settle(Duration::from_millis(200)).await;
    assert_eq!(testing::statistics_analyses(&h.t.engine), runs);
    h.t.clock.advance(1.0);
    h.tick().await;
    let stats = h.wait_for("statistics", |stats| task_title(stats, 1) == "One").await;
    assert_eq!(task_title(&stats, 2), "Azure ticket #2");
    assert_eq!(testing::statistics_analyses(&h.t.engine), runs + 1);
}

#[tokio::test]
async fn the_period_and_anchor_move_and_reset_the_zoom() {
    let h = Harness::new(week_logs()).await;
    h.ok(json!({"type": "statistics.zoomTo", "start": "2026-10-05T08:00:00Z", "end": "2026-10-05T09:00:00Z"}))
        .await;
    assert_eq!(h.slice("statistics")["zoomDepth"], 1);
    h.ok(json!({"type": "statistics.setPeriod", "period": "month"})).await;
    let stats = h.slice("statistics");
    assert_eq!(stats["range"]["start"], "2026-09-30T22:00:00Z");
    assert_eq!((stats["isZoomed"].clone(), stats["zoomDepth"].clone()), (json!(false), json!(0)));
    h.ok(json!({"type": "statistics.move", "amount": -1})).await;
    assert_eq!(h.slice("statistics")["range"]["start"], "2026-08-31T22:00:00Z");
    h.ok(json!({"type": "statistics.jumpTo", "date": "2026-02-10"})).await;
    assert_eq!(h.slice("statistics")["range"]["start"], "2026-01-31T23:00:00Z");
    h.ok(json!({"type": "statistics.current"})).await;
    assert_eq!(h.slice("statistics")["range"]["start"], "2026-09-30T22:00:00Z");
    h.ok(json!({"type": "statistics.setSection", "section": "patterns"})).await;
    assert_eq!(h.slice("statistics")["section"], "patterns");
    // Nothing downloads while the page is hidden.
    assert_eq!(h.seven_pace.calls_to("work_logs"), 0);
}
