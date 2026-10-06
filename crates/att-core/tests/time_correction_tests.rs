//! Port of TimeCorrectionTests.swift › TimeCorrectionTests, plus Rust-only checks of issue
//! identities and the remaining correction rules.

#[path = "support/worklogs.rs"]
mod worklogs;

use att_core::Interval;
use att_core::model::{TrackingState, WorkLog};
use att_core::time::{add_secs, wire_date};
use att_core::worklog::WorkLogDraft;
use att_core::worklog::corrections::{TimeCorrectionKind, TimeCorrections};
use att_core::worklog::ops::{WorkLogChangeStatus, WorkLogOperations, WorkLogPlan};
use jiff::Timestamp;
use worklogs::*;

fn start() -> Timestamp {
    local("2026-09-28T09:00:00")
}

fn at(offset: f64) -> Timestamp {
    add_secs(start(), offset)
}

/// Swift `entry(_:_:_:)`: a deletable entry `offset` seconds after 09:00.
fn entry(id: &str, offset: f64, duration: f64) -> WorkLog {
    let mut log = editable_log(id, &local_string(at(offset)), duration);
    log.is_can_delete = Some(true);
    log
}

/// Swift `DateInterval(start: start, duration:)`.
fn window(duration: f64) -> Interval {
    Interval::new(start(), at(duration))
}

#[test]
fn union_finds_gaps_without_false_gaps_inside_nested_entries() {
    let logs = [entry("a", 0.0, 3600.0), entry("b", 600.0, 600.0), entry("c", 4800.0, 1200.0)];
    let with_duplicate = [logs.as_slice(), &[logs[0].clone()]].concat();
    let issues = TimeCorrections::issues(&with_duplicate, window(6000.0), 300.0, &cal()).unwrap();
    let gaps: Vec<_> = issues.iter().filter(|i| i.kind == TimeCorrectionKind::Gap).collect();
    let overlaps: Vec<_> =
        issues.iter().filter(|i| i.kind == TimeCorrectionKind::Overlap).collect();
    assert!(
        gaps.len() == 1
            && gaps[0].seconds() == 1200.0
            && gaps[0].earlier.as_ref().map(|l| l.id.as_str()) == Some("a")
    );
    assert!(overlaps.len() == 1 && overlaps[0].seconds() == 600.0);
}

#[test]
fn touching_entries_do_not_overlap_and_overnight_is_clipped() {
    let logs = [entry("a", -3600.0, 7200.0), entry("b", 3600.0, 3600.0)];
    let issues = TimeCorrections::issues(&logs, window(7200.0), 300.0, &cal()).unwrap();
    assert!(issues.is_empty(), "{issues:?}");
}

#[test]
fn leading_trailing_and_threshold_gaps() {
    let logs = [entry("a", 600.0, 600.0)];
    let issues = TimeCorrections::issues(&logs, window(1800.0), 600.0, &cal()).unwrap();
    assert!(issues.len() == 2 && issues[0].earlier.is_none() && issues[1].later.is_none());
    let plan = TimeCorrections::fill_gap(&issues[0], false, now(), &cal()).unwrap();
    assert!(plan.desired[0].start == start() && plan.desired[0].seconds == 1200);
    assert!(TimeCorrections::fill_gap(&issues[0], true, now(), &cal()).is_err());
}

#[test]
fn invalid_intervals_do_not_invent_gaps() {
    let mut log = entry("a", 0.0, 3600.0);
    log.timestamp = "bad date".into();
    assert!(TimeCorrections::issues(&[log], window(7200.0), 300.0, &cal()).is_err());
}

#[test]
fn remove_middle_preserves_both_work_segments_and_billable_proportion() {
    let mut log = entry(EDITABLE_ID, 0.0, 10800.0);
    log.billable_length = Some(5400.0);
    let plan = TimeCorrections::remove_interval(&log, at(3600.0), at(7200.0), None, now(), &cal())
        .unwrap();
    assert_eq!(plan.desired.iter().map(|d| d.seconds).collect::<Vec<_>>(), [3600, 3600]);
    assert_eq!(plan.desired.iter().map(|d| d.billable_seconds).collect::<Vec<_>>(), [1800, 1800]);
    assert!(
        plan.desired[0].existing_id.as_deref() == Some(log.id.as_str())
            && plan.desired[1].existing_id.is_none()
    );
    assert_eq!(plan.desired[1].start, at(7200.0));
}

