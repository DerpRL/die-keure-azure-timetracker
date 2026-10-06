//! Port of TimeEditingTests.swift › TimeEditingTests (the TrackingAttentionTests suite in the same
//! Swift file is ported with the tracking module), plus Rust-only checks of the validation bounds
//! and the DST rule.

#[path = "support/worklogs.rs"]
mod worklogs;

use std::collections::BTreeSet;

use att_core::AppError;
use att_core::time::{add_secs, wire_date};
use att_core::worklog::WorkLogTimeEdit;
use att_core::worklog::edit::{WorkLogEditing, WorkLogOverlap};
use jiff::Timestamp;
use worklogs::*;

fn edit() -> WorkLogTimeEdit {
    WorkLogTimeEdit::new(local("2026-09-28T09:00:00"), local("2026-09-28T11:00:00"))
}

#[test]
fn overlaps_include_containing_and_cross_midnight_entries_but_not_touching_edges() {
    let logs = [
        editable_log("before", "2026-09-28T08:00:00", 3600.0),
        editable_log("after", "2026-09-28T11:00:00", 3600.0),
        editable_log("inside", "2026-09-28T09:30:00", 1800.0),
        editable_log("contains", "2026-09-27T23:00:00", 13.0 * 3600.0),
        editable(),
        editable_log("inside", "2026-09-28T09:30:00", 1800.0),
    ];
    let conflicts =
        WorkLogOverlap::conflicts(&edit(), EDITABLE_ID, &logs, &idle(), now(), &cal()).unwrap();
    let ids: BTreeSet<&str> = conflicts.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, BTreeSet::from(["inside", "contains"]));
    assert_eq!(conflicts.len(), 2, "duplicate history rows count once");
    assert_eq!(conflicts.iter().find(|c| c.id == "contains").unwrap().overlap, 7200.0);
}

#[test]
fn live_timer_is_counted_once_and_cannot_be_edited() {
    let mut tracking = state(Some(456), "session");
    tracking.track.as_mut().unwrap().current_track_started_date_time =
        Some("2026-09-28T10:00:00".into());
    let at = local("2026-09-28T12:00:00");
    let history = [editable_log("session", "2026-09-28T10:00:00", 3600.0)];
    let conflicts =
        WorkLogOverlap::conflicts(&edit(), EDITABLE_ID, &history, &tracking, at, &cal()).unwrap();
    assert!(conflicts.len() == 1 && conflicts[0].active && conflicts[0].overlap == 3600.0);
    assert_eq!(conflicts[0].end, at, "the running timer counts until now");
    let running = WorkLogOverlap::conflicts(&edit(), "session", &[], &tracking, at, &cal());
    assert_eq!(
        running.unwrap_err().to_string(),
        "This entry is still running. Stop or pause it before editing."
    );
    tracking.track.as_mut().unwrap().work_log_id = None;
    let unknown = WorkLogOverlap::conflicts(&edit(), EDITABLE_ID, &[], &tracking, now(), &cal());
    assert_eq!(
        unknown.unwrap_err().to_string(),
        "7pace has a running timer without a worklog ID. Stop it before editing recorded time."
    );
}

#[test]
fn incomplete_dates_are_reported_and_invalid_drafts_are_rejected() {
    let bad = [editable_log("bad", "invalid", 3600.0)];
    let error = WorkLogOverlap::conflicts(&edit(), EDITABLE_ID, &bad, &idle(), now(), &cal());
    assert_eq!(
        error.unwrap_err().to_string(),
        "An existing entry has an unreadable time, so overlaps could not be fully checked."
    );
    let now = now();
    // Swift `.distantFuture` and `.distantPast`.
    let distant_future: Timestamp = "4001-01-01T00:00:00Z".parse().unwrap();
    let distant_past: Timestamp = "0001-01-01T00:00:00Z".parse().unwrap();
    for (case, end) in [
        ("distant future", distant_future),
        ("distant past", distant_past),
        ("a second ago", add_secs(now, -1.0)),
    ] {
        let edit = WorkLogTimeEdit::new(now, end);
        assert!(edit.validate(now, &cal()).is_err(), "{case}");
    }
}

#[tokio::test]
async fn locked_and_externally_changed_entries_prevent_writes() {
    let original = editable();
    let fixture = EditingFixture::tracking(idle());
    let mut locked = original.clone();
    locked.is_can_edit = Some(false);
    let mut longer = original.clone();
    longer.length += 1.0;
    let mut stamped = original.clone();
    stamped.edited_timestamp = Some("new".into());
    for (case, changed) in [("locked", locked), ("length", longer), ("edit stamp", stamped)] {
        fixture.state.lock().await.entry = changed;
        let review = WorkLogEditing::review(&original, edit(), &fixture, now(), &cal()).await;
        assert!(review.is_err(), "{case}");
    }
    assert_eq!(fixture.writes().await, 0);
}

