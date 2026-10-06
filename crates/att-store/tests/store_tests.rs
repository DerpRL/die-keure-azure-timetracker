use att_core::model::WorkLog;
use att_core::time::{Cal, Interval};
use att_store::{Store, keys, legacy};
use jiff::civil::date;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, PartialEq, Serialize, Deserialize)]
struct Slice {
    value: i64,
}

#[test]
fn documents_round_trip_and_skip_unchanged_writes() {
    let store = Store::open_in_memory().unwrap();
    assert_eq!(store.get::<Slice>("a").unwrap(), None);
    assert!(store.put("a", &Slice { value: 1 }).unwrap());
    assert!(!store.put("a", &Slice { value: 1 }).unwrap(), "identical JSON is not rewritten");
    assert!(store.put("a", &Slice { value: 2 }).unwrap());
    assert_eq!(store.get::<Slice>("a").unwrap(), Some(Slice { value: 2 }));
    store.delete("a").unwrap();
    assert_eq!(store.get::<Slice>("a").unwrap(), None);
}

#[test]
fn unreadable_documents_are_errors_not_resets() {
    let store = Store::open_in_memory().unwrap();
    store.put_raw("a", r#"{"value":"not a number"}"#).unwrap();
    assert!(store.get::<Slice>("a").is_err());
    assert!(store.get_raw("a").unwrap().is_some(), "the original text stays");
}

#[test]
fn audit_is_newest_first_and_capped() {
    let store = Store::open_in_memory().unwrap();
    for value in 0..5 {
        store.append_audit(&Slice { value }, 3).unwrap();
    }
    let entries: Vec<Slice> = store.audit(10).unwrap();
    assert_eq!(entries, [4, 3, 2].map(|value| Slice { value }));
}

#[test]
fn files_are_private_and_reopen_keeps_data() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    {
        let store = Store::open(&data).unwrap();
        store.put("a", &Slice { value: 7 }).unwrap();
        store.set_weekly_draft("ws|2026-09-28T00:00:00", "# Draft").unwrap();
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = |p: &std::path::Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&data), 0o700);
        assert_eq!(mode(&data.join(att_store::DATABASE_FILE)), 0o600);
    }
    let store = Store::open(&data).unwrap();
    assert_eq!(store.get::<Slice>("a").unwrap(), Some(Slice { value: 7 }));
    assert_eq!(store.weekly_draft("ws|2026-09-28T00:00:00").unwrap().as_deref(), Some("# Draft"));
}

fn log(id: &str, timestamp: &str) -> WorkLog {
    WorkLog::new(id, timestamp, 600.0)
}

#[test]
fn worklog_cache_replaces_ranges_and_tracks_coverage() {
    let cal = Cal::brussels();
    let store = Store::open_in_memory().unwrap();
    let day = cal.date_interval(date(2026, 9, 29));
    let next = cal.date_interval(date(2026, 9, 30));
    let fetched = cal.date_at(date(2026, 9, 30), 18, 0);
    store
        .put_worklogs(
            "ws",
            day,
            &[log("a", "2026-09-29T09:00:00"), log("b", "2026-09-29T10:00:00"), log("bad", "?")],
            cal.tz(),
            fetched,
        )
        .unwrap();
    let ids: Vec<String> = store.worklogs("ws", day).unwrap().into_iter().map(|l| l.id).collect();
    assert_eq!(
        ids,
        ["b", "a", "bad"],
        "newest first; unparseable dates anchored at the range start"
    );
    assert_eq!(store.worklog_coverage("ws", day).unwrap(), Some(fetched));
    let both = Interval::new(day.start, next.end);
    assert_eq!(store.worklog_coverage("ws", both).unwrap(), None, "next day not fetched");

    // A refetch of the same day replaces deleted entries.
    store.put_worklogs("ws", day, &[log("a", "2026-09-29T09:00:00")], cal.tz(), fetched).unwrap();
    assert_eq!(store.worklogs("ws", day).unwrap().len(), 1);

    store.put_worklogs("ws", next, &[], cal.tz(), fetched).unwrap();
    assert_eq!(store.worklog_coverage("ws", both).unwrap(), Some(fetched), "touching ranges merge");
    assert!(store.worklogs("other", day).unwrap().is_empty(), "workspaces are separate");
    store.invalidate_worklogs("ws").unwrap();
    assert_eq!(store.worklog_coverage("ws", day).unwrap(), None);
    assert_eq!(store.worklogs("ws", day).unwrap().len(), 1, "invalidation keeps cached rows");
    store.clear_worklogs("ws").unwrap();
    assert!(store.worklogs("ws", day).unwrap().is_empty());
}

