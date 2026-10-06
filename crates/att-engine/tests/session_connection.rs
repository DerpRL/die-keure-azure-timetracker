//! Connection: connect, failures and their messages, stale results, `apply` ordering and the
//! rule that metadata lookups never mark 7pace disconnected.

mod support;

use std::sync::Arc;

use serde_json::json;
use tokio::sync::Semaphore;

use att_core::AppError;
use att_core::model::WorkItem;
use support::*;

#[tokio::test]
async fn connect_reads_the_timer_then_activities_history_and_progress() {
    let h = Harness::new(configuration(vec![]));
    h.seven_pace.set_current(running(Some(33984), Some("dev"), None));
    h.start().await;

    let connection = h.slice("connection");
    assert_eq!(connection["health"], "confirmed");
    assert_eq!(connection["status"], "7pace connected");
    assert_eq!(connection["connected"], true);
    assert_eq!(connection["hasSevenPaceToken"], true);
    assert_eq!(connection["hasAzurePat"], true);
    assert_eq!(connection["host"], HOST);
    assert_eq!(connection["workspace"], WORKSPACE, "the URL as typed, like 1.14.x");
    assert_eq!(connection["indicator"], "running");
    assert_eq!(h.slice("app")["notice"], format!("Connected to {HOST}"));
    let flow = h.slice("flow");
    assert_eq!(flow["activitiesLoaded"], true);
    assert_eq!(flow["activityTypes"].as_array().unwrap().len(), 4);
    let tracking = h.slice("tracking");
    assert_eq!(tracking["running"], true);
    assert_eq!(tracking["ticketId"], 33984);
    assert_eq!(tracking["title"], "Improve loading", "title from the Azure batch lookup");
    assert_eq!(tracking["extrapolate"], true);
    assert_eq!(tracking["ticketUrl"], "https://dev.azure.com/contoso/_workitems/edit/33984");
    assert_eq!(h.slice("progress")["available"], true);
    assert_eq!(h.slice("history")["loaded"], true);
    let calls = h.seven_pace.take_calls();
    assert_eq!(calls[0], "current");
    assert!(calls.contains(&"activityTypes".to_string()), "{calls:?}");
    assert!(
        calls.iter().filter(|call| *call == "workLogs").count() >= 2,
        "history + progress: {calls:?}"
    );
}

#[tokio::test]
async fn connection_failures_show_why() {
    // No token: the factory's message, and the health asks for setup.
    let h = Harness::new(configuration(vec![]));
    *h.t.clients.error.lock().unwrap() = Some(AppError::message(
        "Pair with a mobile PIN or add your 7pace API token in Settings → Accounts.",
    ));
    h.start().await;
    let connection = h.slice("connection");
    assert_eq!(connection["health"], "unconfigured");
    assert_eq!(connection["status"], "Set up 7pace");
    assert_eq!(
        connection["connectionIssue"],
        "Pair with a mobile PIN or add your 7pace API token in Settings → Accounts."
    );
    assert_eq!(h.slice("app")["error"], serde_json::Value::Null, "shown once, in the health view");

    // Rejected credentials: sign in again.
    *h.t.clients.error.lock().unwrap() = Some(AppError::Authentication(HOST.into()));
    h.ok(json!({"type": "connection.retry"})).await;
    assert_eq!(h.slice("connection")["health"], "authentication");
    assert_eq!(h.slice("connection")["status"], "Sign in to 7pace");

    // The timer read fails: offline, with the last known state kept.
    *h.t.clients.error.lock().unwrap() = None;
    h.seven_pace
        .server
        .lock()
        .unwrap()
        .fail_current
        .push_back(AppError::Network("Could not connect to contoso.timehub.7pace.com.".into()));
    h.ok(json!({"type": "connection.retry"})).await;
    let connection = h.slice("connection");
    assert_eq!(connection["health"], "disconnected");
    assert_eq!(connection["status"], "7pace offline");
    assert_eq!(connection["connected"], false);
    assert_eq!(connection["indicator"], "disconnected");
    assert_eq!(connection["connectionIssue"], "Could not connect to contoso.timehub.7pace.com.");

    // Retry while configured: a refresh confirms again.
    h.ok(json!({"type": "connection.retry"})).await;
    assert_eq!(h.slice("connection")["health"], "confirmed");
}

#[tokio::test]
async fn health_turns_stale_without_confirmation() {
    let h = Harness::new(configuration(vec![]));
    h.seven_pace.set_current(running(Some(33984), Some("dev"), None));
    h.start().await;
    // max(90 s, 2 × 60 s + 15 s) = 135 s.
    h.advance(130.0);
    assert_eq!(h.slice("connection")["health"], "confirmed");
    h.advance(10.0);
    assert_eq!(h.slice("connection")["health"], "stale");
    let tracking = h.slice("tracking");
    assert_eq!(tracking["extrapolate"], false, "a stale clock stands still");
    assert_eq!(
        h.slice("connection")["detail"],
        "Showing the last known timer. Check 7pace before changing it."
    );
}

