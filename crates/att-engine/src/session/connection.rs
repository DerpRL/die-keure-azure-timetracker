//! The 7pace and Azure connection: `connect`, `refresh`, `apply`, `fail`, `retry`, health,
//! activity types, ticket lookups and the shared title cache (Swift AppModel L348–512,
//! L636–650, L1042–1056, L1175–1183).

use std::sync::Arc;

use jiff::Timestamp;

use att_core::awareness::IdleTrackingSession;
use att_core::model::{ActivityType, TrackingState, WorkItem};
use att_core::productivity::{ConnectionHealth, QuickTickets};
use att_core::text::NonEmpty;
use att_core::time::diff_secs;
use att_core::{AppError, Cal, Result};

use crate::clients::Clients;
use crate::controllers::hooks as controllers;
use crate::engine::Engine;
use crate::state::AppState;

use super::{Effects, announce, attention, completion, history, progress, update_with};

/// History reloads after a refresh at least this often (Swift 300 s).
const HISTORY_REFRESH_SECONDS: f64 = 300.0;

#[derive(Default)]
pub(crate) struct ConnectionState {
    /// The latest confirmed 7pace state (Swift `state`); kept as "last known" when disconnected.
    pub tracking: Option<TrackingState>,
    pub connected: bool,
    pub connecting: bool,
    pub last_sync: Option<Timestamp>,
    pub failure: Option<AppError>,
    /// Swift `connectionIssue`.
    pub issue: Option<String>,
    pub azure_issue: Option<String>,
    pub has_azure_pat: bool,
    pub has_seven_pace_token: bool,
    pub host: Option<String>,
    /// Swift `lastRemoteCheck`.
    pub last_remote_check: Option<Timestamp>,
    pub activity_types: Vec<ActivityType>,
    pub activities_loaded: bool,
    pub loading_activities: bool,
    pub activity_error: Option<String>,
}

/// Swift `workspaceIdentity`, the 2.0 spelling shared with the controllers
/// (`clients::workspace_identity`: the parsed URL, lower-cased, with a trailing `/`).
///
/// Swift kept the URL as typed (usually without the `/`), so data restored from 1.14.x is
/// compared with [`same_workspace`] and respelled on load (`session::persist`).
pub(crate) fn workspace_identity(seven_pace_url: &str) -> String {
    crate::clients::workspace_identity(seven_pace_url)
}

/// Workspace identities compare without a trailing slash or the default port, so data written
/// with either spelling (1.14.x stored the URL as typed) still belongs to the workspace.
pub(crate) fn same_workspace(a: &str, b: &str) -> bool {
    normalized_workspace(a) == normalized_workspace(b)
}

fn normalized_workspace(workspace: &str) -> String {
    let lower = workspace.trim().to_lowercase();
    let trimmed = lower.trim_end_matches('/');
    trimmed.strip_suffix(":443").unwrap_or(trimmed).to_string()
}

pub(crate) fn workspace(state: &AppState) -> String {
    workspace_identity(&state.config.seven_pace_url)
}

/// Swift `updateConnectionHealth()`, computed when needed instead of stored.
pub(crate) fn health(state: &AppState, now: Timestamp) -> ConnectionHealth {
    let connection = &state.session.connection;
    ConnectionHealth::resolve(
        connection.has_seven_pace_token,
        connection.connecting,
        connection.connected,
        connection.last_sync,
        connection.failure.as_ref(),
        now,
        state.config.poll_interval() as i64,
    )
}

/// Swift `connected && connectionHealth == .confirmed`.
pub(crate) fn confirmed(state: &AppState, now: Timestamp) -> bool {
    state.session.connection.connected && health(state, now) == ConnectionHealth::Confirmed
}

pub(crate) fn tracking(state: &AppState) -> Option<&TrackingState> {
    state.session.connection.tracking.as_ref()
}

/// Swift `state?.running == true`.
pub(crate) fn running(state: &AppState) -> bool {
    tracking(state).is_some_and(TrackingState::running)
}

/// Swift `state?.running == true ? state?.track?.ticketID : nil`.
pub(crate) fn running_ticket(state: &AppState) -> Option<i64> {
    tracking(state)
        .filter(|state| state.running())
        .and_then(|state| state.track.as_ref()?.ticket_id())
}

/// Swift `elapsed(at:)`: the confirmed track length, extrapolated only while confirmed.
pub(crate) fn elapsed(state: &AppState, now: Timestamp) -> f64 {
    let track = tracking(state).and_then(|state| state.track.as_ref()).filter(|t| t.is_running());
    let Some(track) = track else {
        return state.session.paused.as_ref().map_or(0.0, |paused| paused.elapsed_seconds);
    };
    let base = track.current_track_length.unwrap_or(0.0);
    let extrapolated = if health(state, now) == ConnectionHealth::Confirmed {
        let since = state.session.connection.last_sync.unwrap_or(now);
        diff_secs(now, since).max(0.0)
    } else {
        0.0
    };
    base + extrapolated
}

