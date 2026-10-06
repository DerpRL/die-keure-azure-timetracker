//! Controller documents across a restart: the offline ledger, the edit journal and the weekly
//! drafts, in the 2.0 format and as imported from 1.14.x.

#[path = "support/controllers.rs"]
mod support;

use serde_json::json;

use att_core::offline::OfflineDraft;
use att_core::worklog::ops::{WorkLogChange, WorkLogChangeStatus};
use support::*;

const A: &str = "11111111-1111-1111-1111-111111111111";
const JOURNAL: &str = "timeEditJournal";

/// `offline-drafts.json` as 1.14.x wrote it (from the att-core fixture): the workspace URL as
/// typed, without the trailing slash 2.0 adds.
const SWIFT_LEDGER: &str = r##"{"activities":{"https:\/\/acme.timehub.7pace.com":[{"id":"dev","name":"Development","color":"#2E7D32"},{"id":"meet","name":"Meeting"}],"https:\/\/other.timehub.7pace.com":[]},"drafts":[{"ticketID":123,"id":"08239A7D-F296-4863-BEA8-2E35E34970AC","billable":true,"activityID":"dev","status":"Synced to 7pace","remoteID":"33333333-3333-3333-3333-333333333333","workspace":"https:\/\/acme.timehub.7pace.com","start":812271600,"comment":"Offline work","end":812275200},{"comment":"Daily standup","id":"64F64560-7875-4832-BCF8-2E8925D27B21","status":"Check 7pace before retrying","workspace":"https:\/\/other.timehub.7pace.com","start":812286000,"billable":false,"end":812288700},{"start":812355330.25,"billable":false,"status":"Local draft","comment":"","workspace":"https:\/\/acme.timehub.7pace.com","id":"44C885F6-A83E-44B1-9569-736168C27D34"}]}"##;

/// `time-edit-history.json` with a change 1.14.x did not see finish.
const SWIFT_APPLYING: &str = r#"[{"before":[{"id":"11111111-1111-1111-1111-111111111111","isCanEdit":true,"timestamp":"2026-10-06T07:00:00","length":3600,"workItemId":1,"comment":"Development"}],"date":812966400.5,"id":"935077DC-1B64-4A96-AF7D-58E4887C9DB3","status":"applying","detail":"Updating entry 11111111-1111-1111-1111-111111111111.","title":"Edit time","workspace":"https:\/\/acme.timehub.7pace.com","after":[],"desired":[]}]"#;

#[tokio::test]
async fn drafts_edits_and_weekly_text_survive_a_restart() {
    let store = store_with(&configuration());
    let logs = vec![log(A, "2026-10-06T07:00:00", 3600.0, Some(1), "Development")];
    let draft = OfflineDraft::new(
        workspace(),
        local("2026-10-06T08:00:00"),
        Some(local("2026-10-06T09:00:00")),
        Some(5),
        "Offline work",
        None,
    );
    let change = {
        let h = Harness::on(store.clone(), FakeSevenPace::with_logs(logs.clone())).await;
        h.ok(json!({"type": "offline.save", "draft": draft})).await;
        h.ok(json!({"type": "timeEditor.select", "logId": A})).await;
        h.ok(json!({"type": "timeEditor.setTimes", "start": "2026-10-06T05:15:00Z", "end": "2026-10-06T06:00:00Z"}))
            .await;
        h.ok(json!({"type": "timeEditor.save"})).await;
        h.ok(json!({"type": "weekly.setText", "text": "Notes for the week"})).await;
        h.ok(json!({"type": "statistics.setPeriod", "period": "month"})).await;
        h.slice("timeEditor")["changes"][0]["id"].clone()
    };

    let h = Harness::on(store, FakeSevenPace::with_logs(logs)).await;
    assert_eq!(h.slice("offline")["drafts"][0]["id"], json!(draft.id));
    let editor = h.slice("timeEditor");
    assert_eq!(
        (&editor["changes"][0]["id"], &editor["changes"][0]["status"]),
        (&change, &json!("complete"))
    );
    assert_eq!(h.slice("weekly")["text"], "Notes for the week");
    // Page state is not persisted, as in 1.14.x.
    assert_eq!(h.slice("statistics")["period"], "week");
}

#[tokio::test]
async fn a_1_14_ledger_loads_with_the_workspace_url_as_typed() {
    let store = store_with(&configuration());
    store.put_raw("offlineLedger", SWIFT_LEDGER).unwrap();
    let h = Harness::on(store, FakeSevenPace::default()).await;
    let offline = h.slice("offline");
    assert_eq!(offline["active"]["id"], "44c885f6-a83e-44b1-9569-736168c27d34");
    assert_eq!(offline["drafts"].as_array().unwrap().len(), 1, "the synced draft is hidden");
    assert_eq!(
        offline["activities"],
        json!([{"id": "dev", "name": "Development", "color": "#2E7D32"}, {"id": "meet", "name": "Meeting"}])
    );
    assert_eq!(offline["readyCount"], 0, "the running timer is not ready yet");
    h.ok(json!({"type": "offline.setShowSynced", "show": true})).await;
    assert_eq!(h.slice("offline")["drafts"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn the_main_loop_saves_the_interrupted_change_rule() {
    let store = store_with(&configuration());
    store.put_raw(JOURNAL, SWIFT_APPLYING).unwrap();
    let h = Harness::on(store.clone(), FakeSevenPace::default()).await;
    assert_eq!(h.slice("timeEditor")["changes"][0]["status"], "needsReview");
    assert!(store.get_raw(JOURNAL).unwrap().unwrap().contains(r#""status":"applying""#));

    // The engine loop's per-tick save writes the reviewed state (2.0 format).
    h.t.engine.start();
    eventually("the journal is saved", || {
        document::<Vec<WorkLogChange>>(&store, JOURNAL)
            .is_some_and(|changes| changes[0].status == WorkLogChangeStatus::NeedsReview)
    })
    .await;
    let changes: Vec<WorkLogChange> = document(&store, JOURNAL).unwrap();
    assert_eq!(
        changes[0].detail,
        "The app closed during this change. Check the affected entries in 7pace; no request will be replayed."
    );
    assert_eq!(changes[0].workspace, "https://acme.timehub.7pace.com", "kept as stored");
}
