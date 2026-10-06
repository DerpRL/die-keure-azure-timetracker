//! Port of OfflineDraftTests.swift › OfflineDraftTests and ManualTrackingTests.swift ›
//! LocalTimerDisplayTests (the type lives in `offline`), plus Rust-only checks of the ledger
//! format and the upload guards. Reading and writing `offline-drafts.json` (file permissions,
//! corrupt files) is tested in att-store.

#[path = "support/worklogs.rs"]
mod worklogs;

use att_core::model::ActivityType;
use att_core::offline::{
    LocalTimerDisplay, OfflineDraft, OfflineDraftStatus, OfflineLedger, OfflineSync,
};
use att_core::service::WorkLogMutationService;
use att_core::time::{add_secs, swift_date};
use att_core::worklog::WorkLogDraft;
use jiff::Timestamp;
use uuid::Uuid;
use worklogs::*;

/// Swift `draft()`: a stopped hour on ticket 123 with the Development activity.
fn draft() -> OfflineDraft {
    OfflineDraft::new(
        "test",
        local("2026-09-28T09:00:00"),
        Some(local("2026-09-28T10:00:00")),
        Some(123),
        "Offline work",
        Some("dev".into()),
    )
}

/// Swift `OfflineDraft(workspace:)`: a local timer started now.
fn timer(workspace: &str) -> OfflineDraft {
    OfflineDraft::new(workspace, now(), None, None, "", None)
}

#[test]
fn local_timer_persists_and_only_one_may_run_across_workspaces() {
    let mut ledger = OfflineLedger::default();
    let mut active = draft();
    active.end = None;
    ledger.replace(active.clone()).unwrap();
    // Adapted: the file round trip and its 0600 permissions moved to att-store; the ledger's own
    // JSON must still restore the running timer exactly.
    let restored: OfflineLedger =
        serde_json::from_str(&serde_json::to_string(&ledger).unwrap()).unwrap();
    assert!(restored.drafts.first() == Some(&active) && restored.drafts[0].running());
    assert_eq!(
        ledger.replace(timer("other")).unwrap_err().to_string(),
        "Stop the existing local timer first."
    );
    active.end = Some(local("2026-09-28T10:00:00"));
    ledger.replace(active).unwrap();
    ledger.replace(timer("other")).unwrap();
    assert_eq!(ledger.drafts.len(), 2);
}

#[tokio::test]
async fn uploads_once_with_durable_sending_checkpoint_then_confirmation() {
    let api = MutationFixture::new(Vec::new());
    let capture = DraftCheckpoint::default();
    let review = OfflineSync::review(&draft(), &api, now(), &cal()).await.unwrap();
    let result = OfflineSync::upload(&review, "test", &api, now(), &cal(), |d| capture.save(d))
        .await
        .unwrap();
    assert!(result.status == OfflineDraftStatus::Synced && result.remote_id.is_some());
    assert_eq!(capture.statuses().await, [OfflineDraftStatus::Sending, OfflineDraftStatus::Synced]);
    assert_eq!(api.mutations().await, ["create"]);
}

#[tokio::test]
async fn lost_response_needs_reconciliation_and_cannot_replay() {
    let api = MutationFixture::new(Vec::new());
    let capture = DraftCheckpoint::default();
    let review = OfflineSync::review(&draft(), &api, now(), &cal()).await.unwrap();
    api.state.lock().await.lose_create_response = true;
    let upload =
        OfflineSync::upload(&review, "test", &api, now(), &cal(), |d| capture.save(d)).await;
    assert!(upload.is_err());
    let pending = capture.records().await.last().cloned().expect("a sending checkpoint");
    assert_eq!(pending.status, OfflineDraftStatus::Sending);
    let retry = OfflineSync::review(&pending, &api, now(), &cal()).await.unwrap();
    assert_eq!(retry.matches.len(), 1);
    let again = OfflineSync::upload(&retry, "test", &api, now(), &cal(), |d| capture.save(d)).await;
    assert!(again.is_err());
    assert_eq!(api.mutations().await, ["create"]);
}

