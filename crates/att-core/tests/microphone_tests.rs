//! Ported from MicrophoneTests.swift. `legacySlackSettingsMigrateWithoutRequiringIDsOrTokens`
//! and the `Configuration` half of `requestedMeetingAppsAreEnabledByDefault…` wait for
//! `Configuration`.

#[path = "support/context.rs"]
mod support;

use std::collections::BTreeSet;

use att_core::microphone::{
    MicrophoneApp, MicrophoneMeetingEngine, MicrophoneOwner, MicrophonePreferences,
    MicrophoneSession,
};
use att_core::time::add_secs;
use jiff::Timestamp;
use support::at;

fn app() -> MicrophoneOwner {
    MicrophoneOwner::new("com.tinyspeck.slackmacgap", "Slack")
}

fn date() -> Timestamp {
    at(1_000_000.0)
}

fn sample(engine: &mut MicrophoneMeetingEngine, seconds: i64, active: bool) {
    let owners = if active { vec![app()] } else { vec![] };
    engine.sample(Some(&owners), add_secs(date(), seconds as f64));
}

#[test]
fn short_use_does_not_suggest_and_sustained_use_suggests_once() {
    let mut engine = MicrophoneMeetingEngine::new();
    sample(&mut engine, 0, true);
    sample(&mut engine, 2, true);
    assert!(engine.suggestions().is_empty());
    sample(&mut engine, 4, true);
    assert_eq!(engine.suggestions().len(), 1);
    sample(&mut engine, 6, true);
    assert!(engine.suggestions().is_empty());
    assert_eq!(engine.sessions().len(), 1);
}

#[test]
fn short_interruption_does_not_split_meeting() {
    let mut engine = MicrophoneMeetingEngine::new();
    for second in (0..=6).step_by(2) {
        sample(&mut engine, second, true);
    }
    let session = engine.suggestions().into_iter().next().expect("a suggestion");
    for second in (8..=50).step_by(2) {
        sample(&mut engine, second, false);
    }
    sample(&mut engine, 52, true);
    assert!(engine.is_active(&session));
    assert!(engine.ended().is_empty());
    assert!(engine.suggestions().is_empty());
}

#[test]
fn confirmed_absence_ends_episode_and_next_use_is_new() {
    let mut engine = MicrophoneMeetingEngine::new();
    for second in (0..=6).step_by(2) {
        sample(&mut engine, second, true);
    }
    let session = engine.suggestions().into_iter().next().expect("a suggestion");
    for second in (8..=68).step_by(2) {
        sample(&mut engine, second, false);
    }
    assert!(!engine.is_active(&session));
    assert!(engine.ended().contains(&session.id));
    for second in (70..=76).step_by(2) {
        sample(&mut engine, second, true);
    }
    assert_ne!(engine.suggestions().first().map(|s| s.id.clone()), Some(session.id));
    assert_eq!(engine.sessions().len(), 1);
}

#[test]
fn missing_samples_and_sleep_cannot_prove_end() {
    let mut engine = MicrophoneMeetingEngine::new();
    for second in (0..=6).step_by(2) {
        sample(&mut engine, second, true);
    }
    let session = engine.suggestions().into_iter().next().expect("a suggestion");
    for second in (8..=64).step_by(2) {
        sample(&mut engine, second, false);
    }
    engine.sample(None, add_secs(date(), 66.0));
    sample(&mut engine, 68, false);
    sample(&mut engine, 1000, false);
    assert!(engine.is_active(&session));
    assert!(engine.ended().is_empty());
}

#[test]
fn failed_and_interrupted_samples_reset_start_debounce() {
    let mut engine = MicrophoneMeetingEngine::new();
    sample(&mut engine, 0, true);
    engine.sample(None, add_secs(date(), 2.0));
    sample(&mut engine, 4, true);
    assert!(engine.suggestions().is_empty());
    sample(&mut engine, 100, true);
    assert!(engine.suggestions().is_empty());
    sample(&mut engine, 102, true);
    sample(&mut engine, 104, true);
    assert_eq!(engine.suggestions().len(), 1);
}

#[test]
fn multiple_helpers_do_not_produce_duplicate_sessions() {
    let mut engine = MicrophoneMeetingEngine::new();
    engine.sample(Some(&[app(), app()]), date());
    engine.sample(Some(&[app(), app()]), add_secs(date(), 4.0));
    assert_eq!(engine.suggestions().len(), 1);
}

