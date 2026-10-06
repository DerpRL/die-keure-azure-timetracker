//! Offline drafts and the local timer (port of `OfflineDraftModel.swift`): the one-running-timer
//! rule, validation, the durable `sending` checkpoint, lost responses, linking and retries.

#[path = "support/controllers.rs"]
mod support;

use serde_json::{Value, json};
use uuid::Uuid;

use att_core::model::ActivityType;
use att_core::offline::{OfflineDraft, OfflineDraftStatus, OfflineLedger};
use att_engine::controllers::hooks;
use support::*;

const LEDGER: &str = "offlineLedger";

fn ledger(h: &Harness) -> OfflineLedger {
    document(&h.t.store, LEDGER).unwrap_or_default()
}

/// A stopped draft from 08:00 to 09:00 today on ticket 5.
fn past_draft() -> OfflineDraft {
    OfflineDraft::new(
        workspace(),
        local("2026-10-06T08:00:00"),
        Some(local("2026-10-06T09:00:00")),
        Some(5),
        "Offline work",
        Some("dev".into()),
    )
}

async fn save(h: &Harness, draft: &OfflineDraft) -> Result<Value, att_engine::IpcError> {
    h.dispatch(json!({"type": "offline.save", "draft": draft})).await
}

/// A saved, reviewed draft ready to upload.
async fn reviewed(h: &Harness) -> OfflineDraft {
    let draft = past_draft();
    save(h, &draft).await.unwrap();
    h.ok(json!({"type": "offline.review", "draftId": draft.id})).await;
    let offline = h.slice("offline");
    assert_eq!(offline["review"]["draft"]["id"], json!(draft.id), "{offline:#}");
    draft
}

#[tokio::test]
async fn the_local_timer_starts_stops_and_only_one_may_run() {
    let h = Harness::new(Vec::new()).await;
    h.ok(json!({"type": "offline.startLocal", "ticketId": 5, "comment": "", "activityId": "dev"}))
        .await;
    let offline = h.slice("offline");
    assert_eq!(offline["active"]["ticketId"], 5);
    assert_eq!(offline["active"]["start"], "2026-10-06T08:00:00Z");
    assert!(offline["active"].get("end").is_none());
    assert_eq!(offline["message"], "Local timer saved. This does not change the 7pace timer.");
    assert_eq!(ledger(&h).drafts.len(), 1, "written to the store");

    let error = h
        .dispatch(
            json!({"type": "offline.startLocal", "ticketId": 6, "comment": "", "activityId": null}),
        )
        .await
        .unwrap_err();
    assert_eq!(error.message, "Stop the existing local timer first.");
    assert_eq!(h.slice("offline")["issue"], "Stop the existing local timer first.");

    h.t.clock.advance(3600.0);
    h.ok(json!({"type": "offline.stopLocal"})).await;
    let offline = h.slice("offline");
    assert!(offline["active"].is_null());
    assert_eq!(offline["drafts"][0]["end"], "2026-10-06T09:00:00Z");
    assert_eq!(offline["message"], "Local timer stopped. Review the draft before uploading.");
    assert_eq!(offline["readyCount"], 1);
    assert_eq!(ledger(&h).drafts[0].end, Some(local("2026-10-06T11:00:00")));
}

#[tokio::test]
async fn a_timer_running_in_another_workspace_blocks_a_new_one_and_stops_from_here() {
    let store = store_with(&configuration());
    let other = OfflineDraft::new(
        "https://other.timehub.7pace.com/",
        local("2026-10-06T09:00:00"),
        None,
        None,
        "Other work",
        None,
    );
    store
        .put(LEDGER, &OfflineLedger { drafts: vec![other.clone()], activities: Default::default() })
        .unwrap();
    let h = Harness::on(store, FakeSevenPace::default()).await;
    let offline = h.slice("offline");
    assert_eq!(offline["active"]["id"], json!(other.id));
    assert_eq!(offline["drafts"], json!([]), "drafts list only this workspace");

    let error = h
        .dispatch(json!({"type": "offline.startLocal", "ticketId": null, "comment": "Notes", "activityId": null}))
        .await
        .unwrap_err();
    assert_eq!(error.message, "Stop the existing local timer first.");
    h.ok(json!({"type": "offline.stopLocal"})).await;
    assert!(h.slice("offline")["active"].is_null());
    assert_eq!(ledger(&h).drafts[0].end, Some(local("2026-10-06T10:00:00")));
}