#[tokio::test]
async fn checkpoint_failure_before_write_prevents_request_and_after_write_preserves_uncertainty() {
    for stage in [0, 1] {
        let api = MutationFixture::new(Vec::new());
        let capture = DraftCheckpoint::failing_at(stage);
        let review = OfflineSync::review(&draft(), &api, now(), &cal()).await.unwrap();
        let upload =
            OfflineSync::upload(&review, "test", &api, now(), &cal(), |d| capture.save(d)).await;
        assert!(upload.is_err(), "stage {stage}");
        assert_eq!(api.mutations().await.len(), stage, "stage {stage}");
        if stage == 1 {
            assert_eq!(capture.records().await.last().unwrap().status, OfflineDraftStatus::Sending);
        }
    }
}

#[tokio::test]
async fn workspace_mismatch_and_missing_activity_never_write() {
    let api = MutationFixture::new(Vec::new());
    let capture = DraftCheckpoint::default();
    let review = OfflineSync::review(&draft(), &api, now(), &cal()).await.unwrap();
    let other =
        OfflineSync::upload(&review, "other", &api, now(), &cal(), |d| capture.save(d)).await;
    assert!(other.is_err());
    let mut missing = draft();
    missing.activity_id = Some("removed".into());
    let invalid = OfflineSync::review(&missing, &api, now(), &cal()).await.unwrap();
    let upload =
        OfflineSync::upload(&invalid, "test", &api, now(), &cal(), |d| capture.save(d)).await;
    assert!(upload.is_err());
    assert!(api.mutations().await.is_empty());
}

#[tokio::test]
async fn overlaps_are_advisory_but_changed_overlap_requires_review() {
    let mut log = editable_log(EDITABLE_ID, "2026-09-28T09:30:00", 3600.0);
    log.work_item_id = Some(456);
    let api = MutationFixture::new(vec![log.clone()]);
    let capture = DraftCheckpoint::default();
    let review = OfflineSync::review(&draft(), &api, now(), &cal()).await.unwrap();
    assert!(review.conflicts.len() == 1 && review.matches.is_empty());
    let result = OfflineSync::upload(&review, "test", &api, now(), &cal(), |d| capture.save(d))
        .await
        .unwrap();
    assert_eq!(result.status, OfflineDraftStatus::Synced);
    let changed_api = MutationFixture::new(Vec::new());
    let stale = OfflineSync::review(&draft(), &changed_api, now(), &cal()).await.unwrap();
    changed_api.replace(log).await;
    let upload =
        OfflineSync::upload(&stale, "test", &changed_api, now(), &cal(), |d| capture.save(d)).await;
    assert_eq!(
        upload.unwrap_err().to_string(),
        "Overlap details changed. Refresh the review before uploading."
    );
    assert!(changed_api.mutations().await.is_empty());
}

#[tokio::test]
async fn duplicate_appearing_after_review_prevents_another_create() {
    let api = MutationFixture::new(Vec::new());
    let review = OfflineSync::review(&draft(), &api, now(), &cal()).await.unwrap();
    let capture = DraftCheckpoint::default();
    api.create_work_log(&draft().proposal(now(), &cal()).unwrap()).await.unwrap();
    let upload =
        OfflineSync::upload(&review, "test", &api, now(), &cal(), |d| capture.save(d)).await;
    assert_eq!(
        upload.unwrap_err().to_string(),
        "A matching entry already exists. Refresh the review and link it instead of uploading again."
    );
    assert_eq!(api.mutations().await, ["create"]);
}

#[test]
fn stopping_with_fractional_seconds_never_rounds_into_future() {
    // Swift used `Date()`, which has a fraction; try whole and fractional clocks.
    for fraction in [0.0, 0.005, 0.5, 0.995] {
        let now = add_secs(now(), fraction);
        let end = add_secs(now, -0.01);
        let proposal = WorkLogDraft::from_times(
            add_secs(end, -60.0),
            end,
            Some(123),
            None,
            None,
            false,
            now,
            &cal(),
        )
        .unwrap();
        assert!(
            proposal.edit().end <= end && proposal.seconds == 60 && proposal.allow_default_activity,
            "now + {fraction}"
        );
    }
}

