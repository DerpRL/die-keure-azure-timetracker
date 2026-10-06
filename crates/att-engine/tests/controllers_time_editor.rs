//! The Time editor controller (port of `TimeEditorModel.swift` and `AppModel.saveTimeEdit`):
//! edits, splits, merges, undo, guided and idle corrections, the recovery journal and its
//! checkpoints, and the rule that no write is ever retried.

#[path = "support/controllers.rs"]
mod support;

use serde_json::{Value, json};
use uuid::Uuid;

use att_core::model::WorkLog;
use att_core::worklog::ops::{WorkLogChange, WorkLogChangeStatus};
use att_engine::controllers::{hooks, testing};
use support::*;

const A: &str = "11111111-1111-1111-1111-111111111111";
const B: &str = "22222222-2222-2222-2222-222222222222";
const C: &str = "33333333-3333-3333-3333-333333333333";
const JOURNAL: &str = "timeEditJournal";

/// Tuesday 6 October 2026, "now" is 10:00 in Brussels (08:00Z).
fn day_logs() -> Vec<WorkLog> {
    vec![
        log(A, "2026-10-06T07:00:00", 3600.0, Some(1), "Development"),
        log(B, "2026-10-06T08:00:00", 3600.0, Some(1), "Development"),
        log(C, "2026-10-06T09:00:00", 1800.0, Some(2), "Review"),
    ]
}

/// An editor showing today's entries.
async fn editor() -> Harness {
    let h = Harness::new(day_logs()).await;
    h.seven_pace.probe(h.t.store.clone(), JOURNAL);
    h.show(Some("timeEditor")).await;
    h.tick().await;
    h.wait_for("timeEditor", |editor| editor["logs"].as_array().unwrap().len() == 3).await;
    h
}

fn ids(values: &Value) -> Vec<String> {
    values.as_array().unwrap().iter().map(|log| log["id"].as_str().unwrap().to_string()).collect()
}

fn journal(h: &Harness) -> Vec<WorkLogChange> {
    document(&h.t.store, JOURNAL).unwrap_or_default()
}

/// The journal as the store had it when 7pace received each write.
fn journals_at_writes(h: &Harness) -> Vec<Vec<WorkLogChange>> {
    h.seven_pace.probed().iter().map(|json| serde_json::from_str(json).unwrap()).collect()
}

#[tokio::test]
async fn an_edit_is_journalled_before_the_write_and_confirmed_after_it() {
    let h = editor().await;
    let editor = h.slice("timeEditor");
    assert_eq!(ids(&editor["logs"]), [C, B, A], "newest first");
    assert_eq!(editor["configured"], true);
    assert_eq!(
        h.seven_pace.calls()[0],
        "work_logs(2026-10-06T00:00:00..2026-10-07T00:00:00 editable)"
    );

    h.ok(json!({"type": "timeEditor.select", "logId": A})).await;
    let editor = h.slice("timeEditor");
    assert_eq!(editor["selected"]["id"], A);
    assert_eq!(editor["mode"], "edit");
    assert_eq!(editor["start"], "2026-10-06T05:00:00Z");
    assert_eq!(editor["end"], "2026-10-06T06:00:00Z");
    assert_eq!(editor["splitAt"], "2026-10-06T05:30:00Z");
    assert_eq!(
        (&editor["secondTicket"], &editor["secondComment"], &editor["secondActivity"]),
        (&json!("1"), &json!("Development"), &json!("dev"))
    );

    h.ok(json!({"type": "timeEditor.setTimes", "start": "2026-10-06T05:15:00Z", "end": "2026-10-06T06:00:00Z"}))
        .await;
    let editor = h.slice("timeEditor");
    assert_eq!(editor["plan"]["title"], "Edit time");
    assert!(editor["validationIssue"].is_null());
    assert_eq!(editor["loadedConflicts"], json!([]), "B only touches the new end");

    h.ok(json!({"type": "timeEditor.save"})).await;
    assert_eq!(h.seven_pace.mutations(), [format!("update {A}")]);
    // The checkpoint was durable before 7pace saw the request.
    let at_write = journals_at_writes(&h);
    assert_eq!(at_write[0].len(), 1);
    assert_eq!(at_write[0][0].status, WorkLogChangeStatus::Applying);
    assert_eq!(at_write[0][0].detail, format!("Updating entry {A}."));
    let stored = journal(&h);
    assert_eq!(
        (stored[0].status, stored[0].detail.as_str()),
        (WorkLogChangeStatus::Complete, "Confirmed by 7pace")
    );

    let editor = h.slice("timeEditor");
    assert_eq!(
        editor["message"],
        "Edit time confirmed by 7pace. You can undo this from Recent edits."
    );
    assert!(editor["selected"].is_null());
    assert_eq!(editor["changes"][0]["status"], "complete");
    assert_eq!(editor["requiresReview"], false);
    // The shown day reloads after a save.
    let editor = h
        .wait_for("timeEditor", |editor| {
            editor["logs"]
                .as_array()
                .unwrap()
                .iter()
                .any(|log| log["timestamp"] == "2026-10-06T07:15:00")
        })
        .await;
    assert_eq!(editor["loading"], false);
}

