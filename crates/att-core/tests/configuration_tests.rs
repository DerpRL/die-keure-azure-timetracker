//! `Configuration` tests: the Swift cases that decode whole settings (deferred from the module
//! ports until the type existed) and the 2.0 settings.

use std::collections::BTreeSet;

use att_core::config::{
    Cadences, Configuration, Interruption, PromptKind, QuietHours, SevenPaceAuthMode,
};
use att_core::interface_prefs::{
    InterfaceContrast, InterfacePreferences, InterfaceScale, InterfaceTheme,
};
use att_core::microphone::{MicrophoneApp, MicrophonePreferences};
use att_core::model::Repository;

fn round_trip(config: &Configuration) -> Configuration {
    serde_json::from_str(&serde_json::to_string(config).unwrap()).unwrap()
}

/// MeetingAndStatusTests › MeetingSuggestionTests › oldSettingsStillDecode (exact Swift JSON).
#[test]
fn old_settings_still_decode() {
    let old = r#"{"organization":"org","project":"","sevenPaceURL":"","repositories":[],"branchPattern":"([0-9]+)","autoStartWhenIdle":false,"notificationsEnabled":true,"watchEnabled":true,"calendarEnabled":true,"selectedCalendarIDs":[],"activityTypeID":"dev","pollSeconds":60}"#;
    let mut settings: Configuration = serde_json::from_str(old).unwrap();
    assert!(settings.meetings.enabled);
    assert!(settings.meetings.default_ticket.is_empty());
    settings.meetings.default_ticket = "33984".into();
    let restored = round_trip(&settings);
    assert_eq!(restored.meetings.default_ticket, "33984");
    assert_eq!(restored.activity_type_id, "dev");
    assert_eq!(restored.branch_pattern, "([0-9]+)");
    assert!(restored.calendar_enabled);
}

/// MicrophoneTests › legacySlackSettingsMigrateWithoutRequiringIDsOrTokens.
#[test]
fn legacy_slack_settings_migrate_without_requiring_ids_or_tokens() {
    let old = r#"{"organization":"org","slackHuddles":{"enabled":true,"workspaceID":"","channels":[],"onlyWhenJoined":true}}"#;
    let mut decoded: Configuration = serde_json::from_str(old).unwrap();
    assert!(decoded.microphone.enabled);
    decoded.microphone =
        MicrophonePreferences { enabled: false, ..MicrophonePreferences::default() };
    assert!(!round_trip(&decoded).microphone.enabled);
    assert!(Configuration::default().microphone.enabled);
    let written = serde_json::to_value(&decoded).unwrap();
    assert!(written.get("slackHuddles").is_none(), "dead Slack settings are not written");
}