#[test]
fn ticket_free_draft_needs_comment_and_future_time_is_rejected() {
    let mut value = draft();
    value.ticket_id = None;
    value.comment = String::new();
    assert!(value.proposal(now(), &cal()).is_err());
    value.comment = "Daily standup".into();
    assert_eq!(value.proposal(now(), &cal()).unwrap().ticket_id, None);
    value.end = Some(add_secs(now(), 3600.0));
    assert!(value.proposal(now(), &cal()).is_err());
}

/// ManualTrackingTests.swift › LocalTimerDisplayTests › localClockWhenRemoteIsIdleOrUnavailable.
#[test]
fn local_clock_when_remote_is_idle_or_unavailable() {
    let start = Timestamp::from_second(100).unwrap();
    let mut draft = OfflineDraft::new("workspace", start, None, None, "Meeting", None);
    assert!(LocalTimerDisplay::is_primary(Some(&draft), false, true));
    assert!(LocalTimerDisplay::is_primary(Some(&draft), true, false));
    assert!(!LocalTimerDisplay::is_primary(Some(&draft), true, true));
    assert_eq!(LocalTimerDisplay::elapsed(&draft, add_secs(start, 65.0)), 65.0);
    assert_eq!(LocalTimerDisplay::elapsed(&draft, add_secs(start, -1.0)), 0.0);
    draft.end = Some(add_secs(start, 80.0));
    assert!(!LocalTimerDisplay::is_primary(Some(&draft), false, true));
    assert_eq!(LocalTimerDisplay::elapsed(&draft, add_secs(start, 100.0)), 80.0);
    assert!(!LocalTimerDisplay::is_primary(None, false, true));
}

// Rust-only: the 1.14.x ledger format.

/// `offline-drafts.json` as Swift 1.14.2 wrote it (`JSONEncoder` defaults), captured from the
/// Swift sources: a synced draft, an unconfirmed upload in another workspace and a running timer
/// with a fractional start, plus cached activities.
const SWIFT_LEDGER: &str = r##"{"activities":{"https:\/\/acme.timehub.7pace.com":[{"id":"dev","name":"Development","color":"#2E7D32"},{"id":"meet","name":"Meeting"}],"https:\/\/other.timehub.7pace.com":[]},"drafts":[{"ticketID":123,"id":"08239A7D-F296-4863-BEA8-2E35E34970AC","billable":true,"activityID":"dev","status":"Synced to 7pace","remoteID":"33333333-3333-3333-3333-333333333333","workspace":"https:\/\/acme.timehub.7pace.com","start":812271600,"comment":"Offline work","end":812275200},{"comment":"Daily standup","id":"64F64560-7875-4832-BCF8-2E8925D27B21","status":"Check 7pace before retrying","workspace":"https:\/\/other.timehub.7pace.com","start":812286000,"billable":false,"end":812288700},{"start":812355330.25,"billable":false,"status":"Local draft","comment":"","workspace":"https:\/\/acme.timehub.7pace.com","id":"44C885F6-A83E-44B1-9569-736168C27D34"}]}"##;

const ACME: &str = "https://acme.timehub.7pace.com";

