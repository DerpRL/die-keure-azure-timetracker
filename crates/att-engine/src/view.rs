//! Assembles every view slice (see `docs/engine.md` §6). Slices are cheap to build; the
//! publisher sends only the ones whose JSON changed.

use jiff::Timestamp;
use serde_json::Value;

use crate::engine::Engine;
use crate::state::AppState;
use crate::{controllers, session};

pub(crate) fn slices(
    engine: &Engine,
    state: &AppState,
    now: Timestamp,
) -> Vec<(&'static str, Value)> {
    let mut slices = session::view::slices(engine, state, now);
    slices.extend(controllers::view::slices(engine, state, now));
    slices
}
