//! Completed-ticket reminders. Ported from TicketCompletion.swift.
//!
//! The workflow status itself is [`crate::ticket::TicketWorkflowStatus`].

use std::collections::BTreeMap;

use jiff::Timestamp;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::model::TrackingState;
use crate::ticket::TicketWorkflowStatus;
use crate::time::diff_secs;

/// "This ticket is completed in Azure. Stop tracking?"
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketCompletionPrompt {
    #[serde(default = "uuid::Uuid::new_v4")]
    pub id: Uuid,
    pub scope: String,
    pub tracking_identity: String,
    #[serde(alias = "ticketID")]
    pub ticket_id: i64,
    pub title: String,
    pub workflow_state: String,
    #[serde(default)]
    pub notified: bool,
}

impl TicketCompletionPrompt {
    /// Still about the same running session of the same ticket in the same scope.
    pub fn matches(&self, tracking: Option<&TrackingState>, scope: &str) -> bool {
        self.scope == scope
            && tracking.is_some_and(|tracking| {
                tracking.running()
                    && tracking.identity() == self.tracking_identity
                    && tracking.track.as_ref().and_then(|track| track.ticket_id())
                        == Some(self.ticket_id)
            })
    }
}

/// Decisions apply to one running session. A confirmed reopen permits a later completion
/// reminder. Persisted as `ticketCompletion`, including the private `dismissed` map.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct TicketCompletionMonitor {
    #[serde(skip_serializing_if = "Option::is_none")]
    pending: Option<TicketCompletionPrompt>,
    /// `scope|tracking identity` → when "Keep tracking" was chosen.
    #[serde(with = "crate::time::flex_date::map")]
    dismissed: BTreeMap<String, Timestamp>,
}

impl TicketCompletionMonitor {
    /// "Keep tracking" lasts for the session, at most 30 days.
    pub const KEEP_SECONDS: f64 = 30.0 * 86_400.0;

    pub fn new() -> Self {
        Self::default()
    }

    pub fn pending(&self) -> Option<&TicketCompletionPrompt> {
        self.pending.as_ref()
    }

    fn key(scope: &str, identity: &str) -> String {
        format!("{scope}|{identity}")
    }

    pub fn reconcile(&mut self, tracking: Option<&TrackingState>, scope: &str) {
        if self.pending.as_ref().is_some_and(|pending| !pending.matches(tracking, scope)) {
            self.pending = None;
        }
    }

    pub fn clear_prompt(&mut self) {
        self.pending = None;
    }

    pub fn mark_notified(&mut self) {
        if let Some(pending) = &mut self.pending {
            pending.notified = true;
        }
    }

    /// "Keep tracking": no new reminder for this session.
    pub fn keep_tracking(&mut self, now: Timestamp) {
        let Some(pending) = self.pending.take() else { return };
        self.dismissed.insert(Self::key(&pending.scope, &pending.tracking_identity), now);
    }

    /// Acts only on a confirmed state of the ticket that is running. A completed category
    /// prompts once per session; any other category clears the prompt and the session's
    /// "Keep tracking" decision.
    pub fn observe(
        &mut self,
        status: &TicketWorkflowStatus,
        tracking: Option<&TrackingState>,
        scope: &str,
        confirmed: bool,
        now: Timestamp,
    ) {
        if !confirmed || scope.is_empty() {
            return;
        }
        self.reconcile(tracking, scope);
        let Some(tracking) = tracking.filter(|tracking| {
            tracking.running()
                && tracking.track.as_ref().and_then(|track| track.ticket_id())
                    == Some(status.ticket_id)
        }) else {
            return;
        };
        self.dismissed.retain(|_, kept| diff_secs(now, *kept) < Self::KEEP_SECONDS);
        let identity = tracking.identity();
        let decision = Self::key(scope, &identity);
        if !status.completed() {
            self.pending = None;
            self.dismissed.remove(&decision);
            return;
        }
        if self.dismissed.contains_key(&decision) || self.pending.is_some() {
            return;
        }
        self.pending = Some(TicketCompletionPrompt {
            id: Uuid::new_v4(),
            scope: scope.to_string(),
            tracking_identity: identity,
            ticket_id: status.ticket_id,
            title: status.title.clone(),
            workflow_state: status.state.clone(),
            notified: false,
        });
    }
}
