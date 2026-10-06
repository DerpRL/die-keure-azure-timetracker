//! Ported from MeetingAndStatusTests.swift › MeetingSuggestionTests, MeetingTicketTests and
//! MeetingActivityTests. `oldSettingsStillDecode` decodes the whole `Configuration` and waits for
//! it; TrackingIndicatorTests belong to the indicator port.

#[path = "support/context.rs"]
mod support;

use std::collections::BTreeMap;

use att_core::meetings::{
    MeetingEvent, MeetingPreferences, MeetingSuggestionEngine, meeting_activity, meeting_ticket,
};
use att_core::model::ActivityType;
use att_core::time::add_secs;
use jiff::Timestamp;
use support::{activity, at, swift};

fn now() -> Timestamp {
    at(1_800_000_000.0)
}

fn meeting(id: &str, offset: f64) -> MeetingEvent {
    MeetingEvent::new(
        id,
        "Daily stand-up",
        add_secs(now(), offset),
        add_secs(now(), offset + 1800.0),
    )
}

// MeetingSuggestionTests

#[test]
fn starts_once_and_survives_restart() {
    let mut engine = MeetingSuggestionEngine::default();
    let event = meeting("occurrence", 0.0);
    let due = engine.due(&[event.clone(), event.clone()], now());
    assert_eq!(due, std::slice::from_ref(&event));
    assert!(engine.due(std::slice::from_ref(&event), add_secs(now(), 2.0)).is_empty());
    let saved = serde_json::to_string(engine.seen()).unwrap();
    let seen: BTreeMap<String, Timestamp> = serde_json::from_str(&saved).unwrap();
    let mut restored = MeetingSuggestionEngine::new(seen);
    assert!(restored.due(&[event], add_secs(now(), 30.0)).is_empty());
}

#[test]
fn does_not_prompt_before_start() {
    let mut engine = MeetingSuggestionEngine::default();
    let event = meeting("occurrence", 30.0);
    assert!(engine.due(std::slice::from_ref(&event), now()).is_empty());
    assert_eq!(engine.due(std::slice::from_ref(&event), event.start), [event]);
}

#[test]
fn grace_period_and_expired_events() {
    let mut engine = MeetingSuggestionEngine::default();
    let recent = meeting("recent", -300.0);
    let events = [meeting("old", -301.0), meeting("ended", -1800.0), recent.clone()];
    assert_eq!(engine.due(&events, now()), [recent]);
}

#[test]
fn ignores_non_meeting_time_and_declined_invitations() {
    let mut all_day = meeting("all-day", 0.0);
    all_day.all_day = true;
    let mut cancelled = meeting("cancelled", 0.0);
    cancelled.cancelled = true;
    let mut declined = meeting("declined", 0.0);
    declined.declined = true;
    let mut free = meeting("free", 0.0);
    free.free = true;
    let mut engine = MeetingSuggestionEngine::default();
    assert!(engine.due(&[all_day, cancelled, declined, free], now()).is_empty());
    assert!(engine.seen().is_empty());
}

#[test]
fn recurring_occurrences_and_overlapping_meetings_remain_independent() {
    let mut engine = MeetingSuggestionEngine::default();
    let first = meeting("series-day1", 0.0);
    let other = meeting("other", -30.0);
    assert_eq!(engine.due(&[first.clone(), other.clone()], now()), [other, first]);
    let tomorrow = meeting("series-day2", 86_400.0);
    assert_eq!(engine.due(std::slice::from_ref(&tomorrow), tomorrow.start), [tomorrow]);
}

#[test]
fn prunes_old_reminder_keys() {
    let seen = BTreeMap::from([
        ("old".to_string(), add_secs(now(), -172_801.0)),
        ("recent".to_string(), add_secs(now(), -10.0)),
    ]);
    let mut engine = MeetingSuggestionEngine::new(seen);
    engine.due(&[], now());
    assert!(!engine.seen().contains_key("old"));
    assert!(engine.seen().contains_key("recent"));
}

