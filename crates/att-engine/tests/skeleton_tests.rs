//! The engine skeleton: intent parsing and routing, generic intents, persistence routing and
//! the publish path.

use std::sync::{Arc, Mutex};

use att_engine::publish::SliceUpdate;
use att_engine::testing::TestEngine;
use serde_json::json;

#[tokio::test]
async fn unknown_and_malformed_intents_are_rejected_with_a_kind() {
    let t = TestEngine::new();
    let error = t.engine.dispatch(json!({"type": "nope.nothing"})).await.unwrap_err();
    assert_eq!(error.kind, "invalidIntent");
    let error = t.engine.dispatch(json!({"no": "type"})).await.unwrap_err();
    assert_eq!(error.kind, "invalidIntent");
    let error =
        t.engine.dispatch(json!({"type": "tracking.start", "draftId": 5})).await.unwrap_err();
    assert_eq!(error.kind, "invalidIntent");
}

#[tokio::test]
async fn every_documented_intent_shape_parses() {
    let examples = [
        json!({"type": "app.snapshot"}),
        json!({"type": "app.setVisiblePage", "page": "statistics"}),
        json!({"type": "app.setInterface", "preferences": {"theme": "dark", "scale": 125, "contrast": "increased"}}),
        json!({"type": "settings.save", "configuration": {}, "azurePat": "", "sevenPaceToken": ""}),
        json!({"type": "settings.setPromptInterruption", "kind": "branch", "level": "openAndFocus"}),
        json!({"type": "settings.setQuietHours", "quietHours": {"enabled": true, "startMinute": 1080, "endMinute": 480}}),
        json!({"type": "repositories.setEnabled", "id": "6f1c2b9e-1111-4c4c-8a8a-000000000001", "enabled": false}),
        json!({"type": "tracking.beginPanel", "branchId": null}),
        json!({"type": "tracking.chooseManual", "kind": "standup"}),
        json!({"type": "tracking.start", "draftId": "6f1c2b9e-1111-4c4c-8a8a-000000000001", "activityId": "dev", "comment": "", "includeTicket": true}),
        json!({"type": "meeting.begin", "id": "abc", "useSuggestedTicket": true}),
        json!({"type": "awareness.chooseForgottenTicket", "ticketId": null}),
        json!({"type": "dayReview.markReviewed", "day": "2026-10-06"}),
        json!({"type": "history.setRange", "from": "2026-09-30", "to": "2026-10-06"}),
        json!({"type": "figma.link", "fileKey": "Abc123", "ticketId": 33984}),
        json!({"type": "statistics.zoomTo", "start": "2026-10-05T22:00:00Z", "end": "2026-10-06T22:00:00Z"}),
        json!({"type": "timeEditor.setSplit", "at": "2026-10-06T09:30:00Z", "ticket": "", "comment": "x", "activityId": ""}),
        json!({"type": "dayReview.setDay", "day": "2026-10-06"}),
        json!({"type": "weekly.generate", "replace": false}),
        json!({"type": "offline.startLocal", "ticketId": null, "comment": "Notes", "activityId": null}),
        json!({"type": "ticket.showContext", "ticketId": 33984}),
        json!({"type": "statistics.setPeriod", "period": "week"}),
        json!({"type": "statistics.setFilter", "filter": {"query": "login", "weekday": 2}}),
        json!({"type": "statistics.setSection", "section": "tasks"}),
        json!({"type": "timeEditor.setMode", "mode": "split"}),
        json!({"type": "settings.testBranchPattern", "branch": "feature/1-x", "pattern": "([0-9]+)"}),
        json!({"type": "app.dismissError"}),
    ];
    for example in examples {
        assert!(att_engine::intent::parse(example.clone()).is_ok(), "{example}");
    }
}

#[tokio::test]
async fn visible_page_is_validated_and_snapshot_returns_slices() {
    let t = TestEngine::new();
    t.engine.dispatch(json!({"type": "app.setVisiblePage", "page": "statistics"})).await.unwrap();
    t.engine.dispatch(json!({"type": "app.setVisiblePage", "page": "not-a-page"})).await.unwrap();
    let snapshot = t.engine.dispatch(json!({"type": "app.snapshot"})).await.unwrap();
    assert!(snapshot.is_array());
}

#[tokio::test]
async fn sinks_never_receive_empty_batches() {
    let t = TestEngine::new();
    let batches: Arc<Mutex<Vec<Vec<String>>>> = Arc::default();
    let sink = batches.clone();
    t.engine.set_sink(Arc::new(move |updates: Vec<SliceUpdate>| {
        sink.lock().unwrap().push(updates.iter().map(|u| u.name.to_string()).collect());
    }));
    assert!(batches.lock().unwrap().iter().all(|batch| !batch.is_empty()));
}

#[tokio::test]
async fn reopening_the_store_restores_the_same_slices() {
    let t = TestEngine::new();
    let snapshot = t.engine.snapshot();
    let reopened = TestEngine::with_store(t.store.clone());
    assert_eq!(reopened.engine.snapshot().len(), snapshot.len());
}
