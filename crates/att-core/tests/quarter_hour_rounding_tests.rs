//! Quarter-hour rounding of saved entries: the setting, drafts, plans, stopped timers and
//! offline drafts. The rounding function itself is tested in `rounding.rs`.

#[path = "support/worklogs.rs"]
mod worklogs;

use att_core::Configuration;
use att_core::model::WorkLog;
use att_core::offline::{OfflineDraft, OfflineDraftStatus, OfflineSync};
use att_core::rounding::{Rounding, round_stopped_entry, stopped_entry};
use att_core::time::add_secs;
use att_core::worklog::edit::WorkLogOverlap;
use att_core::worklog::ops::{WorkLogOperations, WorkLogPlan};
use att_core::worklog::{WorkLogDraft, WorkLogTimeEdit};
use worklogs::*;

const MINUTE: i64 = 60;

/// A new 2026-09-28 entry from `start` (local) lasting `seconds`, billing all of it.
fn draft(start: &str, seconds: i64) -> WorkLogDraft {
    let start = local(start);
    WorkLogDraft::from_times(
        start,
        add_secs(start, seconds as f64),
        Some(123),
        None,
        None,
        true,
        now(),
        &cal(),
    )
    .unwrap()
}

// -- The setting ----------------------------------------------------------------------------------

