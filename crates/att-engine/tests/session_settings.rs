//! Settings: validation, secrets under the 1.14.x accounts, settings applied immediately,
//! interruption levels and quiet hours, onboarding and PIN pairing.

mod support;

use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};

use att_core::Configuration;
use att_core::config::SevenPaceAuthMode;
use att_core::model::Repository;
use att_net::SevenPacePinStatus;
use support::*;

fn credential(h: &Harness, account: &str) -> Option<String> {
    h.t.credentials.0.lock().unwrap().get(account).cloned()
}

async fn save(h: &Harness, config: &Configuration, pat: &str, token: &str) {
    h.ok(json!({"type": "settings.save", "configuration": config, "azurePat": pat, "sevenPaceToken": token})).await;
}

#[tokio::test]
async fn settings_are_validated_before_anything_is_stored() {
    let h = Harness::new(configuration(vec![]));
    h.start().await;
    type Change = Box<dyn Fn(&mut Configuration)>;
    let cases: Vec<(Change, &str)> = vec![
        (
            Box::new(|c| c.awareness.idle_minutes = 0),
            "Choose idle and forgotten-timer thresholds between 1 and 120 minutes.",
        ),
        (
            Box::new(|c| c.meetings.default_ticket = "abc".into()),
            "Enter a valid default meeting ticket number, or leave it empty.",
        ),
        (Box::new(|c| c.branch_pattern = "([0-9]+".into()), "The value “([0-9]+” is invalid."),
        (
            Box::new(|c| c.seven_pace_url = "http://contoso.timehub.7pace.com".into()),
            "Use your 7pace workspace URL: https://your-organization.timehub.7pace.com",
        ),
        (
            Box::new(|c| c.organization = "con toso".into()),
            "Enter the organization name from dev.azure.com/your-organization.",
        ),
    ];
    for (change, message) in cases {
        let mut draft = configuration(vec![]);
        change(&mut draft);
        save(&h, &draft, "pat-123", "token-123").await;
        assert_eq!(h.slice("app")["error"], message);
        assert!(h.t.credentials.0.lock().unwrap().is_empty(), "{message}: nothing stored");
        assert_eq!(h.slice("settings")["savedAt"], Value::Null);
    }
}

#[tokio::test]
async fn non_blank_secrets_are_stored_under_the_1_14_accounts_then_it_reconnects() {
    let h = Harness::new(configuration(vec![]));
    h.start().await;
    h.seven_pace.take_calls();
    let mut draft = configuration(vec![]);
    draft.organization = "Contoso".into();
    save(&h, &draft, "  pat-123 \n", "token-123").await;
    assert_eq!(credential(&h, "azure:contoso").as_deref(), Some("pat-123"));
    assert_eq!(credential(&h, &format!("7pace:{HOST}")).as_deref(), Some("token-123"));
    assert_ne!(h.slice("settings")["savedAt"], Value::Null);
    assert_eq!(h.seven_pace.take_calls()[0], "current", "reconnected");

    // Blank secrets keep the stored ones; Mobile PIN never stores an API token.
    let mut draft = configuration(vec![]);
    draft.seven_pace_auth_mode = SevenPaceAuthMode::MobilePin;
    save(&h, &draft, "  ", "other-token").await;
    assert_eq!(credential(&h, "azure:contoso").as_deref(), Some("pat-123"));
    assert_eq!(credential(&h, &format!("7pace:{HOST}")).as_deref(), Some("token-123"));
}

#[tokio::test]
async fn settings_applied_immediately_survive_an_older_draft() {
    let dir = TempDir::new();
    let repository = Repository::new(dir.repository("webshop", "main").to_string_lossy());
    let h = Harness::new(configuration(vec![repository.clone()]));
    h.start().await;
    let old_draft = configuration(vec![]);
    h.ok(json!({"type": "app.setInterface", "preferences": {"theme": "dark", "scale": 125, "contrast": "increased"}})).await;
    h.ok(json!({"type": "figma.setPreferences", "preferences": {"enabled": true, "dismissalMinutes": 30, "historyDays": 60}})).await;
    h.ok(
        json!({"type": "settings.setPromptInterruption", "kind": "branch", "level": "notifyOnly"}),
    )
    .await;
    h.ok(json!({"type": "settings.setQuietHours", "quietHours": {"enabled": true, "startMinute": 1080, "endMinute": 480}})).await;
    assert_eq!(
        h.slice("interface"),
        json!({"theme": "dark", "scale": 125, "contrast": "increased"})
    );
    save(&h, &old_draft, "", "").await;
    let saved = h.slice("settings")["configuration"].clone();
    assert_eq!(saved["interface"], json!({"theme": "dark", "scale": 125, "contrast": "increased"}));
    assert_eq!(saved["figma"]["dismissalMinutes"], 30);
    assert_eq!(saved["interruptions"]["branch"], "notifyOnly");
    assert_eq!(saved["quietHours"]["enabled"], true);
    assert_eq!(saved["repositories"][0]["path"], repository.path);
    let interruptions = h.slice("settings")["interruptions"].clone();
    assert_eq!(
        interruptions[0],
        json!({"kind": "branch", "label": "Branch changes", "level": "notifyOnly"})
    );
    // Saved to the store, not only in memory.
    let stored: Configuration = h.t.store.get(att_store::keys::CONFIGURATION).unwrap().unwrap();
    assert_eq!(stored.interface.theme, att_core::interface_prefs::InterfaceTheme::Dark);
}

