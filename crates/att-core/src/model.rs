//! 7pace and Azure wire models plus the repository record. Ported from Models.swift.
//!
//! JSON field names match the Swift property names (camelCase), which are also the 7pace names.
//! `Configuration` is assembled after every module's preference types exist.

use jiff::{Timestamp, tz::TimeZone};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::text::NonEmpty;
use crate::time::wire_date;

/// The operating system, for per-OS defaults such as work apps and microphone apps.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HostOs {
    Macos,
    Windows,
    Other,
}

impl HostOs {
    /// The OS this binary was built for.
    pub const fn current() -> Self {
        if cfg!(target_os = "macos") {
            Self::Macos
        } else if cfg!(target_os = "windows") {
            Self::Windows
        } else {
            Self::Other
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Repository {
    pub id: Uuid,
    pub path: String,
    pub enabled: bool,
}

impl Repository {
    pub fn new(path: impl Into<String>) -> Self {
        Self { id: Uuid::new_v4(), path: path.into(), enabled: true }
    }

    /// The last path component, on both `/` and `\` separators.
    pub fn name(&self) -> &str {
        last_path_component(&self.path)
    }
}

/// Foundation's `URL(fileURLWithPath:).lastPathComponent` on both `/` and `\` separators:
/// trailing separators are ignored, and a path made only of separators names the root (`"/"`).
pub(crate) fn last_path_component(path: &str) -> &str {
    let trimmed = path.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        // Swift returns "/" for the root rather than an empty name.
        return &path[..path.len().min(1)];
    }
    trimmed.rsplit(['/', '\\']).next().unwrap_or(trimmed)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItem {
    pub id: i64,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_project: Option<String>,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_item_link: Option<String>,
}

impl WorkItem {
    pub fn new(id: i64, title: impl Into<String>) -> Self {
        Self { id, title: title.into(), team_project: None, kind: None, work_item_link: None }
    }
}

/// 7pace enums arrive as names or as their numeric representation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WireValue {
    Number(i64),
    Text(String),
}

impl WireValue {
    pub fn text(value: impl Into<String>) -> Self {
        Self::Text(value.into())
    }

    /// Lower-cased name, or the number as text.
    pub fn normalized(&self) -> String {
        match self {
            Self::Text(s) => s.to_lowercase(),
            Self::Number(n) => n.to_string(),
        }
    }

    fn is_one_of(&self, values: &[&str]) -> bool {
        let normalized = self.normalized();
        values.contains(&normalized.as_str())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityCheck {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_running: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seconds_left: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tfs_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity_type_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_item: Option<WorkItem>,
    pub tracking_state: WireValue,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_log_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_track_length: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_me_today_length: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_track_started_date_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity_check: Option<ActivityCheck>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stopped_track_type: Option<WireValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_status_change_date: Option<String>,
}

impl Track {
    /// A blank track in the given state, convenient for tests and fixtures.
    pub fn with_state(state: WireValue) -> Self {
        Self {
            tfs_id: None,
            activity_type_id: None,
            remark: None,
            work_item: None,
            tracking_state: state,
            work_log_id: None,
            current_track_length: None,
            total_me_today_length: None,
            current_track_started_date_time: None,
            activity_check: None,
            stopped_track_type: None,
            track_status_change_date: None,
        }
    }

    /// Positive ticket number only.
    pub fn ticket_id(&self) -> Option<i64> {
        self.tfs_id.filter(|id| *id > 0)
    }

    pub fn is_running(&self) -> bool {
        self.tracking_state.is_one_of(&["tracking", "activitycheck", "idlecheck", "0", "2", "3"])
    }

    pub fn is_idle(&self) -> bool {
        self.tracking_state.is_one_of(&["idle", "clientinputrequired", "1", "4"])
    }

    pub fn needs_activity_check(&self) -> bool {
        self.activity_check.as_ref().and_then(|c| c.is_running) == Some(true)
            || self.tracking_state.is_one_of(&["activitycheck", "3"])
    }

    pub fn title(&self) -> String {
        if let Some(item) = &self.work_item {
            return item.title.clone();
        }
        if let Some(remark) = self.remark.non_empty() {
            return remark.to_string();
        }
        match self.ticket_id() {
            Some(id) => format!("Work item #{id}"),
            None => "Unassigned time".to_string(),
        }
    }

    /// Optimistic-concurrency token: `"workLogId|tfsId|startedAt"`, or `"idle"`.
    pub fn identity(&self) -> String {
        if !self.is_running() {
            return "idle".to_string();
        }
        format!(
            "{}|{}|{}",
            self.work_log_id.as_deref().unwrap_or(""),
            self.tfs_id.unwrap_or(0),
            self.current_track_started_date_time.as_deref().unwrap_or("")
        )
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_tracking_start_allowed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_state: Option<WireValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_message: Option<String>,
}

impl TrackSettings {
    pub fn has_error(&self) -> bool {
        self.response_state.as_ref().is_some_and(|s| s.is_one_of(&["error", "autherror", "2", "3"]))
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackingState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track: Option<Track>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_settings: Option<TrackSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<i64>,
}

impl TrackingState {
    pub fn with_track(track: Track) -> Self {
        Self { track: Some(track), track_settings: None, timestamp: None }
    }

    /// `"unknown"` when the server sent no track.
    pub fn identity(&self) -> String {
        self.track.as_ref().map_or_else(|| "unknown".to_string(), Track::identity)
    }

    pub fn running(&self) -> bool {
        self.track.as_ref().is_some_and(Track::is_running)
    }

    /// Rejects HTTP 200 responses that carry an error state, and unknown tracking states.
    pub fn checked(self) -> Result<Self> {
        if let Some(settings) = self.track_settings.as_ref().filter(|s| s.has_error()) {
            let message = settings
                .response_message
                .non_empty()
                .unwrap_or("7pace rejected this request.")
                .to_string();
            return Err(AppError::Message(message));
        }
        match &self.track {
            Some(track) if track.is_running() || track.is_idle() => Ok(self),
            _ => Err(AppError::message(
                "7pace returned an unknown tracking state. Refresh before changing your timer.",
            )),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ActivityType {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

impl ActivityType {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self { id: id.into(), name: Some(name.into()), color: None }
    }
}

/// Ported from `ActivityChoice.resolve`.
pub fn resolve_activity(selected_id: &str, available: &[ActivityType]) -> Result<Option<String>> {
    if available.is_empty() {
        return Ok(None);
    }
    if !available.iter().any(|a| a.id == selected_id) {
        return Err(AppError::message("Choose an activity type before starting the timer."));
    }
    Ok(Some(selected_id.to_string()))
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkLogUser {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkLog {
    pub id: String,
    pub timestamp: String,
    pub length: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_item_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity_type: Option<ActivityType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_can_edit: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edited_timestamp: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billable_length: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_can_delete: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<WorkLogUser>,
}

impl WorkLog {
    /// A minimal log, convenient for tests and fixtures.
    pub fn new(id: impl Into<String>, timestamp: impl Into<String>, length: f64) -> Self {
        Self {
            id: id.into(),
            timestamp: timestamp.into(),
            length,
            work_item_id: None,
            comment: None,
            activity_type: None,
            is_can_edit: None,
            edited_timestamp: None,
            billable_length: None,
            is_can_delete: None,
            user: None,
        }
    }

    /// Start instant; offset-free timestamps are local time in `tz` (Swift `WorkLog.date`).
    pub fn date(&self, tz: &TimeZone) -> Option<Timestamp> {
        wire_date::parse(&self.timestamp, Some(tz))
    }

    pub fn ticket_id(&self) -> Option<i64> {
        self.work_item_id.filter(|id| *id > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numeric_and_named_states() {
        let running: TrackingState = serde_json::from_str(
            r#"{"track":{"tfsId":33984,"trackingState":2,"workLogId":"w","currentTrackStartedDateTime":"s"}}"#,
        )
        .unwrap();
        assert!(running.running());
        assert_eq!(running.identity(), "w|33984|s");
        let idle: TrackingState =
            serde_json::from_str(r#"{"track":{"trackingState":"Idle"}}"#).unwrap();
        assert_eq!(idle.identity(), "idle");
        assert!(idle.clone().checked().is_ok());
        let unknown: TrackingState = serde_json::from_str(r#"{}"#).unwrap();
        assert!(unknown.checked().is_err());
    }

    #[test]
    fn repository_names_on_both_separators() {
        assert_eq!(Repository::new("/Users/me/repo/").name(), "repo");
        assert_eq!(Repository::new(r"C:\code\other").name(), "other");
        assert_eq!(Repository::new("/").name(), "/");
        assert_eq!(Repository::new("").name(), "");
    }
}
