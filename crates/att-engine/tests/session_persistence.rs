//! Persistence across a restart (reopening the store), 1.14.x documents and the load-time
//! rules, history and the CSV export, repositories, the agenda and the tray.

mod support;

use std::sync::Arc;

use serde_json::{Value, json};

use att_core::Configuration;
use att_core::model::{Repository, WorkLog};
use att_store::{Store, keys};
use support::*;

/// A second engine on the same store, as after a restart.
fn reopen(store: Arc<Store>) -> Harness {
    let config: Configuration = store.get(keys::CONFIGURATION).unwrap().unwrap();
    Harness::with_store(store, config)
}

#[tokio::test]
async fn session_state_survives_a_restart() {
    let dir = TempDir::new();
    let root = dir.repository("webshop", "feature/4821-card-retry");
    let store = store();
    {
        let h = Harness::with_store(
            store.clone(),
            configuration(vec![Repository::new(root.to_string_lossy())]),
        );
        h.seven_pace.set_current(running(Some(4821), Some("dev"), None));
        h.start().await;
        h.tick().await;
        h.tick().await;
        set_branch(&root, "feature/33984-improve-loading");
        h.tick().await;
        h.tick().await;
        assert_eq!(h.slice("prompts")["branches"].as_array().unwrap().len(), 1);
        h.ok(json!({"type": "quick.toggleFavorite", "ticketId": 4790})).await;
        h.ok(json!({"type": "tracking.pause"})).await;
        h.ok(json!({"type": "awareness.deferForgotten", "untilTomorrow": true})).await;
    }
    let h = reopen(store.clone());
    let tracking = h.slice("tracking");
    assert_eq!(tracking["paused"]["ticketId"], 4821);
    assert_eq!(tracking["paused"]["activityId"], "dev");
    assert_eq!(h.slice("prompts")["branches"][0]["change"]["ticketId"], 33984);
    assert_eq!(h.slice("flow")["quickTickets"][0]["ticketId"], 4790);
    assert_eq!(h.slice("flow")["quickTickets"][0]["favorite"], true);
    let awareness: att_core::awareness::WorkAwarenessLedger =
        store.get(keys::WORK_AWARENESS).unwrap().unwrap();
    assert!(awareness.deferral.ignored_day.is_some());
    // The audit log is in the store too.
    let titles: Vec<String> = h.slice("history")["audit"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["title"].as_str().unwrap().to_string())
        .collect();
    assert!(titles.contains(&"Tracking paused".to_string()), "{titles:?}");
}