#[tokio::test]
async fn the_branch_pattern_tester_returns_the_settings_line() {
    let h = Harness::new(configuration(vec![]));
    let test = |branch: &str, pattern: &str| json!({"type": "settings.testBranchPattern", "branch": branch, "pattern": pattern});
    let default = att_core::git::DEFAULT_BRANCH_PATTERN;
    assert_eq!(
        h.ok(test("feature/33624-improve-loading", default)).await,
        json!({"text": "Ticket #33624", "valid": true})
    );
    assert_eq!(
        h.ok(test("develop", default)).await,
        json!({"text": "No unique ticket found", "valid": true})
    );
    assert_eq!(
        h.ok(test("feature/1", "([0-9]+")).await,
        json!({"text": "Invalid pattern: The value “([0-9]+” is invalid.", "valid": false})
    );
}

#[tokio::test]
async fn the_shell_reports_shortcut_and_notification_state() {
    let h = Harness::new(configuration(vec![]));
    assert!(h.slice("connection").get("shortcutIssue").is_none());
    assert!(h.slice("settings").get("notificationsAuthorized").is_none(), "unknown at first");
    let issue =
        "⌃⌥T is unavailable or already used by another app. Use Switch ticket in the menu bar.";
    h.ok(json!({"type": "app.reportShortcutIssue", "issue": issue})).await;
    h.ok(json!({"type": "app.reportNotificationPermission", "authorized": false})).await;
    assert_eq!(h.slice("connection")["shortcutIssue"], issue);
    assert_eq!(h.slice("settings")["notificationsAuthorized"], false);
    h.ok(json!({"type": "app.reportShortcutIssue", "issue": null})).await;
    assert!(h.slice("connection").get("shortcutIssue").is_none());
}

#[tokio::test]
async fn microphone_owners_carry_their_category() {
    let h = Harness::new(configuration(vec![]));
    h.start().await;
    *h.t.microphone.0.lock().unwrap() = Some(vec![att_platform::InputOwner {
        id: "us.zoom.xos".into(),
        name: "Zoom".into(),
        pid: Some(7),
        path: None,
    }]);
    h.ok(json!({"type": "microphone.checkNow"})).await;
    let diagnostics = h.slice("settings")["microphone"].clone();
    assert_eq!(
        diagnostics["owners"],
        json!([{"id": "us.zoom.xos", "name": "Zoom", "pid": 7, "path": null, "category": "Zoom"}])
    );
    assert_eq!(diagnostics["status"], "Microphone in use: Zoom");
    assert_eq!(diagnostics["checkedAt"], "2026-10-06T08:00:00Z");
}

#[tokio::test]
async fn quiet_hours_must_be_valid() {
    let h = Harness::new(configuration(vec![]));
    h.ok(json!({"type": "settings.setQuietHours", "quietHours": {"enabled": true, "startMinute": 1440, "endMinute": 480}})).await;
    assert_eq!(h.slice("app")["error"], "Choose quiet hours between 00:00 and 23:59.");
    assert_eq!(h.slice("settings")["configuration"]["quietHours"]["enabled"], false);
}

/// Triggers one day-review prompt at 17:01 (snooze + 31 min triggers the next). Returns the
/// shell calls it caused.
async fn day_review_prompt(h: &Harness) -> Vec<String> {
    h.shell();
    h.tick().await;
    let calls = h.shell();
    assert_ne!(h.slice("prompts")["dayReview"], Value::Null, "the prompt is always listed");
    h.ok(json!({"type": "dayReview.snooze"})).await;
    h.advance(31.0 * 60.0);
    calls.into_iter().filter(|call| !call.starts_with("remove_notification")).collect()
}

