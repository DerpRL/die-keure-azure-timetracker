//! Session documents: `pending`, `meetingReminders`, `pausedSession`, `meetingReturn`,
//! `workAwareness`, `ticketCompletion`, `microphoneTracking`, `quickTickets`, `dayReviews`,
//! `attentionNotified`, `attentionDismissed`, `figmaStore` (see `att_store::keys`).
//!
//! Every document keeps the 1.14.x JSON shape (the `att-core` types read Swift's encoding), so
//! imported data loads unchanged. A document that cannot be read keeps its defaults and is
//! never overwritten, so the original data survives (Swift `canPersist`, per document).

use std::collections::BTreeMap;

use jiff::Timestamp;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use att_core::awareness::WorkAwarenessLedger;
use att_core::completion::TicketCompletionMonitor;
use att_core::day_review::DayReviewRecord;
use att_core::figma::FigmaStore;
use att_core::indicator::PausedSession;
use att_core::interface_prefs::InterfacePreferences;
use att_core::meetings::MeetingSuggestionEngine;
use att_core::microphone::{MicrophoneApp, MicrophoneOwner, MicrophoneSession};
use att_core::microphone_end::{MicrophoneTrackingLink, MicrophoneTrackingMonitor};
use att_core::productivity::{MeetingReturn, QuickTickets};
use att_store::keys;

use crate::ipc::IpcError;
use crate::services::Services;
use crate::state::AppState;

use super::connection::{same_workspace, workspace};
use super::history;

