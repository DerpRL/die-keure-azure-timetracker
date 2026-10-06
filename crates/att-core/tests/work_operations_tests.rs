//! Port of WorkOperationsTests.swift › WorkOperationsTests (the WorkInsightTests suite in the same
//! Swift file is ported with the insights module), plus Rust-only checks of the journal format,
//! checkpoint order and the executor's guards.

#[path = "support/worklogs.rs"]
mod worklogs;

use att_core::model::{ActivityType, WorkLog, WorkLogUser};
use att_core::time::{add_secs, swift_date};
use att_core::worklog::ops::{WorkLogChange, WorkLogChangeStatus, WorkLogOperations, WorkLogPlan};
use att_core::worklog::{WorkLogDraft, WorkLogTimeEdit};
use tokio::sync::Mutex;
use uuid::Uuid;
use worklogs::*;

/// Swift `pair()`: two adjacent, deletable hours with explicit billable time.
fn pair() -> Vec<WorkLog> {
    let mut first = editable_log(EDITABLE_ID, "2026-09-28T09:00:00", 3600.0);
    let mut second = editable_log(SECOND_ID, "2026-09-28T10:00:00", 3600.0);
    first.is_can_delete = Some(true);
    second.is_can_delete = Some(true);
    first.billable_length = Some(1800.0);
    second.billable_length = Some(900.0);
    vec![first, second]
}

fn seconds(plan: &WorkLogPlan) -> Vec<i64> {
    plan.desired.iter().map(|draft| draft.seconds).collect()
}

#[test]
fn split_preserves_exact_time_and_billable_remainder() {
    let mut log = pair()[0].clone();
    log.billable_length = Some(1001.0);
    let at = local("2026-09-28T09:20:00");
    let plan =
        WorkLogPlan::split(&log, at, Some(456), Some("Other task".into()), None, now(), &cal())
            .unwrap();
    assert_eq!(seconds(&plan), [1200, 2400]);
    assert_eq!(plan.desired.iter().map(|d| d.billable_seconds).sum::<i64>(), 1001);
    assert!(
        plan.desired[0].edit().end == plan.desired[1].start
            && plan.desired[1].ticket_id == Some(456)
    );
    let start = log.date(cal().tz()).unwrap();
    assert!(WorkLogPlan::split(&log, start, None, None, None, now(), &cal()).is_err());
}

#[test]
fn merge_preserves_totals_and_rejects_gaps_overlaps_or_different_metadata() {
    let logs = pair();
    let reversed: Vec<WorkLog> = logs.iter().rev().cloned().collect();
    let plan = WorkLogPlan::merge(&reversed, now(), &cal()).unwrap();
    assert!(plan.desired[0].seconds == 7200 && plan.desired[0].billable_seconds == 2700);
    for timestamp in ["2026-09-28T10:00:01", "2026-09-28T09:59:59"] {
        let mut changed = logs[1].clone();
        changed.timestamp = timestamp.into();
        assert!(
            WorkLogPlan::merge(&[logs[0].clone(), changed], now(), &cal()).is_err(),
            "{timestamp}"
        );
    }
    let mut changed = logs[1].clone();
    changed.comment = Some("Different purpose".into());
    assert!(WorkLogPlan::merge(&[logs[0].clone(), changed], now(), &cal()).is_err());
}

