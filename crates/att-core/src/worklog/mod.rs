//! Worklog editing, transactional operations and guided corrections.
//!
//! The two value types below cross crate boundaries (the 7pace client sends them), so they are
//! defined here. Their behaviour lives in the submodules:
//! - `edit`: `WorkLogTimeEdit::validate/matches`, `WorkLogConflict`, `WorkLogOverlap`,
//!   `WorkLogEditing` review/save (WorkLogEditing.swift)
//! - `ops`: `WorkLogDraft` constructors and validation, `WorkLogPlan`, `WorkLogChange`,
//!   `WorkLogOperations::apply` (WorkLogOperations.swift)
//! - `corrections`: `TimeCorrections` (TimeCorrections.swift)

use jiff::Timestamp;
use serde::{Deserialize, Serialize};

use crate::time::{add_secs, diff_secs, round_to_second};

pub mod corrections;
pub mod edit;
pub mod ops;

/// A start/end pair rounded to whole seconds. Ported from `WorkLogTimeEdit`.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkLogTimeEdit {
    pub start: Timestamp,
    pub end: Timestamp,
}

impl WorkLogTimeEdit {
    /// Rounds both ends to the nearest second, like the Swift initialiser.
    pub fn new(start: Timestamp, end: Timestamp) -> Self {
        Self { start: round_to_second(start), end: round_to_second(end) }
    }

    /// Rounded duration in whole seconds.
    pub fn seconds(&self) -> i64 {
        diff_secs(self.end, self.start).round() as i64
    }
}

/// The desired state of one worklog. Ported from `WorkLogDraft`.
///
/// Persisted inside the edit journal. Writes use camelCase keys; reads also accept the Swift keys
/// (`existingID`, `ticketID`, …) and the Swift date format, so 1.14.x journals decode directly.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkLogDraft {
    /// The server entry this draft replaces, when it updates an existing log.
    #[serde(alias = "existingID", default, skip_serializing_if = "Option::is_none")]
    pub existing_id: Option<String>,
    /// For undo: the deleted ID this draft recreates (checked to be gone first).
    #[serde(alias = "restoredID", default, skip_serializing_if = "Option::is_none")]
    pub restored_id: Option<String>,
    #[cfg_attr(feature = "ts", ts(as = "Timestamp"))]
    #[serde(with = "crate::time::flex_date")]
    pub start: Timestamp,
    pub seconds: i64,
    pub billable_seconds: i64,
    #[serde(alias = "ticketID", default, skip_serializing_if = "Option::is_none")]
    pub ticket_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(alias = "activityID", default, skip_serializing_if = "Option::is_none")]
    pub activity_id: Option<String>,
    #[serde(alias = "userID", default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(default)]
    pub allow_default_activity: bool,
}

impl WorkLogDraft {
    /// `start + seconds`.
    pub fn end(&self) -> Timestamp {
        add_secs(self.start, self.seconds as f64)
    }

    /// The draft's time span as an edit (Swift `edit`).
    pub fn edit(&self) -> WorkLogTimeEdit {
        WorkLogTimeEdit::new(self.start, self.end())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drafts_decode_swift_journal_keys_and_write_camel_case() {
        let swift = r#"{"existingID":"a","start":0,"seconds":60,"billableSeconds":60,
            "ticketID":33984,"activityID":"x","allowDefaultActivity":false}"#;
        let draft: WorkLogDraft = serde_json::from_str(swift).unwrap();
        assert_eq!(draft.existing_id.as_deref(), Some("a"));
        assert_eq!(draft.ticket_id, Some(33984));
        let json = serde_json::to_value(&draft).unwrap();
        assert_eq!(json["ticketId"], 33984);
        assert_eq!(json["start"], "2001-01-01T00:00:00Z");
        assert_eq!(serde_json::from_value::<WorkLogDraft>(json).unwrap(), draft);
    }
}