#[test]
fn the_setting_is_off_by_default_and_for_older_settings() {
    assert!(!Configuration::default().round_to_quarter_hours);
    assert_eq!(Configuration::default().rounding(), Rounding::Exact);
    // Saved by 2.3, before the setting existed.
    let older: Configuration =
        serde_json::from_str(r#"{"organization":"contoso","pollSeconds":60}"#).unwrap();
    assert!(!older.round_to_quarter_hours);
    assert_eq!(older.organization, "contoso");
}

#[test]
fn the_setting_round_trips() {
    let config = Configuration { round_to_quarter_hours: true, ..Configuration::default() };
    let json = serde_json::to_value(&config).unwrap();
    assert_eq!(json["roundToQuarterHours"], true);
    let read: Configuration = serde_json::from_value(json).unwrap();
    assert_eq!(read.rounding(), Rounding::QuarterHour);
}

// -- Drafts ---------------------------------------------------------------------------------------

#[test]
fn a_draft_keeps_its_start_and_moves_its_end() {
    let up = draft("2026-09-28T09:00:00", 72 * MINUTE).rounded(Rounding::QuarterHour, now(), None);
    assert_eq!(
        (up.start, up.seconds, up.billable_seconds),
        (local("2026-09-28T09:00:00"), 75 * MINUTE, 75 * MINUTE)
    );
    let down =
        draft("2026-09-28T09:00:00", 65 * MINUTE).rounded(Rounding::QuarterHour, now(), None);
    assert_eq!((down.start, down.seconds), (local("2026-09-28T09:00:00"), 60 * MINUTE));
    let short =
        draft("2026-09-28T09:00:00", 3 * MINUTE).rounded(Rounding::QuarterHour, now(), None);
    assert_eq!(short.seconds, 15 * MINUTE, "any tracked time is at least 15 minutes");
}

#[test]
fn exact_rounding_and_quarter_multiples_are_unchanged() {
    let odd = draft("2026-09-28T09:00:00", 65 * MINUTE + 7);
    assert_eq!(odd.rounded(Rounding::Exact, now(), None), odd);
    let quarter = draft("2026-09-28T09:00:00", 45 * MINUTE);
    assert_eq!(quarter.rounded(Rounding::QuarterHour, now(), None), quarter);
}

#[test]
fn a_draft_that_would_end_in_the_future_moves_back_into_free_time() {
    // now() is 12:00 in Brussels; 11:48–12:00 is 12m, so 15m would end at 12:03.
    let recent = draft("2026-10-06T11:48:00", 12 * MINUTE);
    let rounded = recent.rounded(Rounding::QuarterHour, now(), None);
    assert_eq!((rounded.start, rounded.end()), (local("2026-10-06T11:45:00"), now()));
    rounded.validate(now(), &cal()).unwrap();
    // The previous entry ends at 11:46: the start moves back only that far, ending at 12:01.
    let gap = recent.rounded(Rounding::QuarterHour, now(), Some(local("2026-10-06T11:46:00")));
    assert_eq!(
        (gap.start, gap.end()),
        (local("2026-10-06T11:46:00"), local("2026-10-06T12:01:00"))
    );
    gap.validate(now(), &cal()).unwrap();
}

#[test]
fn a_draft_right_after_the_previous_entry_keeps_its_start_and_ends_in_the_future() {
    // The previous entry ends at 11:48, where this one starts: 11:48–12:03.
    let recent = draft("2026-10-06T11:48:00", 12 * MINUTE);
    for previous in ["2026-10-06T11:48:00", "2026-10-06T11:55:00"] {
        let rounded = recent.rounded(Rounding::QuarterHour, now(), Some(local(previous)));
        assert_eq!(rounded.start, local("2026-10-06T11:48:00"), "never before the start");
        assert_eq!(rounded.end(), local("2026-10-06T12:03:00"));
        rounded.validate(now(), &cal()).unwrap();
    }
    // A 1m entry becomes 11:59–12:14 without free time before it.
    let short = draft("2026-10-06T11:59:00", MINUTE);
    let rounded = short.rounded(Rounding::QuarterHour, now(), Some(local("2026-10-06T11:59:00")));
    assert_eq!(rounded.end(), local("2026-10-06T12:14:00"));
    rounded.validate(now(), &cal()).unwrap();
}

#[test]
fn only_whole_quarter_hours_may_end_after_now_and_never_more_than_15_minutes() {
    let mut future = draft("2026-10-06T11:00:00", 60 * MINUTE);
    future.start = local("2026-10-06T11:10:00");
    future.validate(now(), &cal()).unwrap();
    future.start = local("2026-10-06T11:16:00");
    assert!(future.validate(now(), &cal()).is_err(), "16 minutes after now");
    future.start = local("2026-10-06T11:10:00");
    future.seconds = 61 * MINUTE;
    future.billable_seconds = future.seconds;
    assert!(future.validate(now(), &cal()).is_err(), "not a whole quarter hour");
    // Times the user enters must still end by now.
    let typed = WorkLogTimeEdit::new(local("2026-10-06T11:10:00"), local("2026-10-06T12:10:00"));
    assert!(typed.validate(now(), &cal()).is_err());
}

#[test]
fn explicit_billable_time_rounds_and_never_exceeds_the_duration() {
    let mut partial = draft("2026-09-28T09:00:00", 65 * MINUTE);
    partial.billable_seconds = 20 * MINUTE;
    assert_eq!(partial.rounded(Rounding::QuarterHour, now(), None).billable_seconds, 15 * MINUTE);
    partial.billable_seconds = 0;
    assert_eq!(partial.rounded(Rounding::QuarterHour, now(), None).billable_seconds, 0);
    partial.billable_seconds = 64 * MINUTE + 50;
    assert_eq!(partial.rounded(Rounding::QuarterHour, now(), None).billable_seconds, 60 * MINUTE);
}

// -- Plans ----------------------------------------------------------------------------------------

#[test]
fn an_edit_is_rounded_and_an_unchanged_entry_is_not() {
    let log = editable_log(EDITABLE_ID, "2026-09-28T09:00:00", 3600.0 + 7.0 * 60.0);
    let edit = WorkLogTimeEdit::new(local("2026-09-28T09:00:00"), local("2026-09-28T10:12:00"));
    let plan = WorkLogPlan::edit(&log, edit, now(), &cal()).unwrap();
    let rounded = plan.rounded(Rounding::QuarterHour, &[], now(), &cal()).unwrap();
    assert_eq!(rounded.desired[0].seconds, 75 * MINUTE);
    // Saving the same times does not round an entry already in 7pace (1h 7m stays).
    let same = WorkLogTimeEdit::new(local("2026-09-28T09:00:00"), local("2026-09-28T10:07:00"));
    let plan = WorkLogPlan::edit(&log, same, now(), &cal()).unwrap();
    let kept = plan.rounded(Rounding::QuarterHour, &[], now(), &cal()).unwrap();
    assert_eq!(kept.desired[0].seconds, 67 * MINUTE);
}

#[test]
fn a_split_rounds_both_parts() {
    let log = editable_log(EDITABLE_ID, "2026-09-28T09:00:00", 3600.0);
    let plan = WorkLogPlan::split(
        &log,
        local("2026-09-28T09:20:00"),
        Some(456),
        None,
        None,
        now(),
        &cal(),
    )
    .unwrap();
    let rounded = plan.rounded(Rounding::QuarterHour, &[], now(), &cal()).unwrap();
    let parts: Vec<(i64, i64)> =
        rounded.desired.iter().map(|d| (d.seconds, d.billable_seconds)).collect();
    assert_eq!(parts, [(15 * MINUTE, 15 * MINUTE), (45 * MINUTE, 45 * MINUTE)]);
    assert_eq!(rounded.desired[1].start, local("2026-09-28T09:20:00"), "starts stay");
}

#[tokio::test]
async fn an_undo_restores_the_exact_earlier_times() {
    let log = editable_log(EDITABLE_ID, "2026-09-28T09:00:00", 3600.0 + 7.0 * 60.0);
    let api = MutationFixture::new(vec![log.clone()]);
    let capture = ChangeCapture::default();
    let edit = WorkLogTimeEdit::new(local("2026-09-28T09:00:00"), local("2026-09-28T10:12:00"));
    let plan = WorkLogPlan::edit(&log, edit, now(), &cal())
        .unwrap()
        .rounded(Rounding::QuarterHour, &[], now(), &cal())
        .unwrap();
    let record =
        WorkLogOperations::apply(&plan, "test", &api, now(), &cal(), |r| capture.checkpoint(r))
            .await
            .unwrap();
    assert_eq!(api.entries().await[EDITABLE_ID].length, 4500.0);
    let undo = WorkLogPlan::undo(&record, &cal())
        .unwrap()
        .rounded(Rounding::QuarterHour, &[], now(), &cal())
        .unwrap();
    assert_eq!(undo.desired[0].seconds, 67 * MINUTE, "1h 7m is restored, not rounded");
}

#[test]
fn exact_plans_are_unchanged() {
    let log = editable_log(EDITABLE_ID, "2026-09-28T09:00:00", 3600.0);
    let edit = WorkLogTimeEdit::new(local("2026-09-28T09:00:00"), local("2026-09-28T10:12:00"));
    let plan = WorkLogPlan::edit(&log, edit, now(), &cal()).unwrap();
    assert_eq!(plan.clone().rounded(Rounding::Exact, &[], now(), &cal()).unwrap(), plan);
}

#[test]
fn rounding_up_may_overlap_the_next_entry_and_the_overlap_check_reports_it() {
    // 10:00–10:12 rounds to 10:00–10:15, into an entry that starts at 10:10.
    let log = editable_log(EDITABLE_ID, "2026-09-28T10:00:00", 600.0);
    let next = editable_log(SECOND_ID, "2026-09-28T10:10:00", 1800.0);
    let edit = WorkLogTimeEdit::new(local("2026-09-28T10:00:00"), local("2026-09-28T10:12:00"));
    let plan = WorkLogPlan::edit(&log, edit, now(), &cal())
        .unwrap()
        .rounded(Rounding::QuarterHour, &[], now(), &cal())
        .unwrap();
    assert_eq!(plan.desired[0].edit().end, local("2026-09-28T10:15:00"));
    let conflicts = WorkLogOverlap::conflicts(
        &plan.desired[0].edit(),
        EDITABLE_ID,
        &[next],
        &idle(),
        now(),
        &cal(),
    )
    .unwrap();
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].overlap, 300.0);
}