#[tokio::test]
async fn saving_checks_the_ticket_comment_and_times() {
    let h = Harness::new(Vec::new()).await;
    let mut draft = past_draft();
    draft.ticket_id = None;
    draft.comment = "   ".into();
    let error = save(&h, &draft).await.unwrap_err();
    assert_eq!(error.message, "Choose a ticket or add a comment for ticket-free work.");
    draft.ticket_id = Some(0);
    assert_eq!(
        save(&h, &draft).await.unwrap_err().message,
        "Choose a ticket or add a comment for ticket-free work."
    );
    draft.ticket_id = Some(5);
    draft.start = local("2026-10-06T10:30:00");
    draft.end = Some(local("2026-10-06T11:00:00"));
    assert_eq!(
        save(&h, &draft).await.unwrap_err().message,
        "The local timer cannot start in the future."
    );
    draft.start = local("2026-10-06T08:00:00");
    assert_eq!(
        save(&h, &draft).await.unwrap_err().message,
        "Choose valid times with no time in the future."
    );

    let draft = past_draft();
    save(&h, &draft).await.unwrap();
    let offline = h.slice("offline");
    assert_eq!(offline["message"], "Draft saved on this Mac.");
    assert!(offline["issue"].is_null());
    assert_eq!(
        (offline["readyCount"].clone(), offline["canCreate"].clone()),
        (json!(1), json!(true))
    );

    let mut synced = draft.clone();
    synced.status = OfflineDraftStatus::Synced;
    assert_eq!(
        save(&h, &synced).await.unwrap_err().message,
        "An uploaded or unconfirmed draft cannot be edited."
    );
    h.ok(json!({"type": "offline.remove", "draftId": draft.id})).await;
    assert!(ledger(&h).drafts.is_empty());
}

#[tokio::test]
async fn an_upload_is_checkpointed_as_sending_before_the_create_and_synced_after() {
    let h = Harness::new(Vec::new()).await;
    h.seven_pace.probe(h.t.store.clone(), LEDGER);
    let draft = reviewed(&h).await;
    let offline = h.slice("offline");
    assert_eq!(offline["review"]["conflicts"], json!([]));
    assert_eq!(offline["review"]["matches"], json!([]));
    assert_eq!(offline["activities"], json!([{"id": "dev", "name": "Development"}]));
    assert_eq!(ledger(&h).activities[&workspace()].len(), 1, "cached for offline use");

    h.ok(json!({"type": "offline.upload"})).await;
    assert_eq!(h.seven_pace.mutations(), ["create"]);
    let at_create: OfflineLedger = serde_json::from_str(&h.seven_pace.probed()[0]).unwrap();
    assert_eq!(
        at_create.drafts[0].status,
        OfflineDraftStatus::Sending,
        "durable before the request"
    );
    let stored = ledger(&h).drafts.remove(0);
    assert_eq!(stored.status, OfflineDraftStatus::Synced);
    let created = h.seven_pace.logs().into_keys().next().unwrap();
    assert_eq!(stored.remote_id.as_deref(), Some(created.as_str()));
    let offline = h.slice("offline");
    assert_eq!(offline["message"], "Draft confirmed by 7pace.");
    assert!(offline["review"].is_null());
    assert_eq!(offline["drafts"], json!([]), "synced drafts are hidden");
    h.ok(json!({"type": "offline.setShowSynced", "show": true})).await;
    assert_eq!(h.slice("offline")["drafts"][0]["id"], json!(draft.id));
}

#[tokio::test]
async fn a_lost_response_is_flagged_never_resent_and_can_be_linked() {
    let h = Harness::new(Vec::new()).await;
    h.seven_pace.state.lock().unwrap().lose_create_response = true;
    let draft = reviewed(&h).await;
    h.ok(json!({"type": "offline.upload"})).await;
    let issue = h.slice("offline")["issue"].as_str().unwrap().to_string();
    assert!(
        issue.starts_with(
            "Upload outcome is unconfirmed. Review this draft and check 7pace before retrying. "
        ),
        "{issue}"
    );
    assert_eq!(ledger(&h).drafts[0].status, OfflineDraftStatus::Sending);

    // Nothing sends it again, and an unconfirmed draft cannot be removed.
    h.ok(json!({"type": "offline.upload"})).await;
    h.ok(json!({"type": "offline.remove", "draftId": draft.id})).await;
    assert_eq!(h.seven_pace.mutations(), ["create"]);
    assert_eq!(ledger(&h).drafts.len(), 1);

    // The entry did reach 7pace: link it instead of uploading again.
    h.ok(json!({"type": "offline.review", "draftId": draft.id})).await;
    let review = h.slice("offline")["review"].clone();
    let created = review["matches"][0]["id"].as_str().unwrap().to_string();
    assert_eq!(review["draft"]["status"], "Check 7pace before retrying");
    h.ok(json!({"type": "offline.link", "logId": created})).await;
    let stored = ledger(&h).drafts.remove(0);
    assert_eq!(stored.status, OfflineDraftStatus::Synced);
    assert_eq!(stored.remote_id.as_deref(), Some(created.as_str()));
    assert_eq!(
        h.slice("offline")["message"],
        "Linked to the existing 7pace entry. No time was added."
    );
    assert_eq!(h.seven_pace.mutations(), ["create"]);
}

