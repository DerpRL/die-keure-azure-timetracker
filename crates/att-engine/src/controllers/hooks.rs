//! Calls the session makes into the controllers (Swift `AppModel` → sub-model calls). The
//! controllers engineer implements the bodies; the signatures are the contract.

use std::sync::Arc;

use jiff::Timestamp;
use uuid::Uuid;

use att_core::model::ActivityType;
use att_core::offline::OfflineDraft;

use super::{offline, page_appeared, time_editor, weekly};
use crate::clients::Clients;
use crate::engine::Engine;
use crate::state::AppState;

/// After `connect()` (Swift `statistics.configure(client)`, `timeEditor.configure(client)`, …):
/// reset every controller for the new connection (or `None` when disconnected). Results of
/// requests made for the previous connection are dropped. The page that is shown loads again
/// for the new connection (Swift's views reloaded on `connectionID`), in the background.
pub async fn on_connection_changed(engine: &Engine, clients: Option<Arc<Clients>>) {
    let configured = clients.is_some();
    let workspace = clients.as_ref().map(|clients| clients.workspace.clone());
    let azure = clients.as_ref().is_some_and(|clients| clients.azure.is_some());
    let cal = engine.cal();
    let services = engine.services();
    let page = engine.update(|state| {
        let controllers = &mut state.controllers;
        controllers.statistics.configure(configured);
        controllers.time_editor.configure(workspace.clone());
        controllers.day_review.configure(configured);
        weekly::configure(services, &mut controllers.weekly, workspace, &cal);
        controllers.offline.configure(configured);
        controllers.ticket_context.configure(azure);
        state.visible_page.clone()
    });
    if configured {
        page_appeared(engine, page.as_deref());
    }
}

/// After any 7pace write or tracking change (Swift `statistics.invalidate()`,
/// `dayReview.invalidate()`, `weeklyReport.invalidate()`). Statistics and the day review download
/// again on their next refresh; a shown weekly report reloads at once.
pub fn invalidate_worklogs(engine: &Engine) {
    engine.update(|state| {
        state.controllers.statistics.invalidate();
        state.controllers.day_review.invalidate();
    });
    weekly::invalidate(engine);
}

/// Swift `offlineDrafts.cacheActivities(types, workspace:)`.
pub fn cache_activities(engine: &Engine, workspace: &str, types: &[ActivityType]) {
    offline::cache_activities(engine, workspace, types);
}

/// Swift `timeEditor.prepareIdleCorrection(id:start:end:)`: open the time editor on the idle
/// interval of a stopped session (`work_log_id` is the confirmed session's worklog).
///
/// Prefer [`prepare_idle_correction_for`]: without the review's id a saved correction cannot
/// clear the session's pending idle review.
pub async fn prepare_idle_correction(
    engine: &Engine,
    work_log_id: Option<String>,
    start: Timestamp,
    end: Timestamp,
) {
    time_editor::prepare_idle(engine, None, work_log_id, start, end).await;
}

/// [`prepare_idle_correction`] for the saved idle review `correction_id` (Swift
/// `workAwareness.correction.id`). After the correction is saved the controllers call
/// `session::hooks::idle_correction_applied(engine, correction_id)` (Swift `saveTimeEdit`).
pub async fn prepare_idle_correction_for(
    engine: &Engine,
    correction_id: Uuid,
    work_log_id: Option<String>,
    start: Timestamp,
    end: Timestamp,
) {
    time_editor::prepare_idle(engine, Some(correction_id), work_log_id, start, end).await;
}

/// The running local (offline) timer, across workspaces (Swift `offlineDrafts.active`).
pub fn active_local_timer(state: &AppState) -> Option<OfflineDraft> {
    state.controllers.offline.ledger.active().cloned()
}

/// An offline review or upload is in flight (Swift `offlineDrafts.working`).
pub fn offline_working(state: &AppState) -> bool {
    state.controllers.offline.working
}

/// The time editor is saving or showing an edit (Swift `timeEditor.working`,
/// `selected != nil`, `showCorrections`): awareness prompts wait.
pub fn time_editor_busy(state: &AppState) -> bool {
    let editor = &state.controllers.time_editor;
    editor.working || editor.selected.is_some() || editor.show_corrections
}