#[tokio::test]
async fn a_split_creates_the_second_part_first_and_undo_restores_the_entry() {
    let h = editor().await;
    h.ok(json!({"type": "timeEditor.select", "logId": A})).await;
    h.ok(json!({"type": "timeEditor.setMode", "mode": "split"})).await;
    h.ok(json!({"type": "timeEditor.setSplit", "at": "2026-10-06T05:20:00Z", "ticket": "5", "comment": "Code review", "activityId": ""}))
        .await;
    let plan = h.slice("timeEditor")["plan"].clone();
    assert_eq!(plan["title"], "Split entry");
    assert_eq!(plan["desired"][1]["ticketId"], 5);
    assert_eq!(plan["desired"][1]["seconds"], 2400);

    h.ok(json!({"type": "timeEditor.save"})).await;
    assert_eq!(h.seven_pace.mutations(), ["create".to_string(), format!("update {A}")]);
    let at_write = journals_at_writes(&h);
    assert_eq!(
        at_write[0][0].detail,
        "Creating a replacement entry; if interrupted, check 7pace before doing anything else."
    );
    assert_eq!(at_write[1][0].after.len(), 2, "the created entry was journalled before the update");
    let split = journal(&h).remove(0);
    assert_eq!(
        (split.title.as_str(), split.status),
        ("Split entry", WorkLogChangeStatus::Complete)
    );

    h.ok(json!({"type": "timeEditor.beginUndo", "changeId": split.id})).await;
    let editor = h.slice("timeEditor");
    assert_eq!(editor["mode"], "undo");
    assert_eq!(editor["plan"]["title"], "Undo split entry");
    h.ok(json!({"type": "timeEditor.save"})).await;
    let created = split.after.iter().find(|log| log.id != A).unwrap().id.clone();
    assert_eq!(h.seven_pace.mutations()[2..], [format!("update {A}"), format!("delete {created}")]);
    let stored = journal(&h);
    let undo = stored.iter().find(|change| change.undo_of == Some(split.id)).unwrap();
    assert_eq!(undo.status, WorkLogChangeStatus::Complete);
    let original = stored.iter().find(|change| change.id == split.id).unwrap();
    assert_eq!(original.status, WorkLogChangeStatus::Undone);
    let logs = h.seven_pace.logs();
    assert_eq!((logs[A].length, logs.len()), (3600.0, 3));
}

