//! Parsing and routing UI intents.
//!
//! Intents are `{ "type": "<namespace>.<name>", …args }` with camelCase fields. Each intent
//! belongs to one owner enum: [`SessionIntent`] (port of `AppModel`) or [`ControllerIntent`]
//! (ports of the page models). A few generic intents are handled here.

use serde::Deserialize;
use serde_json::Value;

use crate::controllers::{self, ControllerIntent};
use crate::engine::Engine;
use crate::ipc::IpcError;
use crate::session::{self, SessionIntent};

/// Intents handled by the engine itself.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "type")]
pub enum GenericIntent {
    /// Every slice, as `[{ name, value }]`.
    #[serde(rename = "app.snapshot")]
    Snapshot,
    /// The page the main window shows, or `null` when it is closed.
    #[serde(rename = "app.setVisiblePage")]
    SetVisiblePage { page: Option<String> },
}

#[derive(Debug, Clone, PartialEq)]
pub enum Intent {
    Generic(GenericIntent),
    Session(SessionIntent),
    Controller(ControllerIntent),
}

/// Intent types owned by the page controllers. Every other type belongs to the session.
fn is_controller_type(kind: &str) -> bool {
    matches!(
        kind.split('.').next(),
        Some("statistics" | "timeEditor" | "weekly" | "offline" | "ticket")
    ) || matches!(kind, "dayReview.setDay" | "dayReview.refresh")
}

pub fn parse(value: Value) -> Result<Intent, IpcError> {
    let kind = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| IpcError::new("invalidIntent", "The request has no type."))?
        .to_string();
    let invalid = |error: serde_json::Error| {
        IpcError::new("invalidIntent", format!("The request {kind} is not valid: {error}"))
    };
    if matches!(kind.as_str(), "app.snapshot" | "app.setVisiblePage") {
        return serde_json::from_value(value).map(Intent::Generic).map_err(invalid);
    }
    if is_controller_type(&kind) {
        serde_json::from_value(value).map(Intent::Controller).map_err(invalid)
    } else {
        serde_json::from_value(value).map(Intent::Session).map_err(invalid)
    }
}

pub async fn route(engine: &Engine, intent: Intent) -> Result<Value, IpcError> {
    match intent {
        Intent::Generic(GenericIntent::Snapshot) => serde_json::to_value(engine.snapshot())
            .map_err(|e| IpcError::new("internal", e.to_string())),
        Intent::Generic(GenericIntent::SetVisiblePage { page }) => {
            let page = page.filter(|page| crate::state::PAGES.contains(&page.as_str()));
            engine.update(|state| state.visible_page = page);
            engine.inner.wake.notify_one();
            Ok(Value::Null)
        }
        Intent::Session(intent) => session::handle(engine, intent).await,
        Intent::Controller(intent) => controllers::handle(engine, intent).await,
    }
}

/// The result of an intent that changes state only through slices.
pub(crate) fn done() -> Result<Value, IpcError> {
    Ok(Value::Null)
}

/// Placeholder result while a handler is being ported.
pub(crate) fn not_implemented(kind: &str) -> Result<Value, IpcError> {
    Err(IpcError::new("notImplemented", format!("{kind} is not available yet.")))
}