#[tokio::test]
async fn a_retry_needs_a_manual_check_without_a_matching_entry() {
    let h = Harness::new(Vec::new()).await;
    h.seven_pace.state.lock().unwrap().lose_create_response = true;
    let draft = reviewed(&h).await;
    h.ok(json!({"type": "offline.upload"})).await;
    // This time nothing reached 7pace.
    h.seven_pace.state.lock().unwrap().logs.clear();
    h.seven_pace.state.lock().unwrap().lose_create_response = false;
    h.ok(json!({"type": "offline.review", "draftId": draft.id})).await;
    assert_eq!(h.slice("offline")["review"]["matches"], json!([]));
    h.ok(json!({"type": "offline.allowRetryAfterManualCheck"})).await;
    assert_eq!(ledger(&h).drafts[0].status, OfflineDraftStatus::Draft);
    assert_eq!(
        h.slice("offline")["message"],
        "Draft unlocked after your check. Review again before uploading."
    );

    h.ok(json!({"type": "offline.review", "draftId": draft.id})).await;
    h.ok(json!({"type": "offline.upload"})).await;
    assert_eq!(h.seven_pace.mutations(), ["create", "create"]);
    assert_eq!(ledger(&h).drafts[0].status, OfflineDraftStatus::Synced);
}

#[tokio::test]
async fn an_unreadable_ledger_is_reported_and_never_overwritten() {
    let store = store_with(&configuration());
    store.put_raw(LEDGER, "{not a ledger").unwrap();
    let h = Harness::on(store, FakeSevenPace::default()).await;
    let offline = h.slice("offline");
    assert!(
        offline["issue"]
            .as_str()
            .unwrap()
            .starts_with("Local drafts could not be read. The file has been preserved: "),
        "{offline:#}"
    );
    assert_eq!(offline["canCreate"], false);
    let error = h
        .dispatch(
            json!({"type": "offline.startLocal", "ticketId": 5, "comment": "", "activityId": null}),
        )
        .await
        .unwrap_err();
    assert_eq!(
        error.message,
        "The saved drafts are unreadable; the original file has been preserved."
    );
    hooks::cache_activities(&h.t.engine, &workspace(), &[ActivityType::new("dev", "Development")]);
    assert!(h.slice("offline")["issue"].as_str().unwrap().starts_with("Could not save activities"));
    assert_eq!(h.t.store.get_raw(LEDGER).unwrap().as_deref(), Some("{not a ledger"));
}

#[tokio::test]
async fn activities_are_cached_per_workspace_and_the_running_timer_is_shared() {
    let h = Harness::new(Vec::new()).await;
    let types = [ActivityType::new("dev", "Development"), ActivityType::new("meet", "Meeting")];
    hooks::cache_activities(&h.t.engine, &workspace(), &types);
    hooks::cache_activities(&h.t.engine, "https://other.timehub.7pace.com/", &types[..1]);
    assert_eq!(h.slice("offline")["activities"].as_array().unwrap().len(), 2);
    assert_eq!(ledger(&h).activities.len(), 2);

    h.ok(json!({"type": "offline.startLocal", "ticketId": null, "comment": "Notes", "activityId": "meet"}))
        .await;
    let id: Uuid = serde_json::from_value(h.slice("offline")["active"]["id"].clone()).unwrap();
    assert_eq!(ledger(&h).active().map(|draft| draft.id), Some(id));
}

#[tokio::test]
async fn reviews_and_uploads_need_a_connection() {
    let t = att_engine::testing::TestEngine::with_store(store_with(&configuration()));
    let draft = past_draft();
    t.engine.dispatch(json!({"type": "offline.save", "draft": draft})).await.unwrap();
    t.engine.dispatch(json!({"type": "offline.review", "draftId": draft.id})).await.unwrap();
    t.engine.dispatch(json!({"type": "offline.upload"})).await.unwrap();
    let offline = slice(&t, "offline");
    assert_eq!(offline["configured"], false);
    assert!(offline["review"].is_null());
    assert_eq!(offline["drafts"].as_array().unwrap().len(), 1, "drafts work offline");
}