/// Swift `connect()`: drops everything tied to the previous connection, builds the clients from
/// the settings and stored credentials, reads the timer, then loads activities, history and
/// progress.
pub(crate) async fn connect(engine: &Engine) {
    if engine.preview() || engine.read(controllers::offline_working) {
        return;
    }
    let Some(_busy) = engine.inner.busy.try_acquire() else { return };
    update_with(engine, reset_for_connect);
    engine.set_clients(None);
    controllers::on_connection_changed(engine, None).await;
    let config = engine.read(|state| state.config.clone());
    if config.seven_pace_url.non_empty().is_some() {
        let factory = engine.services().clients.clone();
        let credentials = engine.services().platform.credentials.clone();
        let cal = engine.cal();
        // Keychain reads can wait for a system prompt: blocking pool, no short deadline.
        let built =
            tokio::task::spawn_blocking(move || factory.connect(&config, credentials, &cal, 0))
                .await
                .unwrap_or_else(|error| Err(AppError::Message(error.to_string())));
        match built {
            Ok(Some(clients)) => connected(engine, clients).await,
            Ok(None) => {}
            Err(error) => fail(engine, error),
        }
    }
    let now = engine.now();
    engine.update(|state| {
        let connection = &mut state.session.connection;
        connection.last_remote_check = Some(now);
        connection.connecting = false;
    });
}

async fn connected(engine: &Engine, clients: Clients) {
    let generation = engine.set_clients(Some(clients));
    let Some(clients) = engine.clients() else { return };
    engine.update(|state| {
        let connection = &mut state.session.connection;
        connection.has_seven_pace_token = true;
        connection.has_azure_pat = clients.azure.is_some();
        connection.host = Some(clients.host.clone());
    });
    controllers::on_connection_changed(engine, Some(clients.clone())).await;
    let result = clients.seven_pace.current().await;
    if engine.connection_generation() != generation {
        return;
    }
    match result {
        Ok(next) => {
            apply(engine, next);
            let host = clients.host.clone();
            engine.update(|state| {
                state.session.error = None;
                state.session.notice = Some(format!("Connected to {host}"));
            });
            refresh_activities(engine).await;
            history::load(engine).await;
            progress::load(engine).await;
        }
        Err(error) => fail(engine, error),
    }
}

/// The first half of Swift `connect()`: forget everything that belongs to the old connection.
fn reset_for_connect(state: &mut AppState, effects: &mut Effects) {
    let workspace = workspace(state);
    let scope = completion::scope(state);
    let reminders = state.config.completion_reminders;
    let session = &mut state.session;
    session.connection.connecting = true;
    session.history.generation += 1;
    session.history.loading = false;
    session.attention.prompt = None;
    session.attention.popup_pending = false;
    effects.remove_notification(announce::ATTENTION_ID);
    session.day_review.prompt_day = None;
    if session.completion.monitor.pending().map(|prompt| prompt.scope.as_str())
        != Some(scope.as_str())
        || !reminders
    {
        session.completion.monitor.clear_prompt();
    }
    session.completion.issue = None;
    session.completion.checked_at = None;
    session.completion.last_check = None;
    session.awareness.ledger.scope(&workspace);
    session.awareness.forgotten.reset();
    let connection = &mut session.connection;
    connection.tracking = None;
    connection.connected = false;
    connection.last_sync = None;
    connection.activity_types.clear();
    session.history.logs.clear();
    session.history.loaded = false;
    session.progress.logs.clear();
    session.progress.last_sync = None;
    session.progress.week = None;
    session.progress.loading = false;
    session.work_items.clear();
    let flow = &mut session.flow;
    flow.draft = None;
    flow.show_picker = false;
    flow.menu_tracking = false;
    flow.selected_meeting = None;
    flow.selected_figma = None;
    flow.skip_figma_prefill = false;
    session.loading_titles.clear();
    session.microphone.monitor.restrict(&state.config.microphone.apps, &workspace);
    if session.paused.as_ref().is_some_and(|paused| !same_workspace(&paused.workspace, &workspace))
    {
        session.paused = None;
    }
    if session
        .meeting_return
        .as_ref()
        .is_some_and(|plan| !same_workspace(&plan.workspace, &workspace))
    {
        session.meeting_return = None;
    }
    if !same_workspace(&session.quick_tickets.workspace, &workspace) {
        session.quick_tickets = QuickTickets::new(workspace);
    }
    let connection = &mut session.connection;
    connection.failure = None;
    connection.issue = None;
    connection.azure_issue = None;
    session.progress.issue = None;
    connection.activities_loaded = false;
    connection.activity_error = None;
    connection.has_azure_pat = false;
    connection.has_seven_pace_token = false;
    connection.host = None;
}