#[tokio::test]
async fn documents_written_by_1_14_load_and_another_workspace_drops_them() {
    let store = store();
    // Swift encoding: seconds since 2001, `ticketID` keys.
    store
        .put_raw(
            keys::PAUSED_SESSION,
            &json!({"ticketID": 33984, "activityID": "dev", "workspace": WORKSPACE, "pausedAt": 781_430_400.0, "elapsedSeconds": 1200.0}).to_string(),
        )
        .unwrap();
    store
        .put_raw(
            keys::QUICK_TICKETS,
            &json!({"workspace": WORKSPACE, "recent": [4821], "favorites": [4790]}).to_string(),
        )
        .unwrap();
    store
        .put_raw(
            keys::ATTENTION_DISMISSED,
            &json!({format!("{WORKSPACE}|x"): 781_430_400.0}).to_string(),
        )
        .unwrap();
    store
        .put_raw(
            keys::DAY_REVIEWS,
            &json!({format!("{WORKSPACE}|2026-10-6"): {"reviewedAt": 781_430_400.0}}).to_string(),
        )
        .unwrap();
    let h = Harness::with_store(store.clone(), configuration(vec![]));
    let paused = h.slice("tracking")["paused"].clone();
    assert_eq!(paused["ticketId"], 33984);
    assert_eq!(paused["elapsedSeconds"], 1200.0);
    assert_eq!(paused["pausedAt"], "2025-10-06T08:00:00Z");
    let quick: Vec<i64> = h.slice("flow")["quickTickets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|ticket| ticket["ticketId"].as_i64().unwrap())
        .collect();
    assert_eq!(quick, vec![4790, 4821]);
    // Saving writes the 2.0 encoding.
    h.ok(json!({"type": "app.dismissError"})).await;
    let raw = store.get_raw(keys::ATTENTION_DISMISSED).unwrap().unwrap();
    assert_eq!(raw, format!(r#"{{"{WORKSPACE}/|x":"2025-10-06T08:00:00Z"}}"#), "respelled");

    // Another 7pace workspace: the pause, the meeting return and quick tickets are dropped.
    let mut other = configuration(vec![]);
    other.seven_pace_url = "https://fabrikam.timehub.7pace.com".into();
    let h = Harness::with_store(store.clone(), other);
    assert_eq!(h.slice("tracking")["paused"], Value::Null);
    assert_eq!(h.slice("flow")["quickTickets"], json!([]));
}

#[tokio::test]
async fn data_keyed_by_another_spelling_of_the_workspace_still_belongs_to_it() {
    let store = store();
    // 1.14.x stored the URL as typed, without the trailing slash of the 2.0 identity.
    let typed = WORKSPACE.to_string();
    store
        .put_raw(
            keys::PAUSED_SESSION,
            &json!({"ticketID": 4821, "workspace": typed, "pausedAt": 781_430_400.0, "elapsedSeconds": 60.0}).to_string(),
        )
        .unwrap();
    store
        .put_raw(
            keys::QUICK_TICKETS,
            &json!({"workspace": typed, "recent": [4821], "favorites": []}).to_string(),
        )
        .unwrap();
    store
        .put_raw(
            keys::DAY_REVIEWS,
            &json!({format!("{typed}|2026-10-6"): {"reviewedAt": 781_430_400.0}}).to_string(),
        )
        .unwrap();
    store
        .put_raw(
            keys::FIGMA_STORE,
            &json!({"workspaces": {format!("contoso|{typed}"): {"links": {"AbC123": 4790}}}})
                .to_string(),
        )
        .unwrap();
    let h = Harness::with_store(store.clone(), configuration(vec![]));
    assert_eq!(h.slice("tracking")["paused"]["ticketId"], 4821);
    assert_eq!(h.slice("flow")["quickTickets"][0]["ticketId"], 4821);
    assert_eq!(h.slice("figma")["files"][0]["ticketId"], 4790);
    h.start().await;
    // Reviewed today already: no prompt at the finish time.
    h.t.clock.set(ts("2026-10-06T15:01:00Z"));
    h.tick().await;
    assert_eq!(h.slice("prompts")["dayReview"], Value::Null);
    let raw = store.get_raw(keys::DAY_REVIEWS).unwrap().unwrap();
    assert!(raw.contains(&format!("\"{WORKSPACE}/|2026-10-6\"")), "respelled: {raw}");
}

#[tokio::test]
async fn an_unreadable_document_is_kept_and_never_overwritten() {
    let store = store();
    store.put_raw(keys::FIGMA_STORE, "{not json").unwrap();
    let h = Harness::with_store(store.clone(), configuration(vec![]));
    let issue = h.slice("app")["storageIssue"].as_str().unwrap().to_string();
    assert!(
        issue.starts_with("Saved data could not be read. The original data has been preserved"),
        "{issue}"
    );
    h.ok(json!({"type": "figma.clearHistory"})).await;
    assert_eq!(store.get_raw(keys::FIGMA_STORE).unwrap().as_deref(), Some("{not json"));
}

#[tokio::test]
async fn a_microphone_meeting_from_1_14_keeps_its_end_prompt() {
    let store = store();
    // A meeting return with an open end (Swift `Date.distantFuture`) and no monitor document.
    store
        .put_raw(
            keys::MEETING_RETURN,
            &json!({
                "occurrenceID": "microphone:ABC", "end": 63_113_904_000.0, "ticketID": 4821,
                "activityID": "dev", "workspace": WORKSPACE, "meetingIdentity": "wl-0|0|2026-10-06T09:50:00",
                "notified": false, "microphoneSessionID": "ABC", "microphoneAppID": "us.zoom.xos"
            })
            .to_string(),
        )
        .unwrap();
    let h = Harness::with_store(store.clone(), configuration(vec![]));
    h.ok(json!({"type": "app.dismissError"})).await;
    let monitor: Value =
        serde_json::from_str(&store.get_raw(keys::MICROPHONE_TRACKING).unwrap().unwrap()).unwrap();
    let link = &monitor["links"]["ABC"];
    assert_eq!(link["appId"], "us.zoom.xos");
    assert_eq!(link["appName"], "Zoom");
    assert_eq!(link["trackingIdentity"], "wl-0|0|2026-10-06T09:50:00");
}

#[tokio::test]
async fn history_export_writes_formula_safe_csv() {
    let h = Harness::new(configuration(vec![]));
    // The running ticket's title is loaded, so the export can name it.
    h.seven_pace.set_current(running(Some(33984), Some("dev"), None));
    let mut first = WorkLog::new("a", "2026-10-06T09:00:00", 1800.9);
    first.work_item_id = Some(33984);
    first.comment = Some("=SUM(A1) \"quoted\"".into());
    let mut second = WorkLog::new("b", "2026-10-06T08:00:00", 600.0);
    second.comment = Some("-dash, comma".into());
    h.seven_pace.server.lock().unwrap().logs = vec![first, second];
    h.start().await;
    settle().await;
    let history = h.slice("history");
    assert_eq!(history["loaded"], true);
    assert_eq!(history["totalSeconds"], 2400.9);
    assert_eq!(history["from"], "2026-09-30");
    assert_eq!(history["to"], "2026-10-06");
    assert_eq!(history["todayLogs"].as_array().unwrap().len(), 2);
    let dir = TempDir::new();
    let path = dir.0.join("azure-time-history.csv");
    h.ok(json!({"type": "history.exportCsv", "path": path.to_string_lossy()})).await;
    let text = std::fs::read_to_string(&path).unwrap();
    assert_eq!(
        text,
        "Timestamp,Ticket,Title,Seconds,Comment\n\
         \"2026-10-06T09:00:00\",\"33984\",\"Improve loading\",\"1800\",\"'=SUM(A1) \"\"quoted\"\"\"\n\
         \"2026-10-06T08:00:00\",\"\",\"\",\"600\",\"'-dash, comma\""
    );
    // A missing folder is reported, not ignored.
    let missing = dir.0.join("missing/history.csv");
    h.ok(json!({"type": "history.exportCsv", "path": missing.to_string_lossy()})).await;
    assert!(h.slice("app")["error"].as_str().unwrap().contains("could not be saved"));
}

#[tokio::test]
async fn the_history_range_is_validated_and_today_comes_from_the_week() {
    let h = Harness::new(configuration(vec![]));
    let mut today = WorkLog::new("t", "2026-10-06T09:00:00", 900.0);
    today.work_item_id = Some(4821);
    h.seven_pace.server.lock().unwrap().logs = vec![today];
    h.start().await;
    h.ok(json!({"type": "history.setRange", "from": "2026-10-02", "to": "2026-10-01"})).await;
    h.ok(json!({"type": "history.load"})).await;
    assert_eq!(h.slice("app")["error"], "Choose a history end date on or after the start date.");
    h.ok(json!({"type": "history.setRange", "from": "2026-09-01", "to": "2026-09-02"})).await;
    h.ok(json!({"type": "history.load"})).await;
    let history = h.slice("history");
    assert_eq!(history["from"], "2026-09-01");
    // Today's worklogs come from the week's progress download, without another request.
    assert_eq!(history["todayLogs"][0]["id"], "t");
    assert_eq!(h.slice("tracking")["todaySeconds"], 900.0);
}

#[tokio::test]
async fn repositories_are_scanned_added_paused_and_removed() {
    let dir = TempDir::new();
    let first = dir.repository("alpha", "main");
    dir.repository("beta", "feature/12-x");
    std::fs::create_dir_all(dir.0.join("not-a-repo")).unwrap();
    let h = Harness::new(configuration(vec![]));
    h.ok(json!({"type": "repositories.scan", "path": dir.0.to_string_lossy()})).await;
    let scan = h.slice("repositories")["scan"].clone();
    assert_eq!(scan["scanning"], false);
    let results = scan["results"].as_array().unwrap();
    assert_eq!(results.len(), 2, "{scan}");
    assert_eq!(results[0]["branch"], "main");
    let paths: Vec<String> =
        results.iter().map(|r| r["path"].as_str().unwrap().to_string()).collect();
    h.ok(json!({"type": "repositories.add", "paths": paths})).await;
    let repositories = h.slice("repositories")["repositories"].clone();
    assert_eq!(repositories.as_array().unwrap().len(), 2);
    assert_eq!(repositories[0]["name"], "alpha");
    // Adding again never duplicates, and a folder without Git is refused.
    h.ok(json!({"type": "repositories.add", "paths": [first.to_string_lossy(), dir.0.join("not-a-repo").to_string_lossy()]})).await;
    assert_eq!(h.slice("repositories")["repositories"].as_array().unwrap().len(), 2);
    assert!(
        h.slice("app")["error"].as_str().unwrap().starts_with("No Git repository at not-a-repo")
    );
    h.ok(json!({"type": "repositories.scan", "path": dir.0.to_string_lossy()})).await;
    assert_eq!(h.slice("repositories")["scan"]["results"][0]["alreadyAdded"], true);
    h.ok(json!({"type": "repositories.cancelScan"})).await;
    assert_eq!(h.slice("repositories")["scan"]["results"], json!([]));

    let id = repositories[0]["id"].clone();
    h.ok(json!({"type": "repositories.setEnabled", "id": id, "enabled": false})).await;
    assert_eq!(h.slice("repositories")["repositories"][0]["enabled"], false);
    h.ok(json!({"type": "repositories.remove", "id": id})).await;
    assert_eq!(h.slice("repositories")["repositories"].as_array().unwrap().len(), 1);
    h.ok(json!({"type": "repositories.toggleWatching"})).await;
    assert_eq!(h.slice("repositories")["watching"], false);
}

#[tokio::test]
async fn the_agenda_shows_any_day_while_meetings_stay_on_today() {
    let mut config = configuration(vec![]);
    config.calendar_enabled = true;
    let h = Harness::new(config);
    *h.t.calendar.calendars.lock().unwrap() = vec![att_platform::CalendarInfo {
        id: "work".into(),
        title: "Work".into(),
        color: Some("#2f7de1".into()),
        source: Some("iCloud".into()),
    }];
    let event = |id: &str, title: &str, start: &str, end: &str| att_platform::CalendarEvent {
        occurrence_id: id.into(),
        calendar_id: "work".into(),
        title: title.into(),
        start: ts(start),
        end: ts(end),
        all_day: false,
        status: att_platform::EventStatus::Confirmed,
        declined: false,
        free: false,
        location: None,
        notes: None,
        url: None,
        calendar_color: Some("#2f7de1".into()),
        calendar_title: Some("Work".into()),
    };
    let mut cancelled = event("x", "Cancelled", "2026-10-07T09:00:00Z", "2026-10-07T10:00:00Z");
    cancelled.status = att_platform::EventStatus::Canceled;
    *h.t.calendar.events.lock().unwrap() = vec![
        event("today", "", "2026-10-06T07:00:00Z", "2026-10-06T09:00:00Z"),
        event("tomorrow", "Planning", "2026-10-07T07:00:00Z", "2026-10-07T08:00:00Z"),
        cancelled,
    ];
    h.start().await;
    h.tick().await;
    let agenda = h.slice("agenda");
    assert_eq!(agenda["supported"], true);
    assert_eq!(agenda["access"], "authorized");
    assert_eq!(
        agenda["calendars"][0],
        json!({"id": "work", "title": "Work", "color": "#2f7de1", "source": "iCloud", "selected": false})
    );
    assert_eq!(agenda["events"][0]["title"], "Untitled event");
    assert_eq!(agenda["events"][0]["isNow"], true);
    h.ok(json!({"type": "agenda.setDay", "day": "2026-10-07"})).await;
    let agenda = h.slice("agenda");
    assert_eq!(agenda["day"], "2026-10-07");
    assert_eq!(agenda["events"].as_array().unwrap().len(), 1, "cancelled events are left out");
    assert_eq!(agenda["events"][0]["title"], "Planning");
}

#[tokio::test(start_paused = true)]
async fn the_tray_shows_the_elapsed_clock_and_the_state() {
    let h = Harness::new(configuration(vec![]));
    let mut state = running(Some(33984), Some("dev"), None);
    state.track.as_mut().unwrap().current_track_length = Some(3_725.0);
    h.seven_pace.set_current(state);
    h.engine().start();
    // The ticker updates once per second; the first update shows the connect in progress.
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    settle().await;
    let calls = h.shell();
    let tray: Vec<&String> = calls.iter().filter(|call| call.starts_with("set_tray")).collect();
    assert!(!tray.is_empty(), "{calls:?}");
    assert_eq!(tray.last().unwrap().as_str(), "set_tray(Running, 01:02:05)");
}