#[test]
fn a_plan_never_moves_an_entry_into_the_previous_one() {
    // 11:30–11:48 is followed by an edit to 11:48–12:00 (12m): rounding keeps 11:48.
    let previous = editable_log(SECOND_ID, "2026-10-06T11:30:00", 18.0 * 60.0);
    let log = editable_log(EDITABLE_ID, "2026-10-06T11:48:00", 600.0);
    let edit = WorkLogTimeEdit::new(local("2026-10-06T11:48:00"), local("2026-10-06T12:00:00"));
    let plan = WorkLogPlan::edit(&log, edit, now(), &cal()).unwrap();
    let rounded = plan
        .clone()
        .rounded(Rounding::QuarterHour, &[previous.clone(), log.clone()], now(), &cal())
        .unwrap();
    assert_eq!(rounded.desired[0].start, local("2026-10-06T11:48:00"));
    assert_eq!(rounded.desired[0].end(), local("2026-10-06T12:03:00"));
    // Without a previous entry it moves back to end now.
    let free = plan.rounded(Rounding::QuarterHour, &[log], now(), &cal()).unwrap();
    assert_eq!(free.desired[0].start, local("2026-10-06T11:45:00"));
}

#[test]
fn a_split_part_never_moves_into_the_part_before_it() {
    // 11:00–12:00 split at 11:50. The first part (50m) becomes 11:00–11:45, so the second part
    // (10m → 15m) moves back into the freed time, up to the first part's new end.
    let log = editable_log(EDITABLE_ID, "2026-10-06T11:00:00", 3600.0);
    let plan = WorkLogPlan::split(
        &log,
        local("2026-10-06T11:50:00"),
        Some(456),
        None,
        None,
        now(),
        &cal(),
    )
    .unwrap();
    let rounded =
        plan.rounded(Rounding::QuarterHour, std::slice::from_ref(&log), now(), &cal()).unwrap();
    assert_eq!(rounded.desired[0].edit().end, local("2026-10-06T11:45:00"), "50m → 45m");
    assert_eq!(rounded.desired[1].start, local("2026-10-06T11:45:00"));
    assert_eq!(rounded.desired[1].end(), now());

    // When the first part rounds up instead (11:00–11:38 → 11:45), the second part (22m → 15m)
    // keeps its start.
    let plan = WorkLogPlan::split(
        &log,
        local("2026-10-06T11:38:00"),
        Some(456),
        None,
        None,
        now(),
        &cal(),
    )
    .unwrap();
    let rounded = plan.rounded(Rounding::QuarterHour, &[log], now(), &cal()).unwrap();
    assert_eq!(rounded.desired[0].edit().end, local("2026-10-06T11:45:00"));
    assert_eq!(rounded.desired[1].start, local("2026-10-06T11:38:00"));
}