#[tokio::test]
async fn interruption_levels_decide_panel_focus_and_notifications() {
    let h = Harness::new(configuration(vec![]));
    h.start().await;
    h.t.clock.set(ts("2026-10-06T15:01:00Z"));
    let set = |level: &str| json!({"type": "settings.setPromptInterruption", "kind": "dayReview", "level": level});

    // Default: the panel without focus, and a banner while the main window is hidden.
    assert_eq!(day_review_prompt(&h).await, vec!["show_panel(focus=false)", "notify(day-review)"]);
    h.ok(set("openAndFocus")).await;
    assert_eq!(day_review_prompt(&h).await, vec!["show_panel(focus=true)"]);
    h.ok(set("notifyOnly")).await;
    assert_eq!(day_review_prompt(&h).await, vec!["notify(day-review)"]);
    h.ok(set("off")).await;
    assert!(day_review_prompt(&h).await.is_empty(), "off: only listed");

    // The main window is open: no banner next to the panel.
    h.ok(set("openPanel")).await;
    h.ok(json!({"type": "app.setVisiblePage", "page": "overview"})).await;
    assert_eq!(day_review_prompt(&h).await, vec!["show_panel(focus=false)"]);
    h.ok(json!({"type": "app.setVisiblePage", "page": null})).await;

    // Notifications switched off in Settings.
    let mut draft = configuration(vec![]);
    draft.notifications_enabled = false;
    h.ok(set("notifyOnly")).await;
    save(&h, &draft, "", "").await;
    assert!(day_review_prompt(&h).await.is_empty(), "no banner without notifications");
}

#[tokio::test]
async fn quiet_hours_silence_prompts_but_never_7pace_timer_checks() {
    let h = Harness::new(configuration(vec![]));
    h.seven_pace.set_current(stopped_at_limit(4821));
    // 19:00–08:00 quiet hours; it is 19:30.
    h.t.clock.set(ts("2026-10-06T17:30:00Z"));
    h.ok(json!({"type": "settings.setQuietHours", "quietHours": {"enabled": true, "startMinute": 1140, "endMinute": 480}})).await;
    h.ok(json!({"type": "settings.setPromptInterruption", "kind": "trackingAttention", "level": "off"})).await;
    h.start().await;
    h.shell();
    h.tick().await;
    let calls = h.shell();
    assert!(
        calls.contains(&"show_panel(focus=false)".to_string()),
        "attention always interrupts: {calls:?}"
    );

    // A branch change during quiet hours is only listed.
    let dir = TempDir::new();
    let root = dir.repository("webshop", "main");
    let h = Harness::new(configuration(vec![Repository::new(root.to_string_lossy())]));
    h.t.clock.set(ts("2026-10-06T17:30:00Z"));
    h.ok(json!({"type": "settings.setQuietHours", "quietHours": {"enabled": true, "startMinute": 1140, "endMinute": 480}})).await;
    h.start().await;
    h.tick().await;
    h.tick().await;
    set_branch(&root, "feature/33984-improve-loading");
    h.shell();
    h.tick().await;
    h.tick().await;
    assert_eq!(h.slice("prompts")["branches"].as_array().unwrap().len(), 1);
    assert!(
        !h.shell().iter().any(|call| call.starts_with("show_panel") || call.starts_with("notify"))
    );
}

#[tokio::test]
async fn onboarding_holds_the_start_until_it_finishes() {
    // First run: no saved settings.
    let t = att_engine::testing::TestEngine::with_store(store());
    assert_eq!(slice(&t.engine, "app")["onboarding"], true);
    att_engine::session::start(&t.engine).await;
    att_engine::session::tick(&t.engine).await;
    assert!(t.shell.take().is_empty(), "nothing starts during onboarding");

    // Figma detection needs Accessibility to continue.
    *t.figma.access.lock().unwrap() = false;
    let figma = json!({"type": "figma.setPreferences", "preferences": {"enabled": true, "dismissalMinutes": 15, "historyDays": 30}});
    t.engine.dispatch(figma).await.unwrap();
    t.engine.dispatch(json!({"type": "app.finishOnboarding"})).await.unwrap();
    assert_eq!(
        slice(&t.engine, "app")["error"],
        "Allow Accessibility for Figma detection, or turn Figma detection off to continue."
    );
    assert_eq!(slice(&t.engine, "app")["onboarding"], true);
    *t.figma.access.lock().unwrap() = true;
    t.engine.dispatch(json!({"type": "app.finishOnboarding"})).await.unwrap();
    assert_eq!(slice(&t.engine, "app")["onboarding"], false);
    assert_eq!(t.shell.take(), vec!["show_main(settings)".to_string()]);
    let stored: Configuration = t.store.get(att_store::keys::CONFIGURATION).unwrap().unwrap();
    assert_eq!(stored.interface_setup_completed, Some(true));
}

