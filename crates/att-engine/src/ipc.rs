//! Errors as the UI receives them.

use serde::{Deserialize, Serialize};

use att_core::AppError;

/// `{ kind, message }`. `kind` is stable for UI logic; `message` is shown to the user verbatim.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[error("{message}")]
pub struct IpcError {
    pub kind: String,
    pub message: String,
}

impl IpcError {
    pub fn new(kind: impl Into<String>, message: impl Into<String>) -> Self {
        Self { kind: kind.into(), message: message.into() }
    }

    pub fn busy() -> Self {
        Self::new(
            "busy",
            "Another tracking change is still in progress. Wait for it to finish, then try again.",
        )
    }
}

impl From<AppError> for IpcError {
    fn from(error: AppError) -> Self {
        Self::new(error.kind(), error.to_string())
    }
}

impl From<att_store::StoreError> for IpcError {
    fn from(error: att_store::StoreError) -> Self {
        Self::new("storage", error.to_string())
    }
}
