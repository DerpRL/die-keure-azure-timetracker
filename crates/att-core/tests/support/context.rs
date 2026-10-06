//! Fixtures shared by the context-engine tests. Include with
//! `#[path = "support/context.rs"] mod support;`.
#![allow(dead_code)]

use att_core::Cal;
use att_core::model::{ActivityType, TrackingState};
use att_core::time::{from_secs, swift_date, wire_date};
use jiff::Timestamp;

/// Swift `state(_:session:)` from CoreTests.swift: tracking `ticket` when given, idle without
/// one, with worklog `session`, a 120 s track started 2026-09-29T08:00:00Z and an OK response.
pub fn state(ticket: Option<i64>, session: &str) -> TrackingState {
    let tfs_id = ticket.map_or_else(|| "null".to_string(), |id| id.to_string());
    let tracking = if ticket.is_some() { "tracking" } else { "idle" };
    let json = format!(
        r#"{{"track":{{"tfsId":{tfs_id},"trackingState":"{tracking}","workLogId":"{session}","currentTrackLength":120,"currentTrackStartedDateTime":"2026-09-29T08:00:00Z"}},"trackSettings":{{"responseState":"OK","isTrackingStartAllowed":true,"responseMessage":"Server validation"}},"timestamp":12}}"#
    );
    serde_json::from_str(&json).expect("valid tracking fixture")
}

/// Swift `state(ticket)`: running on `ticket` in session "session".
pub fn running(ticket: i64) -> TrackingState {
    state(Some(ticket), "session")
}

/// Swift `state()`: idle.
pub fn idle() -> TrackingState {
    state(None, "session")
}

/// Swift `Date(timeIntervalSince1970:)`.
pub fn at(unix_seconds: f64) -> Timestamp {
    from_secs(unix_seconds)
}

/// Swift `localDate(_:)` with the zone pinned to Europe/Brussels.
pub fn local(raw: &str) -> Timestamp {
    wire_date::parse(raw, Some(Cal::brussels().tz())).expect("valid local date")
}

/// How Swift's `JSONEncoder` writes a `Date`: seconds since 2001-01-01.
pub fn swift(ts: Timestamp) -> f64 {
    swift_date::from_timestamp(ts)
}

pub fn activity(id: &str, name: &str) -> ActivityType {
    ActivityType::new(id, name)
}
