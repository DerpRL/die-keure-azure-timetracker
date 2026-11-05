//! The 2.4 Settings redesign in the engine: "Resume after meetings", the day review reminder
//! timing, the menu-bar timer, `pairing.unpair`, `app.resetLocalData`, `app.saveDiagnostics`
//! and the data folder in the `app` slice.

mod support;

use std::collections::BTreeMap;

use serde_json::{Value, json};

use att_core::day_review::{DayReviewRecord, DayReviewReminder};
use att_core::figma::{FigmaContextEvent, FigmaLedger, FigmaStore};
use att_core::git::AuditEntry;
use att_core::offline::{OfflineDraft, OfflineDraftStatus, OfflineLedger};
use att_engine::state::AppState;
use att_platform::{CalendarEvent, EventStatus};
use att_store::keys;
use support::*;

const SEVEN_PACE_ACCOUNT: &str = "7pace:contoso.timehub.7pace.com";
const OAUTH_ACCOUNT: &str = "7pace-oauth:contoso.timehub.7pace.com";
const AZURE_ACCOUNT: &str = "azure:contoso";

fn draft_id(h: &Harness) -> String {
    h.slice("flow")["draft"]["id"].as_str().expect("a draft").to_string()
}

fn credentials(h: &Harness) -> BTreeMap<String, String> {
    h.t.credentials.0.lock().unwrap().clone()
}

// -- resume after meetings ------------------------------------------------------------------------

#[tokio::test]
async fn without_resume_after_meetings_a_meeting_never_offers_the_previous_ticket() {
    let mut config = configuration(vec![]);
    config.calendar_enabled = true;
    config.resume_after_meetings = false;
    let h = Harness::new(config);
    *h.t.calendar.events.lock().unwrap() = vec![CalendarEvent {
        occurrence_id: "occ-1".into(),
        calendar_id: "work".into(),
        title: "Sprint review #4790".into(),
        start: ts("2026-10-06T07:58:00Z"),
        end: ts("2026-10-06T08:30:00Z"),
        all_day: false,
        status: EventStatus::Confirmed,
        declined: false,
        free: false,
        location: None,
        notes: None,
        url: None,
        calendar_color: None,
        calendar_title: None,
    }];
    h.seven_pace.set_current(running(Some(4821), Some("dev"), None));
    h.start().await;
    h.tick().await;
    h.ok(json!({"type": "meeting.begin", "id": "occ-1", "useSuggestedTicket": true})).await;
    let draft = draft_id(&h);
    h.ok(json!({"type": "tracking.start", "draftId": draft, "activityId": "meeting", "comment": "", "includeTicket": true})).await;
    assert_eq!(h.slice("prompts")["meetingReturn"], Value::Null, "no return plan is offered");

    // The meeting ends: no "Return to #4821?" prompt, panel or notification.
    h.advance(31.0 * 60.0);
    h.shell();
    h.tick().await;
    assert_eq!(h.slice("prompts")["meetingReturn"], Value::Null);
    let calls = h.shell();
    assert!(!calls.iter().any(|call| call.contains("meeting-return")), "{calls:?}");
    assert!(!calls.contains(&"show_panel(focus=false)".to_string()), "{calls:?}");

    // Resuming does nothing.
    h.seven_pace.take_calls();
    h.ok(json!({"type": "meeting.returnResume"})).await;
    assert_eq!(h.slice("flow")["draft"], Value::Null);
    assert!(h.seven_pace.writes().is_empty());
    let saved: Option<Value> = h.t.store.get(keys::MEETING_RETURN).unwrap().flatten();
    assert_eq!(saved, None, "no plan is kept");
}

// -- day review reminder timing -------------------------------------------------------------------

fn with_reminder(reminder: DayReviewReminder) -> Harness {
    let mut config = configuration(vec![]);
    config.day_review.reminder = reminder;
    Harness::new(config)
}

/// Tuesday 6 October 2026; Brussels is UTC+2, so 17:00 local is 15:00Z.
#[tokio::test]
async fn before_end_reminds_fifteen_minutes_before_the_finish_time() {
    let h = with_reminder(DayReviewReminder::BeforeEnd);
    h.start().await;
    h.t.clock.set(ts("2026-10-06T14:44:00Z"));
    h.tick().await;
    assert_eq!(h.slice("prompts")["dayReview"], Value::Null, "16:44");
    h.t.clock.set(ts("2026-10-06T14:45:00Z"));
    h.shell();
    h.tick().await;
    assert_eq!(h.slice("prompts")["dayReview"]["day"], "2026-10-06", "16:45");
    assert!(h.shell().contains(&"notify(day-review)".to_string()));
}

