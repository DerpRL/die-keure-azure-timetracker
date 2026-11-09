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
    /// The page the main window shows, or `null` when it is closed. `also` lists the other
    /// pages whose content the same view shows (Today shows the day review, Insights the weekly
    /// report): they load and refresh as if they were visible too.
    #[serde(rename = "app.setVisiblePage")]
    SetVisiblePage {
        page: Option<String>,
        #[cfg_attr(feature = "ts", ts(optional))]
        also: Option<Vec<String>>,
    },
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
        .ok_or_else(|| IpcError::new("invalidIntent", crate::nl::tr("The request has no type.")))?
        .to_string();
    let invalid = |error: serde_json::Error| {
        IpcError::new(
            "invalidIntent",
            crate::nl::trf(
                "The request {kind} is not valid: {error}",
                &[("kind", &kind), ("error", &error)],
            ),
        )
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
        Intent::Generic(GenericIntent::SetVisiblePage { page, also }) => {
            let page = page.filter(|page| crate::state::PAGES.contains(&page.as_str()));
            let mut extra: Vec<String> = Vec::new();
            if page.is_some() {
                for other in also.unwrap_or_default() {
                    let known = crate::state::PAGES.contains(&other.as_str());
                    if known && page.as_deref() != Some(other.as_str()) && !extra.contains(&other) {
                        extra.push(other);
                    }
                }
            }
            engine.update(|state| {
                state.visible_page = page;
                state.visible_also = extra;
            });
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
