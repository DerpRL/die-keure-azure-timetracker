//! Application errors shared by every crate. Ported from `AppError` in Models.swift.

use std::fmt;

use jiff::{Timestamp, tz::TimeZone};

use crate::nl::{tr, trf};

/// Every user-facing failure. Messages never contain HTTP response bodies or secrets.
#[derive(Debug, Clone, PartialEq)]
pub enum AppError {
    Message(String),
    Authentication(String),
    AccessDenied(String),
    RemoteChanged,
    NotFound,
    RateLimited(Timestamp),
    /// The caller cancelled the operation (Swift `CancellationError`).
    Cancelled,
    /// The request timed out. Its outcome is unknown, so writes must never be replayed.
    Timeout,
    /// Transport failures such as DNS, TLS or a dropped connection.
    Network(String),
}

/// The message in the interface language (`Message` and `Network` carry text that was already
/// translated where it was built).
impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::Message(text) | Self::Network(text) => return f.write_str(text),
            Self::Authentication(service) => trf(
                "Authentication failed. Check the token for {service} in Settings; it may have expired or been revoked.",
                &[("service", service)],
            ),
            Self::AccessDenied(service) => trf(
                "Access denied by {service}. Check your token permissions and 7pace license.",
                &[("service", service)],
            ),
            Self::RemoteChanged => tr(
                "Your timer changed in 7pace or another app. The current state has been refreshed; review it and try again.",
            )
            .to_string(),
            Self::NotFound => tr("The requested entry or API endpoint was not found.").to_string(),
            Self::RateLimited(until) => trf(
                "7pace is limiting requests. Try again after {time}.",
                &[("time", &local_time(*until))],
            ),
            Self::Cancelled => tr("The operation was cancelled.").to_string(),
            Self::Timeout => {
                tr("The request timed out. Refresh to see what 7pace recorded before trying again.")
                    .to_string()
            }
        };
        f.write_str(&text)
    }
}

impl std::error::Error for AppError {}

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
