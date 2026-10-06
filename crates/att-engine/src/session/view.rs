//! Session slices: `app`, `interface`, `connection`, `tracking`, `flow`, `prompts`,
//! `progress`, `history`, `workItems`, `repositories`, `agenda`, `settings`, `figma`
//! (see `docs/engine.md` §6).
//!
//! These structs are the UI contract. Their JSON mirrors `apps/desktop/src/ipc/contract.ts`;
//! change both together. Instants are RFC 3339 strings, calendar days `YYYY-MM-DD`.

use std::collections::BTreeMap;

use jiff::Timestamp;
use jiff::civil::Date;
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use att_core::Configuration;
use att_core::awareness::{ForgottenReminder, IdlePeriod};
use att_core::completion::TicketCompletionPrompt;
use att_core::config::{Interruption, PromptKind};
use att_core::figma::{FigmaContextEvent, FigmaPreferences, FigmaSuggestion};
use att_core::git::{AuditEntry, BranchChange};
use att_core::interface_prefs::InterfacePreferences;
use att_core::manual::ManualTrackingKind;
use att_core::meetings::MeetingEvent;
use att_core::microphone::MicrophoneSession;
use att_core::microphone_end::MicrophoneEndPrompt;
use att_core::model::{ActivityType, HostOs, WorkItem, WorkLog};
use att_platform::{CalendarAccess, CalendarInfo, InputOwner};

use crate::engine::Engine;
use crate::shell::TrayState;
use crate::state::{AppState, PAGES};

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
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
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
    /// The activity the chooser preselects (Swift `preferredActivityID`).
    pub preferred_activity_id: String,
    /// Activities the user may start with; empty means any loaded activity.
    pub allowed_activity_ids: Vec<String>,
    /// Shown when an activity is required but missing (Design for Figma, Standup for stand-ups).
    pub required_activity: Option<String>,
    /// Prefilled comment for ticket-free starts.
    pub default_comment: String,
    /// The primary button says "Resume" instead of "Start".
    pub resume: bool,
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

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneDiagnostics {
    pub supported: bool,
    /// Every process with input running at the last sample.
    pub owners: Vec<InputOwner>,
    /// The last sample succeeded recently.
    pub fresh: bool,
    pub issue: Option<String>,
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
            PageInfo {
                id: (*id).to_string(),
                title: title.to_string(),
                group: group.to_string(),
                hidden: state.config.hidden_pages.iter().any(|hidden| hidden == id),
                available: !(*id == "agenda" && os != HostOs::Macos),
                badge: None,
                dot: false,
            }
        })
        .collect()
}

fn to_value<T: Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

/// Every session slice. Until each builder is ported, slices carry what the shared state
/// already knows; the session engineer replaces these with the full builders.
pub(crate) fn slices(
    engine: &Engine,
    state: &AppState,
    _now: Timestamp,
) -> Vec<(&'static str, Value)> {
    let services = engine.services();
    let interface: InterfacePreferences = state.config.interface;
    let app = AppSlice {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: services.os,
        preview: services.preview,
        onboarding: InterfacePreferences::needs_onboarding(
            state.has_saved_settings,
            state.config.interface_setup_completed,
        ),
        visible_page: state.visible_page.clone(),
        pages: page_infos(state, services.os),
        busy: engine.inner.busy.is_busy(),
        notice: None,
        error: None,
        storage_issue: state.storage_issue.clone(),
        features: Features {
            calendar: services.os == HostOs::Macos,
            microphone: services.platform.microphone.supported(),
            figma_title_only: services.os == HostOs::Windows,
        },
    };
    vec![("app", to_value(&app)), ("interface", to_value(&interface))]
}
