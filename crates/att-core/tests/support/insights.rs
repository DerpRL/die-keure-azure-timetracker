//! Shared fixtures for the targets, statistics and review tests. Include with
//! `#[path = "support/insights.rs"] mod support;`.
#![allow(dead_code)]

use att_core::Cal;
use att_core::model::{ActivityType, TrackingState, WorkLog};
use att_core::time::wire_date;
use jiff::Timestamp;

/// `Europe/Brussels`, pinned like the Swift suites.
pub fn cal() -> Cal {
    Cal::brussels()
}

/// Swift `WireDate.parse(text)!`: offset-free text is UTC.
pub fn date(text: &str) -> Timestamp {
    wire_date::parse(text, None).unwrap_or_else(|| panic!("unparsable date {text}"))
}

/// Swift `localDate(_:)`: offset-free text is Brussels local time.
pub fn local_date(text: &str) -> Timestamp {
    wire_date::parse(text, Some(cal().tz())).unwrap_or_else(|| panic!("unparsable date {text}"))
}

pub fn log(id: &str, timestamp: &str, length: f64) -> WorkLog {
    WorkLog::new(id, timestamp, length)
}

pub fn ticket_log(id: &str, timestamp: &str, length: f64, ticket: i64) -> WorkLog {
    WorkLog { work_item_id: Some(ticket), ..WorkLog::new(id, timestamp, length) }
}

pub fn activity(id: &str, name: &str) -> ActivityType {
    ActivityType::new(id, name)
}

/// Swift `editableLog(_:start:length:)` from TimeEditingTests.
pub fn editable_log(id: &str, start: &str, length: f64) -> WorkLog {
    WorkLog {
        work_item_id: Some(123),
        comment: Some("Development".into()),
        is_can_edit: Some(true),
        edited_timestamp: Some("2026-09-28T12:00:00".into()),
        ..WorkLog::new(id, start, length)
    }
}

pub const EDITABLE_ID: &str = "11111111-1111-1111-1111-111111111111";

/// Swift `state(_:session:activity:)` from CoreTests: tracking `id`, or idle without one, with
/// `currentTrackLength` 120 and a fixed start.
pub fn state_with(id: Option<i64>, session: &str, activity: Option<&str>) -> TrackingState {
    let json = format!(
        r#"{{"track":{{"tfsId":{},"trackingState":"{}","workLogId":"{session}","currentTrackLength":120,"currentTrackStartedDateTime":"2026-09-29T08:00:00Z"}},"trackSettings":{{"responseState":"OK","isTrackingStartAllowed":true,"responseMessage":"Server validation"}},"timestamp":12}}"#,
        id.map_or_else(|| "null".to_string(), |id| id.to_string()),
        if id.is_none() { "idle" } else { "tracking" },
    );
    let mut state: TrackingState = serde_json::from_str(&json).expect("valid tracking state");
    if let Some(track) = state.track.as_mut() {
        track.activity_type_id = activity.map(str::to_string);
    }
    state
}

pub fn state(id: Option<i64>) -> TrackingState {
    state_with(id, "session", None)
}
