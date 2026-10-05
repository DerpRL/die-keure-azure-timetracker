//! Azure workflow status shared by the network client and the completion monitor.
//! Ported from `TicketWorkflowStatus` in TicketCompletion.swift.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketWorkflowStatus {
    pub ticket_id: i64,
    pub title: String,
    pub state: String,
    pub category: String,
}

impl TicketWorkflowStatus {
    /// Completion is decided by the workflow *category*, never by the state name.
    pub fn completed(&self) -> bool {
        self.category.eq_ignore_ascii_case("Completed")
    }
}
