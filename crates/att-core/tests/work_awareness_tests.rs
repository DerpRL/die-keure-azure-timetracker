//! Ported from WorkAwarenessTests.swift, with the zone pinned to Europe/Brussels.
//! `oldConfigurationDecodesDefaults` is adapted: it round-trips the preferences, not the whole
//! `Configuration`.

#[path = "support/context.rs"]
mod support;

use att_core::Cal;
use att_core::awareness::{
    ForgottenDeferral, ForgottenTimerMonitor, IdleMonitor, IdleObservation, IdleTrackingSession,
    WorkAwarenessLedger, WorkAwarenessPreferences,
};
use att_core::model::{HostOs, TrackingState};
use att_core::time::add_secs;
use jiff::Timestamp;
use serde_json::json;
use support::{local, swift};

fn now() -> Timestamp {
    local("2026-09-28T10:00:00")
}

fn after(seconds: f64) -> Timestamp {
    add_secs(now(), seconds)
}

fn cal() -> Cal {
    Cal::brussels()
}

fn mac() -> WorkAwarenessPreferences {
    WorkAwarenessPreferences::default_for(HostOs::Macos)
}

fn session(id: &str) -> IdleTrackingSession {
    let state: TrackingState = serde_json::from_value(json!({"track": {
        "trackingState": "tracking", "workLogId": id, "tfsId": 123,
        "currentTrackStartedDateTime": "2026-09-28T09:00:00"
    }}))
    .unwrap();
    IdleTrackingSession::from_state(Some(&state), None, &cal()).expect("a session")
}

/// An unlocked sample without a meeting; override fields with `..idle(…)`.
fn idle<'a>(
    now: Timestamp,
    idle_seconds: f64,
    session: &'a IdleTrackingSession,
    preferences: &'a WorkAwarenessPreferences,
) -> IdleObservation<'a> {
    IdleObservation {
        now,
        idle_seconds,
        unavailable_since: None,
        reason: "",
        session: Some(session),
        preferences,
        meeting: false,
    }
}

#[test]
fn inactivity_uses_last_input_and_prompts_only_on_return() {
    let mut monitor = IdleMonitor::new();
    let (session, prefs) = (session("one"), mac());
    monitor.observe(&idle(now(), 299.0, &session, &prefs));
    assert!(monitor.away().is_none());
    monitor.observe(&idle(now(), 600.0, &session, &prefs));
    assert_eq!(monitor.away().map(|away| away.start), Some(after(-600.0)));
    assert!(monitor.pending().is_none());
    monitor.observe(&idle(after(60.0), 2.0, &session, &prefs));
    assert_eq!(monitor.pending().map(|p| p.seconds()), Some(658.0));
    assert!(monitor.away().is_none());
    let prompt = monitor.pending().cloned();
    monitor.observe(&idle(after(62.0), 1.0, &session, &prefs));
    assert_eq!(monitor.pending().cloned(), prompt);
    monitor.dismiss();
    assert!(monitor.pending().is_none());
}

#[test]
fn lock_prompts_even_below_idle_threshold_and_does_not_end_until_unlocked() {
    let mut monitor = IdleMonitor::new();
    let mut prefs = mac();
    prefs.idle_enabled = false;
    let session = session("one");
    let locked = |at: Timestamp| IdleObservation {
        unavailable_since: Some(now()),
        reason: "Screen locked",
        meeting: true,
        ..idle(at, 0.0, &session, &prefs)
    };
    monitor.observe(&locked(now()));
    monitor.observe(&locked(after(10.0)));
    assert!(monitor.pending().is_none());
    monitor.observe(&IdleObservation { meeting: true, ..idle(after(12.0), 0.0, &session, &prefs) });
    let pending = monitor.pending().expect("a prompt");
    assert_eq!((pending.seconds(), pending.reason.as_str()), (12.0, "Screen locked"));
}