#[test]
fn separate_interval_preserves_totals_and_changes_only_idle_metadata() {
    let mut log = entry("a", 0.0, 10800.0);
    log.billable_length = Some(1001.0);
    let separate = WorkLogDraft::from_times(
        at(3600.0),
        at(7200.0),
        None,
        Some("Break".into()),
        Some("break".into()),
        false,
        now(),
        &cal(),
    )
    .unwrap();
    let plan = TimeCorrections::remove_interval(
        &log,
        separate.start,
        separate.edit().end,
        Some(&separate),
        now(),
        &cal(),
    )
    .unwrap();
    assert_eq!(plan.desired.iter().map(|d| d.seconds).sum::<i64>(), 10800);
    assert_eq!(plan.desired.iter().map(|d| d.billable_seconds).sum::<i64>(), 1001);
    assert!(
        plan.desired[1].comment.as_deref() == Some("Break") && plan.desired[1].ticket_id.is_none()
    );
    assert!(
        plan.desired[0].ticket_id == log.work_item_id
            && plan.desired[2].ticket_id == log.work_item_id
    );
}

#[test]
fn boundary_removes_only_overlapping_duration() {
    let (a, b) = (entry("a", 0.0, 7200.0), entry("b", 5400.0, 5400.0));
    let issues = TimeCorrections::issues(&[a, b], window(10800.0), 1.0, &cal()).unwrap();
    let issue = issues.first().expect("an overlap");
    let plan = TimeCorrections::move_boundary(issue, at(6300.0), now(), &cal()).unwrap();
    assert_eq!(plan.desired.iter().map(|d| d.seconds).collect::<Vec<_>>(), [6300, 4500]);
    assert_eq!(plan.desired[0].edit().end, plan.desired[1].start);
    assert!(TimeCorrections::move_boundary(issue, at(1.0), now(), &cal()).is_err());
}

#[test]
fn whole_removal_and_out_of_bounds_cannot_delete_entries() {
    let log = entry("a", 0.0, 3600.0);
    let whole = TimeCorrections::remove_interval(&log, start(), at(3600.0), None, now(), &cal());
    assert_eq!(
        whole.unwrap_err().to_string(),
        "This would remove the entire entry. Use a narrower interval, or separate the time into its own entry."
    );
    let outside =
        TimeCorrections::remove_interval(&log, at(7200.0), at(8000.0), None, now(), &cal());
    assert_eq!(
        outside.unwrap_err().to_string(),
        "The selected interval is outside this entry. Refresh the recorded time."
    );
}

