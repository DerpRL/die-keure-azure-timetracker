//! Server-side stops and activity checks turned into a prompt. Ported from TrackingAttention.swift.

use serde::{Deserialize, Serialize};

use crate::model::TrackingState;

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AttentionReason {
    ActivityCheck,
    TimeLimit,
    ActivityTimeout,
}

impl AttentionReason {
    pub fn raw(&self) -> &'static str {
        match self {
            Self::ActivityCheck => "activityCheck",
            Self::TimeLimit => "timeLimit",
            Self::ActivityTimeout => "activityTimeout",
        }
    }
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackingAttention {
    /// Stable across polls: `reason|workLogId|startedAt|statusChangeDate|ticketID`.
    pub id: String,
    pub reason: AttentionReason,
    pub ticket_id: Option<i64>,
    pub activity_id: Option<String>,
    pub remark: Option<String>,
    pub title: String,
}

impl TrackingAttention {
    pub fn from_state(state: &TrackingState) -> Option<Self> {
        let track = state.track.as_ref()?;
        let reason = if track.is_running() && track.needs_activity_check() {
            AttentionReason::ActivityCheck
        } else if track.is_idle() {
            match track.stopped_track_type.as_ref().map(|v| v.normalized()).as_deref() {
                Some("4" | "stoppedbymaxsingletracklengthexceeded") => AttentionReason::TimeLimit,
                Some("1" | "stoppedbyactivitycheck") => AttentionReason::ActivityTimeout,
                _ => return None,
            }
        } else {
            return None;
        };
        let id = [
            reason.raw().to_string(),
            track.work_log_id.clone().unwrap_or_default(),
            track.current_track_started_date_time.clone().unwrap_or_default(),
            track.track_status_change_date.clone().unwrap_or_default(),
            track.ticket_id().unwrap_or(0).to_string(),
        ]
        .join("|");
        Some(Self {
            id,
            reason,
            ticket_id: track.ticket_id(),
            activity_id: track.activity_type_id.clone(),
            remark: track.remark.clone(),
            title: track.title(),
        })
    }

    pub fn stopped(&self) -> bool {
        self.reason != AttentionReason::ActivityCheck
    }

    pub fn heading(&self) -> &'static str {
        match self.reason {
            AttentionReason::ActivityCheck => "Still working on this task?",
            AttentionReason::TimeLimit => "7pace stopped your timer at its time limit",
            AttentionReason::ActivityTimeout => "7pace stopped after an unanswered activity check",
        }
    }

    pub fn detail(&self) -> &'static str {
        if self.stopped() {
            "Continue with a new session, or keep this task stopped. Time since the stop will not be added automatically."
        } else {
            "7pace needs your response. Continue tracking or stop this session."
        }
    }
}
