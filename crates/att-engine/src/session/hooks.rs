//! Calls the controllers make into the session. The session engineer implements the bodies;
//! the signatures are the contract.

use std::collections::BTreeMap;

use att_core::model::{ActivityType, TrackingState, WorkItem};

use crate::engine::Engine;
use crate::state::AppState;

/// The lower-cased 7pace workspace URL (Swift `workspaceIdentity`).
pub fn workspace(state: &AppState) -> String {
    crate::clients::workspace_identity(&state.config.seven_pace_url)
}

/// The latest confirmed tracking state, if connected.
pub fn tracking_state(_state: &AppState) -> Option<TrackingState> {
    None
}

/// The workspace's activity types, once loaded.
pub fn activity_types(_state: &AppState) -> Vec<ActivityType> {
    Vec::new()
}

/// Known ticket titles (the shared `workItems` cache).
pub fn work_items(_state: &AppState) -> BTreeMap<i64, WorkItem> {
    BTreeMap::new()
}

/// Loads missing titles in the background (batched); results land in `work_items`.
pub fn request_titles(_engine: &Engine, _ids: Vec<i64>) {}

/// After a controller wrote worklogs (time edit saved, offline draft uploaded): reload history
/// and progress (Swift `didSync`, `saveTimeEdit`).
pub async fn worklogs_changed(_engine: &Engine) {}

/// A guided idle correction was applied: clear the saved correction with this id (Swift
/// `saveTimeEdit`).
pub fn idle_correction_applied(_engine: &Engine, _correction_id: uuid::Uuid) {}
