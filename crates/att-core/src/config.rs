//! User settings. Ported from `Configuration` in Models.swift, plus the 2.0 settings for
//! user-controlled interruptions, quiet hours, cadences, hidden pages and the mini timer.
//!
//! Persisted as the `configuration` document. Writes use camelCase keys with readable names
//! (`figma`, `targets`, …); reads also accept the 1.14.x keys (`figmaDetection`, `workTargets`,
//! `sevenPaceURL`, …) through serde aliases, so the imported `state.json` slice decodes directly.
//! Every field has a default, so missing keys never fail (Swift required some of them).
//! The dead Slack settings (`slackHuddles`) are ignored on read and never written.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::awareness::WorkAwarenessPreferences;
use crate::day_review::DayReviewPreferences;
use crate::error::{AppError, Result};
use crate::figma::FigmaPreferences;
use crate::git::{BranchPattern, DEFAULT_BRANCH_PATTERN};
use crate::interface_prefs::InterfacePreferences;
use crate::meetings::MeetingPreferences;
use crate::microphone::MicrophonePreferences;
use crate::model::Repository;
use crate::targets::WorkTargets;

/// How the app signs in to 7pace. Ported from `SevenPaceAuthMode`; a missing value means
/// `apiToken`, as in 1.14.x.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SevenPaceAuthMode {
    #[default]
    #[serde(rename = "apiToken")]
    ApiToken,
    #[serde(rename = "mobilePIN", alias = "mobilePin")]
    MobilePin,
}

/// How strongly a new prompt may interrupt. 1.14.x always opened the panel and took focus
/// (`OpenAndFocus`); 2.0 opens the panel without stealing focus by default.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Interruption {
    /// Listed in the panel and overview only.
    Off,
    /// An OS notification, without opening the panel.
    NotifyOnly,
    /// Opens the tray panel without taking keyboard focus.
    #[default]
    OpenPanel,
    /// Opens the tray panel and focuses it.
    OpenAndFocus,
}

/// Every kind of prompt that can interrupt.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptKind {
    Branch,
    Meeting,
    Microphone,
    MicrophoneEnd,
    MeetingReturn,
    Figma,
    Idle,
    ForgottenTimer,
    TicketCompletion,
    TrackingAttention,
    DayReview,
    Update,
}

impl PromptKind {
    pub const ALL: [Self; 12] = [
        Self::Branch,
        Self::Meeting,
        Self::Microphone,
        Self::MicrophoneEnd,
        Self::MeetingReturn,
        Self::Figma,
        Self::Idle,
        Self::ForgottenTimer,
        Self::TicketCompletion,
        Self::TrackingAttention,
        Self::DayReview,
        Self::Update,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::Branch => "Branch changes",
            Self::Meeting => "Calendar meetings",
            Self::Microphone => "Microphone meetings",
            Self::MicrophoneEnd => "Meeting ended",
            Self::MeetingReturn => "Return after meetings",
            Self::Figma => "Figma files",
            Self::Idle => "Time away",
            Self::ForgottenTimer => "Working without a timer",
            Self::TicketCompletion => "Completed tickets",
            Self::TrackingAttention => "7pace timer checks",
            Self::DayReview => "Day review",
            Self::Update => "App updates",
        }
    }
}

/// While active, prompts do not open the panel or send notifications. They stay listed in the
/// panel and overview. 7pace activity checks still interrupt, because 7pace stops the timer
/// when they go unanswered.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuietHours {
    pub enabled: bool,
    /// Minutes after local midnight.
    pub start_minute: u16,
    pub end_minute: u16,
}

impl Default for QuietHours {
    fn default() -> Self {
        Self { enabled: false, start_minute: 18 * 60, end_minute: 8 * 60 }
    }
}

impl QuietHours {
    /// Whether `minute` (after local midnight) is inside the quiet period, which may wrap
    /// past midnight.
    pub fn contains(&self, minute: u16) -> bool {
        if !self.enabled || self.start_minute == self.end_minute {
            return false;
        }
        if self.start_minute < self.end_minute {
            (self.start_minute..self.end_minute).contains(&minute)
        } else {
            minute >= self.start_minute || minute < self.end_minute
        }
    }

    pub fn is_valid(&self) -> bool {
        self.start_minute < 24 * 60 && self.end_minute < 24 * 60
    }
}

/// Polling intervals in seconds. The 7pace interval stays in `poll_seconds` for compatibility.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Cadences {
    /// Git HEAD, presence, microphone and Figma probes.
    pub probe_seconds: u32,
    pub calendar_seconds: u32,
    pub progress_seconds: u32,
    pub update_check_seconds: u32,
}

impl Default for Cadences {
    fn default() -> Self {
        Self {
            probe_seconds: 2,
            calendar_seconds: 30,
            progress_seconds: 300,
            update_check_seconds: 60,
        }
    }
}

impl Cadences {
    pub const PROBE: std::ops::RangeInclusive<u32> = 1..=10;
    pub const CALENDAR: std::ops::RangeInclusive<u32> = 15..=300;
    pub const PROGRESS: std::ops::RangeInclusive<u32> = 60..=3600;
    pub const UPDATE_CHECK: std::ops::RangeInclusive<u32> = 60..=86_400;

    pub fn is_valid(&self) -> bool {
        Self::PROBE.contains(&self.probe_seconds)
            && Self::CALENDAR.contains(&self.calendar_seconds)
            && Self::PROGRESS.contains(&self.progress_seconds)
            && Self::UPDATE_CHECK.contains(&self.update_check_seconds)
    }
}