#[test]
fn swift_ledger_decodes_drafts_statuses_and_cached_activities() {
    let ledger: OfflineLedger = serde_json::from_str(SWIFT_LEDGER).unwrap();
    assert_eq!(ledger.drafts.len(), 3);
    let (synced, sending, running) = (&ledger.drafts[0], &ledger.drafts[1], &ledger.drafts[2]);

    assert_eq!(synced.id, Uuid::parse_str("08239a7d-f296-4863-bea8-2e35e34970ac").unwrap());
    assert_eq!(synced.workspace, ACME);
    assert_eq!(synced.start, local("2026-09-28T09:00:00"));
    assert_eq!(synced.end, Some(local("2026-09-28T10:00:00")));
    assert_eq!((synced.ticket_id, synced.activity_id.as_deref()), (Some(123), Some("dev")));
    assert_eq!((synced.comment.as_str(), synced.billable), ("Offline work", true));
    assert_eq!(synced.status, OfflineDraftStatus::Synced);
    assert_eq!(synced.remote_id.as_deref(), Some("33333333-3333-3333-3333-333333333333"));

    assert_eq!(sending.status, OfflineDraftStatus::Sending);
    assert_eq!(sending.workspace, "https://other.timehub.7pace.com");
    assert_eq!((sending.ticket_id, sending.activity_id.as_deref()), (None, None));
    assert_eq!(sending.end, Some(local("2026-09-28T13:45:00")));
    assert_eq!(sending.title(), "Daily standup");

    assert!(running.running() && running.end.is_none() && running.comment.is_empty());
    assert_eq!(running.start, swift_date::to_timestamp(812_355_330.25));
    assert_eq!(running.start, add_secs(local("2026-09-29T08:15:30"), 0.25));
    assert_eq!(running.title(), "Untitled draft");
    assert_eq!(ledger.active(), Some(running));

    let dev =
        ActivityType { color: Some("#2E7D32".into()), ..ActivityType::new("dev", "Development") };
    assert_eq!(ledger.activities_for(ACME), [dev, ActivityType::new("meet", "Meeting")]);
    assert!(ledger.activities_for("https://other.timehub.7pace.com").is_empty());
    assert!(ledger.activities_for("https://unknown.timehub.7pace.com").is_empty());

    // Rust writes RFC 3339 dates and the raw status values, and reads them back losslessly.
    let written = serde_json::to_value(&ledger).unwrap();
    assert_eq!(written["drafts"][1]["status"], "Check 7pace before retrying");
    assert_eq!(written["drafts"][0]["start"], "2026-09-28T07:00:00Z");
    assert!(written["drafts"][2].get("end").is_none(), "a running timer has no end key");
    let reread: OfflineLedger = serde_json::from_value(written).unwrap();
    assert_eq!(reread, ledger);
}

#[test]
fn empty_and_partial_ledgers_decode() {
    for json in [r#"{"drafts":[],"activities":{}}"#, "{}"] {
        assert_eq!(
            serde_json::from_str::<OfflineLedger>(json).unwrap(),
            OfflineLedger::default(),
            "{json}"
        );
    }
    let minimal =
        r#"{"drafts":[{"id":"44C885F6-A83E-44B1-9569-736168C27D34","workspace":"w","start":0}]}"#;
    let ledger: OfflineLedger = serde_json::from_str(minimal).unwrap();
    let draft = &ledger.drafts[0];
    assert!(draft.running() && !draft.billable && draft.comment.is_empty());
    assert!(serde_json::from_str::<OfflineLedger>("invalid json").is_err());
}

#[test]
fn statuses_use_the_swift_raw_values() {
    for (status, raw) in [
        (OfflineDraftStatus::Draft, "Local draft"),
        (OfflineDraftStatus::Sending, "Check 7pace before retrying"),
        (OfflineDraftStatus::Synced, "Synced to 7pace"),
    ] {
        assert_eq!(status.raw(), raw);
        assert_eq!(serde_json::to_value(status).unwrap(), raw);
        assert_eq!(serde_json::from_value::<OfflineDraftStatus>(raw.into()).unwrap(), status);
    }
}

// Rust-only: ledger and upload rules without a Swift test.

#[test]
fn ledger_needs_a_workspace_and_caches_activities_per_workspace() {
    let mut ledger = OfflineLedger::default();
    assert_eq!(
        ledger.replace(timer("")).unwrap_err().to_string(),
        "Set a 7pace workspace URL in Settings first."
    );
    let mut first = draft();
    ledger.replace(first.clone()).unwrap();
    ledger.replace(timer("test")).unwrap();
    first.comment = "Edited".into();
    ledger.replace(first.clone()).unwrap();
    assert_eq!(ledger.drafts.len(), 2);
    assert_eq!(ledger.drafts.last(), Some(&first), "a replaced draft moves to the end");
    assert!(ledger.active().is_some_and(|d| d.workspace == "test" && d.end.is_none()));

    ledger.cache_activities(ACME, vec![ActivityType::new("dev", "Development")]);
    ledger.cache_activities("https://other.timehub.7pace.com", Vec::new());
    ledger.cache_activities(ACME, vec![ActivityType::new("meet", "Meeting")]);
    assert_eq!(ledger.activities_for(ACME), [ActivityType::new("meet", "Meeting")]);
    assert_eq!(ledger.activities.len(), 2);
}