#[tokio::test(start_paused = true)]
async fn pin_pairing_polls_until_approved_and_saves_the_tokens() {
    let h = Harness::new(configuration(vec![]));
    let pairing =
        Arc::new(FakePairing::new(&[SevenPacePinStatus::Waiting, SevenPacePinStatus::Validated]));
    *h.t.clients.pairing.lock().unwrap() = Some(pairing.clone());
    h.ok(json!({"type": "pairing.generatePin", "workspace": "https://Contoso.timehub.7pace.com"}))
        .await;
    let view = h.slice("settings")["pairing"].clone();
    assert_eq!(view["pin"], "482913");
    assert_eq!(view["busy"], true);
    assert_eq!(
        view["status"],
        "Enter this PIN in 7pace → Apps → Pair Mobile App. Waiting for approval…"
    );
    assert_eq!(view["expiresAt"], "2026-10-06T08:01:00Z");
    tokio::time::sleep(Duration::from_secs(5)).await;
    settle().await;
    let view = h.slice("settings")["pairing"].clone();
    assert_eq!(view["pairedHost"], HOST);
    assert_eq!(view["status"], format!("Paired with {HOST}. Save changes to use this connection."));
    assert_eq!(view["busy"], false);
    assert_eq!(view["pin"], Value::Null);
    let saved = credential(&h, &format!("7pace-oauth:{HOST}")).expect("tokens saved");
    let tokens: att_net::SevenPaceTokens = serde_json::from_str(&saved).unwrap();
    assert_eq!(tokens.access_token, "access");
    assert_eq!(
        *pairing.calls.lock().unwrap(),
        vec!["createPin", "status(s3cret)", "status(s3cret)", "exchange(s3cret)"]
    );
}

#[tokio::test(start_paused = true)]
async fn an_unapproved_pin_expires_after_a_minute_and_pairing_can_be_cancelled() {
    let h = Harness::new(configuration(vec![]));
    let pairing = Arc::new(FakePairing::new(&[]));
    *h.t.clients.pairing.lock().unwrap() = Some(pairing.clone());
    h.ok(json!({"type": "pairing.generatePin"})).await;
    tokio::time::sleep(Duration::from_secs(61)).await;
    settle().await;
    let view = h.slice("settings")["pairing"].clone();
    assert_eq!(
        view["status"],
        "The PIN expired. Request a new PIN and enter it within one minute."
    );
    assert_eq!(view["busy"], false);
    let polls =
        pairing.calls.lock().unwrap().iter().filter(|call| call.starts_with("status")).count();
    assert_eq!(polls, 29, "every 2 s within the minute");

    h.ok(json!({"type": "pairing.generatePin", "workspace": WORKSPACE})).await;
    h.ok(json!({"type": "pairing.cancel"})).await;
    tokio::time::sleep(Duration::from_secs(5)).await;
    settle().await;
    assert_eq!(
        h.slice("settings")["pairing"],
        json!({"pin": null, "expiresAt": null, "status": null, "pairedHost": null, "busy": false})
    );

    h.ok(json!({"type": "pairing.generatePin", "workspace": "https://example.com"})).await;
    settle().await;
    assert_eq!(
        h.slice("settings")["pairing"]["status"],
        "Could not pair with 7pace. Use your 7pace workspace URL: https://your-organization.timehub.7pace.com"
    );
}

/// The settings slice's work apps once the background lookup answered (the first app is installed).
async fn resolved_work_apps(h: &Harness) -> Value {
    for _ in 0..200 {
        let apps = h.slice("settings")["workApps"].clone();
        if apps[0]["installed"] == true {
            return apps;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
        h.tick().await;
    }
    panic!("work apps were not looked up: {}", h.slice("settings")["workApps"]);
}

#[tokio::test]
async fn saved_work_apps_are_named_by_the_platform_in_the_background() {
    let mut config = configuration(vec![]);
    config.awareness.work_app_ids =
        vec!["com.example.Editor".into(), "missing.app".into(), "unknown.tool".into()];
    let h = Harness::new(config.clone());
    h.start().await;
    h.tick().await;
    let apps = resolved_work_apps(&h).await;
    assert_eq!(
        apps,
        json!([
            {"id": "com.example.Editor", "name": "Editor", "installed": true},
            {"id": "missing.app", "name": null, "installed": false},
            {"id": "unknown.tool", "name": null, "installed": null},
        ]),
        "saved order; only the platform's answers"
    );

    // An app picked in the file dialog is known at once; saving it needs no new lookup.
    h.ok(json!({"type": "settings.resolveWorkApp", "path": "/Applications/Zed.app"})).await;
    config.awareness.work_app_ids.push("zed".into());
    save(&h, &config, "", "").await;
    assert_eq!(
        h.slice("settings")["workApps"][3],
        json!({"id": "zed", "name": "Zed", "installed": true})
    );
}