#[tokio::test]
async fn correction_undo_restores_original_and_changed_source_blocks_save() {
    let log = entry(EDITABLE_ID, 0.0, 10800.0);
    let api = MutationFixture::new(vec![log.clone()]);
    let capture = ChangeCapture::default();
    let plan = TimeCorrections::remove_interval(&log, at(3600.0), at(7200.0), None, now(), &cal())
        .unwrap();
    let saved =
        WorkLogOperations::apply(&plan, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await
            .unwrap();
    assert_eq!(saved.after.len(), 2);
    let undo = WorkLogPlan::undo(&saved, &cal()).unwrap();
    let restored =
        WorkLogOperations::apply(&undo, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await
            .unwrap();
    assert!(restored.after.len() == 1 && restored.after[0].length == log.length);
    assert!(TimeCorrections::remove_interval(&log, start(), start(), None, now(), &cal()).is_err());
    let stale =
        WorkLogOperations::apply(&plan, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await;
    assert!(stale.is_err());
}

#[tokio::test]
async fn fractional_idle_boundaries_round_trip_through_second_precision_api() {
    let log = entry(EDITABLE_ID, 0.0, 10800.0);
    let api = MutationFixture::new(vec![log.clone()]);
    let capture = ChangeCapture::default();
    let plan = TimeCorrections::remove_interval(&log, at(3600.8), at(7200.6), None, now(), &cal())
        .unwrap();
    assert_eq!(plan.desired.iter().map(|d| d.seconds).collect::<Vec<_>>(), [3601, 3599]);
    for draft in &plan.desired {
        assert_eq!(
            Some(draft.start),
            wire_date::parse(&local_string(draft.start), Some(cal().tz()))
        );
    }
    let saved =
        WorkLogOperations::apply(&plan, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await
            .unwrap();
    assert!(
        saved.status == WorkLogChangeStatus::Complete
            && saved.after.iter().map(|l| l.length).sum::<f64>() == 7200.0
    );
}

#[tokio::test]
async fn running_entry_cannot_be_corrected() {
    let log = entry(EDITABLE_ID, 0.0, 10800.0);
    let tracking: TrackingState = serde_json::from_str(&format!(
        r#"{{"track":{{"trackingState":"tracking","workLogId":"{}"}}}}"#,
        log.id
    ))
    .unwrap();
    let api = MutationFixture::with_tracking(vec![log.clone()], tracking);
    let capture = ChangeCapture::default();
    let plan = TimeCorrections::remove_interval(&log, at(3600.0), at(7200.0), None, now(), &cal())
        .unwrap();
    let result =
        WorkLogOperations::apply(&plan, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await;
    assert!(result.is_err());
    assert!(api.mutations().await.is_empty());
}

// Rust-only checks.

#[test]
fn issue_identities_use_swift_number_text_and_sort_ties_by_identity() {
    let logs = [entry("a", 3600.0, 600.0)];
    let issues = TimeCorrections::issues(&logs, window(7200.0), 300.0, &cal()).unwrap();
    let ids: Vec<String> = issues.iter().map(|issue| issue.id()).collect();
    assert_eq!(ids, ["gap|1790578800.0||a", "gap|1790583000.0|a|"]);

    // Three entries from before the window: every pairwise overlap is clipped to the window start,
    // so the tie is broken by identity rather than by discovery order (c+b, c+a, b+a).
    let logs = [entry("c", -600.0, 1800.0), entry("b", -300.0, 1500.0), entry("a", -120.0, 1320.0)];
    let issues = TimeCorrections::issues(&logs, window(1800.0), 300.0, &cal()).unwrap();
    let name = |log: &Option<WorkLog>| log.as_ref().map_or(String::new(), |l| l.id.clone());
    let pairs: Vec<String> = issues
        .iter()
        .map(|i| format!("{} {}>{}", i.kind.raw(), name(&i.earlier), name(&i.later)))
        .collect();
    assert_eq!(pairs, ["overlap b>a", "overlap c>a", "overlap c>b", "gap c>"]);
    assert!(issues[..3].iter().all(|issue| issue.start == start()));
}

#[test]
fn zero_length_entries_are_ignored_and_empty_days_have_no_trailing_gap() {
    let logs = [entry("empty", 600.0, 0.0)];
    assert!(TimeCorrections::issues(&logs, window(3600.0), 300.0, &cal()).unwrap().is_empty());
    let mut negative = entry("negative", 0.0, 600.0);
    negative.length = -1.0;
    assert!(TimeCorrections::issues(&[negative], window(3600.0), 300.0, &cal()).is_err());
}

#[test]
fn gaps_are_filled_by_extending_the_earlier_entry() {
    let logs = [entry("a", 0.0, 600.0), entry("b", 1800.0, 600.0)];
    let issues = TimeCorrections::issues(&logs, window(2400.0), 300.0, &cal()).unwrap();
    assert_eq!(issues.len(), 1);
    let plan = TimeCorrections::fill_gap(&issues[0], true, now(), &cal()).unwrap();
    assert_eq!(plan.title, "Fill gap with neighboring task");
    assert_eq!((plan.desired[0].start, plan.desired[0].seconds), (start(), 1800));
    assert_eq!(plan.desired[0].existing_id.as_deref(), Some("a"));
}

#[test]
fn removing_a_leading_separate_interval_replaces_the_entry() {
    let mut log = entry(EDITABLE_ID, 0.0, 3600.0);
    log.billable_length = Some(1000.0);
    let separate = WorkLogDraft::from_times(
        start(),
        at(600.0),
        None,
        Some("Idle time".into()),
        None,
        false,
        now(),
        &cal(),
    )
    .unwrap();
    let plan =
        TimeCorrections::remove_interval(&log, start(), at(600.0), Some(&separate), now(), &cal())
            .unwrap();
    assert_eq!(plan.title, "Separate idle interval");
    // Swift keeps the entry only for a leading part that is not the separated interval.
    assert!(plan.desired.iter().all(|draft| draft.existing_id.is_none()));
    assert_eq!(plan.desired.iter().map(|d| d.seconds).collect::<Vec<_>>(), [600, 3000]);
    assert_eq!(plan.desired.iter().map(|d| d.billable_seconds).collect::<Vec<_>>(), [167, 833]);
    assert!(
        plan.desired[0].allow_default_activity
            && plan.desired[0].comment.as_deref() == Some("Idle time")
    );
}

#[test]
fn boundaries_need_two_staggered_entries() {
    let (outer, inner) = (entry("outer", 0.0, 7200.0), entry("inner", 1800.0, 1800.0));
    let issues = TimeCorrections::issues(&[outer, inner], window(7200.0), 1.0, &cal()).unwrap();
    let overlap = issues.iter().find(|i| i.kind == TimeCorrectionKind::Overlap).unwrap();
    let nested = TimeCorrections::move_boundary(overlap, at(2700.0), now(), &cal());
    assert_eq!(
        nested.unwrap_err().to_string(),
        "Choose a boundary inside the overlap between two staggered entries."
    );
    let gap =
        TimeCorrections::issues(&[entry("a", 0.0, 600.0)], window(1800.0), 300.0, &cal()).unwrap();
    let not_overlap = TimeCorrections::move_boundary(&gap[0], at(900.0), now(), &cal());
    assert_eq!(not_overlap.unwrap_err().to_string(), "Select two overlapping entries.");
}
