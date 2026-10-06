//! Connection health, meeting return and quick tickets. Ported from Productivity.swift.

use jiff::Timestamp;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::model::TrackingState;
use crate::time::{add_secs, diff_secs, swift_date};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionHealth {
    Unconfigured,
    Connecting,
    Confirmed,
    Stale,
    Offline,
    Authentication,
    AccessDenied,
}

impl ConnectionHealth {
    /// The timer state is stale when the last confirmation is older than
    /// `max(90 s, 2 × poll interval + 15 s)`.
    pub fn resolve(
        configured: bool,
        connecting: bool,
        connected: bool,
        last_sync: Option<Timestamp>,
        failure: Option<&AppError>,
        now: Timestamp,
        poll_seconds: i64,
    ) -> Self {
        if connecting {
            return Self::Connecting;
        }
        match failure {
            Some(AppError::Authentication(_)) => return Self::Authentication,
            Some(AppError::AccessDenied(_)) => return Self::AccessDenied,
            _ => {}
        }
        if !configured {
            return Self::Unconfigured;
        }
        let Some(last_sync) = last_sync.filter(|_| connected) else { return Self::Offline };
        let limit = (poll_seconds as f64 * 2.0 + 15.0).max(90.0);
        if diff_secs(now, last_sync) > limit { Self::Stale } else { Self::Confirmed }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::Unconfigured => "Set up 7pace",
            Self::Connecting => "Connecting to 7pace…",
            Self::Confirmed => "7pace connected",
            Self::Stale => "7pace status is out of date",
            Self::Offline => "7pace offline",
            Self::Authentication => "Sign in to 7pace",
            Self::AccessDenied => "7pace access denied",
        }
    }

    /// The SF Symbol the Swift app showed; the UI maps it to its own icon set.
    pub fn symbol(&self) -> &'static str {
        match self {
            Self::Confirmed => "checkmark.circle.fill",
            Self::Connecting => "arrow.triangle.2.circlepath",
            Self::Authentication | Self::AccessDenied => "key.fill",
            _ => "exclamationmark.icloud",
        }
    }
}

/// A reminder to return to the previous ticket once a meeting ends.
///
/// Only the occurrence key and tracking identifiers are persisted, never calendar text. The Slack
/// fields Swift also declared (`slackCallID`, `slackTeamID`, `slackWasJoined`) belonged to the
/// removed huddle detection; they are ignored when old state is read.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingReturn {
    #[serde(alias = "occurrenceID")]
    pub occurrence_id: String,
    /// Meeting end. [`MeetingReturn::open_end`] marks a microphone session without a known end.
    #[serde(with = "crate::time::flex_date")]
    pub end: Timestamp,
    #[serde(alias = "ticketID")]
    pub ticket_id: i64,
    #[serde(alias = "activityID", default, skip_serializing_if = "Option::is_none")]
    pub activity_id: Option<String>,
    pub workspace: String,
    /// The identity of the timer started for the meeting.
    pub meeting_identity: String,
    #[serde(default)]
    pub notified: bool,
    #[serde(alias = "microphoneAppID", default, skip_serializing_if = "Option::is_none")]
    pub microphone_app_id: Option<String>,
    #[serde(alias = "microphoneSessionID", default, skip_serializing_if = "Option::is_none")]
    pub microphone_session_id: Option<String>,
}

impl MeetingReturn {
    /// Swift `Date.distantFuture` (4001-01-01), which the microphone flow stores as the end of a
    /// session that has not stopped yet.
    pub fn open_end() -> Timestamp {
        swift_date::to_timestamp(63_113_904_000.0)
    }

    /// The return plan after the user started tracking for a meeting occurrence.
    ///
    /// Only a real switch between two running timers creates a plan. Back-to-back meetings keep
    /// the original ticket and activity: when `existing` belongs to this workspace and the timer
    /// being replaced, its ticket and activity carry over (an unchanged timer only moves the plan
    /// to the new occurrence).
    pub fn after_starting(
        meeting_id: &str,
        meeting_end: Timestamp,
        previous: &TrackingState,
        next: &TrackingState,
        workspace: &str,
        existing: Option<&MeetingReturn>,
    ) -> Option<Self> {
        if !previous.running() || !next.running() {
            return None;
        }
        let original = existing.filter(|plan| {
            plan.workspace == workspace && plan.meeting_identity == previous.identity()
        });
        let ticket_id = original
            .map(|plan| plan.ticket_id)
            .or_else(|| previous.track.as_ref().and_then(|track| track.ticket_id()))?;
        if previous.identity() == next.identity() {
            let mut continued = original?.clone();
            continued.occurrence_id = meeting_id.to_string();
            continued.end = meeting_end;
            continued.notified = false;
            return Some(continued);
        }
        let activity_id = match original {
            Some(plan) => plan.activity_id.clone(),
            None => previous.track.as_ref().and_then(|track| track.activity_type_id.clone()),
        };
        Some(Self {
            occurrence_id: meeting_id.to_string(),
            end: meeting_end,
            ticket_id,
            activity_id,
            workspace: workspace.to_string(),
            meeting_identity: next.identity(),
            notified: false,
            microphone_app_id: None,
            microphone_session_id: None,
        })
    }

    /// Same workspace, the meeting timer still running, and less than 24 hours after the end.
    pub fn is_valid(&self, state: Option<&TrackingState>, workspace: &str, now: Timestamp) -> bool {
        self.workspace == workspace
            && state
                .is_some_and(|state| state.running() && state.identity() == self.meeting_identity)
            && now < add_secs(self.end, 86_400.0)
    }

    pub fn is_due(&self, state: Option<&TrackingState>, workspace: &str, now: Timestamp) -> bool {
        self.is_valid(state, workspace, now) && now >= self.end
    }
}

/// Recent and favourite tickets for quick switch, per workspace. Stores IDs only, never titles.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickTickets {
    #[serde(default)]
    pub workspace: String,
    #[serde(default)]
    pub recent: Vec<i64>,
    #[serde(default)]
    pub favorites: Vec<i64>,
}

impl QuickTickets {
    pub const RECENT_LIMIT: usize = 8;
    pub const FAVORITE_LIMIT: usize = 20;

    pub fn new(workspace: impl Into<String>) -> Self {
        Self { workspace: workspace.into(), recent: Vec::new(), favorites: Vec::new() }
    }

    /// Moves `id` to the front of the recent list, keeping at most eight.
    pub fn remember(&mut self, id: i64) {
        self.recent.retain(|other| *other != id);
        self.recent.insert(0, id);
        self.recent.truncate(Self::RECENT_LIMIT);
    }

    /// Removes a favourite, or adds one while fewer than twenty are saved.
    pub fn toggle_favorite(&mut self, id: i64) {
        if self.favorites.contains(&id) {
            self.favorites.retain(|other| *other != id);
        } else if self.favorites.len() < Self::FAVORITE_LIMIT {
            self.favorites.push(id);
        }
    }

    /// Favourites first, then recent tickets that are not favourites.
    pub fn ordered_ids(&self) -> Vec<i64> {
        let recent = self.recent.iter().filter(|id| !self.favorites.contains(id));
        self.favorites.iter().chain(recent).copied().collect()
    }
}
