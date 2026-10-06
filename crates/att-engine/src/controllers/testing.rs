//! Test seams for the controllers' integration tests (`crates/att-engine/tests/controllers_*`).
//!
//! The session (which owns `connect()` and the `workItems` cache) is ported in parallel; until
//! it lands these let the tests drive the controllers the way the session will:
//! [`install_clients`] does what `connect()` does for the controllers, and the title seam
//! stands in for the session's ticket-title cache. Not used in production.

use std::collections::BTreeMap;

use uuid::Uuid;

use super::{TitleSeam, hooks};
use crate::clients::Clients;
use crate::engine::Engine;

/// Installs `clients` as the engine's connection (bumping the connection generation) and calls
/// [`hooks::on_connection_changed`], as the session's `connect()` does. Returns the generation.
pub async fn install_clients(engine: &Engine, clients: Option<Clients>) -> u64 {
    let generation = engine.set_clients(clients);
    hooks::on_connection_changed(engine, engine.clients()).await;
    generation
}

/// Routes ticket titles through an in-memory map instead of `session::hooks`.
pub fn use_title_seam(engine: &Engine) {
    engine.update(|state| state.controllers.title_seam = Some(TitleSeam::default()));
}

/// The titles the seam reports as known (the session's `workItems`).
pub fn set_titles(engine: &Engine, titles: BTreeMap<i64, String>) {
    engine.update(|state| {
        state.controllers.title_seam.get_or_insert_with(TitleSeam::default).titles = titles;
    });
}

/// Every title request the controllers made through the seam, in order.
pub fn title_requests(engine: &Engine) -> Vec<Vec<i64>> {
    engine.read(|state| {
        state.controllers.title_seam.as_ref().map(|seam| seam.requests.clone()).unwrap_or_default()
    })
}

/// How many statistics analyses actually ran (debounced or superseded ones excluded).
pub fn statistics_analyses(engine: &Engine) -> u64 {
    engine.read(|state| state.controllers.statistics.analyses_run)
}

/// The session idle review the open guided correction belongs to.
pub fn idle_correction(engine: &Engine) -> Option<Uuid> {
    engine.read(|state| state.controllers.time_editor.idle_correction)
}
