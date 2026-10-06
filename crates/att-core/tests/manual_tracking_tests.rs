//! Ported from `Tests/AzureTimetrackerCoreTests/ManualTrackingTests.swift` › ManualTrackingTests,
//! plus SlackHuddleTests `onlyStandupActivityMatches` (`StandupActivity` now lives in
//! `att_core::manual`). `LocalTimerDisplayTests` from the same Swift file tests offline drafts and
//! belongs with `att_core::offline`.

use att_core::manual::{ManualTrackingKind, StandupActivity};
use att_core::model::ActivityType;

#[test]
fn no_ticket_or_title_required() {
    assert_eq!(ManualTrackingKind::Standup.remark("", None), "daily standup");
    assert_eq!(ManualTrackingKind::Meeting.remark("  ", None), "Meeting");
    let admin = ActivityType::new("a", "Admin");
    assert_eq!(ManualTrackingKind::Activity.remark("", Some(&admin)), "Admin");
    assert_eq!(ManualTrackingKind::Activity.remark("", None), "Unassigned work");
    assert_eq!(ManualTrackingKind::Meeting.remark("Sprint review", None), "Sprint review");
}

/// SlackHuddleTests `onlyStandupActivityMatches`.
#[test]
fn only_standup_activity_matches() {
    let activities: Vec<ActivityType> = serde_json::from_str(
        r#"[{"id":"dev","name":"Development"},{"id":"meeting","name":"Overleg"},{"id":"standup","name":"Stand-up"}]"#,
    )
    .unwrap();
    assert_eq!(StandupActivity::selected(&activities), Some("standup"));
    assert_eq!(StandupActivity::selected(&activities[..2]), None);
    assert_eq!(StandupActivity::REMARK, "daily standup");
}

#[test]
fn kinds_keep_their_menu_order_labels_and_raw_values() {
    let kinds: Vec<_> =
        ManualTrackingKind::ALL.iter().map(|kind| (kind.id(), kind.label())).collect();
    assert_eq!(
        kinds,
        [("activity", "Other activity"), ("meeting", "Meeting"), ("standup", "Stand-up")]
    );
    for kind in ManualTrackingKind::ALL {
        assert_eq!(serde_json::to_value(kind).unwrap(), kind.id());
    }
}

#[test]
fn comments_are_kept_verbatim_and_blank_activity_names_fall_back() {
    assert_eq!(ManualTrackingKind::Standup.remark(" Retro ", None), " Retro ");
    let blank = ActivityType::new("b", " ");
    assert_eq!(ManualTrackingKind::Activity.remark("", Some(&blank)), "Unassigned work");
    let unnamed = ActivityType { id: "c".to_string(), name: None, color: None };
    assert_eq!(ManualTrackingKind::Activity.remark("\n", Some(&unnamed)), "Unassigned work");
    // Only "other activity" uses the activity name.
    let admin = ActivityType::new("a", "Admin");
    assert_eq!(ManualTrackingKind::Meeting.remark("", Some(&admin)), "Meeting");
}

#[test]
fn standup_names_ignore_case_spacing_and_punctuation() {
    // Only letters count, so digits, emoji and punctuation are ignored, as in Swift.
    for name in ["Standup", "Stand-up", "STAND UP", "stand_up", "Stand-up 🙂", "Stand 2 up"] {
        assert!(StandupActivity::matches(&ActivityType::new("s", name)), "{name}");
    }
    // Accented letters are different letters; a combining accent stays with its letter.
    for name in ["Stand-ups", "Stánd-up", "Sta\u{301}nd-up", "Daily stand-up", ""] {
        assert!(!StandupActivity::matches(&ActivityType::new("s", name)), "{name}");
    }
    let unnamed = ActivityType { id: "s".to_string(), name: None, color: None };
    assert!(!StandupActivity::matches(&unnamed));
}