#[tokio::test]
async fn at_end_reminds_at_the_finish_time() {
    let h = with_reminder(DayReviewReminder::AtEnd);
    h.start().await;
    h.t.clock.set(ts("2026-10-06T14:59:00Z"));
    h.tick().await;
    assert_eq!(h.slice("prompts")["dayReview"], Value::Null, "16:59");
    h.t.clock.set(ts("2026-10-06T15:00:00Z"));
    h.tick().await;
    assert_eq!(h.slice("prompts")["dayReview"]["day"], "2026-10-06", "17:00");
}

#[tokio::test]
async fn next_morning_reminds_at_the_start_time_about_the_previous_review_day() {
    let h = with_reminder(DayReviewReminder::NextMorning);
    h.start().await;
    // 08:59 on Tuesday: not yet.
    h.t.clock.set(ts("2026-10-06T06:59:00Z"));
    h.tick().await;
    assert_eq!(h.slice("prompts")["dayReview"], Value::Null, "08:59");
    // 09:00: about Monday.
    h.t.clock.set(ts("2026-10-06T07:00:00Z"));
    h.shell();
    h.tick().await;
    let prompt = h.slice("prompts")["dayReview"].clone();
    assert_eq!(prompt["day"], "2026-10-05", "{prompt}");
    assert!(h.shell().contains(&"notify(day-review)".to_string()));

    // Snoozing and marking reviewed act on Monday's record.
    h.ok(json!({"type": "dayReview.snooze"})).await;
    assert_eq!(h.slice("prompts")["dayReview"], Value::Null);
    h.advance(31.0 * 60.0);
    h.tick().await;
    assert_eq!(h.slice("prompts")["dayReview"]["day"], "2026-10-05", "due again after the snooze");
    h.ok(json!({"type": "dayReview.markReviewed", "day": "2026-10-05"})).await;
    assert_eq!(h.slice("prompts")["dayReview"], Value::Null);

    // Tuesday evening brings no reminder: Tuesday is reviewed on Wednesday morning.
    h.t.clock.set(ts("2026-10-06T15:30:00Z"));
    h.tick().await;
    assert_eq!(h.slice("prompts")["dayReview"], Value::Null);
    let saved: BTreeMap<String, DayReviewRecord> =
        h.t.store.get(keys::DAY_REVIEWS).unwrap().unwrap();
    assert!(saved[&format!("{WORKSPACE}/|2026-10-5")].reviewed_at.is_some(), "{saved:?}");
    assert!(!saved.contains_key(&format!("{WORKSPACE}/|2026-10-6")), "{saved:?}");
}

// -- menu-bar timer -------------------------------------------------------------------------------

#[test]
fn the_menu_bar_title_follows_the_setting_and_the_tooltip_stays() {
    let now = ts("2026-10-06T08:00:00Z");
    let mut state = AppState::default();
    let shown = att_engine::session::tray_status(&state, now);
    assert_eq!(shown.title.as_deref(), Some(" 00:00:00"));
    state.config.menu_bar_timer = false;
    let hidden = att_engine::session::tray_status(&state, now);
    assert_eq!(hidden.title, None, "icon only");
    assert_eq!(hidden.tooltip, shown.tooltip);
    assert_eq!(hidden.state, shown.state);
}

// -- unpair ---------------------------------------------------------------------------------------