/// Swift `[String: Date]` (`attentionNotified`, `attentionDismissed`).
#[derive(Default, Serialize, Deserialize)]
#[serde(transparent)]
struct DateMap(#[serde(with = "att_core::time::flex_date::map")] BTreeMap<String, Timestamp>);

fn read<T: DeserializeOwned>(
    services: &Services,
    state: &mut AppState,
    key: &'static str,
) -> Option<T> {
    match services.store.get::<T>(key) {
        Ok(value) => value,
        Err(error) => {
            state.session.unreadable.insert(key);
            if state.storage_issue.is_none() {
                state.storage_issue = Some(format!(
                    "Saved data could not be read. The original data has been preserved: {error}"
                ));
            }
            None
        }
    }
}

/// Swift `AppModel.init()`: restores the session and applies the load-time rules.
pub(crate) fn load(services: &Services, state: &mut AppState) {
    let now = services.clock.now();
    let cal = services.clock.cal();
    let session = &mut state.session;
    session.host_os = Some(services.os);
    if services.preview {
        session.notice = Some("Preview mode · no network requests or tracking changes".to_string());
    }
    // The configuration could not be read (the engine stopped writing): no onboarding.
    session.load_failed = !state.can_persist;
    session.branches.discover_on_start =
        !state.has_saved_settings && state.can_persist && !services.preview;
    let onboarding = !session.load_failed
        && InterfacePreferences::needs_onboarding(
            state.has_saved_settings,
            state.config.interface_setup_completed,
        );
    state.config.interface_setup_completed = Some(!onboarding);
    let (from, to) = history::default_range(cal.date(now), &cal);
    state.session.history.from = Some(from);
    state.session.history.to = Some(to);

    let workspace = workspace(state);
    state.session.branches.pending =
        read(services, state, keys::PENDING_BRANCHES).unwrap_or_default();
    let reminders: Option<MeetingSuggestionEngine> = read(services, state, keys::MEETING_REMINDERS);
    state.session.calendar.engine = reminders.unwrap_or_default();
    let paused: Option<Option<PausedSession>> = read(services, state, keys::PAUSED_SESSION);
    let meeting_return: Option<Option<MeetingReturn>> = read(services, state, keys::MEETING_RETURN);
    let meeting_return = meeting_return.flatten();
    let awareness: Option<WorkAwarenessLedger> = read(services, state, keys::WORK_AWARENESS);
    let mut ledger = awareness.unwrap_or_default();
    if same_workspace(&ledger.workspace, &workspace) {
        ledger.workspace = workspace.clone();
    }
    state.session.awareness.ledger = ledger;
    let completion: Option<TicketCompletionMonitor> =
        read(services, state, keys::TICKET_COMPLETION);
    state.session.completion.monitor =
        respell(completion.unwrap_or_default(), &workspace, |value, workspace| {
            if let Some(scope) = value.pointer_mut("/pending/scope")
                && let Some(text) = scope.as_str()
            {
                *scope = Value::String(rekey(text, workspace));
            }
            if let Some(Value::Object(dismissed)) = value.get_mut("dismissed") {
                let entries = std::mem::take(dismissed);
                for (key, date) in entries {
                    dismissed.entry(rekey(&key, workspace)).or_insert(date);
                }
            }
        });
    let microphone: Option<MicrophoneTrackingMonitor> =
        read(services, state, keys::MICROPHONE_TRACKING);
    let restore_link =
        microphone.is_none() && !state.session.unreadable.contains(keys::MICROPHONE_TRACKING);
    let mut monitor = microphone.unwrap_or_default();
    if restore_link
        && let Some(plan) = &meeting_return
        && let (Some(session_id), Some(app_id)) =
            (&plan.microphone_session_id, &plan.microphone_app_id)
        && plan.end == MeetingReturn::open_end()
    {
        // A microphone meeting from before monitors were persisted: keep its end prompt.
        let owner = MicrophoneOwner::new(app_id.clone(), MicrophoneApp::classify(app_id).label());
        let session = MicrophoneSession::new(session_id.clone(), owner, now);
        monitor.restore(MicrophoneTrackingLink::new(
            &session,
            &plan.workspace,
            &plan.meeting_identity,
        ));
    }
    let mut monitor = respell(monitor, &workspace, |value, workspace| {
        let respell = |field: &mut Value| {
            if field.as_str().is_some_and(|text| same_workspace(text, workspace)) {
                *field = Value::String(workspace.to_string());
            }
        };
        if let Some(Value::Object(links)) = value.get_mut("links") {
            links.values_mut().filter_map(|link| link.get_mut("workspace")).for_each(respell);
        }
        if let Some(pending) = value.pointer_mut("/pending/workspace") {
            respell(pending);
        }
    });
    monitor.restrict(&state.config.microphone.apps, &workspace);
    state.session.microphone.monitor = monitor;
    // 1.14.x stored the URL as typed: the same workspace may be spelled with a trailing slash.
    let quick: Option<QuickTickets> = read(services, state, keys::QUICK_TICKETS);
    state.session.quick_tickets = quick
        .filter(|quick| same_workspace(&quick.workspace, &workspace))
        .map(|quick| QuickTickets { workspace: workspace.clone(), ..quick })
        .unwrap_or_else(|| QuickTickets::new(workspace.clone()));
    state.session.meeting_return = meeting_return
        .filter(|plan| same_workspace(&plan.workspace, &workspace))
        .map(|plan| MeetingReturn { workspace: workspace.clone(), ..plan });
    state.session.paused = paused
        .flatten()
        .filter(|paused| same_workspace(&paused.workspace, &workspace))
        .map(|paused| PausedSession { workspace: workspace.clone(), ..paused });
    let reviews: Option<BTreeMap<String, DayReviewRecord>> =
        read(services, state, keys::DAY_REVIEWS);
    state.session.day_review.records = rekey_map(reviews.unwrap_or_default(), &workspace);
    let notified: Option<DateMap> = read(services, state, keys::ATTENTION_NOTIFIED);
    state.session.attention.notified = rekey_map(notified.unwrap_or_default().0, &workspace);
    let dismissed: Option<DateMap> = read(services, state, keys::ATTENTION_DISMISSED);
    state.session.attention.dismissed = rekey_map(dismissed.unwrap_or_default().0, &workspace);
    let figma: Option<FigmaStore> = read(services, state, keys::FIGMA_STORE);
    let mut figma = figma.unwrap_or_default();
    let ledgers = std::mem::take(&mut figma.workspaces);
    for (key, ledger) in ledgers {
        // Figma scopes are `organization|workspace`.
        let key = match key.split_once('|') {
            Some((organization, spelled))
                if !workspace.is_empty() && same_workspace(spelled, &workspace) =>
            {
                format!("{organization}|{workspace}")
            }
            _ => key,
        };
        figma.workspaces.entry(key).or_insert(ledger);
    }
    state.session.figma.store = figma;
}

/// `workspace|rest` keys written with another spelling of this workspace, respelled.
fn rekey(key: &str, workspace: &str) -> String {
    match key.split_once('|') {
        Some((head, rest))
            if !workspace.is_empty() && head != workspace && same_workspace(head, workspace) =>
        {
            format!("{workspace}|{rest}")
        }
        _ => key.to_string(),
    }
}

fn rekey_map<V>(map: BTreeMap<String, V>, workspace: &str) -> BTreeMap<String, V> {
    let mut result = BTreeMap::new();
    for (key, value) in map {
        result.entry(rekey(&key, workspace)).or_insert(value);
    }
    result
}

/// Rewrites workspace spellings inside a core type whose fields are private, through its JSON.
fn respell<T: Serialize + DeserializeOwned>(
    value: T,
    workspace: &str,
    rewrite: impl Fn(&mut Value, &str),
) -> T {
    if workspace.is_empty() {
        return value;
    }
    let Ok(mut json) = serde_json::to_value(&value) else { return value };
    rewrite(&mut json, workspace);
    serde_json::from_value(json).unwrap_or(value)
}

/// Writes every session document (the store skips unchanged JSON).
pub(crate) fn save(services: &Services, state: &AppState) -> Result<(), IpcError> {
    let session = &state.session;
    let put = |key: &'static str, value: &dyn erased::Json| -> Result<(), IpcError> {
        if session.unreadable.contains(key) {
            return Ok(());
        }
        let json = value.json().map_err(|error| IpcError::new("storage", error.to_string()))?;
        services.store.put_raw(key, &json)?;
        Ok(())
    };
    put(keys::PENDING_BRANCHES, &session.branches.pending)?;
    put(keys::MEETING_REMINDERS, &session.calendar.engine)?;
    put(keys::PAUSED_SESSION, &session.paused)?;
    put(keys::MEETING_RETURN, &session.meeting_return)?;
    put(keys::WORK_AWARENESS, &session.awareness.ledger)?;
    put(keys::TICKET_COMPLETION, &session.completion.monitor)?;
    put(keys::MICROPHONE_TRACKING, &session.microphone.monitor)?;
    put(keys::QUICK_TICKETS, &session.quick_tickets)?;
    put(keys::DAY_REVIEWS, &session.day_review.records)?;
    put(keys::ATTENTION_NOTIFIED, &DateMapRef(&session.attention.notified))?;
    put(keys::ATTENTION_DISMISSED, &DateMapRef(&session.attention.dismissed))?;
    put(keys::FIGMA_STORE, &session.figma.store)?;
    Ok(())
}

/// Serializes a borrowed date map like [`DateMap`].
struct DateMapRef<'a>(&'a BTreeMap<String, Timestamp>);

impl Serialize for DateMapRef<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        att_core::time::flex_date::map::serialize(self.0, serializer)
    }
}

/// Object-safe JSON encoding, so one closure writes every document type.
mod erased {
    pub trait Json {
        fn json(&self) -> serde_json::Result<String>;
    }

    impl<T: serde::Serialize> Json for T {
        fn json(&self) -> serde_json::Result<String> {
            serde_json::to_string(self)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attention_maps_read_swift_dates_and_write_rfc3339() {
        let map: DateMap = serde_json::from_str(r#"{"org|a": 0}"#).unwrap();
        assert_eq!(map.0["org|a"].to_string(), "2001-01-01T00:00:00Z");
        let json = serde_json::to_string(&DateMapRef(&map.0)).unwrap();
        assert_eq!(json, r#"{"org|a":"2001-01-01T00:00:00Z"}"#);
    }
}
