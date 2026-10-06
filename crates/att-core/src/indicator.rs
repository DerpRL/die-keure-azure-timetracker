//! Menu-bar tracking indicator and the locally remembered pause. Ported from
//! TrackingIndicator.swift, plus the status text MenuBarController.swift and AppModel.swift build
//! from it.
//!
//! Owner during the port: tracking and Git.

use jiff::Timestamp;
use serde::{Deserialize, Serialize};

use crate::model::TrackingState;

/// The tracking status shown by the tray, the panel and the timer (Swift `TrackingIndicator`).
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrackingIndicator {
    Running,
    Stopped,
    Paused,
    Disconnected,
    Connecting,
    Attention,
}

impl TrackingIndicator {
    /// `connected` means connected *and* confirmed by the connection health check.
    ///
    /// Only a confirmed running or idle track counts as connected: an unknown remote state is
    /// shown as disconnected, never as stopped. The app also shows [`Attention`](Self::Attention)
    /// while a confirmed connection has an open `TrackingAttention` prompt (AppModel
    /// `trackingIndicator`); that override belongs to the caller.
    pub fn resolve(
        connected: bool,
        connecting: bool,
        state: Option<&TrackingState>,
        paused: bool,
    ) -> Self {
        if connecting {
            return Self::Connecting;
        }
        let track = match state.and_then(|state| state.track.as_ref()) {
            Some(track) if connected && (track.is_running() || track.is_idle()) => track,
            _ => return Self::Disconnected,
        };
        if track.needs_activity_check() {
            Self::Attention
        } else if track.is_running() {
            Self::Running
        } else if paused {
            Self::Paused
        } else {
            Self::Stopped
        }
    }

    /// The status text of the tray tooltip, the panel and the timer's accessibility value.
    pub fn label(self) -> &'static str {
        match self {
            Self::Running => "Tracking",
            Self::Stopped => "Stopped",
            Self::Paused => "Paused",
            Self::Disconnected => "Disconnected",
            Self::Connecting => "Connecting",
            Self::Attention => "Check activity",
        }
    }

    /// The SF Symbol 1.14.x showed, kept for reference and for macOS assets.
    pub fn symbol(self) -> &'static str {
        match self {
            Self::Running => "play.circle.fill",
            Self::Stopped => "stop.circle",
            Self::Paused => "pause.circle.fill",
            Self::Disconnected => "exclamationmark.triangle.fill",
            Self::Connecting => "arrow.triangle.2.circlepath",
            Self::Attention => "questionmark.circle.fill",
        }
    }

    pub fn icon(self) -> IndicatorIcon {
        match self {
            Self::Running => IndicatorIcon::Running,
            Self::Stopped => IndicatorIcon::Stopped,
            Self::Paused => IndicatorIcon::Paused,
            Self::Disconnected => IndicatorIcon::Disconnected,
            Self::Connecting => IndicatorIcon::Connecting,
            Self::Attention => IndicatorIcon::Attention,
        }
    }
}

/// Platform-neutral icon state for the tray and the panel. Each OS maps it to its own asset
/// (an SF Symbol on macOS, an `.ico` on Windows) by [`id`](Self::id).
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IndicatorIcon {
    Running,
    Paused,
    Stopped,
    Disconnected,
    Connecting,
    Attention,
}

impl IndicatorIcon {
    /// Stable asset key.
    pub fn id(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Stopped => "stopped",
            Self::Disconnected => "disconnected",
            Self::Connecting => "connecting",
            Self::Attention => "attention",
        }
    }

    /// The colour role (Swift `TrackingIndicator.tint`): green while running, the warning colour
    /// when paused, disconnected or waiting for an activity check, the label colour otherwise.
    pub fn tone(self) -> IndicatorTone {
        match self {
            Self::Running => IndicatorTone::Success,
            Self::Paused | Self::Disconnected | Self::Attention => IndicatorTone::Warning,
            Self::Stopped | Self::Connecting => IndicatorTone::Neutral,
        }
    }
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IndicatorTone {
    Success,
    Warning,
    Neutral,
}