#[test]
fn restored_meeting_waits_for_confirmed_absence_without_repeating_suggestion() {
    let mut engine = MicrophoneMeetingEngine::new();
    let session = MicrophoneSession::new("restored", app(), date());
    engine.restore(session.clone());
    assert!(engine.suggestions().is_empty());
    for second in (0..=58).step_by(2) {
        sample(&mut engine, second, false);
    }
    assert!(engine.is_active(&session));
    sample(&mut engine, 60, false);
    assert!(engine.ended().contains(&session.id));
}

#[test]
fn application_categories_use_boundaries_and_support_browsers() {
    let cases = [
        ("com.microsoft.teams2", MicrophoneApp::Teams),
        ("com.google.Chrome.helper", MicrophoneApp::Browsers),
        ("com.apple.Safari", MicrophoneApp::Browsers),
        ("com.apple.WebKit.GPU", MicrophoneApp::Browsers),
        ("us.zoom.xos", MicrophoneApp::Zoom),
        ("com.tinyspeck.slackmacgap.fake", MicrophoneApp::Slack),
        ("com.microsoft.teamsunexpected", MicrophoneApp::Other),
    ];
    for (id, expected) in cases {
        assert_eq!(MicrophoneApp::classify(id), expected, "{id}");
    }
    assert!(!MicrophonePreferences::new(true).apps.contains(&MicrophoneApp::Other));
}