#[tokio::test]
async fn a_merge_removes_the_later_entry_and_undo_recreates_it() {
    let h = editor().await;
    h.ok(json!({"type": "timeEditor.setSelection", "ids": [A, B]})).await;
    h.ok(json!({"type": "timeEditor.beginMerge"})).await;
    let editor = h.slice("timeEditor");
    assert_eq!(editor["mode"], "merge");
    assert_eq!(ids(&editor["mergeLogs"]), [A, B]);
    assert_eq!(editor["plan"]["title"], "Merge 2 entries");

    h.ok(json!({"type": "timeEditor.save"})).await;
    assert_eq!(h.seven_pace.mutations(), [format!("update {A}"), format!("delete {B}")]);
    assert_eq!(h.seven_pace.logs()[A].length, 7200.0);
    let merge = journal(&h).remove(0);

    h.ok(json!({"type": "timeEditor.beginUndo", "changeId": merge.id})).await;
    h.ok(json!({"type": "timeEditor.save"})).await;
    assert_eq!(h.seven_pace.mutations()[2..], ["create".to_string(), format!("update {A}")]);
    let logs = h.seven_pace.logs();
    assert_eq!(logs[A].length, 3600.0);
    assert_eq!(logs.len(), 3, "B was recreated with a new id");
    assert!(!logs.contains_key(B));
    let stored = journal(&h);
    assert_eq!(
        stored.iter().find(|c| c.id == merge.id).unwrap().status,
        WorkLogChangeStatus::Undone
    );
}

#[tokio::test]
async fn a_failed_write_is_never_retried_and_the_change_waits_for_review() {
    let h = editor().await;
    h.seven_pace.state.lock().unwrap().fail_update = true;
    h.ok(json!({"type": "timeEditor.select", "logId": A})).await;
    h.ok(json!({"type": "timeEditor.setMode", "mode": "split"})).await;
    h.ok(json!({"type": "timeEditor.setSplit", "at": "2026-10-06T05:30:00Z", "ticket": "", "comment": "Second part", "activityId": ""}))
        .await;
    h.ok(json!({"type": "timeEditor.save"})).await;

    // The create succeeded, the update failed once and was not repeated.
    assert_eq!(h.seven_pace.mutations(), ["create".to_string(), format!("update {A}")]);
    let record = journal(&h).remove(0);
    assert_eq!(record.status, WorkLogChangeStatus::NeedsReview);
    assert!(record.detail.contains("No request was retried."), "{}", record.detail);
    assert_eq!(record.after.len(), 2);
    let editor = h.slice("timeEditor");
    assert_eq!(editor["needsReload"], true);
    assert_eq!(editor["requiresReview"], true);
    assert!(
        editor["issue"]
            .as_str()
            .unwrap()
            .ends_with("Review Recent edits and the actual entries in 7pace before continuing.")
    );

    // Neither another save nor a reloaded entry repeats anything while the change needs review.
    h.ok(json!({"type": "timeEditor.save"})).await;
    h.seven_pace.state.lock().unwrap().fail_update = false;
    h.ok(json!({"type": "timeEditor.select", "logId": A})).await;
    assert_eq!(h.slice("timeEditor")["needsReload"], false);
    h.ok(json!({"type": "timeEditor.save"})).await;
    assert_eq!(h.seven_pace.mutations().len(), 2);

    // The user checked 7pace: the change is acknowledged, nothing is undone or retried.
    h.ok(json!({"type": "timeEditor.acknowledge", "changeId": record.id})).await;
    let stored = journal(&h).remove(0);
    assert_eq!(stored.status, WorkLogChangeStatus::Reviewed);
    assert!(stored.detail.ends_with(" User acknowledged checking the entries in 7pace."));
    assert_eq!(h.slice("timeEditor")["requiresReview"], false);
    h.ok(json!({"type": "timeEditor.save"})).await;
    assert_eq!(h.seven_pace.mutations().len(), 3, "a new, confirmed edit");
}

/// A 1.14.x journal (Swift encoding, workspace without a trailing slash) with a change the app
/// did not see finish.
const SWIFT_APPLYING: &str = r#"[{"before":[{"id":"11111111-1111-1111-1111-111111111111","isCanEdit":true,"timestamp":"2026-10-06T07:00:00","length":3600,"workItemId":1,"comment":"Development"}],"date":812966400.5,"id":"935077DC-1B64-4A96-AF7D-58E4887C9DB3","status":"applying","detail":"Updating entry 11111111-1111-1111-1111-111111111111.","title":"Edit time","workspace":"https:\/\/acme.timehub.7pace.com","after":[{"id":"11111111-1111-1111-1111-111111111111","isCanEdit":true,"timestamp":"2026-10-06T07:00:00","length":3600,"workItemId":1,"comment":"Development"}],"desired":[{"seconds":2700,"ticketID":1,"billableSeconds":2700,"start":812962800,"comment":"Development","existingID":"11111111-1111-1111-1111-111111111111","allowDefaultActivity":false}]}]"#;