// -- Stopped timers -------------------------------------------------------------------------------

#[test]
fn the_stopped_entry_is_the_worklog_that_no_longer_runs() {
    assert_eq!(stopped_entry(&state(Some(1), "a"), &idle()).as_deref(), Some("a"));
    assert_eq!(stopped_entry(&state(Some(1), "a"), &state(Some(2), "b")).as_deref(), Some("a"));
    assert_eq!(stopped_entry(&state(Some(1), "a"), &state(Some(1), "a")), None);
    assert_eq!(stopped_entry(&idle(), &idle()), None);
    assert_eq!(stopped_entry(&state(Some(1), ""), &idle()), None, "no worklog ID");
}

#[tokio::test]
async fn a_stopped_timer_is_rounded_with_one_update() {
    let log = editable_log(EDITABLE_ID, "2026-09-28T09:00:00", 3900.0);
    let api = MutationFixture::new(vec![log]);
    let saved = round_stopped_entry(EDITABLE_ID, Rounding::QuarterHour, &api, now(), &cal())
        .await
        .unwrap()
        .expect("written");
    assert_eq!((saved.length, saved.billable_length), (3600.0, Some(3600.0)));
    assert_eq!(saved.timestamp, "2026-09-28T09:00:00");
    assert_eq!(api.mutations().await, ["update"]);
}

#[tokio::test]
async fn a_stopped_timer_moves_back_only_into_free_time() {
    // Stopped at 12:00 after 12m. The previous entry ends at 11:46: saved as 11:46–12:01.
    let previous = editable_log(SECOND_ID, "2026-10-06T11:00:00", 46.0 * 60.0);
    let stopped = editable_log(EDITABLE_ID, "2026-10-06T11:48:00", 720.0);
    let api = MutationFixture::new(vec![previous, stopped]);
    let saved = round_stopped_entry(EDITABLE_ID, Rounding::QuarterHour, &api, now(), &cal())
        .await
        .unwrap()
        .expect("written");
    assert_eq!((saved.timestamp.as_str(), saved.length), ("2026-10-06T11:46:00", 900.0));

    // Right after the previous entry, the start stays: 11:48–12:03.
    let previous = editable_log(SECOND_ID, "2026-10-06T11:00:00", 48.0 * 60.0);
    let stopped = editable_log(EDITABLE_ID, "2026-10-06T11:48:00", 720.0);
    let api = MutationFixture::new(vec![previous, stopped]);
    let saved = round_stopped_entry(EDITABLE_ID, Rounding::QuarterHour, &api, now(), &cal())
        .await
        .unwrap()
        .expect("written");
    assert_eq!((saved.timestamp.as_str(), saved.length), ("2026-10-06T11:48:00", 900.0));
}