#[tokio::test]
async fn metadata_failures_never_mark_7pace_disconnected() {
    let h = Harness::new(configuration(vec![]));
    h.start().await;
    *h.azure.error.lock().unwrap() = Some(AppError::Authentication("dev.azure.com".into()));
    h.ok(json!({"type": "tracking.openPicker"})).await;
    h.ok(json!({"type": "tracking.chooseTicket", "ticketId": 4790})).await;
    let connection = h.slice("connection");
    assert_eq!(connection["health"], "confirmed");
    assert_eq!(connection["connected"], true);
    assert_eq!(
        connection["azureIssue"],
        "Authentication failed. Check the token for dev.azure.com in Settings; it may have expired or been revoked."
    );
    assert_eq!(h.slice("flow")["draft"], serde_json::Value::Null);
    // The lookup error is shown; a later successful lookup clears the Azure issue.
    *h.azure.error.lock().unwrap() = None;
    h.ok(json!({"type": "tracking.chooseTicket", "ticketId": 4790})).await;
    assert_eq!(h.slice("connection")["azureIssue"], serde_json::Value::Null);
    assert_eq!(h.slice("flow")["draft"]["item"]["id"], 4790);
}

#[tokio::test]
async fn a_newer_search_drops_older_results() {
    let h = Arc::new(Harness::new(configuration(vec![])));
    h.start().await;
    let slow = Arc::new(Semaphore::new(0));
    let fast = Arc::new(Semaphore::new(0));
    {
        let mut gates = h.seven_pace.search_gates.lock().unwrap();
        gates.insert("login".into(), slow.clone());
        gates.insert("invoice".into(), fast.clone());
        let mut server = h.seven_pace.server.lock().unwrap();
        server.search.insert("login".into(), vec![WorkItem::new(1, "Login page")]);
        server.search.insert("invoice".into(), vec![WorkItem::new(2, "Invoice PDF")]);
    }
    let first = {
        let h = h.clone();
        tokio::spawn(async move {
            h.engine().dispatch(json!({"type": "tracking.search", "query": "login"})).await
        })
    };
    settle().await;
    let second = {
        let h = h.clone();
        tokio::spawn(async move {
            h.engine().dispatch(json!({"type": "tracking.search", "query": "invoice"})).await
        })
    };
    settle().await;
    fast.add_permits(1);
    second.await.unwrap().unwrap();
    slow.add_permits(1);
    first.await.unwrap().unwrap();
    let search = &h.slice("flow")["search"];
    assert_eq!(search["query"], "invoice");
    assert_eq!(search["results"][0]["title"], "Invoice PDF");
    assert_eq!(search["results"].as_array().unwrap().len(), 1);
    assert_eq!(search["searching"], false);
}

#[tokio::test]
async fn results_from_before_a_reconnect_are_dropped() {
    let h = Arc::new(Harness::new(configuration(vec![])));
    h.start().await;
    let gate = Arc::new(Semaphore::new(0));
    *h.azure.gate.lock().unwrap() = Some(gate.clone());
    h.ok(json!({"type": "quick.toggleFavorite", "ticketId": 4790})).await;
    // Quick switch loads the favourites' titles in one batch, held by the gate.
    h.ok(json!({"type": "quick.switch"})).await;
    assert!(h.azure.calls.lock().unwrap().contains(&"workItems([4790])".to_string()));
    // Saving settings reconnects: a new connection generation.
    let saved = {
        let h = h.clone();
        tokio::spawn(async move {
            let configuration = configuration(vec![]);
            h.engine()
                .dispatch(json!({"type": "settings.save", "configuration": configuration, "azurePat": "", "sevenPaceToken": ""}))
                .await
        })
    };
    settle().await;
    gate.add_permits(10);
    saved.await.unwrap().unwrap();
    settle().await;
    assert!(h.slice("workItems").get("4790").is_none(), "{}", h.slice("workItems"));
}

#[tokio::test]
async fn older_server_states_are_ignored() {
    let h = Harness::new(configuration(vec![]));
    let mut newer = running(Some(33984), Some("dev"), None);
    newer.timestamp = Some(200);
    h.seven_pace.set_current(newer);
    h.start().await;
    assert_eq!(h.slice("tracking")["running"], true);

    let mut older = idle();
    older.timestamp = Some(100);
    h.seven_pace.server.lock().unwrap().scripted_current.push_back(older);
    h.ok(json!({"type": "connection.refresh"})).await;
    assert_eq!(h.slice("tracking")["running"], true, "an older read never replaces a newer one");

    let mut latest = idle();
    latest.timestamp = Some(300);
    h.seven_pace.server.lock().unwrap().scripted_current.push_back(latest);
    h.ok(json!({"type": "connection.refresh"})).await;
    assert_eq!(h.slice("tracking")["running"], false);
}

#[tokio::test]
async fn response_warnings_become_the_notice_and_dismissals_clear_banners() {
    let h = Harness::new(configuration(vec![]));
    let mut state = running(Some(33984), Some("dev"), None);
    state.track_settings = Some(att_core::model::TrackSettings {
        is_tracking_start_allowed: Some(true),
        response_state: None,
        response_message: Some("Your 7pace license expires soon.".into()),
    });
    h.seven_pace.set_current(state);
    h.ok(json!({"type": "connection.retry"})).await;
    h.ok(json!({"type": "connection.refresh"})).await;
    assert_eq!(h.slice("app")["notice"], "Your 7pace license expires soon.");
    h.ok(json!({"type": "app.dismissNotice"})).await;
    assert_eq!(h.slice("app")["notice"], serde_json::Value::Null);
}
