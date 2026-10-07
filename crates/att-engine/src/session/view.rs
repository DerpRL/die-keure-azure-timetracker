//! Session slices: `app`, `interface`, `connection`, `tracking`, `flow`, `prompts`,
//! `progress`, `history`, `workItems`, `repositories`, `agenda`, `settings`, `figma`
//! (see `docs/engine.md` §6).
//!
//! These structs are the UI contract. Their JSON mirrors `apps/desktop/src/ipc/contract.ts`;
//! change both together. Instants are RFC 3339 strings, calendar days `YYYY-MM-DD`.
//!
//! Live values are not republished every second: the tracking slice carries `elapsedBase` +
//! `confirmedAt` + `extrapolate`, the progress slice `computedAt` + `extrapolate`.

use std::collections::BTreeMap;

use jiff::Timestamp;
use jiff::civil::Date;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use att_core::awareness::{ForgottenReminder, IdlePeriod};
use att_core::completion::TicketCompletionPrompt;
use att_core::config::{Interruption, PromptKind};
use att_core::figma::{FigmaContextEvent, FigmaDocument, FigmaPreferences, FigmaSuggestion};
use att_core::git::{AuditEntry, BranchChange};
use att_core::interface_prefs::InterfacePreferences;
use att_core::manual::ManualTrackingKind;
use att_core::meetings::MeetingEvent;
use att_core::microphone::{MicrophoneApp, MicrophoneSession};
use att_core::microphone_end::MicrophoneEndPrompt;
use att_core::model::{ActivityType, HostOs, TrackingState, WorkItem, WorkLog};
use att_core::offline::LocalTimerDisplay;
use att_core::productivity::ConnectionHealth;
use att_core::targets::TargetProgress;
use att_core::text::{NonEmpty, contains_folded};
use att_core::{Cal, Configuration};
use att_net::Endpoint;
use att_platform::{CalendarAccess, CalendarInfo, InputOwner};

use crate::controllers::hooks as controllers;
use crate::engine::Engine;
use crate::shell::TrayState;
use crate::state::{AppState, PAGES};

use super::tracking::{TrackingDraft, can_start, preferred_activity_id};
use super::{
    branches, completion, connection, day_review_prompt, figma, history, meeting_return, meetings,
    microphone, settings, tray,
};