/// Swift `refresh()`: one `current` read, guarded by `busy`; history reloads after an identity
/// change or every 300 s.
pub(crate) async fn refresh(engine: &Engine) {
    if engine.preview() {
        return;
    }
    let Some(clients) = engine.clients() else { return };
    let Some(_busy) = engine.inner.busy.try_acquire() else { return };
    let now = engine.now();
    let old_identity = engine.update(|state| {
        state.session.connection.last_remote_check = Some(now);
        tracking(state).map(TrackingState::identity)
    });
    let result = clients.seven_pace.current().await;
    if engine.connection_generation() != clients.generation {
        return;
    }
    match result {
        Ok(next) => {
            apply(engine, next);
            let now = engine.now();
            let reload = engine.update(|state| {
                state.session.error = None;
                tracking(state).map(TrackingState::identity) != old_identity
                    || state
                        .session
                        .history
                        .last_check
                        .is_none_or(|last| diff_secs(now, last) > HISTORY_REFRESH_SECONDS)
            });
            if reload {
                history::load(engine).await;
            }
        }
        Err(error) => fail(engine, error),
    }
}

/// Swift `retryConnection()`.
pub(crate) async fn retry(engine: &Engine) {
    let now = engine.now();
    let reconnect = engine.clients().is_none()
        || matches!(
            engine.read(|state| health(state, now)),
            ConnectionHealth::Authentication | ConnectionHealth::AccessDenied
        );
    if reconnect {
        connect(engine).await;
    } else {
        refresh(engine).await;
        if engine.read(|state| state.session.connection.connected) {
            progress::load(engine).await;
        }
    }
}

/// Swift `apply(_:)`: accepts a confirmed state unless it is older than the one shown, and
/// reconciles every prompt bound to the timer.
pub(crate) fn apply(engine: &Engine, next: TrackingState) {
    let now = engine.now();
    let cal = engine.cal();
    update_with(engine, |state, effects| apply_state(state, next, now, &cal, effects));
}

fn apply_state(
    state: &mut AppState,
    next: TrackingState,
    now: Timestamp,
    cal: &Cal,
    effects: &mut Effects,
) {
    let workspace = workspace(state);
    let scope = completion::scope(state);
    let previous = tracking(state);
    if let (Some(old), Some(new)) = (previous.and_then(|state| state.timestamp), next.timestamp)
        && new < old
    {
        return;
    }
    let identity = next.identity();
    let identity_changed = previous.map(TrackingState::identity).as_deref() != Some(&identity);
    let session = &mut state.session;
    if identity_changed {
        effects.invalidate_worklogs();
        session.completion.checked_at = None;
        session.completion.last_check = None;
    }
    session.completion.monitor.reconcile(Some(&next), &scope);
    let idle_session = IdleTrackingSession::from_state(Some(&next), Some(now), cal);
    session.awareness.ledger.idle.reconcile(idle_session.as_ref());
    if next.running() {
        if session.awareness.forgotten.pending().is_some() {
            effects.remove_notification(announce::AWARENESS_ID);
        }
        session.awareness.forgotten.reset();
    }
    let running = next.running();
    let track = next.track.clone();
    let warning = next
        .track_settings
        .as_ref()
        .and_then(|settings| settings.response_message.non_empty())
        .map(str::to_string);
    session.connection.tracking = Some(next);
    session.connection.connected = true;
    session.connection.last_sync = Some(now);
    attention::update(state, effects);
    let session = &mut state.session;
    session.connection.failure = None;
    session.connection.issue = None;
    let current = session.connection.tracking.as_ref();
    if session.meeting_return.as_ref().is_some_and(|plan| !plan.is_valid(current, &workspace, now))
    {
        session.meeting_return = None;
    }
    session.microphone.monitor.reconcile(current, &workspace);
    effects.sync_microphone();
    if running && session.paused.is_some() {
        session.paused = None;
    }
    if let Some(item) = track.as_ref().and_then(|track| track.work_item.clone()) {
        session.work_items.insert(item.id, item);
    }
    if let Some(id) = track.as_ref().and_then(|track| track.ticket_id()) {
        effects.title(id);
    }
    if let Some(id) = session.paused.as_ref().and_then(|paused| paused.ticket_id) {
        effects.title(id);
    }
    if let Some(warning) = warning {
        session.notice = Some(warning);
    }
}

/// Swift `fail(_:)`: shows the error and marks 7pace disconnected.
pub(crate) fn fail(engine: &Engine, error: AppError) {
    let message = error.to_string();
    engine.update(|state| {
        state.session.error = Some(message.clone());
        let connection = &mut state.session.connection;
        connection.issue = Some(message);
        connection.failure = Some(error);
        connection.connected = false;
    });
}