/// The 7pace polling choices offered in Settings (seconds).
pub const POLL_CHOICES: [i64; 4] = [30, 60, 120, 300];

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Configuration {
    pub organization: String,
    pub project: String,
    #[serde(alias = "sevenPaceURL")]
    pub seven_pace_url: String,
    pub seven_pace_auth_mode: SevenPaceAuthMode,
    pub repositories: Vec<Repository>,
    pub branch_pattern: String,
    pub auto_start_when_idle: bool,
    pub notifications_enabled: bool,
    pub watch_enabled: bool,
    pub calendar_enabled: bool,
    #[serde(alias = "selectedCalendarIDs")]
    pub selected_calendar_ids: Vec<String>,
    #[serde(alias = "activityTypeID")]
    pub activity_type_id: String,
    pub poll_seconds: i64,
    #[serde(alias = "figmaDetection")]
    pub figma: FigmaPreferences,
    #[serde(alias = "interfacePreferences")]
    pub interface: InterfacePreferences,
    /// `None` for settings saved before onboarding existed (see
    /// `InterfacePreferences::needs_onboarding`).
    pub interface_setup_completed: Option<bool>,
    #[serde(alias = "microphoneMeetings")]
    pub microphone: MicrophonePreferences,
    #[serde(alias = "meetingSuggestions")]
    pub meetings: MeetingPreferences,
    #[serde(alias = "workTargets")]
    pub targets: WorkTargets,
    #[serde(alias = "ticketCompletionReminders")]
    pub completion_reminders: bool,
    pub automatic_update_checks: bool,
    pub quick_switch_enabled: bool,
    #[serde(alias = "workAwareness")]
    pub awareness: WorkAwarenessPreferences,
    #[serde(alias = "endOfDayReview")]
    pub day_review: DayReviewPreferences,

    // 2.0 settings.
    /// Per prompt kind; missing kinds use [`Interruption::default`].
    pub interruptions: BTreeMap<PromptKind, Interruption>,
    pub quiet_hours: QuietHours,
    pub cadences: Cadences,
    /// Page ids hidden from the sidebar (`offlineDrafts`, `weeklyReport`, …).
    pub hidden_pages: Vec<String>,
    /// Small always-on-top elapsed-time window (mainly for Windows).
    pub mini_timer: bool,
    /// Quick-switch accelerator; `None` uses the OS default (⌃⌥T on macOS,
    /// Ctrl+Alt+Shift+T on Windows).
    pub quick_switch_shortcut: Option<String>,
}

impl Default for Configuration {
    fn default() -> Self {
        Self {
            organization: String::new(),
            project: String::new(),
            seven_pace_url: String::new(),
            seven_pace_auth_mode: SevenPaceAuthMode::default(),
            repositories: Vec::new(),
            branch_pattern: DEFAULT_BRANCH_PATTERN.to_string(),
            auto_start_when_idle: false,
            notifications_enabled: true,
            watch_enabled: true,
            calendar_enabled: false,
            selected_calendar_ids: Vec::new(),
            activity_type_id: String::new(),
            poll_seconds: 60,
            figma: FigmaPreferences::default(),
            interface: InterfacePreferences::default(),
            interface_setup_completed: None,
            microphone: MicrophonePreferences::default(),
            meetings: MeetingPreferences::default(),
            targets: WorkTargets::default(),
            completion_reminders: true,
            automatic_update_checks: true,
            quick_switch_enabled: true,
            awareness: WorkAwarenessPreferences::default(),
            day_review: DayReviewPreferences::default(),
            interruptions: BTreeMap::new(),
            quiet_hours: QuietHours::default(),
            cadences: Cadences::default(),
            hidden_pages: Vec::new(),
            mini_timer: false,
            quick_switch_shortcut: None,
        }
    }
}

impl Configuration {
    pub fn interruption(&self, kind: PromptKind) -> Interruption {
        self.interruptions.get(&kind).copied().unwrap_or_default()
    }

    /// The 7pace polling interval, kept within the choices Settings offers.
    pub fn poll_interval(&self) -> f64 {
        self.poll_seconds.clamp(30, 300) as f64
    }

    /// The checks `saveSettings` ran in 1.14.x before saving, plus the 2.0 bounds. Endpoint
    /// URLs and credentials are validated by the network layer.
    pub fn validate(&self) -> Result<()> {
        if !self.awareness.is_valid() {
            return Err(AppError::message(
                "Choose idle and forgotten-timer thresholds between 1 and 120 minutes.",
            ));
        }
        if !self.day_review.is_valid() {
            return Err(AppError::message(
                "Day review needs a finish time after the workday start, at least one selected day, and valid gap/long-entry thresholds.",
            ));
        }
        if !self.targets.is_valid() {
            return Err(AppError::message(
                "Each daily target must be between 0 and 24 hours. Use 0 for a day off.",
            ));
        }
        let default_ticket = self.meetings.default_ticket.trim();
        if !default_ticket.is_empty()
            && !default_ticket.parse::<i64>().is_ok_and(|id| id > 0 && id <= i64::from(i32::MAX))
        {
            return Err(AppError::message(
                "Enter a valid default meeting ticket number, or leave it empty.",
            ));
        }
        BranchPattern::new(&self.branch_pattern)?;
        if !self.cadences.is_valid() {
            return Err(AppError::message(
                "Choose polling intervals within the ranges shown in Settings.",
            ));
        }
        if !self.quiet_hours.is_valid() {
            return Err(AppError::message("Choose quiet hours between 00:00 and 23:59."));
        }
        Ok(())
    }
}