#[tokio::test]
async fn overlapping_edit_saves_directly_without_prior_review() {
    let other = editable_log("other", "2026-09-28T10:30:00", 3600.0);
    let fixture = EditingFixture::new(editable(), vec![other], idle());
    let result = WorkLogEditing::save(&editable(), edit(), &fixture, now(), &cal()).await.unwrap();
    assert!(
        result.saved.length == 7200.0
            && result.saved.work_item_id == Some(123)
            && result.saved.comment.as_deref() == Some("Development")
    );
    assert!(result.conflicts.len() == 1 && result.conflicts[0].overlap == 1800.0);
    assert_eq!(result.overlap_issue, None);
    assert_eq!(fixture.writes().await, 1);
}

#[tokio::test]
async fn new_overlap_after_optional_check_is_returned_as_notice_and_does_not_block_save() {
    let fixture = EditingFixture::tracking(idle());
    let original = editable();
    let checked = WorkLogEditing::review(&original, edit(), &fixture, now(), &cal()).await.unwrap();
    assert!(checked.conflicts.is_empty());
    fixture.state.lock().await.entries = vec![editable_log("other", "2026-09-28T10:30:00", 3600.0)];
    let result = WorkLogEditing::save(&original, edit(), &fixture, now(), &cal()).await.unwrap();
    assert_eq!(result.saved.length, 7200.0);
    assert_eq!(result.conflicts.len(), 1);
    assert_eq!(fixture.writes().await, 1);
}

#[tokio::test]
async fn unavailable_overlap_history_warns_but_does_not_block_valid_save() {
    let fixture = EditingFixture::tracking(idle());
    fixture.state.lock().await.fail_history = true;
    let result = WorkLogEditing::save(&editable(), edit(), &fixture, now(), &cal()).await.unwrap();
    assert_eq!(result.saved.length, 7200.0);
    assert_eq!(
        result.overlap_issue.as_deref(),
        Some("The overlap check could not be completed. Fixture history unavailable")
    );
    assert_eq!(fixture.writes().await, 1);
}

#[tokio::test]
async fn unreadable_other_entry_or_other_timer_start_does_not_block_save() {
    let bad_history =
        EditingFixture::new(editable(), vec![editable_log("bad", "invalid", 3600.0)], idle());
    let mut other_timer = state(Some(456), "session");
    other_timer.track.as_mut().unwrap().current_track_started_date_time = None;
    let missing_timer_start = EditingFixture::tracking(other_timer);
    for (case, fixture) in
        [("bad history", bad_history), ("missing timer start", missing_timer_start)]
    {
        let result =
            WorkLogEditing::save(&editable(), edit(), &fixture, now(), &cal()).await.unwrap();
        assert!(result.saved.length == 7200.0 && result.overlap_issue.is_some(), "{case}");
        assert_eq!(fixture.writes().await, 1, "{case}");
    }
}

#[tokio::test]
async fn selected_running_entry_and_unknown_running_entry_still_prevent_save_even_without_history()
{
    let own_timer = state(Some(123), EDITABLE_ID);
    let mut unknown_timer = state(Some(456), "session");
    unknown_timer.track.as_mut().unwrap().work_log_id = None;
    for (case, tracking) in [("own timer", own_timer), ("unknown timer", unknown_timer)] {
        let fixture = EditingFixture::tracking(tracking);
        fixture.state.lock().await.fail_history = true;
        let saved = WorkLogEditing::save(&editable(), edit(), &fixture, now(), &cal()).await;
        assert!(saved.is_err(), "{case}");
        assert_eq!(fixture.writes().await, 0, "{case}");
    }
}

#[tokio::test]
async fn cancelled_overlap_request_does_not_continue_to_write() {
    let fixture = EditingFixture::tracking(idle());
    fixture.state.lock().await.cancel_history = true;
    let saved = WorkLogEditing::save(&editable(), edit(), &fixture, now(), &cal()).await;
    assert_eq!(saved.unwrap_err(), AppError::Cancelled);
    assert_eq!(fixture.writes().await, 0);
}

#[tokio::test]
async fn change_during_history_fetch_is_caught_before_saving() {
    let fixture = EditingFixture::tracking(idle());
    let approved =
        WorkLogEditing::review(&editable(), edit(), &fixture, now(), &cal()).await.unwrap();
    fixture.state.lock().await.change_during_history = true;
    let saved =
        WorkLogEditing::save(&approved.original, approved.edit, &fixture, now(), &cal()).await;
    assert_eq!(
        saved.unwrap_err().to_string(),
        "This entry changed in 7pace. Reload it before editing so another change is not overwritten."
    );
    assert_eq!(fixture.writes().await, 0);
}