/// After a failed tracking write: never replay it. One `current` read reconciles the shown
/// state (a timed-out write may still have reached 7pace), then the original error is shown.
pub(crate) async fn reconcile_after_error(engine: &Engine, clients: &Clients, message: String) {
    match clients.seven_pace.current().await {
        Ok(state) if engine.connection_generation() == clients.generation => apply(engine, state),
        Ok(_) => {}
        Err(error) => {
            if engine.connection_generation() == clients.generation {
                fail(engine, error);
            }
        }
    }
    engine.update(|state| state.session.error = Some(message));
}

/// Swift `refreshActivities()`.
pub(crate) async fn refresh_activities(engine: &Engine) {
    if engine.preview() {
        return;
    }
    let Some(clients) = engine.clients() else { return };
    let started = engine.update(|state| {
        let connection = &mut state.session.connection;
        !std::mem::replace(&mut connection.loading_activities, true)
    });
    if !started {
        return;
    }
    let result = clients.seven_pace.activity_types().await;
    let current = engine.connection_generation() == clients.generation;
    let cached = engine.update(|state| {
        let workspace = workspace(state);
        let connection = &mut state.session.connection;
        connection.loading_activities = false;
        if !current {
            return None;
        }
        match result {
            Ok(types) => {
                connection.activity_types = types.clone();
                connection.activities_loaded = true;
                connection.activity_error = None;
                Some((workspace, types))
            }
            Err(error) => {
                connection.activities_loaded = false;
                connection.activity_error = Some(format!("Could not load activity types: {error}"));
                None
            }
        }
    });
    if let Some((workspace, types)) = cached {
        controllers::cache_activities(engine, &workspace, &types);
    }
}

/// Swift `lookup(_:)`: the Azure work item when a PAT is configured (credential problems are
/// recorded in `azureIssue` and never mark 7pace disconnected), else the 7pace search.
pub(crate) async fn lookup(engine: &Engine, clients: &Clients, id: i64) -> Result<WorkItem> {
    if let Some(azure) = &clients.azure {
        let result = azure.work_item(id).await;
        record_azure_result(engine, clients, result.as_ref().err());
        return result;
    }
    let items = clients.seven_pace.search(&id.to_string()).await?;
    items.into_iter().find(|item| item.id == id).ok_or_else(|| {
        AppError::Message(format!("Azure ticket #{id} was not found or is not accessible."))
    })
}

/// `azureIssue`: cleared by a successful Azure read, set by authentication and access errors.
fn record_azure_result(engine: &Engine, clients: &Clients, error: Option<&AppError>) {
    if engine.connection_generation() != clients.generation {
        return;
    }
    match error {
        None => engine.update(|state| state.session.connection.azure_issue = None),
        Some(error @ (AppError::Authentication(_) | AppError::AccessDenied(_))) => {
            let message = error.to_string();
            engine.update(|state| state.session.connection.azure_issue = Some(message));
        }
        Some(_) => {}
    }
}

/// Swift `loadTicketTitle(_:)` for many ids at once: one Azure batch request (200 per call),
/// or the 7pace search without a PAT. Runs in the background; failures leave the ids out.
pub(crate) fn request_titles(engine: &Engine, ids: Vec<i64>) {
    if engine.preview() {
        return;
    }
    let Some(clients) = engine.clients() else { return };
    let Ok(handle) = tokio::runtime::Handle::try_current() else { return };
    let ids = engine.update(|state| {
        let session = &mut state.session;
        let mut wanted = Vec::new();
        for id in ids {
            if (1..=i64::from(i32::MAX)).contains(&id)
                && !session.work_items.contains_key(&id)
                && session.loading_titles.insert(id)
            {
                wanted.push(id);
            }
        }
        wanted
    });
    if ids.is_empty() {
        return;
    }
    let engine = engine.clone();
    handle.spawn(async move { load_titles(&engine, clients, ids).await });
}

async fn load_titles(engine: &Engine, clients: Arc<Clients>, ids: Vec<i64>) {
    let items = match &clients.azure {
        Some(azure) => {
            let result = azure.work_items(&ids).await;
            record_azure_result(engine, &clients, result.as_ref().err());
            result.unwrap_or_default()
        }
        None => {
            let mut items = Vec::new();
            for id in &ids {
                if let Ok(found) = clients.seven_pace.search(&id.to_string()).await
                    && let Some(item) = found.into_iter().find(|item| item.id == *id)
                {
                    items.push(item);
                }
            }
            items
        }
    };
    if engine.connection_generation() != clients.generation {
        return;
    }
    engine.update(|state| {
        let session = &mut state.session;
        for id in &ids {
            session.loading_titles.remove(id);
        }
        for item in items {
            session.work_items.insert(item.id, item);
        }
    });
}
