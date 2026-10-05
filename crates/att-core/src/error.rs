//! Application errors shared by every crate. Ported from `AppError` in Models.swift.

use jiff::{Timestamp, tz::TimeZone};

/// Every user-facing failure. Messages never contain HTTP response bodies or secrets.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(
        "Authentication failed. Check the token for {0} in Settings; it may have expired or been revoked."
    )]
    Authentication(String),
    #[error("Access denied by {0}. Check your token permissions and 7pace license.")]
    AccessDenied(String),
    #[error(
        "Your timer changed in 7pace or another app. The current state has been refreshed; review it and try again."
    )]
    RemoteChanged,
    #[error("The requested entry or API endpoint was not found.")]
    NotFound,
    #[error("7pace is limiting requests. Try again after {}.", local_time(*.0))]
    RateLimited(Timestamp),
    /// The caller cancelled the operation (Swift `CancellationError`).
    #[error("The operation was cancelled.")]
    Cancelled,
    /// The request timed out. Its outcome is unknown, so writes must never be replayed.
    #[error("The request timed out. Refresh to see what 7pace recorded before trying again.")]
    Timeout,
    /// Transport failures such as DNS, TLS or a dropped connection.
    #[error("{0}")]
    Network(String),
}

impl AppError {
    pub fn message(text: impl Into<String>) -> Self {
        Self::Message(text.into())
    }

    /// Stable machine-readable kind for the UI.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Message(_) => "message",
            Self::Authentication(_) => "authentication",
            Self::AccessDenied(_) => "accessDenied",
            Self::RemoteChanged => "remoteChanged",
            Self::NotFound => "notFound",
            Self::RateLimited(_) => "rateLimited",
            Self::Cancelled => "cancelled",
            Self::Timeout => "timeout",
            Self::Network(_) => "network",
        }
    }
}

fn local_time(ts: Timestamp) -> String {
    ts.to_zoned(TimeZone::system()).strftime("%H:%M:%S").to_string()
}

pub type Result<T, E = AppError> = std::result::Result<T, E>;