fn write(dir: &std::path::Path, name: &str, value: serde_json::Value) {
    std::fs::write(dir.join(name), serde_json::to_vec_pretty(&value).unwrap()).unwrap();
}

#[test]
fn legacy_import_copies_slices_once_and_keeps_originals() {
    let legacy_dir = tempfile::tempdir().unwrap();
    let dir = legacy_dir.path();
    // Shapes written by the Swift app: newest audit entry first, Swift reference dates.
    write(
        dir,
        legacy::STATE_FILE,
        json!({
            "configuration": {"organization": "org", "pollSeconds": 60, "slackHuddles": {"enabled": false}},
            "audit": [
                {"id": "B3B4C5D6-0000-0000-0000-000000000002", "date": 781_000_100.0, "title": "newer", "detail": ""},
                {"id": "B3B4C5D6-0000-0000-0000-000000000001", "date": 781_000_000.0, "title": "older", "detail": ""}
            ],
            "pending": [],
            "pausedSession": {"ticketID": 33984, "workspace": "https://org.timehub.7pace.com", "pausedAt": 781_000_000.0},
            "slackReminders": {"x": 781_000_000.0},
            "meetingReturn": null
        }),
    );
    write(dir, legacy::OFFLINE_FILE, json!({"drafts": [], "activities": {}}));
    write(dir, legacy::JOURNAL_FILE, json!([]));
    write(dir, legacy::WEEKLY_FILE, json!({"ws|2026-09-28T00:00:00": "# Week"}));
    let state_before = std::fs::read(dir.join(legacy::STATE_FILE)).unwrap();

    let store = Store::open_in_memory().unwrap();
    let report = store.import_legacy(dir).unwrap();
    assert!(report.imported);
    assert_eq!(report.audit_entries, 2);
    assert_eq!(report.weekly_drafts, 1);
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    for key in [
        keys::CONFIGURATION,
        keys::PENDING_BRANCHES,
        keys::PAUSED_SESSION,
        keys::OFFLINE_LEDGER,
        keys::TIME_EDIT_JOURNAL,
    ] {
        assert!(report.documents.iter().any(|d| d == key), "missing {key}");
    }
    assert!(!report.documents.iter().any(|d| d == "slackReminders" || d == keys::MEETING_RETURN));
    let paused: serde_json::Value = store.get(keys::PAUSED_SESSION).unwrap().unwrap();
    assert_eq!(paused["ticketID"], 33984, "copied verbatim for the Rust decoder");
    let audit: Vec<serde_json::Value> = store.audit(10).unwrap();
    assert_eq!(audit[0]["title"], "newer");
    assert_eq!(audit[1]["title"], "older");
    assert_eq!(store.weekly_draft("ws|2026-09-28T00:00:00").unwrap().as_deref(), Some("# Week"));

    assert_eq!(std::fs::read(dir.join(legacy::STATE_FILE)).unwrap(), state_before, "untouched");
    assert!(dir.join(legacy::MARKER_FILE).exists());

    let again = store.import_legacy(dir).unwrap();
    assert!(!again.imported, "runs once");
    assert_eq!(store.audit_count().unwrap(), 2);
}

#[test]
fn legacy_import_skips_unreadable_files_and_keeps_existing_documents() {
    let legacy_dir = tempfile::tempdir().unwrap();
    let dir = legacy_dir.path();
    std::fs::write(dir.join(legacy::STATE_FILE), b"{ not json").unwrap();
    write(dir, legacy::OFFLINE_FILE, json!({"drafts": [], "activities": {}}));
    write(dir, legacy::JOURNAL_FILE, json!([{"id": "x"}]));

    let store = Store::open_in_memory().unwrap();
    store.put_raw(keys::TIME_EDIT_JOURNAL, "[]").unwrap();
    let report = store.import_legacy(dir).unwrap();
    assert!(report.imported);
    assert_eq!(report.documents, [keys::OFFLINE_LEDGER]);
    assert!(report.skipped.iter().any(|s| s.starts_with("state.json")));
    assert!(report.skipped.iter().any(|s| s.starts_with(keys::TIME_EDIT_JOURNAL)));
    assert_eq!(store.get_raw(keys::TIME_EDIT_JOURNAL).unwrap().as_deref(), Some("[]"));
}

#[test]
fn nothing_to_import_does_not_mark_the_database() {
    let empty = tempfile::tempdir().unwrap();
    let store = Store::open_in_memory().unwrap();
    let report = store.import_legacy(empty.path()).unwrap();
    assert!(!report.imported);
    assert!(!store.legacy_imported().unwrap());
}