#[test]
fn meeting_suppresses_passive_idle_and_disabled_features_clear_evidence() {
    let mut monitor = IdleMonitor::new();
    let (session, mut prefs) = (session("one"), mac());
    monitor.observe(&IdleObservation { meeting: true, ..idle(now(), 600.0, &session, &prefs) });
    assert!(monitor.away().is_none());
    monitor.observe(&idle(now(), 600.0, &session, &prefs));
    assert!(monitor.away().is_some());
    prefs.idle_enabled = false;
    prefs.lock_enabled = false;
    monitor.observe(&idle(now(), 0.0, &session, &prefs));
    assert!(monitor.away().is_none() && monitor.pending().is_none());
}

#[test]
fn changed_timer_discards_idle_evidence_and_start_is_clamped() {
    let mut monitor = IdleMonitor::new();
    let (original, other, prefs) = (session("one"), session("other"), mac());
    monitor.observe(&idle(now(), 10_000.0, &original, &prefs));
    assert_eq!(monitor.away().map(|away| away.start), Some(original.start));
    monitor.reconcile(Some(&other));
    assert!(monitor.away().is_none());
}

#[test]
fn pending_and_sleep_evidence_survive_restart_but_workspace_changes_clear_it() {
    let mut ledger = WorkAwarenessLedger::default();
    ledger.scope("first");
    let (session, prefs) = (session("one"), mac());
    ledger.idle.observe(&IdleObservation {
        unavailable_since: Some(now()),
        reason: "Sleep",
        ..idle(now(), 0.0, &session, &prefs)
    });
    let mut restored: WorkAwarenessLedger =
        serde_json::from_str(&serde_json::to_string(&ledger).unwrap()).unwrap();
    assert_eq!(restored, ledger);
    restored.idle.observe(&idle(after(3600.0), 1.0, &session, &prefs));
    assert_eq!(restored.idle.pending().map(|p| p.seconds()), Some(3599.0));
    restored.scope("second");
    assert!(restored.idle.pending().is_none());
    assert_eq!(restored.workspace, "second");
}

#[test]
fn forgotten_requires_continuous_eligible_work_and_resets_for_inactivity() {
    let mut monitor = ForgottenTimerMonitor::new();
    let deferral = ForgottenDeferral::default();
    for i in (0..=60).step_by(2) {
        monitor.observe(after(f64::from(i)), true, "Editor", 1, &deferral, &cal());
    }
    assert_eq!(monitor.pending().map(|p| p.app_name.as_str()), Some("Editor"));
    assert_eq!(monitor.pending().map(|p| p.since), Some(now()));
    monitor.observe(after(62.0), false, "Editor", 1, &deferral, &cal());
    assert!(monitor.pending().is_none());
}

#[test]
fn sleep_and_clock_changes_do_not_count_as_work() {
    let mut monitor = ForgottenTimerMonitor::new();
    for offset in [0.0, 3600.0, -3600.0] {
        monitor.observe(after(offset), true, "Editor", 1, &ForgottenDeferral::default(), &cal());
        assert!(monitor.pending().is_none(), "{offset}");
    }
}

#[test]
fn snooze_ignore_today_and_next_day_use_local_calendar() {
    let cal = cal();
    let mut deferral = ForgottenDeferral { until: Some(after(900.0)), ignored_day: None };
    assert!(deferral.suppresses(now(), &cal));
    assert!(!deferral.suppresses(after(901.0), &cal));
    deferral.ignored_day = Some(now());
    assert!(deferral.suppresses(after(3600.0), &cal));
    assert!(!deferral.suppresses(cal.add_days(now(), 1), &cal));
}

