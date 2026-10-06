//! Completed-ticket reminders (Swift AppModel L452–493): the tracked ticket's Azure workflow
//! state is checked at most once a minute while tracking; a prompt shows only while that check
//! is fresher than 150 s.

use jiff::Timestamp;
use serde_json::Value;

use att_core::completion::{TicketCompletionMonitor, TicketCompletionPrompt};
use att_core::config::PromptKind;
use att_core::time::diff_secs;
use att_core::{AppError, Result};

use crate::engine::Engine;
use crate::ipc::IpcError;
use crate::state::AppState;

use super::connection::{confirmed, tracking, workspace};
use super::tracking::{StopReason, stop as stop_tracking};
use super::{announce, busy, update_with};

/// Checks run at least this far apart (Swift 60 s).
const CHECK_SECONDS: f64 = 60.0;
/// A prompt shows only while its check is fresher than this (Swift 150 s).
const FRESH_SECONDS: f64 = 150.0;

#[derive(Default)]
pub(crate) struct CompletionState {
    /// Swift `ticketCompletion` (persisted).
    pub monitor: TicketCompletionMonitor,
    /// Swift `ticketCompletionIssue`.
    pub issue: Option<String>,
    /// Swift `ticketCompletionCheckedAt`.
    pub checked_at: Option<Timestamp>,
    /// Swift `lastCompletionCheck`.
    pub last_check: Option<Timestamp>,
    pub checking: bool,
}

/// Swift `completionScope`: `workspace|organization`.
pub(crate) fn scope(state: &AppState) -> String {
    format!("{}|{}", workspace(state), state.config.organization.to_lowercase())
}

/// Swift `ticketCompletionPrompt`.
pub(crate) fn prompt(
    state: &AppState,
    now: Timestamp,
    preview: bool,
) -> Option<TicketCompletionPrompt> {
    let completion = &state.session.completion;
    if !state.config.completion_reminders || !confirmed(state, now) {
        return None;
    }
    let prompt = completion.monitor.pending()?;
    let fresh = preview
        || completion.checked_at.is_some_and(|checked| diff_secs(now, checked) < FRESH_SECONDS);
    (prompt.matches(tracking(state), &scope(state)) && fresh).then(|| prompt.clone())
}

/// Swift `checkTicketCompletion(force:)`.
pub(crate) async fn check(engine: &Engine, force: bool) {
    if engine.preview() {
        return;
    }
    let Some(clients) = engine.clients() else { return };
    let Some(azure) = clients.azure.clone() else { return };
    let now = engine.now();
    let Some((tracked, id, scope)) = engine.update(|state| {
        let ready = state.config.completion_reminders && confirmed(state, now);
        let tracked = tracking(state).filter(|tracked| tracked.running())?.clone();
        let id = tracked.track.as_ref()?.ticket_id()?;
        let completion = &mut state.session.completion;
        let due =
            force || completion.last_check.is_none_or(|last| diff_secs(now, last) >= CHECK_SECONDS);
        if !ready || completion.checking || !due {
            return None;
        }
        completion.checking = true;
        completion.last_check = Some(now);
        Some((tracked, id, scope(state)))
    }) else {
        return;
    };
    let result = azure.ticket_workflow(id).await;
    let now = engine.now();
    let current = engine.connection_generation() == clients.generation;
    engine.update(|state| {
        let same_session =
            tracking(state).map(|state| state.identity()) == Some(tracked.identity());
        let still_running = tracking(state).is_some_and(|state| state.running());
        let reminders = state.config.completion_reminders;
        let connected = state.session.connection.connected;
        let is_confirmed = confirmed(state, now);
        let tracking_state = tracking(state).cloned();
        let completion = &mut state.session.completion;
        completion.checking = false;
        match result {
            Ok(status) => {
                if !current || !same_session || !still_running || !connected || !reminders {
                    return;
                }
                completion.monitor.observe(
                    &status,
                    tracking_state.as_ref(),
                    &scope,
                    is_confirmed,
                    now,
                );
                completion.issue = None;
                completion.checked_at = Some(now);
            }
            Err(error) => {
                if !current || !same_session {
                    return;
                }
                completion.issue = Some(error.to_string());
                completion.checked_at = None;
            }
        }
    });
}

/// Swift `showTicketCompletionIfReady()`.
pub(crate) fn show_if_ready(engine: &Engine) {
    let now = engine.now();
    let preview = engine.preview();
    let busy = busy(engine);
    update_with(engine, |state, effects| {
        let Some(current) = prompt(state, now, preview) else { return };
        let flow = &state.session.flow;
        if current.notified
            || busy
            || flow.show_picker
            || flow.menu_tracking
            || flow.draft.is_some()
        {
            return;
        }
        state.session.completion.monitor.mark_notified();
        effects.announce(PromptKind::TicketCompletion, Some(announce::completion(&current)));
    });
}

/// Swift `keepCompletedTicket()`.
pub(crate) fn keep(engine: &Engine) {
    let now = engine.now();
    let preview = engine.preview();
    update_with(engine, |state, effects| {
        if prompt(state, now, preview).is_none() {
            return;
        }
        state.session.completion.monitor.keep_tracking(now);
        effects.remove_notification(announce::COMPLETION_ID);
    });
}

/// `completion.stop`: stops after revalidating the completion state.
pub(crate) async fn stop(engine: &Engine) -> std::result::Result<Value, IpcError> {
    let result = stop_tracking(engine, StopReason::Completion).await;
    engine.services().shell.remove_notification(announce::COMPLETION_ID);
    result
}

/// Swift `validateTicketCompletion(_:)`: Azure must still report the ticket completed.
pub(crate) async fn validate(engine: &Engine, prompt: &TicketCompletionPrompt) -> Result<()> {
    let now = engine.now();
    let preview = engine.preview();
    let clients = engine.clients();
    let azure = clients.as_ref().and_then(|clients| clients.azure.clone());
    let current = engine.read(|state| super::completion::prompt(state, now, preview));
    let (Some(azure), Some(current)) = (azure, current) else {
        return Err(AppError::RemoteChanged);
    };
    if current.id != prompt.id {
        return Err(AppError::RemoteChanged);
    }
    let generation = engine.connection_generation();
    let latest = azure.ticket_workflow(prompt.ticket_id).await?;
    let now = engine.now();
    let matches = engine.read(|state| prompt.matches(tracking(state), &scope(state)));
    if generation != engine.connection_generation() || !matches {
        return Err(AppError::RemoteChanged);
    }
    engine.update(|state| {
        let scope = scope(state);
        let tracking_state = tracking(state).cloned();
        let completion = &mut state.session.completion;
        completion.monitor.observe(&latest, tracking_state.as_ref(), &scope, true, now);
        completion.checked_at = Some(now);
    });
    let _ = engine.persist();
    if !latest.completed() {
        return Err(AppError::message(
            "This ticket is no longer completed. Your timer is unchanged.",
        ));
    }
    Ok(())
}