#[tokio::test]
async fn an_interrupted_change_needs_review_after_a_restart_and_blocks_saving() {
    let store = store_with(&configuration());
    store.put_raw(JOURNAL, SWIFT_APPLYING).unwrap();
    let h = Harness::on(store, FakeSevenPace::with_logs(day_logs())).await;
    let editor = h.slice("timeEditor");
    assert_eq!(editor["changes"].as_array().unwrap().len(), 1);
    assert_eq!(editor["changes"][0]["status"], "needsReview");
    assert_eq!(
        editor["changes"][0]["detail"],
        "The app closed during this change. Check the affected entries in 7pace; no request will be replayed."
    );
    assert_eq!(editor["requiresReview"], true);

    h.ok(json!({"type": "timeEditor.select", "logId": A})).await;
    h.ok(json!({"type": "timeEditor.save"})).await;
    assert!(h.seven_pace.mutations().is_empty());
}

#[tokio::test]
async fn an_unreadable_journal_blocks_saving_before_anything_is_sent() {
    let store = store_with(&configuration());
    store.put_raw(JOURNAL, "{not a journal").unwrap();
    let h = Harness::on(store, FakeSevenPace::with_logs(day_logs())).await;
    let issue = h.slice("timeEditor")["journalIssue"].as_str().unwrap().to_string();
    assert!(issue.starts_with("Edit history could not be read. "), "{issue}");

    h.ok(json!({"type": "timeEditor.select", "logId": A})).await;
    h.ok(json!({"type": "timeEditor.setTimes", "start": "2026-10-06T05:15:00Z", "end": "2026-10-06T06:00:00Z"}))
        .await;
    h.ok(json!({"type": "timeEditor.save"})).await;
    assert!(h.seven_pace.mutations().is_empty());
    assert_eq!(h.slice("timeEditor")["issue"], issue.as_str());
    assert_eq!(h.t.store.get_raw(JOURNAL).unwrap().as_deref(), Some("{not a journal"));
}

#[tokio::test]
async fn an_idle_correction_separates_the_idle_time_and_reports_the_review() {
    let h = editor().await;
    let review = Uuid::new_v4();
    // The idle period started before the entry: only its part inside the entry counts.
    hooks::prepare_idle_correction_for(
        &h.t.engine,
        review,
        Some(A.into()),
        local("2026-10-06T06:50:00"),
        local("2026-10-06T07:40:00"),
    )
    .await;
    let editor = h.slice("timeEditor");
    assert_eq!(editor["mode"], "guided");
    assert_eq!(editor["selected"]["id"], A);
    assert_eq!(
        editor["idleInterval"],
        json!({"start": "2026-10-06T05:00:00Z", "end": "2026-10-06T05:40:00Z"})
    );
    assert_eq!(
        (&editor["secondComment"], &editor["secondActivity"]),
        (&json!("Idle time"), &json!("dev"))
    );
    assert_eq!(editor["plan"]["title"], "Remove interval from entry");
    assert_eq!(testing::idle_correction(&h.t.engine), Some(review));

    h.ok(json!({"type": "timeEditor.setSeparateIdle", "separate": true})).await;
    h.ok(json!({"type": "timeEditor.setSecondEntry", "ticket": "", "comment": "Idle time", "activityId": ""}))
        .await;
    let plan = h.slice("timeEditor")["plan"].clone();
    assert_eq!(plan["title"], "Separate idle interval");
    assert_eq!(plan["desired"].as_array().unwrap().len(), 2, "the idle part and the rest");
    assert_eq!(plan["desired"][0]["comment"], "Idle time");

    h.ok(json!({"type": "timeEditor.save"})).await;
    // The idle part starts the entry, so both parts are new and the original goes last.
    assert_eq!(h.seven_pace.mutations(), ["create", "create", &format!("delete {A}")]);
    let editor = h.slice("timeEditor");
    assert!(editor["idleInterval"].is_null());
    assert_eq!(
        editor["message"],
        "Separate idle interval confirmed by 7pace. You can undo this from Recent edits."
    );
    assert_eq!(testing::idle_correction(&h.t.engine), None);
    assert_eq!(journal(&h)[0].title, "Separate idle interval");
}

