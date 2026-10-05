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
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkLogDraft {
    /// The server entry this draft replaces, when it updates an existing log.
    pub existing_id: Option<String>,
    /// For undo: the deleted ID this draft recreates (checked to be gone first).
    pub restored_id: Option<String>,
    pub start: Timestamp,
    pub seconds: i64,
    pub billable_seconds: i64,
    pub ticket_id: Option<i64>,
    pub comment: Option<String>,
    pub activity_id: Option<String>,
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