// -- app -------------------------------------------------------------------------------------

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSlice {
    pub version: String,
    pub os: HostOs,
    pub preview: bool,
    /// Show the appearance onboarding instead of the app.
    pub onboarding: bool,
    pub visible_page: Option<String>,
    /// Sidebar pages in order.
    pub pages: Vec<PageInfo>,
    /// A remote write or connection is in progress.
    pub busy: bool,
    pub notice: Option<String>,
    /// The latest error, shown in a dismissible banner.
    pub error: Option<String>,
    pub storage_issue: Option<String>,
    pub features: Features,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub id: String,
    pub title: String,
    /// `today`, `insights` or `setup`.
    pub group: String,
    /// Hidden by the user (Settings → Features).
    pub hidden: bool,
    /// Unavailable on this OS (Agenda on Windows).
    pub available: bool,
    /// A count shown on the item, e.g. pending branch changes on Overview.
    pub badge: Option<u32>,
    /// A dot shown on the item, e.g. a due day review.
    pub dot: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Features {
    /// Calendar integration exists on this OS (macOS only at launch).
    pub calendar: bool,
    /// The microphone probe works on this OS version.
    pub microphone: bool,
    /// Figma files are identified by window title only (Windows, experimental).
    pub figma_title_only: bool,
}

// -- connection -------------------------------------------------------------------------------

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Health {
    #[default]
    Unconfigured,
    Connecting,
    Confirmed,
    Stale,
    Disconnected,
    Authentication,
    AccessDenied,
}

impl From<ConnectionHealth> for Health {
    fn from(health: ConnectionHealth) -> Self {
        match health {
            ConnectionHealth::Unconfigured => Self::Unconfigured,
            ConnectionHealth::Connecting => Self::Connecting,
            ConnectionHealth::Confirmed => Self::Confirmed,
            ConnectionHealth::Stale => Self::Stale,
            ConnectionHealth::Offline => Self::Disconnected,
            ConnectionHealth::Authentication => Self::Authentication,
            ConnectionHealth::AccessDenied => Self::AccessDenied,
        }
    }
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSlice {
    pub health: Health,
    /// The tray/status icon state.
    pub indicator: TrayState,
    /// One-line status, e.g. "7pace connected".
    pub status: String,
    pub detail: Option<String>,
    /// Lower-cased workspace URL, empty when not configured.
    pub workspace: String,
    pub host: Option<String>,
    /// Last confirmed 7pace timer read.
    pub last_sync: Option<Timestamp>,
    /// Last successful worklog download for progress.
    pub worklog_sync: Option<Timestamp>,
    pub connection_issue: Option<String>,
    pub azure_issue: Option<String>,
    pub progress_issue: Option<String>,
    pub has_azure_pat: bool,
    pub has_seven_pace_token: bool,
    pub connected: bool,
    pub connecting: bool,
    /// Why the last ticket completion check failed ("Ticket completion check: …").
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub completion_issue: Option<String>,
    /// The quick-switch shortcut could not be registered (reported by the shell through
    /// `app.reportShortcutIssue`).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub shortcut_issue: Option<String>,
}

// -- tracking ---------------------------------------------------------------------------------

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackingSlice {
    pub running: bool,
    pub ticket_id: Option<i64>,
    /// Ticket title, comment or "Unassigned time".
    pub title: String,
    pub activity_id: Option<String>,
    pub activity_name: Option<String>,
    pub remark: Option<String>,
    /// Elapsed seconds at `confirmed_at`. While `extrapolate` is true the UI adds
    /// `now - confirmed_at`; otherwise the value stays still (stale or paused).
    pub elapsed_base: f64,
    pub confirmed_at: Option<Timestamp>,
    pub extrapolate: bool,
    pub paused: Option<PausedView>,
    /// The running offline/local timer, if any.
    pub local: Option<LocalTimerView>,
    /// The local timer leads the menu bar (Swift `showsLocalTimer`).
    pub shows_local_timer: bool,
    /// The Azure/7pace session stays visible next to the local timer (Swift `showsRemoteTimer`).
    pub shows_remote_timer: bool,
    pub attention: Option<AttentionView>,
    /// Seconds recorded today excluding the running entry (Swift `todaySeconds`).
    pub today_seconds: f64,
    /// Azure web link for the running ticket, when the organization is configured.
    pub ticket_url: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PausedView {
    pub ticket_id: Option<i64>,
    pub title: String,
    pub activity_id: Option<String>,
    pub activity_name: Option<String>,
    pub remark: Option<String>,
    pub paused_at: Timestamp,
    pub elapsed_seconds: f64,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTimerView {
    pub draft_id: Uuid,
    pub ticket_id: Option<i64>,
    pub title: String,
    pub comment: Option<String>,
    pub activity_name: Option<String>,
    pub start: Timestamp,
    /// The timer belongs to another 7pace workspace ("Workspace: …").
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub other_workspace: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttentionView {
    pub id: String,
    /// `activityCheck`, `timeLimit` or `activityTimeout`.
    pub reason: String,
    pub heading: String,
    pub detail: String,
    pub ticket_id: Option<i64>,
    pub title: String,
    pub stopped: bool,
}

// -- flow (ticket search and activity chooser) -----------------------------------------------

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FlowSurface {
    /// No tracking choice in progress.
    #[default]
    None,
    /// The tray panel shows the ticket search / activity chooser.
    Panel,
    /// The main window shows the ticket picker sheet.
    Picker,
}

/// Where a draft came from; decides labels and revalidation.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DraftSource {
    Ticket,
    Branch,
    Meeting,
    Microphone,
    Figma,
    Resume,
    Attention,
    MeetingReturn,
    Manual,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftView {
    pub id: Uuid,
    pub source: DraftSource,
    pub title: String,
    pub item: Option<WorkItem>,
    /// "Use Azure ticket" can be switched off.
    pub allows_no_ticket: bool,
    pub manual: Option<ManualTrackingKind>,
    /// The activity the chooser preselects (Swift `preferredActivityID`), or `""` when that
    /// activity is not loaded.
    pub preferred_activity_id: String,
    /// Activities the user may start with; empty means any loaded activity.
    pub allowed_activity_ids: Vec<String>,
    /// Shown when an activity is required but missing (Design for Figma, Standup for stand-ups).
    pub required_activity: Option<String>,
    /// Prefilled comment for ticket-free starts.
    pub default_comment: String,
    /// The primary button says "Resume" instead of "Start".
    pub resume: bool,
    /// A daily stand-up: only the Standup activity can start it.
    pub standup: bool,
    /// Started from Figma: only the Design activity can start it.
    pub is_figma: bool,
    /// The 7pace comment the draft carries (Swift `remark`), shown with the ticket switched off.
    pub remark: Option<String>,
    /// "Comment: …" with the ticket included (Swift `trackingComment(includeTicket: true)`).
    pub comment_with_ticket: Option<String>,
    /// "Comment: …" with the ticket switched off.
    pub comment_without_ticket: Option<String>,
    /// The calendar meeting the draft is for.
    pub meeting_title: Option<String>,
    /// "Choose a ticket instead…" / "Choose another ticket…" is offered
    /// (`tracking.chooseSuggestionTicket`).
    pub can_choose_ticket: bool,
    /// The activity ids `tracking.start` accepts right now (Swift `canStart`), `""` included
    /// when the workspace has no activity types; empty while busy or disconnected.
    pub startable_activity_ids: Vec<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionView {
    /// `branch`, `meeting` or `figma`.
    pub kind: String,
    pub title: String,
    pub ticket_id: Option<i64>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchView {
    pub query: String,
    pub results: Vec<WorkItem>,
    pub searching: bool,
    pub error: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickTicketView {
    pub ticket_id: i64,
    pub title: Option<String>,
    pub favorite: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowSlice {
    pub surface: FlowSurface,
    pub draft: Option<DraftView>,
    /// A branch, meeting or Figma suggestion the user is choosing a ticket for.
    pub selected_suggestion: Option<SuggestionView>,
    pub search: SearchView,
    pub activity_types: Vec<ActivityType>,
    pub activities_loaded: bool,
    pub loading_activities: bool,
    pub activity_error: Option<String>,
    /// Favourites first, then recent tickets (Swift `QuickTickets.orderedIDs`).
    pub quick_tickets: Vec<QuickTicketView>,
    pub default_activity_id: String,
}

// -- prompts ----------------------------------------------------------------------------------

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPromptView {
    pub change: BranchChange,
    pub ticket_title: Option<String>,
    /// `develop` / `long-feature/*`: offer Pause, Stop or Keep.
    pub suggests_break: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingPromptView {
    pub event: MeetingEvent,
    /// The ticket a start would use (marker, work-item link or default meeting ticket).
    pub ticket_id: Option<i64>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingReturnView {
    pub ticket_id: i64,
    pub title: Option<String>,
    pub activity_name: Option<String>,
    pub end: Timestamp,
    /// Due now: offer "Resume previous…".
    pub ready: bool,
    /// The meeting was a microphone session ("Microphone use stopped").
    pub from_microphone: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FigmaPromptView {
    pub suggestion: FigmaSuggestion,
    pub ticket_title: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgottenTicketView {
    pub repository: String,
    pub ticket_id: i64,
    pub title: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayReviewPromptView {
    pub day: Date,
    pub can_snooze: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptsSlice {
    pub branches: Vec<BranchPromptView>,
    pub meetings: Vec<MeetingPromptView>,
    pub microphone: Vec<MicrophoneSession>,
    pub microphone_end: Option<MicrophoneEndPrompt>,
    /// The microphone end prompt may offer "Resume previous ticket…".
    pub can_return_after_microphone: bool,
    pub meeting_return: Option<MeetingReturnView>,
    pub figma: Vec<FigmaPromptView>,
    pub idle: Option<IdlePeriod>,
    /// A saved "Pause & review" correction waiting to be applied or discarded.
    pub idle_correction: Option<IdlePeriod>,
    pub forgotten: Option<ForgottenReminder>,
    pub forgotten_tickets: Vec<ForgottenTicketView>,
    pub ticket_completion: Option<TicketCompletionPrompt>,
    pub day_review: Option<DayReviewPromptView>,
}

// -- progress ---------------------------------------------------------------------------------

/// Today and this-week progress toward the targets, computed at `computed_at`. While
/// `extrapolate` is true and a timer runs, the UI adds `now - computed_at` to both totals.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSlice {
    /// False until the week's worklogs loaded (UI shows "unavailable", never a misleading 0).
    pub available: bool,
    pub today_seconds: f64,
    pub week_seconds: f64,
    pub today_target: f64,
    pub week_target: f64,
    pub computed_at: Option<Timestamp>,
    pub extrapolate: bool,
    /// Totals are older than the last tracking change (shown as "last known").
    pub stale: bool,
    pub loading: bool,
    pub issue: Option<String>,
    /// Start of today: the UI extrapolates today's total from `max(computedAt, todayStart)`,
    /// so a timer running across midnight counts only today's part.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub today_start: Option<Timestamp>,
    /// Start of the ISO week (Monday), likewise for the week's total.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub week_start: Option<Timestamp>,
    /// Why today's target differs (a holiday or a date exception).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub today_reason: Option<String>,
}

// -- history and titles -----------------------------------------------------------------------

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySlice {
    pub from: Date,
    pub to: Date,
    /// Newest first.
    pub logs: Vec<WorkLog>,
    pub today_logs: Vec<WorkLog>,
    pub loading: bool,
    pub loaded: bool,
    pub total_seconds: f64,
    /// App activity, newest first (at most 2,000).
    pub audit: Vec<AuditEntry>,
    /// Why the last load or CSV export failed (1.14.x showed it in the error banner).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub issue: Option<String>,
}

/// Ticket titles known to the engine, keyed by id (shared by every page).
pub type WorkItemsSlice = BTreeMap<i64, WorkItem>;

// -- repositories -----------------------------------------------------------------------------

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryView {
    pub id: Uuid,
    pub path: String,
    pub name: String,
    pub enabled: bool,
    pub branch: Option<String>,
    pub detached: bool,
    pub error: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredView {
    pub path: String,
    pub branch: String,
    pub already_added: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanView {
    pub scanning: bool,
    pub root: Option<String>,
    pub results: Vec<DiscoveredView>,
    pub unreadable: Vec<String>,
    pub error: Option<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoriesSlice {
    pub watching: bool,
    pub repositories: Vec<RepositoryView>,
    pub scan: ScanView,
}

// -- agenda -----------------------------------------------------------------------------------

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaEventView {
    pub id: String,
    pub title: String,
    pub start: Timestamp,
    pub end: Timestamp,
    pub all_day: bool,
    pub calendar_title: Option<String>,
    pub color: Option<String>,
    pub location: Option<String>,
    pub is_now: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarChoice {
    #[serde(flatten)]
    pub calendar: CalendarInfo,
    pub selected: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaSlice {
    /// Calendar integration exists on this OS.
    pub supported: bool,
    pub access: CalendarAccess,
    pub enabled: bool,
    pub calendars: Vec<CalendarChoice>,
    pub day: Date,
    pub events: Vec<AgendaEventView>,
    pub issue: Option<String>,
}

// -- settings ---------------------------------------------------------------------------------

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingView {
    pub pin: Option<String>,
    pub expires_at: Option<Timestamp>,
    pub status: Option<String>,
    pub paired_host: Option<String>,
    pub busy: bool,
}

/// A process using microphone input and its app category (Settings shows "Selected" when the
/// category is watched, else "Ignored").
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneOwnerView {
    #[serde(flatten)]
    pub owner: InputOwner,
    pub category: Option<MicrophoneApp>,
}

/// The result of `settings.testBranchPattern`: the tester line and whether the pattern is
/// valid (`false` with "Invalid pattern: …").
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPatternTest {
    pub text: String,
    pub valid: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneDiagnostics {
    pub supported: bool,
    /// Every process with input running at the last sample.
    pub owners: Vec<MicrophoneOwnerView>,
    /// The last sample succeeded recently.
    pub fresh: bool,
    pub issue: Option<String>,
    /// The status line ("Watching microphone status · checked every 2 seconds", "Microphone in
    /// use: Slack", the last error, …).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub status: Option<String>,
    /// The last successful sample ("Checked 10:02:14").
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub checked_at: Option<Timestamp>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptionChoice {
    pub kind: PromptKind,
    pub label: String,
    pub level: Interruption,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSlice {
    pub configuration: Configuration,
    pub has_azure_pat: bool,
    pub has_seven_pace_token: bool,
    pub pairing: PairingView,
    pub microphone: MicrophoneDiagnostics,
    pub interruptions: Vec<InterruptionChoice>,
    /// The last successful `settings.save` (a failure leaves it and shows `app.error`).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub saved_at: Option<Timestamp>,
    /// Whether the OS allows notifications (reported by the shell through
    /// `app.reportNotificationPermission`); `null` until known.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional = nullable))]
    pub notifications_authorized: Option<bool>,
    /// The saved work apps in order, with what the platform found about each.
    pub work_apps: Vec<WorkAppView>,
}

/// A configured work app as Settings shows it.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkAppView {
    /// The stored id: bundle ID (macOS) or executable name (Windows).
    pub id: String,
    /// The app's display name, when the platform found it.
    pub name: Option<String>,
    /// Found on this computer; `false` only where the lookup is complete (macOS), `null` while
    /// unknown.
    pub installed: Option<bool>,
}

impl WorkAppView {
    pub(crate) fn new(id: String, lookup: att_platform::AppLookup) -> Self {
        match lookup {
            att_platform::AppLookup::Found(app) => {
                Self { id, name: Some(app.name), installed: Some(true) }
            }
            att_platform::AppLookup::NotInstalled => {
                Self { id, name: None, installed: Some(false) }
            }
            att_platform::AppLookup::Unknown => Self::unknown(id),
        }
    }

    pub(crate) fn unknown(id: String) -> Self {
        Self { id, name: None, installed: None }
    }
}

// -- figma ------------------------------------------------------------------------------------

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FigmaFileView {
    pub key: String,
    pub name: String,
    /// `https://www.figma.com/file/<key>`, `None` for title-only files.
    pub web_url: Option<String>,
    pub desktop_url: Option<String>,
    pub ticket_id: Option<i64>,
    pub ticket_title: Option<String>,
    pub last_seen: Option<Timestamp>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FigmaSlice {
    pub preferences: FigmaPreferences,
    pub access: bool,
    pub installed: bool,
    pub title_only: bool,
    /// Last observation: `missingAccess`, `waiting`, `noAddress`, `file` or `notForeground`.
    pub status: String,
    pub current_file: Option<String>,
    pub search: String,
    pub files: Vec<FigmaFileView>,
    pub suggestions: Vec<FigmaPromptView>,
    /// The most recently worked linked ticket and its files.
    pub last_worked_ticket: Option<i64>,
    /// Newest first, at most 200.
    pub history: Vec<FigmaContextEvent>,
    pub storage_issue: Option<String>,
    /// Observation is on (`preferences.enabled`) and not paused by "Pause watching".
    pub observing: bool,
    /// The status line (Swift `FigmaService.status`, without the time).
    pub label: String,
    /// When Figma was last in front, and the file seen then ("Waiting for Figma · 10:02 ·
    /// Seen: …").
    pub last_foreground_at: Option<Timestamp>,
    /// The files linked to `lastWorkedTicket`, most recently seen first.
    pub last_worked: Vec<FigmaFileView>,
    /// History events in total (the list shows the latest 200).
    pub history_count: usize,
}

// -- assembly ---------------------------------------------------------------------------------

/// Sidebar metadata in order; titles and groups as in 1.14.x.
pub fn page_infos(state: &AppState, os: HostOs) -> Vec<PageInfo> {
    PAGES
        .iter()
        .map(|id| {
            let (title, group) = match *id {
                "overview" => ("Overview", "today"),
                "dayReview" => ("Day review", "today"),
                "agenda" => ("Agenda", "today"),
                "offlineDrafts" => ("Offline drafts", "today"),
                "statistics" => ("Statistics", "insights"),
                "weeklyReport" => ("Weekly report", "insights"),
                "history" => ("History", "insights"),
                "timeEditor" => ("Time editor", "insights"),
                "repositories" => ("Repositories", "setup"),
                "figma" => ("Figma", "setup"),
                _ => ("Settings", "setup"),
            };
            let pending = state.session.branches.pending.len();
            PageInfo {
                id: (*id).to_string(),
                title: title.to_string(),
                group: group.to_string(),
                hidden: state.config.hidden_pages.iter().any(|hidden| hidden == id),
                available: !(*id == "agenda" && os != HostOs::Macos),
                badge: (*id == "overview" && pending > 0).then_some(pending as u32),
                dot: *id == "dayReview" && state.session.day_review.prompt_day.is_some(),
            }
        })
        .collect()
}

fn to_value<T: Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

/// What every builder needs besides the state.
struct Context {
    now: Timestamp,
    cal: Cal,
    busy: bool,
    preview: bool,
    os: HostOs,
    microphone_supported: bool,
    health: ConnectionHealth,
}

/// Every session slice.
pub(crate) fn slices(
    engine: &Engine,
    state: &AppState,
    now: Timestamp,
) -> Vec<(&'static str, Value)> {
    let services = engine.services();
    let context = Context {
        now,
        cal: engine.cal(),
        busy: engine.inner.busy.is_busy(),
        preview: services.preview,
        os: services.os,
        microphone_supported: services.platform.microphone.supported(),
        health: connection::health(state, now),
    };
    let interface: InterfacePreferences = state.config.interface;
    vec![
        ("app", to_value(&app_slice(state, &context))),
        ("interface", to_value(&interface)),
        ("connection", to_value(&connection_slice(state, &context))),
        ("tracking", to_value(&tracking_slice(state, &context))),
        ("flow", to_value(&flow_slice(state, &context))),
        ("prompts", to_value(&prompts_slice(state, &context))),
        ("progress", to_value(&progress_slice(state, &context))),
        ("history", to_value(&history_slice(state, &context))),
        ("workItems", to_value(&state.session.work_items)),
        ("repositories", to_value(&repositories_slice(state))),
        ("agenda", to_value(&agenda_slice(state, &context))),
        ("settings", to_value(&settings_slice(state, &context))),
        ("figma", to_value(&figma_slice(state, &context))),
    ]
}

fn app_slice(state: &AppState, context: &Context) -> AppSlice {
    let connection_issue = state.session.connection.issue.as_ref();
    AppSlice {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: context.os,
        preview: context.preview,
        onboarding: settings::needs_onboarding(state, context.preview),
        visible_page: state.visible_page.clone(),
        pages: page_infos(state, context.os),
        busy: context.busy,
        notice: state.session.notice.clone(),
        // 1.14.x showed a connection error once, in the health view, not in the banner too.
        error: state.session.error.clone().filter(|error| Some(error) != connection_issue),
        storage_issue: state.storage_issue.clone(),
        features: Features {
            calendar: context.os == HostOs::Macos,
            microphone: context.microphone_supported,
            figma_title_only: context.os == HostOs::Windows,
        },
    }
}

fn connection_slice(state: &AppState, context: &Context) -> ConnectionSlice {
    let connection = &state.session.connection;
    let health = context.health;
    let detail_issue = connection.azure_issue.is_some()
        || state.session.progress.issue.is_some()
        || state.session.completion.issue.is_some();
    let detail = match health {
        ConnectionHealth::Confirmed
        | ConnectionHealth::Connecting
        | ConnectionHealth::Unconfigured => {
            detail_issue.then(|| "Some details could not refresh".to_string())
        }
        _ if tray::shows_local_timer(state, context.now) => Some(
            "Local tracking continues on this Mac. Reconnect to confirm the 7pace timer."
                .to_string(),
        ),
        _ => Some("Showing the last known timer. Check 7pace before changing it.".to_string()),
    };
    ConnectionSlice {
        health: health.into(),
        indicator: tray::tray_state(tray::indicator(state, context.now)),
        status: health.label().to_string(),
        detail,
        workspace: connection::workspace(state),
        host: connection.host.clone(),
        last_sync: connection.last_sync,
        worklog_sync: state.session.progress.last_sync,
        connection_issue: connection.issue.clone(),
        azure_issue: connection.azure_issue.clone(),
        progress_issue: state.session.progress.issue.clone(),
        has_azure_pat: connection.has_azure_pat,
        has_seven_pace_token: connection.has_seven_pace_token,
        connected: connection.connected,
        connecting: connection.connecting,
        completion_issue: state.session.completion.issue.clone(),
        shortcut_issue: state.session.shortcut_issue.clone(),
    }
}

fn activity_name(state: &AppState, id: Option<&str>) -> Option<String> {
    let id = id?;
    state
        .session
        .connection
        .activity_types
        .iter()
        .find(|activity| activity.id == id)
        .and_then(|activity| activity.name.clone())
}

/// Swift `currentTicketTitle`.
fn current_title(state: &AppState, tracking: &TrackingState) -> String {
    let track = tracking.track.as_ref();
    if let Some(item) =
        track.and_then(|track| track.ticket_id()).and_then(|id| state.session.work_items.get(&id))
    {
        return item.title.clone();
    }
    track.map_or_else(|| "Tracking".to_string(), |track| track.title())
}

fn ticket_url(state: &AppState, ticket: i64) -> Option<String> {
    let base = Endpoint::azure(&state.config.organization).ok()?;
    Some(format!("{}/_workitems/edit/{ticket}", base.as_str().trim_end_matches('/')))
}

fn tracking_slice(state: &AppState, context: &Context) -> TrackingSlice {
    let session = &state.session;
    let tracking = connection::tracking(state);
    let track = tracking.and_then(|tracking| tracking.track.as_ref()).filter(|t| t.is_running());
    let confirmed = session.connection.connected && context.health == ConnectionHealth::Confirmed;
    let paused = session.paused.as_ref().map(|paused| {
        let ticket_title = paused.ticket_id.and_then(|id| session.work_items.get(&id));
        PausedView {
            ticket_id: paused.ticket_id,
            title: paused.title(ticket_title.map(|item| item.title.as_str())),
            activity_id: paused.activity_id.clone(),
            activity_name: activity_name(state, paused.activity_id.as_deref()),
            remark: paused.remark.clone(),
            paused_at: paused.paused_at,
            elapsed_seconds: paused.elapsed_seconds,
        }
    });
    let local_draft = controllers::active_local_timer(state);
    let workspace = connection::workspace(state);
    let local = local_draft.as_ref().map(|draft| {
        let title = draft
            .ticket_id
            .filter(|_| draft.workspace == workspace)
            .and_then(|id| session.work_items.get(&id).map(|item| item.title.clone()))
            .unwrap_or_else(|| draft.title());
        let cached = activity_name(state, draft.activity_id.as_deref());
        LocalTimerView {
            draft_id: draft.id,
            ticket_id: draft.ticket_id,
            title,
            comment: draft
                .comment
                .non_empty()
                .filter(|_| draft.ticket_id.is_some())
                .map(str::to_string),
            activity_name: cached,
            start: draft.start,
            other_workspace: (!connection::same_workspace(&draft.workspace, &workspace))
                .then(|| draft.workspace.clone()),
        }
    });
    let shows_local_timer =
        LocalTimerDisplay::is_primary(local_draft.as_ref(), track.is_some(), confirmed);
    let shows_remote_timer = !shows_local_timer || session.paused.is_some();
    let attention = session.attention.prompt.as_ref().map(|prompt| AttentionView {
        id: prompt.id.clone(),
        reason: prompt.reason.raw().to_string(),
        heading: prompt.heading().to_string(),
        detail: prompt.detail().to_string(),
        ticket_id: prompt.ticket_id,
        title: prompt.title.clone(),
        stopped: prompt.stopped(),
    });
    let today_seconds = history::today_seconds(state, context.now, &context.cal);
    match (tracking, track) {
        (Some(tracking), Some(track)) => TrackingSlice {
            running: true,
            ticket_id: track.ticket_id(),
            title: current_title(state, tracking),
            activity_id: track.activity_type_id.clone(),
            activity_name: activity_name(state, track.activity_type_id.as_deref()),
            remark: track.remark.clone(),
            elapsed_base: track.current_track_length.unwrap_or(0.0),
            confirmed_at: session.connection.last_sync,
            extrapolate: context.health == ConnectionHealth::Confirmed,
            paused,
            local,
            shows_local_timer,
            shows_remote_timer,
            attention,
            today_seconds,
            ticket_url: track.ticket_id().and_then(|id| ticket_url(state, id)),
        },
        _ => TrackingSlice {
            running: false,
            ticket_id: None,
            title: match &paused {
                Some(paused) => paused.title.clone(),
                None => "No timer running".to_string(),
            },
            activity_id: None,
            activity_name: None,
            remark: None,
            elapsed_base: session.paused.as_ref().map_or(0.0, |paused| paused.elapsed_seconds),
            confirmed_at: None,
            extrapolate: false,
            paused,
            local,
            shows_local_timer,
            shows_remote_timer,
            attention,
            today_seconds,
            ticket_url: None,
        },
    }
}

fn draft_source(draft: &TrackingDraft) -> DraftSource {
    if draft.is_figma() {
        DraftSource::Figma
    } else if draft.microphone_session.is_some() {
        DraftSource::Microphone
    } else if draft.attention.is_some() {
        DraftSource::Attention
    } else if draft.meeting_return.is_some() {
        DraftSource::MeetingReturn
    } else if draft.resume.is_some() {
        DraftSource::Resume
    } else if draft.meeting.is_some() {
        DraftSource::Meeting
    } else if draft.change.is_some() {
        DraftSource::Branch
    } else if draft.manual.is_some() {
        DraftSource::Manual
    } else {
        DraftSource::Ticket
    }
}

fn draft_view(state: &AppState, draft: &TrackingDraft, context: &Context) -> DraftView {
    let types = &state.session.connection.activity_types;
    let restricted: Option<Vec<String>> = (draft.is_figma() || draft.standup).then(|| {
        types
            .iter()
            .filter(|activity| {
                (!draft.standup || att_core::manual::StandupActivity::matches(activity))
                    && (!draft.is_figma() || att_core::figma::design_activity::matches(activity))
            })
            .map(|activity| activity.id.clone())
            .collect()
    });
    let loaded = state.session.connection.activities_loaded;
    let required_activity = if draft.is_figma()
        && att_core::figma::design_activity::selected(types).is_none()
    {
        Some("The Design activity is missing in 7pace. Add or enable Design before starting from Figma.".to_string())
    } else if draft.standup
        && att_core::manual::StandupActivity::selected(types).is_none()
        && loaded
    {
        Some("The Standup activity is missing in 7pace. Add or enable it before tracking this stand-up.".to_string())
    } else {
        None
    };
    let preferred = preferred_activity_id(state, draft);
    let preferred = if types.iter().any(|activity| activity.id == preferred) {
        preferred
    } else {
        String::new()
    };
    let mut candidates: Vec<String> = types.iter().map(|activity| activity.id.clone()).collect();
    if candidates.is_empty() {
        candidates.push(String::new());
    }
    let startable = candidates
        .into_iter()
        .filter(|id| can_start(state, draft, id, context.busy, context.now))
        .collect();
    let default_comment = match draft.manual {
        Some(ManualTrackingKind::Standup) => att_core::manual::StandupActivity::REMARK.to_string(),
        Some(ManualTrackingKind::Meeting) => "Meeting".to_string(),
        _ => String::new(),
    };
    DraftView {
        id: draft.id,
        source: draft_source(draft),
        title: draft.title(),
        item: draft.item.clone(),
        allows_no_ticket: draft.allows_no_ticket(),
        manual: draft.manual,
        preferred_activity_id: preferred,
        allowed_activity_ids: restricted.unwrap_or_default(),
        required_activity,
        default_comment,
        resume: draft.resume.is_some() || draft.meeting_return.is_some(),
        standup: draft.standup,
        is_figma: draft.is_figma(),
        remark: draft.remark(),
        comment_with_ticket: draft.tracking_comment(true),
        comment_without_ticket: draft.tracking_comment(false),
        meeting_title: draft.meeting.as_ref().map(|meeting| meeting.title.clone()),
        can_choose_ticket: draft.allows_no_ticket() && draft.figma_file.is_none(),
        startable_activity_ids: startable,
    }
}

fn flow_slice(state: &AppState, context: &Context) -> FlowSlice {
    let session = &state.session;
    let flow = &session.flow;
    let surface = if flow.show_picker {
        FlowSurface::Picker
    } else if flow.menu_tracking {
        FlowSurface::Panel
    } else {
        FlowSurface::None
    };
    let selected_suggestion = if let Some(change) = &flow.selected_change {
        Some(SuggestionView {
            kind: "branch".into(),
            title: change.branch.clone(),
            ticket_id: change.ticket_id,
        })
    } else if let Some(meeting) = &flow.selected_meeting {
        Some(SuggestionView {
            kind: "meeting".into(),
            title: meeting.title.clone(),
            ticket_id: meetings::ticket(meeting, &state.config.meetings.default_ticket),
        })
    } else {
        flow.selected_figma.as_ref().map(|figma| SuggestionView {
            kind: "figma".into(),
            title: figma.name.clone(),
            ticket_id: figma.ticket_id,
        })
    };
    let quick = &session.quick_tickets;
    let quick_tickets = quick
        .ordered_ids()
        .into_iter()
        .map(|id| QuickTicketView {
            ticket_id: id,
            title: session.work_items.get(&id).map(|item| item.title.clone()),
            favorite: quick.favorites.contains(&id),
        })
        .collect();
    let connection = &session.connection;
    FlowSlice {
        surface,
        draft: flow.draft.as_ref().map(|draft| draft_view(state, draft, context)),
        selected_suggestion,
        search: SearchView {
            query: flow.search_query.clone(),
            results: flow.search_results.clone(),
            searching: flow.searching,
            error: flow.search_error.clone(),
        },
        activity_types: connection.activity_types.clone(),
        activities_loaded: connection.activities_loaded,
        loading_activities: connection.loading_activities,
        activity_error: connection.activity_error.clone(),
        quick_tickets,
        default_activity_id: state.config.activity_type_id.clone(),
    }
}

fn prompts_slice(state: &AppState, context: &Context) -> PromptsSlice {
    let session = &state.session;
    let now = context.now;
    let title = |id: i64| session.work_items.get(&id).map(|item| item.title.clone());
    let branches = session
        .branches
        .pending
        .iter()
        .map(|change| BranchPromptView {
            change: change.clone(),
            ticket_title: change.ticket_id.and_then(title),
            suggests_break: change.suggests_break(),
        })
        .collect();
    let default_ticket = &state.config.meetings.default_ticket;
    let meetings = session
        .calendar
        .pending
        .iter()
        .map(|event| MeetingPromptView {
            event: event.clone(),
            ticket_id: meetings::ticket(event, default_ticket),
        })
        .collect();
    let meeting_return = session.meeting_return.as_ref().map(|plan| MeetingReturnView {
        ticket_id: plan.ticket_id,
        title: title(plan.ticket_id),
        activity_name: activity_name(state, plan.activity_id.as_deref()),
        end: plan.end,
        ready: meeting_return::ready(state, now, context.preview),
        from_microphone: plan.microphone_session_id.is_some(),
    });
    let figma = figma::suggestions(state, now)
        .into_iter()
        .map(|suggestion| FigmaPromptView {
            ticket_title: suggestion.ticket_id.and_then(title),
            suggestion,
        })
        .collect();
    let ledger = &session.awareness.ledger;
    let idle = ledger.idle.pending().cloned();
    let forgotten_tickets = branches::forgotten_tickets(state)
        .into_iter()
        .map(|(repository, ticket)| ForgottenTicketView {
            repository,
            ticket_id: ticket,
            title: title(ticket),
        })
        .collect();
    PromptsSlice {
        branches,
        meetings,
        microphone: session.microphone.pending.clone(),
        microphone_end: microphone::end_prompt(state, now, context.preview),
        can_return_after_microphone: meeting_return::can_return_after_microphone(state, now),
        meeting_return,
        figma,
        idle_correction: ledger.correction.clone().filter(|_| idle.is_none()),
        idle,
        forgotten: session.awareness.forgotten.pending().cloned(),
        forgotten_tickets,
        ticket_completion: completion::prompt(state, now, context.preview),
        day_review: session.day_review.prompt_day.map(|day| DayReviewPromptView {
            day,
            can_snooze: day_review_prompt::can_snooze(state, now, &context.cal),
        }),
    }
}

fn progress_slice(state: &AppState, context: &Context) -> ProgressSlice {
    let session = &state.session;
    let progress = &session.progress;
    let now = context.now;
    let cal = &context.cal;
    let week = TargetProgress::week_interval(now, cal);
    let targets = &state.config.targets;
    let today_target = targets.daily_seconds(now, cal);
    let week_target = targets.seconds_in(week, cal);
    let available = progress.last_sync.is_some() && progress.week == Some(week);
    let confirmed = context.health == ConnectionHealth::Confirmed;
    let tracking = connection::tracking(state);
    let last_sync = session.connection.last_sync;
    // Totals up to the last confirmation; the UI adds the time since while extrapolating.
    let totals = available
        .then(|| TargetProgress::calculate(&progress.logs, tracking, last_sync, now, false, cal));
    let active = tracking
        .filter(|state| state.running())
        .and_then(|state| state.track.as_ref())
        .is_some_and(|track| track.work_log_id.non_empty().is_some());
    let extrapolate = available && confirmed && active && last_sync.is_some();
    ProgressSlice {
        available,
        today_seconds: totals.map_or(0.0, |totals| totals.today),
        week_seconds: totals.map_or(0.0, |totals| totals.week),
        today_target,
        week_target,
        computed_at: if extrapolate { last_sync } else { progress.last_sync.filter(|_| available) },
        extrapolate,
        stale: !confirmed || progress.issue.is_some(),
        loading: progress.loading,
        issue: progress.issue.clone(),
        today_start: Some(cal.day_interval(now).start),
        week_start: Some(week.start),
        today_reason: targets.reason(now, cal),
    }
}

fn history_slice(state: &AppState, context: &Context) -> HistorySlice {
    let history = &state.session.history;
    let today = context.cal.date(context.now);
    let (default_from, default_to) = history::default_range(today, &context.cal);
    let mut logs = history.logs.clone();
    // Newest first; entries without a readable date go last.
    let tz = context.cal.tz().clone();
    logs.sort_by_key(|log| std::cmp::Reverse(log.date(&tz)));
    HistorySlice {
        from: history.from.unwrap_or(default_from),
        to: history.to.unwrap_or(default_to),
        total_seconds: logs.iter().fold(0.0, |total, log| total + log.length),
        logs,
        today_logs: history::today_logs(state, context.now, &context.cal),
        loading: history.loading,
        loaded: history.loaded,
        audit: state.audit.clone(),
        issue: history.issue.clone(),
    }
}

fn repositories_slice(state: &AppState) -> RepositoriesSlice {
    let branches = &state.session.branches;
    let repositories = state
        .config
        .repositories
        .iter()
        .map(|repo| {
            let snapshot = branches.snapshots.get(&repo.id);
            RepositoryView {
                id: repo.id,
                path: repo.path.clone(),
                name: repo.name().to_string(),
                enabled: repo.enabled,
                branch: snapshot.and_then(|snapshot| snapshot.branch.clone()),
                detached: snapshot.is_some_and(|snapshot| snapshot.branch.is_none()),
                error: branches.errors.get(&repo.id).cloned(),
            }
        })
        .collect();
    let scan = &state.session.scan;
    let existing: std::collections::BTreeSet<&str> =
        state.config.repositories.iter().map(|repo| repo.path.as_str()).collect();
    RepositoriesSlice {
        watching: state.config.watch_enabled,
        repositories,
        scan: ScanView {
            scanning: scan.scanning,
            root: scan.root.clone(),
            results: scan
                .results
                .iter()
                .map(|found| DiscoveredView {
                    path: found.path.clone(),
                    branch: found.branch.clone(),
                    already_added: existing.contains(found.path.as_str()),
                })
                .collect(),
            unreadable: scan.issues.clone(),
            error: scan.error.clone(),
        },
    }
}

fn agenda_slice(state: &AppState, context: &Context) -> AgendaSlice {
    let calendar = &state.session.calendar;
    let selected = &state.config.selected_calendar_ids;
    AgendaSlice {
        supported: context.os == HostOs::Macos
            && calendar.access != Some(CalendarAccess::Unsupported),
        access: calendar.access.unwrap_or(if context.os == HostOs::Macos {
            CalendarAccess::NotDetermined
        } else {
            CalendarAccess::Unsupported
        }),
        enabled: state.config.calendar_enabled,
        calendars: calendar
            .calendars
            .iter()
            .map(|info| CalendarChoice {
                calendar: info.clone(),
                selected: selected.contains(&info.id),
            })
            .collect(),
        day: calendar.agenda_day.unwrap_or_else(|| context.cal.date(context.now)),
        events: calendar
            .agenda
            .iter()
            .map(|event| AgendaEventView {
                id: event.id.clone(),
                title: event.title.clone(),
                start: event.start,
                end: event.end,
                all_day: event.all_day,
                calendar_title: event.calendar.clone(),
                color: event.color.clone(),
                location: event.location.clone(),
                is_now: event.is_now(context.now),
            })
            .collect(),
        issue: calendar.issue.clone(),
    }
}

fn settings_slice(state: &AppState, context: &Context) -> SettingsSlice {
    let session = &state.session;
    let pairing = &session.pairing;
    let microphone = &session.microphone;
    let fresh = microphone.fresh(context.now);
    SettingsSlice {
        configuration: state.config.clone(),
        has_azure_pat: session.connection.has_azure_pat,
        has_seven_pace_token: session.connection.has_seven_pace_token,
        pairing: PairingView {
            pin: pairing.pin.clone(),
            expires_at: pairing.expires_at,
            status: pairing.status.clone(),
            paired_host: pairing.paired_host.clone(),
            busy: pairing.busy,
        },
        microphone: MicrophoneDiagnostics {
            supported: context.microphone_supported,
            owners: microphone
                .inputs
                .iter()
                .map(|owner| MicrophoneOwnerView {
                    category: Some(MicrophoneApp::classify(&owner.id)),
                    owner: owner.clone(),
                })
                .collect(),
            fresh,
            issue: (!microphone.connected && microphone.configured.is_some())
                .then(|| microphone.status.clone()),
            status: Some(microphone.status.clone()),
            checked_at: microphone.last_confirmed,
        },
        interruptions: PromptKind::ALL
            .iter()
            .map(|kind| InterruptionChoice {
                kind: *kind,
                label: kind.label().to_string(),
                level: state.config.interruption(*kind),
            })
            .collect(),
        saved_at: session.settings_saved_at,
        notifications_authorized: session.notifications_authorized,
        work_apps: state
            .config
            .awareness
            .work_app_ids
            .iter()
            .map(|id| {
                session
                    .work_apps
                    .get(id)
                    .cloned()
                    .unwrap_or_else(|| WorkAppView::unknown(id.clone()))
            })
            .collect(),
    }
}

fn figma_file_view(state: &AppState, file: &att_core::figma::FigmaFile) -> FigmaFileView {
    let ticket = figma::ledger(state).and_then(|ledger| ledger.links.get(&file.key).copied());
    FigmaFileView {
        key: file.key.clone(),
        name: file.name.clone(),
        web_url: FigmaDocument::web_url(&file.key),
        desktop_url: FigmaDocument::desktop_url(&file.key),
        ticket_id: ticket,
        ticket_title: ticket
            .and_then(|id| state.session.work_items.get(&id).map(|item| item.title.clone())),
        last_seen: file.last_seen,
    }
}

fn figma_slice(state: &AppState, context: &Context) -> FigmaSlice {
    let session = &state.session;
    let figma_state = &session.figma;
    let ledger = figma::ledger(state);
    let query = figma_state.search.trim();
    let files = ledger
        .map(|ledger| {
            ledger
                .register()
                .iter()
                .filter(|file| {
                    let ticket = ledger.links.get(&file.key);
                    let title = ticket
                        .and_then(|id| session.work_items.get(id))
                        .map(|item| item.title.as_str());
                    query.is_empty()
                        || contains_folded(&file.name, query)
                        || contains_folded(&file.key, query)
                        || ticket.is_some_and(|id| id.to_string().contains(query))
                        || title.is_some_and(|title| contains_folded(title, query))
                })
                .map(|file| figma_file_view(state, file))
                .collect()
        })
        .unwrap_or_default();
    let last_worked: Vec<FigmaFileView> = ledger
        .map(|ledger| {
            ledger.last_worked().iter().map(|file| figma_file_view(state, file)).collect()
        })
        .unwrap_or_default();
    let last_worked_ticket = last_worked.first().and_then(|file| file.ticket_id);
    let history: Vec<FigmaContextEvent> = ledger
        .map(|ledger| ledger.history.iter().rev().take(200).cloned().collect())
        .unwrap_or_default();
    let title = |id: i64| session.work_items.get(&id).map(|item| item.title.clone());
    FigmaSlice {
        preferences: state.config.figma.clone(),
        access: figma_state.has_access,
        installed: figma_state.installed,
        title_only: context.os == HostOs::Windows,
        status: figma_state.raw.to_string(),
        current_file: figma_state.last_focused_file.clone(),
        search: figma_state.search.clone(),
        files,
        suggestions: figma::suggestions(state, context.now)
            .into_iter()
            .map(|suggestion| FigmaPromptView {
                ticket_title: suggestion.ticket_id.and_then(title),
                suggestion,
            })
            .collect(),
        last_worked_ticket,
        history,
        storage_issue: figma_state.storage_issue.clone(),
        observing: state.config.figma.enabled && state.config.watch_enabled,
        label: figma::status_label(state),
        last_foreground_at: figma_state.last_foreground_at,
        last_worked,
        history_count: ledger.map_or(0, |ledger| ledger.history.len()),
    }
}