/// The tray tooltip and accessibility label (MenuBarController.swift):
/// `Azure timetracker — <status> · <health>`, plus a second line with the running or paused
/// ticket. `health_label` is the connection-health label; `ticket_title` looks up a cached Azure
/// title.
pub fn status_description(
    indicator: TrackingIndicator,
    health_label: &str,
    state: Option<&TrackingState>,
    paused: Option<&PausedSession>,
    ticket_title: impl Fn(i64) -> Option<String>,
) -> String {
    let running = state.and_then(|state| state.track.as_ref()).filter(|track| track.is_running());
    let detail = match running {
        Some(track) => track
            .ticket_id()
            .map(|id| format!("#{id} · {}", ticket_title(id).unwrap_or_else(|| track.title()))),
        None => paused.map(|paused| match paused.ticket_id {
            Some(id) => {
                format!(
                    "#{id} · {}",
                    ticket_title(id).unwrap_or_else(|| "Paused ticket".to_string())
                )
            }
            None => paused.remark.clone().unwrap_or_else(|| "Paused tracking".to_string()),
        }),
    };
    let mut text = format!("Azure timetracker — {} · {health_label}", indicator.label());
    if let Some(detail) = detail {
        text.push('\n');
        if indicator == TrackingIndicator::Disconnected {
            text.push_str("Last known: ");
        }
        text.push_str(&detail);
    }
    text
}

/// A paused remote timer remembered on this machine. Persisted in `state.json` as
/// `pausedSession`; reads the Swift keys `ticketID` and `activityID`.
///
/// Pausing stops the 7pace timer; resuming starts a new session after confirmation, so the
/// paused interval is never logged.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PausedSession {
    #[serde(alias = "ticketID", default, skip_serializing_if = "Option::is_none")]
    pub ticket_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remark: Option<String>,
    #[serde(alias = "activityID", default, skip_serializing_if = "Option::is_none")]
    pub activity_id: Option<String>,
    /// The normalised 7pace workspace URL; a pause is dropped when the workspace changes.
    pub workspace: String,
    #[cfg_attr(feature = "ts", ts(as = "Timestamp"))]
    #[serde(with = "crate::time::flex_date")]
    pub paused_at: Timestamp,
    pub elapsed_seconds: f64,
}

impl PausedSession {
    /// Swift argument order: `ticketID, activityID, workspace, pausedAt, elapsedSeconds, remark`.
    pub fn new(
        ticket_id: Option<i64>,
        activity_id: Option<&str>,
        workspace: impl Into<String>,
        paused_at: Timestamp,
        elapsed_seconds: f64,
        remark: Option<&str>,
    ) -> Self {
        Self {
            ticket_id,
            remark: remark.map(str::to_string),
            activity_id: activity_id.map(str::to_string),
            workspace: workspace.into(),
            paused_at,
            elapsed_seconds,
        }
    }

    /// The pause AppModel records just before stopping `state` for Pause or idle review.
    pub fn from_state(
        state: &TrackingState,
        workspace: impl Into<String>,
        paused_at: Timestamp,
        elapsed_seconds: f64,
    ) -> Self {
        let track = state.track.as_ref();
        Self {
            ticket_id: track.and_then(|track| track.ticket_id()),
            remark: track.and_then(|track| track.remark.clone()),
            activity_id: track.and_then(|track| track.activity_type_id.clone()),
            workspace: workspace.into(),
            paused_at,
            elapsed_seconds,
        }
    }

    /// The paused task's title (AppModel `pausedTicketTitle`), given the cached Azure title.
    pub fn title(&self, ticket_title: Option<&str>) -> String {
        match self.ticket_id {
            Some(id) => ticket_title.map_or_else(|| format!("Azure ticket #{id}"), str::to_string),
            None => self.remark.clone().unwrap_or_else(|| "Paused tracking".to_string()),
        }
    }
}