/// MicrophoneTests › requestedMeetingAppsAreEnabledByDefaultWithoutChangingSavedPreferences
/// (the Configuration half).
#[test]
fn saved_microphone_preferences_survive_a_round_trip() {
    let old: MicrophonePreferences =
        serde_json::from_str(r#"{"enabled":false,"apps":["Slack","Discord"]}"#).unwrap();
    let expected: BTreeSet<_> = [MicrophoneApp::Slack, MicrophoneApp::Discord].into();
    assert!(!old.enabled && old.apps == expected);
    let settings = Configuration { microphone: old.clone(), ..Configuration::default() };
    assert_eq!(round_trip(&settings).microphone, old);
}

/// TicketCompletionTests › defaultsAndExplicitOptOutRoundTrip.
#[test]
fn completion_reminders_default_on_and_opt_out_round_trips() {
    assert!(Configuration::default().completion_reminders);
    let config = Configuration { completion_reminders: false, ..Configuration::default() };
    assert!(!round_trip(&config).completion_reminders);
    let legacy: Configuration =
        serde_json::from_str(r#"{"ticketCompletionReminders":false}"#).unwrap();
    assert!(!legacy.completion_reminders, "1.14.x key");
}

/// WorkAwarenessTests › oldConfigurationDecodesDefaults.
#[test]
fn old_configuration_decodes_awareness_defaults() {
    let config = round_trip(&Configuration::default());
    assert_eq!((config.awareness.idle_minutes, config.awareness.forgotten_minutes), (5, 10));
    if cfg!(target_os = "macos") {
        assert!(config.awareness.watches(Some("com.microsoft.VSCode")));
        assert!(!config.awareness.watches(Some("com.apple.Safari")));
    }
}

/// InterfacePreferencesTests › oldConfigurationsKeepAccountsAndUseSystemDefaults.
#[test]
fn old_configurations_keep_accounts_and_use_system_defaults() {
    let original = Configuration {
        organization: "example".into(),
        project: "Project".into(),
        repositories: vec![Repository::new("/example/repository")],
        automatic_update_checks: false,
        ..Configuration::default()
    };
    let restored = round_trip(&original);
    assert_eq!(restored.interface, InterfacePreferences::default());
    assert_eq!(restored.organization, original.organization);
    assert_eq!(restored.repositories, original.repositories);
    assert!(!restored.automatic_update_checks);
    assert!(!InterfacePreferences::needs_onboarding(true, restored.interface_setup_completed));
}

/// InterfacePreferencesTests › preferencesAndCompletionSurviveRestart (every scale).
#[test]
fn preferences_and_completion_survive_restart() {
    for scale in InterfaceScale::ALL {
        let preferences = InterfacePreferences {
            theme: InterfaceTheme::Dark,
            scale,
            contrast: InterfaceContrast::Increased,
        };
        let original = Configuration {
            interface: preferences,
            interface_setup_completed: Some(true),
            ..Configuration::default()
        };
        let restored = round_trip(&original);
        assert_eq!(restored.interface, preferences, "{scale:?}");
        assert_eq!(restored.interface_setup_completed, Some(true));
        assert!((0.9..=1.5).contains(&restored.interface.scale.factor()));
    }
}

/// The 1.14.x keys decode into the 2.0 fields.
#[test]
fn swift_keys_decode_into_readable_fields() {
    let swift = r#"{
        "sevenPaceURL": "https://org.timehub.7pace.com",
        "sevenPaceAuthMode": "mobilePIN",
        "selectedCalendarIDs": ["work"],
        "activityTypeID": "dev",
        "figmaDetection": {"enabled": true, "dismissalMinutes": 30, "historyDays": 10},
        "interfacePreferences": {"theme": "dark", "scale": 125, "contrast": "standard"},
        "interfaceSetupCompleted": true,
        "microphoneMeetings": {"enabled": false, "apps": ["Zoom"]},
        "meetingSuggestions": {"enabled": false, "defaultTicket": "42", "activityTypeID": "meet"},
        "automaticUpdateChecks": false,
        "quickSwitchEnabled": false,
        "workAwareness": {"idleEnabled": false, "idleMinutes": 7}
    }"#;
    let config: Configuration = serde_json::from_str(swift).unwrap();
    assert_eq!(config.seven_pace_url, "https://org.timehub.7pace.com");
    assert_eq!(config.seven_pace_auth_mode, SevenPaceAuthMode::MobilePin);
    assert_eq!(config.selected_calendar_ids, ["work"]);
    assert_eq!(config.activity_type_id, "dev");
    assert!(config.figma.enabled);
    assert_eq!(config.interface.theme, InterfaceTheme::Dark);
    assert_eq!(config.interface_setup_completed, Some(true));
    assert!(!config.microphone.enabled);
    assert_eq!(config.meetings.default_ticket, "42");
    assert!(!config.automatic_update_checks && !config.quick_switch_enabled);
    assert_eq!(config.awareness.idle_minutes, 7);

    let written = serde_json::to_value(&config).unwrap();
    assert_eq!(written["sevenPaceUrl"], "https://org.timehub.7pace.com");
    assert_eq!(written["sevenPaceAuthMode"], "mobilePIN", "raw value kept");
    assert!(written.get("figma").is_some() && written.get("figmaDetection").is_none());
    assert_eq!(round_trip(&config), config);
}

/// An empty or partial document never fails, and keeps the 1.14.x defaults.
#[test]
fn missing_keys_use_defaults() {
    let config: Configuration = serde_json::from_str("{}").unwrap();
    assert_eq!(config, Configuration::default());
    assert_eq!(config.seven_pace_auth_mode, SevenPaceAuthMode::ApiToken);
    assert!(config.quick_switch_enabled && config.notifications_enabled && config.watch_enabled);
    assert!(!config.calendar_enabled && !config.auto_start_when_idle);
    assert_eq!(config.poll_seconds, 60);
    assert_eq!(config.branch_pattern, att_core::git::DEFAULT_BRANCH_PATTERN);
    assert!(config.validate().is_ok());
}

#[test]
fn interruptions_default_to_opening_the_panel_without_focus() {
    let mut config = Configuration::default();
    for kind in PromptKind::ALL {
        assert_eq!(config.interruption(kind), Interruption::OpenPanel, "{kind:?}");
    }
    config.interruptions.insert(PromptKind::Branch, Interruption::OpenAndFocus);
    config.interruptions.insert(PromptKind::Figma, Interruption::Off);
    let restored = round_trip(&config);
    assert_eq!(restored.interruption(PromptKind::Branch), Interruption::OpenAndFocus);
    assert_eq!(restored.interruption(PromptKind::Figma), Interruption::Off);
    let json = serde_json::to_value(&config).unwrap();
    assert_eq!(json["interruptions"]["branch"], "openAndFocus");
}

#[test]
fn quiet_hours_wrap_past_midnight() {
    let quiet = QuietHours { enabled: true, start_minute: 18 * 60, end_minute: 8 * 60 };
    assert!(quiet.contains(23 * 60) && quiet.contains(0) && quiet.contains(7 * 60 + 59));
    assert!(!quiet.contains(8 * 60) && !quiet.contains(12 * 60));
    let day = QuietHours { enabled: true, start_minute: 12 * 60, end_minute: 13 * 60 };
    assert!(day.contains(12 * 60 + 30) && !day.contains(13 * 60));
    assert!(!QuietHours { enabled: false, ..quiet }.contains(23 * 60));
}

#[test]
fn validation_messages_match_settings() {
    let mut config = Configuration::default();
    config.meetings.default_ticket = "abc".into();
    assert_eq!(
        config.validate().unwrap_err().to_string(),
        "Enter a valid default meeting ticket number, or leave it empty."
    );
    config.meetings.default_ticket = " 33984 ".into();
    assert!(config.validate().is_ok());
    config.branch_pattern = "feature/[0-9]+".into();
    assert!(config.validate().is_err(), "a pattern needs a capture group");
    config.branch_pattern = att_core::git::DEFAULT_BRANCH_PATTERN.into();
    config.awareness.idle_minutes = 0;
    assert_eq!(
        config.validate().unwrap_err().to_string(),
        "Choose idle and forgotten-timer thresholds between 1 and 120 minutes."
    );
    config.awareness.idle_minutes = 5;
    config.cadences = Cadences { probe_seconds: 0, ..Cadences::default() };
    assert!(config.validate().is_err());
    config.cadences = Cadences::default();
    config.quiet_hours = QuietHours { enabled: true, start_minute: 24 * 60, end_minute: 0 };
    assert!(config.validate().is_err());
}