#[tokio::test]
async fn unpair_forgets_the_7pace_credential_and_disconnects_but_keeps_everything_else() {
    let h = Harness::new(configuration(vec![]));
    {
        let mut stored = h.t.credentials.0.lock().unwrap();
        stored.insert(SEVEN_PACE_ACCOUNT.into(), "api-token".into());
        stored.insert(OAUTH_ACCOUNT.into(), r#"{"access_token":"a"}"#.into());
        stored.insert(AZURE_ACCOUNT.into(), "azure-pat".into());
    }
    h.start().await;
    assert_eq!(h.slice("connection")["connected"], true);
    let before = h.slice("settings")["configuration"].clone();

    h.ok(json!({"type": "pairing.unpair"})).await;
    let stored = credentials(&h);
    assert!(!stored.contains_key(SEVEN_PACE_ACCOUNT), "{stored:?}");
    assert!(!stored.contains_key(OAUTH_ACCOUNT), "{stored:?}");
    assert_eq!(stored.get(AZURE_ACCOUNT).map(String::as_str), Some("azure-pat"));
    let connection = h.slice("connection");
    assert_eq!(connection["connected"], false);
    assert_eq!(connection["hasSevenPaceToken"], false);
    assert_eq!(connection["health"], "unconfigured");
    let settings = h.slice("settings");
    assert_eq!(settings["hasSevenPaceToken"], false);
    assert_eq!(settings["hasAzurePat"], true, "the Azure token is still stored");
    assert_eq!(settings["configuration"], before, "settings are untouched");
    let audit = h.slice("history")["audit"].clone();
    assert_eq!(audit[0]["title"], "Unpaired from 7pace");

    // Nothing reconnects by itself.
    h.seven_pace.take_calls();
    h.advance(120.0);
    h.tick().await;
    assert_eq!(h.slice("connection")["connected"], false);
    assert!(h.seven_pace.take_calls().is_empty());
}

// -- reset local data -----------------------------------------------------------------------------

fn draft(status: OfflineDraftStatus, comment: &str) -> OfflineDraft {
    let mut draft = OfflineDraft::new(
        format!("{}/", WORKSPACE.to_lowercase()),
        ts("2026-10-05T07:00:00Z"),
        Some(ts("2026-10-05T08:00:00Z")),
        None,
        comment,
        Some("dev".into()),
    );
    draft.status = status;
    if status != OfflineDraftStatus::Draft {
        draft.remote_id = Some(format!("remote-{comment}"));
    }
    draft
}

fn figma_ledger() -> FigmaLedger {
    let mut ledger = FigmaLedger::default();
    ledger.links.insert("file-1".into(), 4790);
    ledger.history.push(FigmaContextEvent {
        id: uuid::Uuid::new_v4(),
        timestamp: ts("2026-10-05T09:00:00Z"),
        kind: "focused".into(),
        file: "file-1".into(),
        name: "Checkout".into(),
        ticket_id: Some(4790),
    });
    ledger
}

#[tokio::test]
async fn reset_local_data_keeps_unsent_drafts_settings_and_accounts() {
    let store = store();
    let unsent = draft(OfflineDraftStatus::Draft, "unsent");
    let unconfirmed = draft(OfflineDraftStatus::Sending, "unconfirmed");
    let mut running = draft(OfflineDraftStatus::Draft, "running");
    running.end = None;
    let synced = draft(OfflineDraftStatus::Synced, "synced");
    let ledger = OfflineLedger {
        drafts: vec![unsent.clone(), synced.clone(), unconfirmed.clone(), running.clone()],
        activities: BTreeMap::new(),
    };
    store.put(keys::OFFLINE_LEDGER, &ledger).unwrap();
    let mut reviews = BTreeMap::new();
    reviews.insert(
        format!("{WORKSPACE}/|2026-10-5"),
        DayReviewRecord { reviewed_at: Some(ts("2026-10-05T15:10:00Z")), ..Default::default() },
    );
    reviews.insert(
        format!("{WORKSPACE}/|2026-10-2"),
        DayReviewRecord { snoozed_until: Some(ts("2026-10-02T15:30:00Z")), ..Default::default() },
    );
    store.put(keys::DAY_REVIEWS, &reviews).unwrap();
    let mut figma = FigmaStore::default();
    figma.workspaces.insert("contoso|one".into(), figma_ledger());
    figma.workspaces.insert("contoso|two".into(), figma_ledger());
    store.put(keys::FIGMA_STORE, &figma).unwrap();

    let mut config = configuration(vec![]);
    config.menu_bar_timer = false;
    let h = Harness::with_store(store, config.clone());
    h.t.credentials.0.lock().unwrap().insert(SEVEN_PACE_ACCOUNT.into(), "api-token".into());
    h.t.credentials.0.lock().unwrap().insert(AZURE_ACCOUNT.into(), "azure-pat".into());
    h.start().await;
    let settings_before = h.slice("settings")["configuration"].clone();

    h.ok(json!({"type": "app.resetLocalData"})).await;
    assert_eq!(
        h.slice("app")["notice"],
        "Local data was reset. Settings, accounts and unsent offline drafts were kept."
    );

    // Unsent drafts (stopped, unconfirmed upload, the running local timer) survive.
    let saved: OfflineLedger = h.t.store.get(keys::OFFLINE_LEDGER).unwrap().unwrap();
    let ids: Vec<_> = saved.drafts.iter().map(|draft| draft.id).collect();
    assert_eq!(ids, vec![unsent.id, unconfirmed.id, running.id]);
    assert_eq!(h.slice("offline")["active"]["id"], running.id.to_string());

    let reviews: BTreeMap<String, DayReviewRecord> =
        h.t.store.get(keys::DAY_REVIEWS).unwrap().unwrap();
    assert!(reviews.is_empty(), "{reviews:?}");
    let figma: FigmaStore = h.t.store.get(keys::FIGMA_STORE).unwrap().unwrap();
    for ledger in figma.workspaces.values() {
        assert!(ledger.history.is_empty());
        assert_eq!(ledger.links.get("file-1"), Some(&4790), "ticket links stay");
    }

    // Settings, accounts and tokens are untouched.
    assert_eq!(h.slice("settings")["configuration"], settings_before);
    let saved_config: att_core::Configuration =
        h.t.store.get(keys::CONFIGURATION).unwrap().unwrap();
    assert_eq!(saved_config, config);
    let stored = credentials(&h);
    assert_eq!(stored.get(SEVEN_PACE_ACCOUNT).map(String::as_str), Some("api-token"));
    assert_eq!(stored.get(AZURE_ACCOUNT).map(String::as_str), Some("azure-pat"));
    assert_eq!(h.slice("connection")["connected"], true);
}

// -- diagnostics ----------------------------------------------------------------------------------

#[tokio::test]
async fn diagnostics_describe_the_app_without_any_credential() {
    const TOKEN: &str = "sp-secret-token-8f3a";
    const PAT: &str = "azure-pat-secret-91c2";
    let store = store();
    store
        .append_audit(
            &AuditEntry::new(
                "Request failed",
                format!(
                    "https://me:{PAT}@dev.azure.com/contoso/_apis/wit?token={TOKEN} returned 500"
                ),
                ts("2026-10-06T07:30:00Z"),
            ),
            2_000,
        )
        .unwrap();
    let h = Harness::with_store(store, configuration(vec![]));
    h.start().await;
    let mut config = configuration(vec![]);
    config.day_review.reminder = DayReviewReminder::BeforeEnd;
    h.ok(json!({"type": "settings.save", "configuration": config, "azurePat": PAT, "sevenPaceToken": TOKEN})).await;
    let stored = credentials(&h);
    assert_eq!(stored.get(SEVEN_PACE_ACCOUNT).map(String::as_str), Some(TOKEN));
    assert_eq!(stored.get(AZURE_ACCOUNT).map(String::as_str), Some(PAT));

    let folder = TempDir::new();
    let path = folder.0.join("diagnostics.txt");
    h.ok(json!({"type": "app.saveDiagnostics", "path": path.to_string_lossy()})).await;
    let text = std::fs::read_to_string(&path).expect("diagnostics written");
    assert!(!text.contains(TOKEN), "{text}");
    assert!(!text.contains(PAT), "{text}");
    for expected in [
        "Azure timetracker diagnostics",
        &format!("Version: {}", env!("CARGO_PKG_VERSION")),
        "OS: macos",
        "Preview: no",
        "Status: 7pace connected",
        "Connected: yes",
        "7pace host: contoso.timehub.7pace.com",
        "Last 7pace check: 2026-10-06T08:00:00Z",
        "sevenPaceUrl: contoso.timehub.7pace.com",
        "resumeAfterMeetings: true",
        "menuBarTimer: true",
        "dayReview.reminder: beforeEnd",
        "== App activity",
        "Request failed — https://dev.azure.com/contoso/_apis/wit returned 500",
    ] {
        assert!(text.contains(expected), "missing {expected:?} in\n{text}");
    }
    assert!(!text.contains(WORKSPACE.trim_end_matches('/')), "the URL is shown as its host only");

    // A folder that does not exist is an error, not a silent failure.
    let missing = folder.0.join("missing/diagnostics.txt");
    let error = h
        .dispatch(json!({"type": "app.saveDiagnostics", "path": missing.to_string_lossy()}))
        .await
        .expect_err("cannot write");
    assert!(error.message.contains("diagnostics.txt"), "{}", error.message);
}

// -- data folder ----------------------------------------------------------------------------------

#[tokio::test]
async fn the_app_slice_names_the_data_folder() {
    let h = Harness::new(configuration(vec![]));
    assert_eq!(h.slice("app")["dataDirectory"], Value::Null, "in-memory store");

    let folder = TempDir::new();
    let store = att_store::Store::open(&folder.0).expect("store");
    store.set_meta(att_store::legacy::IMPORTED_META, "test").unwrap();
    let h = Harness::with_store(std::sync::Arc::new(store), configuration(vec![]));
    assert_eq!(h.slice("app")["dataDirectory"], folder.0.to_string_lossy().as_ref());
}
