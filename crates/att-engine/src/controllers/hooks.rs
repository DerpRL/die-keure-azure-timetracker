//! Calls the session makes into the controllers (Swift `AppModel` → sub-model calls). The
//! controllers engineer implements the bodies; the signatures are the contract.

use std::sync::Arc;

use jiff::Timestamp;
use uuid::Uuid;

use att_core::model::ActivityType;
use att_core::offline::{OfflineDraft, OfflineDraftStatus};

use super::{offline, page_appeared, persist, time_editor, weekly};
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
    let pages = engine.update(|state| {
        let controllers = &mut state.controllers;
        controllers.statistics.configure(configured);
        controllers.time_editor.configure(workspace.clone());
        controllers.day_review.configure(configured);
        weekly::configure(services, &mut controllers.weekly, workspace, &cal);
        controllers.offline.configure(configured);
        controllers.ticket_context.configure(azure);
        state.visible_pages()
    });
    if configured {
        for page in &pages {
            page_appeared(engine, Some(page.as_str()));
        }
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

/// `app.resetLocalData`: removes the local records of offline drafts that were already synced
/// to 7pace, in every workspace. Unsent drafts (local, running, or with an unconfirmed upload)
/// stay. Written to the store before memory changes, like every ledger change; refused while
/// the ledger is unreadable or a review or upload runs. Returns how many were removed.
pub fn clear_synced_offline_drafts(engine: &Engine) -> Result<usize, String> {
    let services = engine.services();
    engine.update(|state| {
        let offline = &mut state.controllers.offline;
        if offline.unreadable {
            return Err(
                "The saved drafts are unreadable; the original file has been preserved.".into()
            );
        }
        if offline.working {
            return Err("Wait for the offline draft upload to finish.".into());
        }
        let mut next = offline.ledger.clone();
        next.drafts.retain(|draft| draft.status != OfflineDraftStatus::Synced);
        let removed = offline.ledger.drafts.len() - next.drafts.len();
        if removed == 0 {
            return Ok(0);
        }
        if !services.preview {
            persist::write_ledger(services, &next).map_err(|error| error.to_string())?;
        }
        offline.ledger = next;
        offline.review = None;
        Ok(removed)
    })
}