#[tokio::test]
async fn an_idle_correction_for_a_running_entry_is_refused() {
    let h = editor().await;
    h.seven_pace.state.lock().unwrap().tracking = Some(
        serde_json::from_value(json!({"track": {"trackingState": "tracking", "tfsId": 1,
            "workLogId": A, "currentTrackStartedDateTime": "2026-10-06T07:00:00"}}))
        .unwrap(),
    );
    hooks::prepare_idle_correction(
        &h.t.engine,
        Some(A.into()),
        local("2026-10-06T07:10:00"),
        local("2026-10-06T07:20:00"),
    )
    .await;
    let editor = h.slice("timeEditor");
    assert_eq!(editor["issue"], "This entry is still running. Stop or pause it before editing.");
    assert!(editor["selected"].is_null());
    assert_eq!(editor["working"], false);
}

#[tokio::test]
async fn gaps_and_overlaps_offer_their_valid_corrections() {
    let monday = vec![
        log(
            "44444444-4444-4444-4444-444444444444",
            "2026-10-05T09:00:00",
            10_800.0,
            Some(1),
            "Morning",
        ),
        log(
            "55555555-5555-5555-5555-555555555555",
            "2026-10-05T12:30:00",
            16_200.0,
            Some(2),
            "Afternoon",
        ),
        log("66666666-6666-6666-6666-666666666666", "2026-10-05T16:30:00", 3600.0, Some(3), "Late"),
    ];
    let h = Harness::new(monday).await;
    h.show(Some("timeEditor")).await;
    h.ok(json!({"type": "timeEditor.setDay", "day": "2026-10-05"})).await;
    h.ok(json!({"type": "timeEditor.loadCorrections"})).await;
    let corrections = h.slice("timeEditor")["corrections"].clone();
    assert_eq!(corrections["show"], true);
    assert!(corrections["issue"].is_null(), "{corrections:#}");
    let issues = corrections["issues"].as_array().unwrap();
    assert_eq!(issues.len(), 2);
    assert_eq!(
        (&issues[0]["kind"], &issues[0]["start"]),
        (&json!("gap"), &json!("2026-10-05T10:00:00Z"))
    );
    assert_eq!(
        (&issues[1]["kind"], &issues[1]["start"], &issues[1]["end"]),
        (&json!("overlap"), &json!("2026-10-05T14:30:00Z"), &json!("2026-10-05T15:00:00Z"))
    );
    assert_eq!(corrections["choices"][0]["options"], json!(["extendEarlier", "startLaterEarlier"]));
    assert_eq!(
        corrections["choices"][1]["options"],
        json!(["removeFromEarlier", "removeFromLater", "boundary"])
    );
    assert!(h.seven_pace.calls().contains(&"work_logs_before(2026-10-06T00:00:00)".to_string()));

    let gap = corrections["choices"][0]["issueId"].as_str().unwrap().to_string();
    let error = h
        .dispatch(json!({"type": "timeEditor.prepareCorrection", "issueId": "nope", "option": "extendEarlier"}))
        .await
        .unwrap_err();
    assert_eq!(error.kind, "notFound");
    h.ok(
        json!({"type": "timeEditor.prepareCorrection", "issueId": gap, "option": "extendEarlier"}),
    )
    .await;
    let editor = h.slice("timeEditor");
    assert_eq!(editor["mode"], "guided");
    assert_eq!(editor["guidedPlan"]["title"], "Fill gap with neighboring task");
    assert_eq!(editor["selected"]["id"], "44444444-4444-4444-4444-444444444444");
    assert_eq!(editor["corrections"]["show"], false);

    h.ok(json!({"type": "timeEditor.save"})).await;
    assert_eq!(h.seven_pace.mutations(), ["update 44444444-4444-4444-4444-444444444444"]);
    assert_eq!(h.seven_pace.logs()["44444444-4444-4444-4444-444444444444"].length, 12_600.0);

    // A shared boundary inside the overlap.
    h.ok(json!({"type": "timeEditor.loadCorrections"})).await;
    let corrections = h.slice("timeEditor")["corrections"].clone();
    let overlap = corrections["choices"][0]["issueId"].as_str().unwrap().to_string();
    h.ok(json!({"type": "timeEditor.prepareCorrection", "issueId": overlap, "option": "boundary",
        "boundary": "2026-10-05T14:45:00Z"}))
        .await;
    let plan = h.slice("timeEditor")["guidedPlan"].clone();
    assert_eq!(plan["title"], "Correct overlapping boundary");
    assert_eq!(plan["desired"][1]["start"], "2026-10-05T14:45:00Z");
}