#[test]
fn missing_start_uses_confirmed_duration_without_extrapolating() {
    let tracking: TrackingState = serde_json::from_str(
        r#"{"track":{"trackingState":"tracking","workLogId":"one","currentTrackLength":600}}"#,
    )
    .unwrap();
    assert_eq!(IdleTrackingSession::from_state(Some(&tracking), None, &cal()), None);
    let confirmed = IdleTrackingSession::from_state(Some(&tracking), Some(now()), &cal());
    assert_eq!(confirmed.map(|s| s.start), Some(after(-600.0)));
    let no_id: TrackingState =
        serde_json::from_str(r#"{"track":{"trackingState":"tracking","currentTrackLength":600}}"#)
            .unwrap();
    assert_eq!(IdleTrackingSession::from_state(Some(&no_id), Some(now()), &cal()), None);
}

#[test]
fn old_configuration_decodes_defaults() {
    let data = serde_json::to_string(&mac()).unwrap();
    let awareness: WorkAwarenessPreferences = serde_json::from_str(&data).unwrap();
    assert!(awareness.idle_minutes == 5 && awareness.forgotten_minutes == 10);
    assert!(awareness.watches(Some("com.microsoft.VSCode")));
    assert!(!awareness.watches(Some("com.apple.Safari")));
}

#[test]
fn sessions_need_a_running_timer_with_a_worklog_and_a_bounded_length() {
    let decode = |track: serde_json::Value| -> TrackingState {
        serde_json::from_value(json!({ "track": track })).unwrap()
    };
    let started = decode(json!({"trackingState": "tracking", "workLogId": "w", "tfsId": 7,
        "remark": "Planning", "currentTrackStartedDateTime": "2026-09-28T07:00:00Z"}));
    let session = IdleTrackingSession::from_state(Some(&started), None, &cal()).unwrap();
    assert_eq!(session.identity, "w|7|2026-09-28T07:00:00Z");
    assert_eq!((session.work_log_id.as_str(), session.title.as_str()), ("w", "Planning"));
    assert_eq!(session.start, local("2026-09-28T09:00:00"));
    let cases = [
        json!({"trackingState": "idle", "workLogId": "w", "currentTrackLength": 5}),
        json!({"trackingState": "tracking", "workLogId": "  ", "currentTrackLength": 5}),
        json!({"trackingState": "tracking", "workLogId": "w", "currentTrackLength": -1}),
        json!({"trackingState": "tracking", "workLogId": "w", "currentTrackLength": 2_147_483_648.0}),
        // An unreadable start falls back to the confirmed length, which is missing here.
        json!({"trackingState": "tracking", "workLogId": "w", "currentTrackStartedDateTime": "soon"}),
    ];
    for track in cases {
        let state = decode(track.clone());
        assert_eq!(
            IdleTrackingSession::from_state(Some(&state), Some(now()), &cal()),
            None,
            "{track}"
        );
    }
    assert_eq!(IdleTrackingSession::from_state(None, Some(now()), &cal()), None);
}

#[test]
fn thresholds_bound_idle_detection_and_return() {
    let session = session("one");
    let mut prefs = mac();
    for (minutes, valid) in [(0, false), (1, true), (120, true), (121, false)] {
        prefs.idle_minutes = minutes;
        assert_eq!(prefs.is_valid(), valid, "idle {minutes}");
    }
    prefs.idle_minutes = 5;
    prefs.forgotten_minutes = 121;
    let mut monitor = IdleMonitor::new();
    monitor.observe(&idle(now(), 600.0, &session, &prefs));
    assert!(monitor.away().is_none(), "invalid preferences detect nothing");
    prefs.forgotten_minutes = 10;
    prefs.idle_minutes = 2;
    monitor.observe(&idle(now(), 119.0, &session, &prefs));
    assert!(monitor.away().is_none());
    monitor.observe(&idle(now(), 120.0, &session, &prefs));
    assert!(monitor.away().is_some());
    // Unreadable idle time keeps the evidence; 30 s idle is not a return yet.
    monitor.observe(&idle(after(10.0), f64::NAN, &session, &prefs));
    monitor.observe(&idle(after(10.0), -1.0, &session, &prefs));
    monitor.observe(&idle(after(40.0), 30.0, &session, &prefs));
    assert!(monitor.away().is_some() && monitor.pending().is_none());
    monitor.observe(&idle(after(41.0), 29.0, &session, &prefs));
    assert_eq!(monitor.pending().map(|p| p.seconds()), Some(132.0));
}

#[test]
fn absences_shorter_than_a_second_are_dropped() {
    let session = session("one");
    let prefs = mac();
    let mut monitor = IdleMonitor::new();
    let lock = IdleObservation {
        unavailable_since: Some(after(-0.5)),
        reason: "Screen locked",
        ..idle(now(), 0.0, &session, &prefs)
    };
    monitor.observe(&lock);
    monitor.observe(&idle(now(), 0.0, &session, &prefs));
    assert!(monitor.away().is_none() && monitor.pending().is_none());
}

#[test]
fn forgotten_timer_respects_minutes_bounds_and_deferral() {
    let mut monitor = ForgottenTimerMonitor::new();
    for minutes in [0, 121] {
        monitor.observe(now(), true, "Editor", minutes, &ForgottenDeferral::default(), &cal());
        monitor.observe(after(1.0), true, "Editor", minutes, &ForgottenDeferral::default(), &cal());
        assert!(monitor.pending().is_none(), "{minutes}");
    }
    let snoozed = ForgottenDeferral { until: Some(after(120.0)), ignored_day: None };
    for i in (0..=120).step_by(2) {
        monitor.observe(after(f64::from(i)), true, "Editor", 1, &snoozed, &cal());
    }
    assert!(monitor.pending().is_none());
    // The snooze ended at 120 s. A 16 s gap restarts the count (at 153 s); 15 s gaps do not.
    let steps = [
        (122.0, false),
        (137.0, false),
        (153.0, false),
        (168.0, false),
        (183.0, false),
        (198.0, false),
        (213.0, true),
    ];
    for (offset, pending) in steps {
        monitor.observe(after(offset), true, "Editor", 1, &snoozed, &cal());
        assert_eq!(monitor.pending().is_some(), pending, "{offset}");
    }
}

#[test]
fn work_apps_default_per_operating_system() {
    let mac = WorkAwarenessPreferences::default_for(HostOs::Macos);
    assert_eq!(
        mac.work_app_ids,
        [
            "com.microsoft.VSCode",
            "com.apple.Terminal",
            "com.googlecode.iterm2",
            "com.todesktop.230313mzl4w4u92",
            "com.openai.codex",
            "com.apple.dt.Xcode",
        ]
    );
    let windows = WorkAwarenessPreferences::default_for(HostOs::Windows);
    assert_eq!(
        windows.work_app_ids,
        [
            "code.exe",
            "cursor.exe",
            "windowsterminal.exe",
            "pwsh.exe",
            "powershell.exe",
            "devenv.exe"
        ]
    );
    assert!(WorkAwarenessPreferences::default_for(HostOs::Other).work_app_ids.is_empty());
    for preferences in [&mac, &windows] {
        assert!(
            preferences.idle_enabled && preferences.lock_enabled && preferences.forgotten_enabled
        );
        assert_eq!((preferences.idle_minutes, preferences.forgotten_minutes), (5, 10));
        assert!(preferences.is_valid());
    }
    assert_eq!(
        WorkAwarenessPreferences::default(),
        WorkAwarenessPreferences::default_for(HostOs::current())
    );
}

#[test]
fn windows_work_apps_match_executable_names_ignoring_case() {
    let windows = WorkAwarenessPreferences::default_for(HostOs::Windows);
    for id in [
        "code.exe",
        "Code.exe",
        r"C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe",
        "WindowsTerminal.exe",
        "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    ] {
        assert!(windows.watches(Some(id)), "{id}");
    }
    for id in ["notepad.exe", "code", "com.microsoft.VSCode", "code.exe.lnk"] {
        assert!(!windows.watches(Some(id)), "{id}");
    }
    assert!(!windows.watches(None));
    // Bundle IDs keep the exact 1.14.2 match.
    let mac = WorkAwarenessPreferences::default_for(HostOs::Macos);
    assert!(mac.watches(Some("com.apple.dt.Xcode")));
    assert!(!mac.watches(Some("com.apple.dt.xcode")) && !mac.watches(Some("code.exe")));
}

#[test]
fn swift_work_awareness_preferences_keep_the_stored_apps() {
    let swift_json = r#"{"idleEnabled":false,"lockEnabled":true,"idleMinutes":15,"forgottenEnabled":false,"forgottenMinutes":30,"workAppIDs":["com.custom.Editor"]}"#;
    let preferences: WorkAwarenessPreferences = serde_json::from_str(swift_json).unwrap();
    assert!(
        !preferences.idle_enabled && preferences.lock_enabled && !preferences.forgotten_enabled
    );
    assert_eq!((preferences.idle_minutes, preferences.forgotten_minutes), (15, 30));
    assert_eq!(preferences.work_app_ids, ["com.custom.Editor"]);
    let written = serde_json::to_value(&preferences).unwrap();
    assert_eq!(written["workAppIds"], json!(["com.custom.Editor"]));
    assert_eq!(serde_json::from_value::<WorkAwarenessPreferences>(written).unwrap(), preferences);
    // A missing list takes this system's defaults; the rest keep what was stored.
    let partial: WorkAwarenessPreferences = serde_json::from_str(r#"{"idleMinutes":7}"#).unwrap();
    assert_eq!(partial.idle_minutes, 7);
    assert_eq!(partial.work_app_ids, WorkAwarenessPreferences::default().work_app_ids);
}

#[test]
fn swift_work_awareness_ledger_decodes() {
    let session_json = r#"{"identity":"one|123|2026-09-28T09:00:00","workLogID":"one","title":"Work item #123","start":START}"#;
    let json = r#"{"workspace":"org|https://org.timehub.7pace.com/",
        "idle":{"away":{"id":"6B2E0E1A-6F0C-4B8B-9E1D-2B7C1F0A9D11","session":SESSION,"start":AWAY,"reason":"Screen locked"},
                "pending":{"id":"7C3F1F2B-7A1D-4C9C-8F2E-3C8D2A1B0E22","session":SESSION,"start":START,"end":AWAY,"reason":"Sleep"}},
        "correction":{"id":"7C3F1F2B-7A1D-4C9C-8F2E-3C8D2A1B0E22","session":SESSION,"start":START,"end":AWAY,"reason":"Sleep"},
        "deferral":{"until":UNTIL,"ignoredDay":AWAY}}"#
        .replace("SESSION", session_json)
        .replace("START", &swift(local("2026-09-28T09:00:00")).to_string())
        .replace("AWAY", &swift(now()).to_string())
        .replace("UNTIL", &swift(after(900.0)).to_string());
    let ledger: WorkAwarenessLedger = serde_json::from_str(&json).unwrap();
    assert_eq!(ledger.workspace, "org|https://org.timehub.7pace.com/");
    let away = ledger.idle.away().expect("an open absence");
    assert_eq!((away.start, away.end, away.reason.as_str()), (now(), None, "Screen locked"));
    assert_eq!(away.session.work_log_id, "one");
    let pending = ledger.idle.pending().expect("a pending period");
    assert_eq!(pending.seconds(), 3600.0);
    assert_eq!(pending.id.to_string(), "7c3f1f2b-7a1d-4c9c-8f2e-3c8d2a1b0e22");
    assert_eq!(ledger.correction.as_ref(), Some(pending));
    assert_eq!(ledger.deferral.until, Some(after(900.0)));
    assert!(ledger.deferral.suppresses(after(3600.0), &cal()));
    // Swift's session identity still matches a fresh session for the same timer.
    let mut idle_monitor = ledger.idle.clone();
    idle_monitor.reconcile(Some(&session("one")));
    assert!(idle_monitor.pending().is_some());
    let written = serde_json::to_value(&ledger).unwrap();
    assert_eq!(written["idle"]["pending"]["session"]["workLogId"], "one");
    assert!(written["idle"]["away"].get("end").is_none());
    assert_eq!(serde_json::from_value::<WorkAwarenessLedger>(written).unwrap(), ledger);
    let empty: WorkAwarenessLedger =
        serde_json::from_str(r#"{"workspace":"","idle":{},"deferral":{}}"#).unwrap();
    assert_eq!(empty, WorkAwarenessLedger::default());
}
