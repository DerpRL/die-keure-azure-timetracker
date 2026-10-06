//! Session slices: `app`, `interface`, `connection`, `tracking`, `flow`, `prompts`, `progress`,
//! `history`, `repositories`, `agenda`, `settings`, `figma` (see `docs/engine.md` §6).

use jiff::Timestamp;
use serde_json::Value;

use crate::engine::Engine;
use crate::state::AppState;

pub(crate) fn slices(
    _engine: &Engine,
    _state: &AppState,
    _now: Timestamp,
) -> Vec<(&'static str, Value)> {
    Vec::new()
}