#[tokio::test]
async fn corrections_wait_for_a_timer_that_crosses_the_review_window() {
    let h = Harness::new(vec![log(A, "2026-10-05T09:00:00", 3600.0, Some(1), "Morning")]).await;
    h.seven_pace.state.lock().unwrap().tracking = Some(
        serde_json::from_value(json!({"track": {"trackingState": "tracking", "tfsId": 2,
            "workLogId": "running", "currentTrackStartedDateTime": "2026-10-05T16:00:00"}}))
        .unwrap(),
    );
    h.ok(json!({"type": "timeEditor.setDay", "day": "2026-10-05"})).await;
    h.ok(json!({"type": "timeEditor.loadCorrections"})).await;
    let corrections = h.slice("timeEditor")["corrections"].clone();
    assert_eq!(
        corrections["issue"],
        "Pause or stop the timer that crosses this review window, so its boundaries are confirmed."
    );
    assert_eq!(corrections["loading"], false);
}

#[tokio::test]
async fn overlap_checks_are_advisory_and_never_block_a_save() {
    let h = editor().await;
    h.ok(json!({"type": "timeEditor.select", "logId": A})).await;
    h.ok(json!({"type": "timeEditor.setTimes", "start": "2026-10-06T05:00:00Z", "end": "2026-10-06T06:30:00Z"}))
        .await;
    // Swift showed day overlaps only with a known tracking state (`session::hooks` has none here).
    assert_eq!(h.slice("timeEditor")["loadedConflicts"], json!([]));

    h.ok(json!({"type": "timeEditor.checkOverlaps"})).await;
    let review = h.slice("timeEditor")["review"].clone();
    assert_eq!(ids(&review["conflicts"]), [B]);
    assert_eq!(review["conflicts"][0]["overlap"], 1800.0);
    assert!(review["overlapIssue"].is_null());
    // Changing a field drops the review.
    h.ok(json!({"type": "timeEditor.setTimes", "start": "2026-10-06T05:00:00Z", "end": "2026-10-06T06:30:00Z"}))
        .await;
    assert!(h.slice("timeEditor")["review"].is_null());

    h.ok(json!({"type": "timeEditor.save"})).await;
    assert_eq!(h.seven_pace.mutations(), [format!("update {A}")]);
    assert_eq!(ids(&h.slice("timeEditor")["savedConflicts"]), [B]);
}

#[tokio::test]
async fn the_filter_matches_ticket_numbers_and_comments() {
    let h = editor().await;
    h.ok(json!({"type": "timeEditor.setSelection", "ids": [A, B]})).await;
    h.ok(json!({"type": "timeEditor.setFilter", "text": "#2"})).await;
    let editor = h.slice("timeEditor");
    assert_eq!(ids(&editor["logs"]), [C]);
    assert_eq!(editor["selection"], json!([]), "a new filter clears the selection");
    h.ok(json!({"type": "timeEditor.setFilter", "text": "DEVELOP"})).await;
    assert_eq!(ids(&h.slice("timeEditor")["logs"]), [B, A]);
    h.ok(json!({"type": "timeEditor.cancel"})).await;
    assert!(h.slice("timeEditor")["selected"].is_null());
}