#[tokio::test]
async fn permission_revocation_after_review_prevents_save() {
    let fixture = EditingFixture::tracking(idle());
    let approved =
        WorkLogEditing::review(&editable(), edit(), &fixture, now(), &cal()).await.unwrap();
    let mut locked = editable();
    locked.is_can_edit = Some(false);
    fixture.state.lock().await.entry = locked;
    let saved =
        WorkLogEditing::save(&approved.original, approved.edit, &fixture, now(), &cal()).await;
    assert_eq!(
        saved.unwrap_err().to_string(),
        "7pace does not allow editing this entry. Its week may be locked, or your account may lack permission."
    );
    assert_eq!(fixture.writes().await, 0);
}

#[tokio::test]
async fn failed_or_mismatched_write_is_never_retried() {
    for wrong in [false, true] {
        let fixture = EditingFixture::tracking(idle());
        let approved =
            WorkLogEditing::review(&editable(), edit(), &fixture, now(), &cal()).await.unwrap();
        if wrong {
            fixture.state.lock().await.wrong_response = true;
        } else {
            fixture.state.lock().await.fail_write = true;
        }
        let saved =
            WorkLogEditing::save(&approved.original, approved.edit, &fixture, now(), &cal()).await;
        assert!(saved.is_err(), "wrong response: {wrong}");
        assert_eq!(fixture.writes().await, 1, "wrong response: {wrong}");
    }
}

// Rust-only checks.

#[test]
fn validation_accepts_one_second_up_to_int32_max_ending_now() {
    let now = now();
    let cal = cal();
    let max = f64::from(i32::MAX);
    let cases = [
        ("one second", add_secs(now, -1.0), now, true),
        ("rounds to zero", add_secs(now, -0.4), now, false),
        ("Int32.max", add_secs(now, -max), now, true),
        ("over Int32.max", add_secs(now, -max - 1.0), now, false),
        ("ends in the future", add_secs(now, -60.0), add_secs(now, 1.0), false),
    ];
    for (case, start, end, valid) in cases {
        assert_eq!(WorkLogTimeEdit::new(start, end).validate(now, &cal).is_ok(), valid, "{case}");
    }
}

/// 2025-10-26 02:30 happens twice in Brussels (CEST, then CET). 7pace receives the offset-free
/// local string, so only the instant that string parses back to may be saved. Like the Swift
/// app's `DateFormatter`, `wire_date::parse` resolves repeated times to the later instant.
#[test]
fn repeated_local_hour_accepts_only_the_instant_its_local_time_parses_to() {
    let cal = cal();
    let first: Timestamp = "2025-10-26T00:30:00Z".parse().unwrap();
    let second: Timestamp = "2025-10-26T01:30:00Z".parse().unwrap();
    assert_eq!(local_string(first), local_string(second));
    let resolved = wire_date::parse("2025-10-26T02:30:00", Some(cal.tz())).unwrap();
    // Like 1.14.x (`DateFormatter`): the later instant, so only the second 02:30 may be saved.
    assert_eq!(resolved, second);
    for start in [first, second] {
        let result = WorkLogTimeEdit::new(start, add_secs(start, 600.0)).validate(now(), &cal);
        if start == resolved {
            assert!(result.is_ok(), "{start}");
        } else {
            assert_eq!(
                result.unwrap_err().to_string(),
                "This start time is ambiguous during a clock change. Choose an unambiguous local time.",
                "{start}"
            );
        }
    }
    let after_the_change: Timestamp = "2025-10-26T02:30:00Z".parse().unwrap();
    assert!(
        WorkLogTimeEdit::new(after_the_change, add_secs(after_the_change, 600.0))
            .validate(now(), &cal)
            .is_ok()
    );
}

#[test]
fn matches_tolerates_less_than_a_second() {
    let cal = cal();
    let edit = edit();
    let mut log = editable_log(EDITABLE_ID, "2026-09-28T09:00:00.900", 7200.9);
    assert!(edit.matches(&log, &cal));
    log.length = 7201.0;
    assert!(!edit.matches(&log, &cal));
    log.length = 7200.0;
    log.timestamp = "2026-09-28T09:00:01".into();
    assert!(!edit.matches(&log, &cal));
}

#[tokio::test]
async fn save_future_can_move_between_threads() {
    let fixture = EditingFixture::tracking(idle());
    let cal = cal();
    let original = editable();
    let saved = assert_send(WorkLogEditing::save(&original, edit(), &fixture, now(), &cal));
    assert!(saved.await.is_ok());
}