#[test]
fn titles_prefer_the_ticket_then_the_comment() {
    let mut value = draft();
    assert_eq!(value.title(), "#123");
    value.ticket_id = None;
    assert_eq!(value.title(), "Offline work");
    value.comment = "  ".into();
    assert_eq!(value.title(), "Untitled draft");
    value.status = OfflineDraftStatus::Sending;
    value.end = None;
    assert!(!value.running(), "an unconfirmed upload is never the local timer");
}

#[tokio::test]
async fn running_timer_without_worklog_id_becomes_an_overlap_notice() {
    let mut tracking = state(Some(456), "session");
    tracking.track.as_mut().unwrap().work_log_id = None;
    let api = MutationFixture::with_tracking(Vec::new(), tracking);
    let review = OfflineSync::review(&draft(), &api, now(), &cal()).await.unwrap();
    assert!(review.conflicts.is_empty());
    assert_eq!(
        review.overlap_issue.as_deref(),
        Some(
            "7pace has a running timer without a worklog ID. Stop it before editing recorded time."
        )
    );
    assert!(review.warning_key().starts_with("7pace has a running timer"));
}

#[tokio::test]
async fn activity_must_still_resolve_against_fresh_types() {
    let capture = DraftCheckpoint::default();
    let cases = [
        (
            "activity removed",
            Some("dev"),
            Vec::new(),
            "The saved activity is no longer available. Edit the draft’s activity.",
        ),
        (
            "activity required",
            None,
            vec![ActivityType::new("dev", "Development")],
            "Choose an activity type before starting the timer.",
        ),
    ];
    for (case, activity, types, message) in cases {
        let api = MutationFixture::new(Vec::new());
        api.state.lock().await.activity_types = types;
        let mut value = draft();
        value.activity_id = activity.map(str::to_string);
        let review = OfflineSync::review(&value, &api, now(), &cal()).await.unwrap();
        let upload =
            OfflineSync::upload(&review, "test", &api, now(), &cal(), |d| capture.save(d)).await;
        assert_eq!(upload.unwrap_err().to_string(), message, "{case}");
        assert!(api.mutations().await.is_empty(), "{case}");
    }
    assert!(capture.records().await.is_empty());
    // Without activity types (and without a saved activity) 7pace picks its default.
    let api = MutationFixture::new(Vec::new());
    api.state.lock().await.activity_types = Vec::new();
    let mut value = draft();
    value.activity_id = None;
    let review = OfflineSync::review(&value, &api, now(), &cal()).await.unwrap();
    let synced =
        OfflineSync::upload(&review, "test", &api, now(), &cal(), |d| capture.save(d)).await;
    assert_eq!(synced.unwrap().status, OfflineDraftStatus::Synced);
}

#[tokio::test]
async fn unconfirmed_create_stays_sending() {
    let api = MutationFixture::new(Vec::new());
    api.state.lock().await.alter_create = true;
    let capture = DraftCheckpoint::default();
    let review = OfflineSync::review(&draft(), &api, now(), &cal()).await.unwrap();
    let upload =
        OfflineSync::upload(&review, "test", &api, now(), &cal(), |d| capture.save(d)).await;
    assert_eq!(
        upload.unwrap_err().to_string(),
        "7pace did not confirm this draft exactly. Check 7pace before retrying."
    );
    assert_eq!(capture.statuses().await, [OfflineDraftStatus::Sending]);
    let mut synced = draft();
    synced.status = OfflineDraftStatus::Synced;
    let review = OfflineSync::review(&synced, &api, now(), &cal()).await.unwrap();
    let again =
        OfflineSync::upload(&review, "test", &api, now(), &cal(), |d| capture.save(d)).await;
    assert_eq!(
        again.unwrap_err().to_string(),
        "This draft belongs to another workspace or has an unconfirmed upload. Review it before sending."
    );
    assert_eq!(api.mutations().await, ["create"]);
}

#[tokio::test]
async fn upload_future_can_move_between_threads() {
    let api = MutationFixture::new(Vec::new());
    let capture = DraftCheckpoint::default();
    let cal = cal();
    let review = OfflineSync::review(&draft(), &api, now(), &cal).await.unwrap();
    let upload =
        assert_send(OfflineSync::upload(&review, "test", &api, now(), &cal, |d| capture.save(d)));
    assert_eq!(upload.await.unwrap().status, OfflineDraftStatus::Synced);
}