#[test]
fn calendar_removal_or_cancellation_makes_event_inactive() {
    let mut event = meeting("occurrence", 0.0);
    assert!(event.is_active(now()));
    event.cancelled = true;
    assert!(!event.is_active(now()));
    event.cancelled = false;
    event.end = now();
    assert!(!event.is_active(now()));
}

#[test]
fn seen_keys_are_kept_until_48_hours_after_the_end() {
    let seen = BTreeMap::from([
        ("edge".to_string(), add_secs(now(), -172_800.0)),
        ("inside".to_string(), add_secs(now(), -172_799.0)),
    ]);
    let mut engine = MeetingSuggestionEngine::new(seen);
    engine.due(&[], now());
    assert_eq!(engine.seen().keys().collect::<Vec<_>>(), ["inside"]);
}

#[test]
fn swift_meeting_reminders_decode() {
    // `meetingReminders` in the 1.14.x state.json: occurrence id → end, seconds since 2001.
    let end = add_secs(now(), 1800.0);
    let json = format!(r#"{{"occurrence":{}}}"#, swift(end));
    let mut engine: MeetingSuggestionEngine = serde_json::from_str(&json).unwrap();
    assert_eq!(engine.seen().get("occurrence"), Some(&end));
    assert!(engine.due(&[meeting("occurrence", 0.0)], now()).is_empty());
    let written = serde_json::to_value(&engine).unwrap();
    assert!(written["occurrence"].is_string(), "writes RFC 3339: {written}");
    assert_eq!(serde_json::from_value::<MeetingSuggestionEngine>(written).unwrap(), engine);
}

#[test]
fn swift_meeting_preferences_decode() {
    let swift_json = r#"{"enabled":false,"defaultTicket":"33984","activityTypeID":"meeting"}"#;
    let preferences: MeetingPreferences = serde_json::from_str(swift_json).unwrap();
    let expected = MeetingPreferences {
        enabled: false,
        default_ticket: "33984".to_string(),
        activity_type_id: "meeting".to_string(),
    };
    assert_eq!(preferences, expected);
    let written = serde_json::to_value(&preferences).unwrap();
    assert_eq!(written["activityTypeId"], "meeting");
    assert_eq!(serde_json::from_value::<MeetingPreferences>(written).unwrap(), expected);
    let defaults: MeetingPreferences = serde_json::from_str("{}").unwrap();
    assert!(defaults.enabled && defaults.default_ticket.is_empty());
}

// MeetingTicketTests

#[test]
fn explicit_title_markers() {
    for title in ["Review #33984", "AB#33984 daily", "Discuss #33984."] {
        assert_eq!(meeting_ticket::extract(title, None, None, "org"), Some(33984), "{title}");
    }
}

#[test]
fn ambiguous_and_unmarked_numbers_require_manual_selection() {
    let titles = [
        "Stand-up 2026-09-29",
        "Review #33984 and #33981",
        "#0",
        "#2147483648",
        "#33.984",
        "Task #999999999999",
    ];
    for title in titles {
        let notes = Some("Meeting ID: 33984");
        assert_eq!(meeting_ticket::extract(title, None, notes, "org"), None, "{title}");
    }
}

#[test]
fn azure_links_use_the_configured_organization() {
    let link = Some("https://dev.azure.com/org/Project/_workitems/edit/33984?view=edit");
    assert_eq!(meeting_ticket::extract("Review", link, None, "ORG"), Some(33984));
    assert_eq!(meeting_ticket::extract("Review", link, None, "another-org"), None);
    let evil = Some("https://dev.azure.com.evil.test/org/_workitems/edit/33984");
    assert_eq!(meeting_ticket::extract("Review", evil, None, "org"), None);
}

#[test]
fn notes_links_and_legacy_azure_hosts() {
    let legacy = Some("See (https://org.visualstudio.com/Project/_workitems/edit/33984).");
    assert_eq!(meeting_ticket::extract("Review", None, legacy, "org"), Some(33984));
    let teams = Some("https://teams.microsoft.com/l/meetup-join/33984");
    assert_eq!(meeting_ticket::extract("Review", None, teams, "org"), None);
}

#[test]
fn conflicting_title_and_url_are_not_guessed() {
    let link = Some("https://dev.azure.com/org/_workitems/edit/33981");
    assert_eq!(meeting_ticket::extract("Review #33984", link, None, "org"), None);
}

#[test]
fn the_same_ticket_named_twice_counts_once() {
    let link = Some("https://dev.azure.com/org/_workitems/edit/33984");
    let notes = Some("Also https://org.visualstudio.com/P/_workitems/edit/33984, thanks");
    assert_eq!(meeting_ticket::extract("Review AB#33984 #33984", link, notes, "org"), Some(33984));
}

#[test]
fn markers_ignore_case_but_need_a_boundary() {
    assert_eq!(meeting_ticket::extract("Fix ab#12", None, None, ""), Some(12));
    for title in ["a#12", "##12", "_#12", "#12.5", "#2147483647x#5"] {
        let expected = (title == "#2147483647x#5").then_some(2_147_483_647);
        assert_eq!(meeting_ticket::extract(title, None, None, ""), expected, "{title}");
    }
}

#[test]
fn work_item_links_need_https_edit_a_positive_id_and_no_user_info() {
    let cases = [
        ("https://user@dev.azure.com/org/_workitems/edit/5", None),
        ("http://dev.azure.com/org/_workitems/edit/5", None),
        ("https://dev.azure.com/org/_workitems/view/5", None),
        ("https://dev.azure.com/org/_workitems/edit/0", None),
        ("https://dev.azure.com/org/_workitems/edit/2147483648", None),
        ("https://dev.azure.com/org/_workitems/edit", None),
        ("https://dev.azure.com:abc/org/_workitems/edit/5", None),
        ("HTTPS://DEV.AZURE.COM/ORG/P/_workitems/edit/5", Some(5)),
        ("https://dev.azure.com:443//org//_workitems/edit/5/", Some(5)),
        ("https://dev.azure.com/my%20org/_workitems/edit/7#comment", Some(7)),
    ];
    for (link, expected) in cases {
        let org = if link.contains("my%20org") { " My Org " } else { "org" };
        assert_eq!(meeting_ticket::extract("Review", Some(link), None, org), expected, "{link}");
    }
}

#[test]
fn links_count_only_with_an_organization() {
    let link = Some("https://dev.azure.com/org/_workitems/edit/5");
    assert_eq!(meeting_ticket::extract("Review", link, None, "  "), None);
    assert_eq!(meeting_ticket::extract("Review #9", link, None, ""), Some(9));
}

// MeetingActivityTests

fn types() -> Vec<ActivityType> {
    vec![
        activity("dev", "Development"),
        activity("meeting", "Overleg"),
        activity("daily", "Stand-up"),
    ]
}

#[test]
fn suggests_meeting_activities_and_honors_explicit_default() {
    let types = types();
    assert_eq!(meeting_activity::suggested_id("Team stand-up", "", &types), Some("daily"));
    assert_eq!(meeting_activity::suggested_id("Daily scrum", "", &types), Some("daily"));
    assert_eq!(meeting_activity::suggested_id("Planning", "", &types), Some("meeting"));
    assert_eq!(meeting_activity::suggested_id("Stand-up", "dev", &types), Some("dev"));
}

#[test]
fn missing_or_removed_activity_requires_user_choice() {
    let types = types();
    assert_eq!(meeting_activity::suggested_id("Planning", "deleted", &types), None);
    assert_eq!(meeting_activity::suggested_id("Planning", "", &types[..1]), None);
}

#[test]
fn activity_names_ignore_case_diacritics_and_punctuation() {
    let types = [activity("call", "Meetings"), activity("talk", "Óverleg!")];
    assert_eq!(meeting_activity::suggested_id("Sync", "", &types), Some("talk"));
    assert_eq!(meeting_activity::suggested_id("Stánd-Up", "", &types[..1]), Some("call"));
}
