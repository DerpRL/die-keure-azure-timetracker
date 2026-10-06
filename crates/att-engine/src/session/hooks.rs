//! Calls the controllers make into the session. The session engineer implements the bodies;
//! the signatures are the contract.

use std::collections::BTreeMap;

use jiff::Timestamp;
use jiff::civil::Date;

use att_core::day_review::DayReviewRecord;
use att_core::model::{ActivityType, TrackingState, WorkItem};

use crate::engine::Engine;
use crate::state::AppState;

/// The lower-cased 7pace workspace URL (Swift `workspaceIdentity`, 2.0 spelling with a trailing
/// `/`; 1.14.x data without it is respelled on load, compare with a slash-insensitive check, see
/// `session::connection::workspace_identity`).
pub fn workspace(state: &AppState) -> String {
    super::connection::workspace(state)
}

/// The latest confirmed tracking state, if connected.
pub fn tracking_state(state: &AppState) -> Option<TrackingState> {
    let connection = &state.session.connection;
    if connection.connected { connection.tracking.clone() } else { None }
}

/// The workspace's activity types, once loaded.
pub fn activity_types(state: &AppState) -> Vec<ActivityType> {
    state.session.connection.activity_types.clone()
}

/// Known ticket titles (the shared `workItems` cache).
pub fn work_items(state: &AppState) -> BTreeMap<i64, WorkItem> {
    state.session.work_items.clone()
}

/// Loads missing titles in the background (batched); results land in `work_items`.
pub fn request_titles(engine: &Engine, ids: Vec<i64>) {
    super::connection::request_titles(engine, ids);
}

/// After a controller wrote worklogs (time edit saved, offline draft uploaded): reload history
/// and progress (Swift `didSync`, `saveTimeEdit`).
pub async fn worklogs_changed(engine: &Engine) {
    super::history::load(engine).await;
    super::progress::load(engine).await;
}

/// A guided idle correction was applied: clear the saved correction with this id (Swift
/// `saveTimeEdit`).
pub fn idle_correction_applied(engine: &Engine, correction_id: uuid::Uuid) {
    engine.update(|state| super::awareness::correction_applied(state, correction_id));
    let _ = engine.persist();
}

/// The confirmed timer for reviews at `now`: the tracking state (while connected), when 7pace
/// last confirmed it (Swift `lastSync`) and whether the connection health is confirmed (Swift
/// `connectionHealth == .confirmed`). Requested by the controllers for the day review.
pub fn tracking_confirmation(
    state: &AppState,
    now: Timestamp,
) -> (Option<TrackingState>, Option<Timestamp>, bool) {
    let confirmed = super::connection::health(state, now)
        == att_core::productivity::ConnectionHealth::Confirmed;
    (tracking_state(state), state.session.connection.last_sync, confirmed)
}

/// The day review record of a local day in this workspace (Swift `dayReviewRecord(for:)`).
pub fn day_review_record(state: &AppState, day: Date) -> Option<DayReviewRecord> {
    super::day_review_prompt::record(state, day)
}