#[tokio::test]
async fn split_and_undo_restore_original_time_without_duplicate_requests() {
    let log = pair()[0].clone();
    let api = MutationFixture::new(vec![log.clone()]);
    let capture = ChangeCapture::default();
    let at = local("2026-09-28T09:30:00");
    let plan =
        WorkLogPlan::split(&log, at, Some(456), Some("Another task".into()), None, now(), &cal())
            .unwrap();
    let result =
        WorkLogOperations::apply(&plan, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await
            .unwrap();
    assert!(result.status == WorkLogChangeStatus::Complete && result.after.len() == 2);
    assert_eq!(api.mutations().await, ["create", "update"]);
    let undo = WorkLogPlan::undo(&result, &cal()).unwrap();
    let undone =
        WorkLogOperations::apply(&undo, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await
            .unwrap();
    assert!(
        undone.after.len() == 1
            && undone.after[0].length == log.length
            && undone.after[0].billable_length == log.billable_length
    );
    assert_eq!(api.mutations().await, ["create", "update", "update", "delete"]);
}

#[tokio::test]
async fn merge_and_undo_recreate_removed_entry_with_new_id() {
    let logs = pair();
    let api = MutationFixture::new(logs.clone());
    let capture = ChangeCapture::default();
    let plan = WorkLogPlan::merge(&logs, now(), &cal()).unwrap();
    let result =
        WorkLogOperations::apply(&plan, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await
            .unwrap();
    assert_eq!(api.mutations().await, ["update", "delete"]);
    assert_eq!(result.after.len(), 1);
    let undo = WorkLogPlan::undo(&result, &cal()).unwrap();
    let undone =
        WorkLogOperations::apply(&undo, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await
            .unwrap();
    assert!(undone.after.len() == 2 && !undone.after.iter().any(|log| log.id == logs[1].id));
    assert_eq!(undone.after.iter().map(|log| log.length).sum::<f64>(), 7200.0);
    assert_eq!(
        undone.after.iter().map(|log| log.billable_length.unwrap_or(log.length)).sum::<f64>(),
        2700.0
    );
}

#[tokio::test]
async fn edit_can_be_undone_but_external_changes_prevent_undo() {
    let log = pair()[0].clone();
    let api = MutationFixture::new(vec![log.clone()]);
    let capture = ChangeCapture::default();
    let start = log.date(cal().tz()).unwrap();
    let plan = WorkLogPlan::edit(
        &log,
        WorkLogTimeEdit::new(start, add_secs(start, 7200.0)),
        now(),
        &cal(),
    )
    .unwrap();
    let result =
        WorkLogOperations::apply(&plan, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await
            .unwrap();
    let mut changed = result.after[0].clone();
    changed.comment = Some("Edited elsewhere".into());
    api.replace(changed).await;
    let undo = WorkLogPlan::undo(&result, &cal()).unwrap();
    let undone =
        WorkLogOperations::apply(&undo, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await;
    assert!(undone.is_err());
    assert_eq!(api.mutations().await, ["update"]);
}

#[tokio::test]
async fn missing_delete_permission_and_running_entries_prevent_every_write() {
    let mut logs = pair();
    logs[1].is_can_delete = Some(false);
    let capture = ChangeCapture::default();
    let denied = MutationFixture::new(logs.clone());
    let plan = WorkLogPlan::merge(&logs, now(), &cal()).unwrap();
    let result =
        WorkLogOperations::apply(&plan, "test", &denied, now(), &cal(), |r| capture.checkpoint(r))
            .await;
    assert!(result.is_err());
    assert!(denied.mutations().await.is_empty());
    let active = MutationFixture::with_tracking(pair(), state(Some(123), &logs[0].id));
    let plan = WorkLogPlan::merge(&pair(), now(), &cal()).unwrap();
    let result =
        WorkLogOperations::apply(&plan, "test", &active, now(), &cal(), |r| capture.checkpoint(r))
            .await;
    assert!(result.is_err());
    assert!(active.mutations().await.is_empty());
}

#[tokio::test]
async fn lost_create_is_never_retried_and_leaves_durable_review_record() {
    let log = pair()[0].clone();
    let api = MutationFixture::new(vec![log.clone()]);
    let capture = ChangeCapture::default();
    api.state.lock().await.lose_create_response = true;
    let at = add_secs(log.date(cal().tz()).unwrap(), 1800.0);
    let plan =
        WorkLogPlan::split(&log, at, Some(123), Some("Development".into()), None, now(), &cal())
            .unwrap();
    let result =
        WorkLogOperations::apply(&plan, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await;
    assert!(result.is_err());
    assert_eq!(api.mutations().await, ["create"]);
    assert_eq!(api.entries().await.len(), 2);
    assert_eq!(capture.records().await.last().unwrap().status, WorkLogChangeStatus::NeedsReview);
    assert_eq!(api.entries().await[&log.id].length, log.length);
}

#[tokio::test]
async fn failed_merge_does_not_delete_sources_and_journal_failure_prevents_writes() {
    let api = MutationFixture::new(pair());
    let capture = ChangeCapture::default();
    api.state.lock().await.fail_update = true;
    let plan = WorkLogPlan::merge(&pair(), now(), &cal()).unwrap();
    let result =
        WorkLogOperations::apply(&plan, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await;
    assert!(result.is_err());
    assert_eq!(api.mutations().await, ["update"]);
    assert_eq!(api.entries().await.len(), 2);
    let other = MutationFixture::new(pair());
    let unavailable = ChangeCapture::failing();
    let result = WorkLogOperations::apply(&plan, "test", &other, now(), &cal(), |r| {
        unavailable.checkpoint(r)
    })
    .await;
    assert_eq!(result.unwrap_err().to_string(), "Disk unavailable");
    assert!(other.mutations().await.is_empty());
}

#[test]
fn journal_round_trips_all_recovery_data() {
    let plan = WorkLogPlan::merge(&pair(), now(), &cal()).unwrap();
    let record = WorkLogChange::new(&plan, "scope", now());
    let decoded: WorkLogChange =
        serde_json::from_str(&serde_json::to_string(&record).unwrap()).unwrap();
    assert!(
        decoded.before == record.before
            && decoded.desired == record.desired
            && decoded.workspace == "scope"
    );
    assert_eq!(decoded, record);
}

// Rust-only: the 1.14.x journal format.

/// `time-edit-history.json` as Swift 1.14.2 wrote it (`JSONEncoder` defaults: dates in seconds
/// since 2001, uppercase UUIDs, escaped slashes, nil optionals omitted), captured from the Swift
/// sources: a completed merge and a failed undo of it.
const SWIFT_JOURNAL: &str = r##"[{"before":[{"id":"11111111-1111-1111-1111-111111111111","isCanEdit":true,"timestamp":"2026-09-28T09:00:00","user":{"id":"user-1"},"activityType":{"id":"8a5e1c2d-0000-4000-8000-000000000001","color":"#2E7D32","name":"Development"},"comment":"Development","length":3600,"workItemId":123,"editedTimestamp":"2026-09-28T12:00:00","billableLength":1800,"isCanDelete":true},{"id":"22222222-2222-2222-2222-222222222222","isCanEdit":true,"timestamp":"2026-09-28T10:00:00","user":{"id":"user-1"},"activityType":{"name":"Development","id":"8a5e1c2d-0000-4000-8000-000000000001","color":"#2E7D32"},"comment":"Development","length":3600,"workItemId":123,"editedTimestamp":"2026-09-28T12:00:00","billableLength":900,"isCanDelete":true}],"date":812961340.07238,"id":"935077DC-1B64-4A96-AF7D-58E4887C9DB3","status":"complete","detail":"Confirmed by 7pace","title":"Merge 2 entries","workspace":"https:\/\/acme.timehub.7pace.com","after":[{"id":"11111111-1111-1111-1111-111111111111","isCanEdit":true,"timestamp":"2026-09-28T09:00:00","user":{"id":"user-1"},"activityType":{"id":"8a5e1c2d-0000-4000-8000-000000000001","name":"Development","color":"#2E7D32"},"comment":"Development","length":7200,"workItemId":123,"editedTimestamp":"2026-09-28T13:05:00.123","billableLength":2700,"isCanDelete":true}],"desired":[{"seconds":7200,"ticketID":123,"billableSeconds":2700,"start":812271600,"comment":"Development","existingID":"11111111-1111-1111-1111-111111111111","allowDefaultActivity":false,"userID":"user-1","activityID":"8a5e1c2d-0000-4000-8000-000000000001"}]},{"before":[{"id":"11111111-1111-1111-1111-111111111111","isCanEdit":true,"timestamp":"2026-09-28T09:00:00","user":{"id":"user-1"},"activityType":{"id":"8a5e1c2d-0000-4000-8000-000000000001","name":"Development","color":"#2E7D32"},"comment":"Development","length":7200,"workItemId":123,"editedTimestamp":"2026-09-28T13:05:00.123","billableLength":2700,"isCanDelete":true}],"date":812961340.074033,"id":"581F3E7E-8EDE-49BC-88CC-95D8CB10CD3A","undoOf":"935077DC-1B64-4A96-AF7D-58E4887C9DB3","status":"needsReview","detail":"Creating a replacement entry; if interrupted, check 7pace before doing anything else. Some changes may already be saved. No request was retried. Response lost after create","title":"Undo merge 2 entries","workspace":"https:\/\/acme.timehub.7pace.com","after":[{"id":"11111111-1111-1111-1111-111111111111","isCanEdit":true,"timestamp":"2026-09-28T09:00:00","user":{"id":"user-1"},"activityType":{"name":"Development","color":"#2E7D32","id":"8a5e1c2d-0000-4000-8000-000000000001"},"comment":"Development","length":7200,"workItemId":123,"editedTimestamp":"2026-09-28T13:05:00.123","billableLength":2700,"isCanDelete":true}],"desired":[{"seconds":3600,"ticketID":123,"billableSeconds":1800,"start":812271600,"comment":"Development","existingID":"11111111-1111-1111-1111-111111111111","allowDefaultActivity":false,"userID":"user-1","activityID":"8a5e1c2d-0000-4000-8000-000000000001"},{"seconds":3600,"ticketID":123,"billableSeconds":900,"start":812275200,"comment":"Development","allowDefaultActivity":false,"userID":"user-1","activityID":"8a5e1c2d-0000-4000-8000-000000000001","restoredID":"22222222-2222-2222-2222-222222222222"}]}]"##;

/// Swift `WorkLogPlan.merge` of the journal's two source entries, from the same run.
const SWIFT_MERGE_PLAN: &str = r##"{"title":"Merge 2 entries","desired":[{"allowDefaultActivity":false,"comment":"Development","start":812271600,"activityID":"8a5e1c2d-0000-4000-8000-000000000001","ticketID":123,"billableSeconds":2700,"seconds":7200,"existingID":"11111111-1111-1111-1111-111111111111","userID":"user-1"}],"before":[{"isCanDelete":true,"editedTimestamp":"2026-09-28T12:00:00","user":{"id":"user-1"},"billableLength":1800,"comment":"Development","id":"11111111-1111-1111-1111-111111111111","workItemId":123,"timestamp":"2026-09-28T09:00:00","length":3600,"activityType":{"id":"8a5e1c2d-0000-4000-8000-000000000001","name":"Development","color":"#2E7D32"},"isCanEdit":true},{"isCanDelete":true,"editedTimestamp":"2026-09-28T12:00:00","user":{"id":"user-1"},"billableLength":900,"comment":"Development","id":"22222222-2222-2222-2222-222222222222","workItemId":123,"timestamp":"2026-09-28T10:00:00","length":3600,"activityType":{"name":"Development","color":"#2E7D32","id":"8a5e1c2d-0000-4000-8000-000000000001"},"isCanEdit":true}]}"##;

/// Swift `WorkLogPlan.undo` of the journal's completed merge, from the same run.
const SWIFT_UNDO_PLAN: &str = r##"{"undoOf":"935077DC-1B64-4A96-AF7D-58E4887C9DB3","title":"Undo merge 2 entries","desired":[{"seconds":3600,"userID":"user-1","billableSeconds":1800,"comment":"Development","start":812271600,"activityID":"8a5e1c2d-0000-4000-8000-000000000001","allowDefaultActivity":false,"existingID":"11111111-1111-1111-1111-111111111111","ticketID":123},{"seconds":3600,"ticketID":123,"userID":"user-1","billableSeconds":900,"comment":"Development","start":812275200,"activityID":"8a5e1c2d-0000-4000-8000-000000000001","allowDefaultActivity":false,"restoredID":"22222222-2222-2222-2222-222222222222"}],"before":[{"isCanEdit":true,"user":{"id":"user-1"},"isCanDelete":true,"workItemId":123,"comment":"Development","id":"11111111-1111-1111-1111-111111111111","timestamp":"2026-09-28T09:00:00","length":7200,"billableLength":2700,"activityType":{"name":"Development","color":"#2E7D32","id":"8a5e1c2d-0000-4000-8000-000000000001"},"editedTimestamp":"2026-09-28T13:05:00.123"}]}"##;

#[test]
fn swift_journal_decodes_with_plans_and_worklog_snapshots() {
    let journal: Vec<WorkLogChange> = serde_json::from_str(SWIFT_JOURNAL).unwrap();
    assert_eq!(journal.len(), 2);
    let (merge, undo) = (&journal[0], &journal[1]);
    let merge_id = Uuid::parse_str("935077dc-1b64-4a96-af7d-58e4887c9db3").unwrap();
    assert_eq!(merge.id, merge_id);
    assert_eq!(merge.date, swift_date::to_timestamp(812_961_340.072_38));
    assert_eq!(merge.workspace, "https://acme.timehub.7pace.com");
    assert_eq!(
        (merge.status, merge.detail.as_str()),
        (WorkLogChangeStatus::Complete, "Confirmed by 7pace")
    );
    assert_eq!((merge.title.as_str(), merge.undo_of), ("Merge 2 entries", None));

    let source = &merge.before[0];
    assert_eq!(source.id, EDITABLE_ID);
    assert_eq!((source.length, source.billable_length), (3600.0, Some(1800.0)));
    assert_eq!(
        source.activity_type,
        Some(ActivityType {
            id: "8a5e1c2d-0000-4000-8000-000000000001".into(),
            name: Some("Development".into()),
            color: Some("#2E7D32".into()),
        })
    );
    assert_eq!(source.user, Some(WorkLogUser { id: Some("user-1".into()) }));
    assert_eq!((source.is_can_edit, source.is_can_delete), (Some(true), Some(true)));
    assert_eq!(merge.before[1].id, SECOND_ID);
    assert_eq!(merge.after[0].edited_timestamp.as_deref(), Some("2026-09-28T13:05:00.123"));
    assert_eq!(merge.after[0].length, 7200.0);

    let combined = &merge.desired[0];
    assert_eq!(combined.existing_id.as_deref(), Some(EDITABLE_ID));
    assert_eq!(combined.start, local("2026-09-28T09:00:00"));
    assert_eq!((combined.seconds, combined.billable_seconds), (7200, 2700));
    assert_eq!(combined.ticket_id, Some(123));
    assert_eq!(combined.activity_id.as_deref(), Some("8a5e1c2d-0000-4000-8000-000000000001"));
    assert_eq!(combined.user_id.as_deref(), Some("user-1"));

    assert_eq!(undo.undo_of, Some(merge_id));
    assert_eq!(undo.status, WorkLogChangeStatus::NeedsReview);
    assert!(undo.detail.ends_with("Response lost after create"));
    assert_eq!(undo.desired[1].existing_id, None);
    assert_eq!(undo.desired[1].restored_id.as_deref(), Some(SECOND_ID));
    assert_eq!(undo.desired[1].start, local("2026-09-28T10:00:00"));

    // Rust writes RFC 3339 dates and camelCase keys, and reads them back losslessly.
    let written = serde_json::to_value(&journal).unwrap();
    assert!(written[0]["date"].as_str().unwrap().starts_with("2026-10-06T06:35:40.07"));
    assert_eq!(written[1]["undoOf"], merge_id.to_string());
    assert_eq!(written[0]["status"], "complete");
    assert_eq!(written[1]["status"], "needsReview");
    assert!(written[0].get("undoOf").is_none(), "nil optionals stay omitted");
    let reread: Vec<WorkLogChange> = serde_json::from_value(written).unwrap();
    assert_eq!(reread, journal);
}

#[test]
fn rust_plans_equal_the_plans_swift_built_from_the_same_entries() {
    let journal: Vec<WorkLogChange> = serde_json::from_str(SWIFT_JOURNAL).unwrap();
    let swift_merge: WorkLogPlan = serde_json::from_str(SWIFT_MERGE_PLAN).unwrap();
    let swift_undo: WorkLogPlan = serde_json::from_str(SWIFT_UNDO_PLAN).unwrap();
    let sources = [journal[0].before[1].clone(), journal[0].before[0].clone()];
    assert_eq!(WorkLogPlan::merge(&sources, now(), &cal()).unwrap(), swift_merge);
    assert_eq!(WorkLogPlan::undo(&journal[0], &cal()).unwrap(), swift_undo);
    assert_eq!(swift_undo.undo_of, Some(journal[0].id));
}

#[test]
fn journal_records_missing_defaulted_keys_still_decode() {
    let minimal = r#"{"id":"581F3E7E-8EDE-49BC-88CC-95D8CB10CD3A","date":0,"workspace":"w","title":"Edit time"}"#;
    let record: WorkLogChange = serde_json::from_str(minimal).unwrap();
    assert_eq!(record.status, WorkLogChangeStatus::Applying);
    assert_eq!(record.detail, "Preparing change");
    assert!(record.before.is_empty() && record.after.is_empty() && record.desired.is_empty());
    assert_eq!(record.undo_of, None);
    for (status, raw) in [
        (WorkLogChangeStatus::Applying, "applying"),
        (WorkLogChangeStatus::Complete, "complete"),
        (WorkLogChangeStatus::NeedsReview, "needsReview"),
        (WorkLogChangeStatus::Reviewed, "reviewed"),
        (WorkLogChangeStatus::Undone, "undone"),
    ] {
        assert_eq!(serde_json::to_value(status).unwrap(), raw);
    }
}

// Rust-only: executor guards and checkpoint order.

type Trace = Vec<(WorkLogChangeStatus, String, usize, usize)>;

/// Applies `plan` and records `(status, detail, writes so far, after.len())` at every checkpoint.
async fn trace(api: &MutationFixture, plan: &WorkLogPlan) -> Trace {
    let seen = Mutex::new(Trace::new());
    let result = WorkLogOperations::apply(plan, "test", api, now(), &cal(), |record| {
        let seen = &seen;
        async move {
            let writes = api.mutations().await.len();
            seen.lock().await.push((record.status, record.detail, writes, record.after.len()));
            Ok(())
        }
    })
    .await;
    assert_eq!(result.unwrap().status, WorkLogChangeStatus::Complete);
    seen.into_inner()
}

#[tokio::test]
async fn journal_checkpoints_precede_every_write_and_follow_every_step() {
    use WorkLogChangeStatus::{Applying, Complete};
    let creating =
        "Creating a replacement entry; if interrupted, check 7pace before doing anything else.";
    let updating = format!("Updating entry {EDITABLE_ID}.");
    let removing = format!("Removing original entry {SECOND_ID}.");

    let log = pair()[0].clone();
    let api = MutationFixture::new(vec![log.clone()]);
    let at = local("2026-09-28T09:30:00");
    let split =
        WorkLogPlan::split(&log, at, Some(456), Some("Another task".into()), None, now(), &cal())
            .unwrap();
    let expected: Trace = vec![
        (Applying, "Preparing change".into(), 0, 1),
        (Applying, creating.into(), 0, 1),
        (Applying, creating.into(), 1, 2),
        (Applying, updating.clone(), 1, 2),
        (Applying, updating.clone(), 2, 2),
        (Complete, "Confirmed by 7pace".into(), 2, 2),
    ];
    assert_eq!(trace(&api, &split).await, expected);

    let api = MutationFixture::new(pair());
    let merge = WorkLogPlan::merge(&pair(), now(), &cal()).unwrap();
    let expected: Trace = vec![
        (Applying, "Preparing change".into(), 0, 2),
        (Applying, updating.clone(), 0, 2),
        (Applying, updating, 1, 2),
        (Applying, removing.clone(), 1, 2),
        (Applying, removing, 2, 1),
        (Complete, "Confirmed by 7pace".into(), 2, 1),
    ];
    assert_eq!(trace(&api, &merge).await, expected);
}

#[tokio::test]
async fn duplicate_unknown_or_empty_plans_are_rejected_before_any_write() {
    let logs = pair();
    let api = MutationFixture::new(logs.clone());
    let capture = ChangeCapture::default();
    let start = logs[0].date(cal().tz()).unwrap();
    let edit = WorkLogPlan::edit(
        &logs[0],
        WorkLogTimeEdit::new(start, add_secs(start, 1800.0)),
        now(),
        &cal(),
    )
    .unwrap();
    let mut unknown = edit.clone();
    unknown.desired[0].existing_id = Some("33333333-3333-3333-3333-333333333333".into());
    let mut duplicate_source = edit.clone();
    duplicate_source.before.push(logs[0].clone());
    let mut duplicate_target = edit.clone();
    duplicate_target.desired.push(edit.desired[0].clone());
    let empty = WorkLogPlan {
        title: "Empty".into(),
        before: Vec::new(),
        desired: Vec::new(),
        undo_of: None,
    };
    let duplicate = "This change contains duplicate or unknown entries.";
    for (case, plan, message) in [
        ("unknown target", unknown, duplicate),
        ("duplicate source", duplicate_source, duplicate),
        ("duplicate target", duplicate_target, duplicate),
        ("empty", empty, "This change has no entries."),
    ] {
        let result =
            WorkLogOperations::apply(&plan, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
                .await;
        assert_eq!(result.unwrap_err().to_string(), message, "{case}");
    }
    assert!(api.mutations().await.is_empty());
    assert!(capture.records().await.is_empty(), "nothing is journalled before validation passes");
}

#[tokio::test]
async fn existing_restoration_target_blocks_undo_before_any_write() {
    let logs = pair();
    let api = MutationFixture::new(logs.clone());
    let capture = ChangeCapture::default();
    let merge = WorkLogPlan::merge(&logs, now(), &cal()).unwrap();
    let merged =
        WorkLogOperations::apply(&merge, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await
            .unwrap();
    api.replace(logs[1].clone()).await;
    let undo = WorkLogPlan::undo(&merged, &cal()).unwrap();
    let result =
        WorkLogOperations::apply(&undo, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await;
    assert_eq!(
        result.unwrap_err().to_string(),
        "An entry scheduled for restoration already exists. Refresh before undoing."
    );
    assert_eq!(api.mutations().await, ["update", "delete"]);
}

#[tokio::test]
async fn unconfirmed_removal_needs_review_and_explains_the_failed_step() {
    let api = MutationFixture::new(pair());
    api.state.lock().await.ignore_delete = true;
    let capture = ChangeCapture::default();
    let plan = WorkLogPlan::merge(&pair(), now(), &cal()).unwrap();
    let result =
        WorkLogOperations::apply(&plan, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await;
    let detail = format!(
        "Removing original entry {SECOND_ID}. Some changes may already be saved. No request was retried. 7pace did not confirm removal of the original entry."
    );
    assert_eq!(
        result.unwrap_err().to_string(),
        format!("{detail} Review Recent edits and the actual entries in 7pace before continuing.")
    );
    let last = capture.records().await.pop().unwrap();
    assert_eq!((last.status, last.detail), (WorkLogChangeStatus::NeedsReview, detail));
    assert_eq!(api.mutations().await, ["update", "delete"]);
}

#[test]
fn only_completed_changes_can_be_undone() {
    let plan = WorkLogPlan::merge(&pair(), now(), &cal()).unwrap();
    for status in [
        WorkLogChangeStatus::Applying,
        WorkLogChangeStatus::NeedsReview,
        WorkLogChangeStatus::Reviewed,
        WorkLogChangeStatus::Undone,
    ] {
        let mut record = WorkLogChange::new(&plan, "test", now());
        record.status = status;
        let undo = WorkLogPlan::undo(&record, &cal());
        assert_eq!(
            undo.unwrap_err().to_string(),
            "Only a confirmed, completed change can be undone.",
            "{status:?}"
        );
    }
}

#[test]
fn server_entries_become_drafts_rounded_to_the_nearest_second() {
    let cal = cal();
    let mut log = editable_log(EDITABLE_ID, "2026-09-28T09:00:00.600", 3599.5);
    log.work_item_id = Some(0);
    let draft = WorkLogDraft::from_log(&log, true, &cal).unwrap();
    assert_eq!(draft.start, local("2026-09-28T09:00:01"));
    assert_eq!(draft.seconds, 3600);
    assert_eq!(draft.billable_seconds, 3600, "a missing billable length bills the whole entry");
    assert_eq!(draft.ticket_id, None, "non-positive tickets are ticket-free");
    assert_eq!(draft.existing_id.as_deref(), Some(EDITABLE_ID));
    assert!(!draft.allow_default_activity);
    assert_eq!(WorkLogDraft::from_log(&log, false, &cal).unwrap().existing_id, None);

    let with = |change: fn(&mut WorkLog)| {
        let mut log = editable();
        change(&mut log);
        log
    };
    for (case, log) in [
        ("shorter than a second", with(|l| l.length = 0.9)),
        ("not finite", with(|l| l.length = f64::NAN)),
        ("over Int32.max", with(|l| l.length = f64::from(i32::MAX) + 1.0)),
        ("negative billable", with(|l| l.billable_length = Some(-1.0))),
        ("unreadable start", with(|l| l.timestamp = "invalid".into())),
    ] {
        assert_eq!(
            WorkLogDraft::from_log(&log, true, &cal).unwrap_err().to_string(),
            "This entry has an invalid time or billable duration.",
            "{case}"
        );
    }
}

#[test]
fn user_times_round_down_and_need_a_valid_ticket_or_comment() {
    let (cal, now) = (cal(), now());
    let start = add_secs(local("2026-09-28T09:00:00"), 0.9);
    let end = add_secs(local("2026-09-28T10:00:00"), 0.9);
    let draft =
        WorkLogDraft::from_times(start, end, Some(123), None, Some("dev".into()), true, now, &cal)
            .unwrap();
    assert_eq!(draft.start, local("2026-09-28T09:00:00"));
    assert!(
        draft.seconds == 3600 && draft.billable_seconds == 3600 && !draft.allow_default_activity
    );
    for (case, ticket, comment) in [
        ("ticket zero", Some(0), None),
        ("ticket over Int32.max", Some(i64::from(i32::MAX) + 1), None),
        ("blank comment without ticket", None, Some("  ".to_string())),
    ] {
        let result = WorkLogDraft::from_times(start, end, ticket, comment, None, false, now, &cal);
        assert_eq!(
            result.unwrap_err().to_string(),
            "Choose a valid ticket or add a comment for ticket-free time.",
            "{case}"
        );
    }
    let future = WorkLogDraft::from_times(
        start,
        add_secs(now, 1.0),
        Some(123),
        None,
        None,
        false,
        now,
        &cal,
    );
    assert_eq!(future.unwrap_err().to_string(), "Choose valid times with no time in the future.");
}

#[test]
fn drafts_match_saved_entries_by_value() {
    let cal = cal();
    let log = pair()[0].clone();
    let mut draft = WorkLogDraft::from_log(&log, true, &cal).unwrap();
    assert!(draft.matches(&log, &cal));
    let mut saved = log.clone();
    saved.activity_type = Some(ActivityType::new("default", "Default"));
    assert!(!draft.matches(&saved, &cal));
    draft.allow_default_activity = true;
    assert!(draft.matches(&saved, &cal), "the server may choose the default activity");
    saved.user = Some(WorkLogUser { id: Some("someone".into()) });
    assert!(draft.matches(&saved, &cal), "an unnamed owner is not compared");
    draft.user_id = Some("me".into());
    assert!(!draft.matches(&saved, &cal));
    draft.user_id = None;
    saved.billable_length = Some(1801.0);
    assert!(!draft.matches(&saved, &cal));
    saved.billable_length = Some(1800.0);
    draft.comment = Some(" ".into());
    saved.comment = None;
    assert!(draft.matches(&saved, &cal), "blank comments compare equal");
}

#[tokio::test]
async fn apply_future_can_move_between_threads() {
    let log = pair()[0].clone();
    let api = MutationFixture::new(vec![log.clone()]);
    let capture = ChangeCapture::default();
    let cal = cal();
    let start = log.date(cal.tz()).unwrap();
    let plan =
        WorkLogPlan::edit(&log, WorkLogTimeEdit::new(start, add_secs(start, 600.0)), now(), &cal)
            .unwrap();
    let applied = assert_send(WorkLogOperations::apply(&plan, "test", &api, now(), &cal, |r| {
        capture.checkpoint(r)
    }));
    assert_eq!(applied.await.unwrap().status, WorkLogChangeStatus::Complete);
}
