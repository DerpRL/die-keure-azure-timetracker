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

use super::connection::workspace;
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
    state.session.awareness.ledger = awareness.unwrap_or_default();
    let completion: Option<TicketCompletionMonitor> =
        read(services, state, keys::TICKET_COMPLETION);
    state.session.completion.monitor = completion.unwrap_or_default();
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
    monitor.restrict(&state.config.microphone.apps, &workspace);
    state.session.microphone.monitor = monitor;
    let quick: Option<QuickTickets> = read(services, state, keys::QUICK_TICKETS);
    state.session.quick_tickets = quick
        .filter(|quick| quick.workspace == workspace)
        .unwrap_or_else(|| QuickTickets::new(workspace.clone()));
    state.session.meeting_return = meeting_return.filter(|plan| plan.workspace == workspace);
    state.session.paused = paused.flatten().filter(|paused| paused.workspace == workspace);
    let reviews: Option<BTreeMap<String, DayReviewRecord>> =
        read(services, state, keys::DAY_REVIEWS);
    state.session.day_review.records = reviews.unwrap_or_default();
    let notified: Option<DateMap> = read(services, state, keys::ATTENTION_NOTIFIED);
    state.session.attention.notified = notified.unwrap_or_default().0;
    let dismissed: Option<DateMap> = read(services, state, keys::ATTENTION_DISMISSED);
    state.session.attention.dismissed = dismissed.unwrap_or_default().0;
    let figma: Option<FigmaStore> = read(services, state, keys::FIGMA_STORE);
    state.session.figma.store = figma.unwrap_or_default();
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
