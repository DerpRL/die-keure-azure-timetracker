//! 7pace activity checks and server-side stops (Swift AppModel L896–938): announced once per
//! prompt (with 30-day pruning of the notified/dismissed maps), "Keep stopped" and
//! "Continue".

use std::collections::BTreeMap;

use jiff::Timestamp;
use serde_json::Value;

use att_core::attention::TrackingAttention;
use att_core::config::PromptKind;
use att_core::text::NonEmpty;
use att_core::time::add_secs;
use att_core::{AppError, Result};

use crate::engine::Engine;
use crate::intent::done;
use crate::ipc::IpcError;
use crate::state::AppState;

use super::connection::{self, lookup, refresh_activities, workspace};
use super::tracking::TrackingDraft;
use super::{Effects, announce, busy, update_with};

/// Entries older than this are dropped from the notified and dismissed maps.
const RETENTION_SECONDS: f64 = 30.0 * 86_400.0;

#[derive(Default)]
pub(crate) struct AttentionState {
    /// Swift `trackingAttention`.
    pub prompt: Option<TrackingAttention>,
    /// `workspace|prompt id` → when it was announced (persisted).
    pub notified: BTreeMap<String, Timestamp>,
    /// `workspace|prompt id` → when "Keep stopped" was chosen (persisted).
    pub dismissed: BTreeMap<String, Timestamp>,
    pub popup_pending: bool,
}

fn key(workspace: &str, prompt: &TrackingAttention) -> String {
    format!("{workspace}|{}", prompt.id)
}

/// Swift `updateTrackingAttention(_:)`, from the state just applied.
pub(crate) fn update(state: &mut AppState, effects: &mut Effects) {
    let workspace = workspace(state);
    let candidate = connection::tracking(state).and_then(TrackingAttention::from_state);
    let attention = &mut state.session.attention;
    let next =
        candidate.filter(|prompt| !attention.dismissed.contains_key(&key(&workspace, prompt)));
    if attention.prompt.as_ref().map(|prompt| &prompt.id) != next.as_ref().map(|prompt| &prompt.id)
    {
        effects.remove_notification(announce::ATTENTION_ID);
        if let Some(prompt) = &next
            && !attention.notified.contains_key(&key(&workspace, prompt))
        {
            attention.popup_pending = true;
        }
        attention.prompt = next.clone();
    }
    if next.is_none() {
        attention.popup_pending = false;
    }
}

/// Swift `showTrackingAttentionIfReady()`.
pub(crate) fn show_if_ready(engine: &Engine) {
    let now = engine.now();
    let busy = busy(engine);
    update_with(engine, |state, effects| {
        let workspace = workspace(state);
        let session = &mut state.session;
        let flow_open = session.flow.show_picker || session.flow.menu_tracking;
        let attention = &mut session.attention;
        let Some(prompt) = attention.prompt.clone() else { return };
        if !attention.popup_pending || !session.connection.connected || busy || flow_open {
            return;
        }
        attention.popup_pending = false;
        let cutoff = add_secs(now, -RETENTION_SECONDS);
        attention.notified.retain(|_, at| *at > cutoff);
        attention.dismissed.retain(|_, at| *at > cutoff);
        attention.notified.insert(key(&workspace, &prompt), now);
        effects.announce(PromptKind::TrackingAttention, Some(announce::attention(&prompt)));
    });
}

/// Swift `keepAttentionStopped()`.
pub(crate) fn keep_stopped(engine: &Engine) {
    if busy(engine) {
        return;
    }
    let now = engine.now();
    update_with(engine, |state, effects| {
        let workspace = workspace(state);
        let attention = &mut state.session.attention;
        let Some(prompt) = attention.prompt.clone().filter(TrackingAttention::stopped) else {
            return;
        };
        attention.dismissed.insert(key(&workspace, &prompt), now);
        attention.prompt = None;
        attention.popup_pending = false;
        effects.remove_notification(announce::ATTENTION_ID);
    });
}

/// Swift `continueTrackingAttention()`: an activity check is confirmed; after a server stop a
/// draft for the stopped task opens (a new session needs a fresh confirmation).
pub(crate) async fn continue_tracking(engine: &Engine) -> std::result::Result<Value, IpcError> {
    let Some(prompt) = engine.read(|state| state.session.attention.prompt.clone()) else {
        return done();
    };
    if busy(engine) {
        return Err(IpcError::busy());
    }
    let Some(clients) = engine.clients().filter(|_| !engine.preview()) else { return done() };
    let ready = engine
        .read(|state| state.session.connection.connected && state.session.flow.draft.is_none());
    if !ready {
        return done();
    }
    if !prompt.stopped() {
        return super::tracking::confirm_activity(engine).await;
    }
    let Some(_busy) = engine.inner.busy.try_acquire() else { return Err(IpcError::busy()) };
    let connection = engine.connection_generation();
    let result: Result<Option<TrackingDraft>> = async {
        let current = clients.seven_pace.current().await?;
        connection::apply(engine, current.clone());
        if TrackingAttention::from_state(&current).map(|current| current.id)
            != Some(prompt.id.clone())
        {
            return Err(AppError::RemoteChanged);
        }
        let item = match prompt.ticket_id {
            Some(id) => Some(lookup(engine, &clients, id).await?),
            None => {
                if prompt.remark.non_empty().is_none() {
                    return Err(AppError::message(
                        "The stopped task has no ticket or comment. Choose a task manually.",
                    ));
                }
                None
            }
        };
        if !engine.read(|state| state.session.connection.activities_loaded) {
            refresh_activities(engine).await;
        }
        if engine.connection_generation() != connection {
            return Ok(None);
        }
        let mut draft = TrackingDraft::new(item, None, current.identity());
        draft.attention = Some(prompt.clone());
        Ok(Some(draft))
    }
    .await;
    match result {
        Ok(Some(draft)) => {
            engine.update(|state| {
                state.session.flow.draft = Some(draft);
                state.session.flow.menu_tracking = true;
                state.session.error = None;
            });
            engine.services().shell.show_panel(true);
        }
        Ok(None) => {}
        Err(error) => engine.update(|state| state.session.error = Some(error.to_string())),
    }
    done()
}
