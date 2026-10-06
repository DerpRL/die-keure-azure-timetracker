//! Calls the session makes into the controllers (Swift `AppModel` → sub-model calls). The
//! controllers engineer implements the bodies; the signatures are the contract.

use std::sync::Arc;

use jiff::Timestamp;

use att_core::model::ActivityType;
use att_core::offline::OfflineDraft;

use crate::clients::Clients;
use crate::engine::Engine;
use crate::state::AppState;

/// After `connect()` (Swift `statistics.configure(client)`, `timeEditor.configure(client)`, …):
/// reset every controller for the new connection (or `None` when disconnected).
pub async fn on_connection_changed(_engine: &Engine, _clients: Option<Arc<Clients>>) {}

/// After any 7pace write or tracking change (Swift `statistics.invalidate()`,
/// `dayReview.invalidate()`, `weeklyReport.invalidate()`).
pub fn invalidate_worklogs(_engine: &Engine) {}

/// Swift `offlineDrafts.cacheActivities(types, workspace:)`.
pub fn cache_activities(_engine: &Engine, _workspace: &str, _types: &[ActivityType]) {}

/// Swift `timeEditor.prepareIdleCorrection(id:start:end:)`: open the time editor on the idle
/// interval of a stopped session (`work_log_id` is the confirmed session's worklog).
pub async fn prepare_idle_correction(
    _engine: &Engine,
    _work_log_id: Option<String>,
    _start: Timestamp,
    _end: Timestamp,
) {
}

/// The running local (offline) timer, across workspaces (Swift `offlineDrafts.active`).
pub fn active_local_timer(_state: &AppState) -> Option<OfflineDraft> {
    None
}

/// An offline review or upload is in flight (Swift `offlineDrafts.working`).
pub fn offline_working(_state: &AppState) -> bool {
    false
}

/// The time editor is saving or showing an edit (Swift `timeEditor.working`,
/// `selected != nil`, `showCorrections`): awareness prompts wait.
pub fn time_editor_busy(_state: &AppState) -> bool {
    false
}