#[tokio::test]
async fn a_stopped_timer_is_left_alone_when_nothing_changes() {
    let quarter = editable_log(EDITABLE_ID, "2026-09-28T09:00:00", 2700.0);
    let api = MutationFixture::new(vec![quarter]);
    assert!(
        round_stopped_entry(EDITABLE_ID, Rounding::QuarterHour, &api, now(), &cal())
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        round_stopped_entry(EDITABLE_ID, Rounding::Exact, &api, now(), &cal())
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        round_stopped_entry("missing", Rounding::QuarterHour, &api, now(), &cal())
            .await
            .unwrap()
            .is_none()
    );
    assert!(api.mutations().await.is_empty());
}

#[tokio::test]
async fn a_failed_update_is_reported() {
    let log = editable_log(EDITABLE_ID, "2026-09-28T09:00:00", 3900.0);
    let api = MutationFixture::new(vec![log]);
    api.state.lock().await.fail_update = true;
    assert!(
        round_stopped_entry(EDITABLE_ID, Rounding::QuarterHour, &api, now(), &cal()).await.is_err()
    );
    assert_eq!(api.entries().await[EDITABLE_ID].length, 3900.0);
}

// -- Offline drafts -------------------------------------------------------------------------------

fn offline(start: &str, seconds: i64) -> OfflineDraft {
    let start = local(start);
    let mut draft = OfflineDraft::new(
        "test",
        start,
        Some(add_secs(start, seconds as f64)),
        Some(123),
        "",
        Some("dev".into()),
    );
    draft.billable = true;
    draft
}

#[test]
fn an_offline_proposal_is_rounded_only_when_asked() {
    let draft = offline("2026-09-28T09:00:00", 72 * MINUTE);
    assert_eq!(draft.proposal(Rounding::Exact, &[], now(), &cal()).unwrap().seconds, 72 * MINUTE);
    let rounded = draft.proposal(Rounding::QuarterHour, &[], now(), &cal()).unwrap();
    assert_eq!((rounded.start, rounded.seconds), (local("2026-09-28T09:00:00"), 75 * MINUTE));
}

#[test]
fn an_offline_proposal_never_moves_into_the_previous_entry() {
    let draft = offline("2026-10-06T11:48:00", 12 * MINUTE);
    let previous = editable_log(SECOND_ID, "2026-10-06T11:00:00", 48.0 * 60.0);
    let rounded = draft.proposal(Rounding::QuarterHour, &[previous], now(), &cal()).unwrap();
    assert_eq!((rounded.start, rounded.seconds), (local("2026-10-06T11:48:00"), 15 * MINUTE));
}

#[tokio::test]
async fn an_offline_draft_uploads_rounded() {
    let api = MutationFixture::new(Vec::new());
    let capture = DraftCheckpoint::default();
    let draft = offline("2026-09-28T09:00:00", 65 * MINUTE);
    let review =
        OfflineSync::review(&draft, &api, Rounding::QuarterHour, now(), &cal()).await.unwrap();
    let synced =
        OfflineSync::upload(&review, "test", &api, Rounding::QuarterHour, now(), &cal(), |d| {
            capture.save(d)
        })
        .await
        .unwrap();
    assert_eq!(synced.status, OfflineDraftStatus::Synced);
    let entries = api.entries().await;
    let created: Vec<&WorkLog> = entries.values().collect();
    assert_eq!(created.len(), 1);
    assert_eq!((created[0].length, created[0].billable_length), (3600.0, Some(3600.0)));
    assert_eq!(created[0].timestamp, "2026-09-28T09:00:00");
}