#[test]
fn requested_meeting_apps_are_enabled_by_default_without_changing_saved_preferences() {
    use MicrophoneApp::{Browsers, Discord, Slack, Teams, Zoom};
    let defaults = MicrophonePreferences::default();
    assert!(defaults.enabled);
    assert_eq!(defaults.apps, BTreeSet::from([Slack, Teams, Zoom, Browsers]));
    assert!(MicrophoneApp::Browsers.label().contains("Google Meet"));
    let old: MicrophonePreferences =
        serde_json::from_str(r#"{"enabled":false,"apps":["Slack","Discord"]}"#).unwrap();
    assert!(!old.enabled);
    assert_eq!(old.apps, BTreeSet::from([Slack, Discord]));
    // Adapted: Swift round-trips through `Configuration`; the preferences round-trip alone.
    let written = serde_json::to_string(&old).unwrap();
    assert_eq!(written, r#"{"enabled":false,"apps":["Slack","Discord"]}"#);
    assert_eq!(serde_json::from_str::<MicrophonePreferences>(&written).unwrap(), old);
}

#[test]
fn swift_microphone_preferences_decode_tolerantly() {
    let swift_json = r#"{"enabled":true,"apps":["Microsoft Teams","Web browsers","FaceTime","Other apps","Webex","Zoom"]}"#;
    let preferences: MicrophonePreferences = serde_json::from_str(swift_json).unwrap();
    use MicrophoneApp::{Browsers, FaceTime, Other, Teams, Webex, Zoom};
    assert_eq!(preferences.apps, BTreeSet::from([Teams, Browsers, FaceTime, Other, Webex, Zoom]));
    // Names this version does not know are skipped; missing keys take the defaults.
    let future: MicrophonePreferences =
        serde_json::from_str(r#"{"enabled":true,"apps":["Slack","Google Meet"]}"#).unwrap();
    assert_eq!(future.apps, BTreeSet::from([MicrophoneApp::Slack]));
    assert_eq!(
        serde_json::from_str::<MicrophonePreferences>("{}").unwrap(),
        MicrophonePreferences::default()
    );
}

#[test]
fn raw_values_and_labels_match_swift() {
    let raws: Vec<&str> = MicrophoneApp::ALL.iter().map(|app| app.raw()).collect();
    assert_eq!(
        raws,
        [
            "Slack",
            "Microsoft Teams",
            "Zoom",
            "Web browsers",
            "Webex",
            "Discord",
            "FaceTime",
            "Other apps"
        ]
    );
    for app in MicrophoneApp::ALL {
        assert_eq!(MicrophoneApp::from_raw(app.raw()), Some(app));
        let expected =
            if app == MicrophoneApp::Browsers { "Google Meet / web browsers" } else { app.raw() };
        assert_eq!(app.label(), expected);
        assert_eq!(serde_json::to_value(app).unwrap(), app.raw());
    }
    assert_eq!(MicrophoneApp::from_raw("slack"), None);
}

#[test]
fn windows_executables_are_classified_by_file_name() {
    use MicrophoneApp::{Browsers, Discord, Other, Slack, Teams, Webex, Zoom};
    let cases = [
        ("slack.exe", Slack),
        ("ms-teams.exe", Teams),
        ("teams.exe", Teams),
        ("msteams.exe", Teams),
        ("zoom.exe", Zoom),
        ("chrome.exe", Browsers),
        ("msedge.exe", Browsers),
        ("firefox.exe", Browsers),
        ("brave.exe", Browsers),
        ("opera.exe", Browsers),
        ("vivaldi.exe", Browsers),
        ("arc.exe", Browsers),
        ("msedgewebview2.exe", Browsers),
        ("webex.exe", Webex),
        ("ciscocollabhost.exe", Webex),
        ("atmgr.exe", Webex),
        ("discord.exe", Discord),
        // Case-insensitive, and a full path classifies by its file name.
        ("Zoom.exe", Zoom),
        ("CiscoCollabHost.EXE", Webex),
        (r"C:\Users\me\AppData\Local\Discord\app-1.0\Discord.exe", Discord),
        ("C:/Program Files/Google/Chrome/Application/chrome.exe", Browsers),
        // Unknown executables and look-alikes stay "Other apps".
        ("notepad.exe", Other),
        ("slack.exe.bak", Other),
        ("myslack.exe", Other),
        ("slack", Other),
    ];
    for (id, expected) in cases {
        assert_eq!(MicrophoneApp::classify(id), expected, "{id}");
        assert_eq!(MicrophoneOwner::new(id, "App").category(), expected, "{id}");
    }
}

#[test]
fn web_view_helpers_are_labelled_and_count_as_browsers() {
    let cases = [
        ("com.apple.WebKit.GPU", Some("WebKit (browser or web view)")),
        ("com.apple.webkit.webcontent", Some("WebKit (browser or web view)")),
        ("com.apple.webkit", None),
        ("msedgewebview2.exe", Some("WebView2 (browser or web view)")),
        (
            r"C:\Program Files (x86)\Microsoft\EdgeWebView\Application\MSEdgeWebView2.exe",
            Some("WebView2 (browser or web view)"),
        ),
        ("msedge.exe", None),
        ("com.google.Chrome", None),
    ];
    for (id, expected) in cases {
        assert_eq!(MicrophoneOwner::web_view_name(id), expected, "{id}");
    }
    assert_eq!(MicrophoneApp::classify("MSEdgeWebView2.exe"), MicrophoneApp::Browsers);
}

#[test]
fn long_sample_gaps_and_clock_changes_restart_both_debounces() {
    let mut engine = MicrophoneMeetingEngine::new();
    sample(&mut engine, 0, true);
    sample(&mut engine, 2, true);
    // An 11 s gap restarts the start debounce at 13 s.
    sample(&mut engine, 13, true);
    sample(&mut engine, 15, true);
    assert!(engine.sessions().is_empty());
    sample(&mut engine, 17, true);
    let session = engine.suggestions().into_iter().next().expect("a suggestion");
    assert_eq!(session.started, add_secs(date(), 13.0));
    // Absence restarts too: after 50 s absent the clock steps back to 60 s, so 58 s more absent
    // is not enough and 60 s is.
    for second in (19..=69).step_by(2) {
        sample(&mut engine, second, false);
    }
    sample(&mut engine, 60, false);
    for second in (62..=118).step_by(2) {
        sample(&mut engine, second, false);
    }
    assert!(engine.is_active(&session));
    sample(&mut engine, 120, false);
    assert!(engine.ended().contains(&session.id));
}

#[test]
fn ended_sessions_are_trimmed_to_the_greatest_hundred_ids() {
    let owners: Vec<MicrophoneOwner> =
        (0..201).map(|i| MicrophoneOwner::new(format!("app{i}"), "App")).collect();
    let mut engine = MicrophoneMeetingEngine::new();
    engine.sample(Some(&owners), date());
    engine.sample(Some(&owners), add_secs(date(), 4.0));
    let mut ids: Vec<String> = engine.sessions().values().map(|s| s.id.clone()).collect();
    assert_eq!(ids.len(), 201);
    for id in &ids {
        // Swift `UUID().uuidString`.
        assert!(uuid::Uuid::parse_str(id).is_ok() && *id == id.to_uppercase(), "{id}");
    }
    for second in (6..=66).step_by(2) {
        engine.sample(Some(&[]), add_secs(date(), second as f64));
    }
    ids.sort();
    let expected: BTreeSet<String> = ids[101..].iter().cloned().collect();
    assert_eq!(engine.ended(), &expected);
    assert!(engine.sessions().is_empty());
}
