//! The session: port of `AppModel` (+ `FigmaModel`, `PinPairingModel`). Connection, tracking
//! flows, branch watching, every prompt, health, progress, history, settings, repositories,
//! agenda and Figma.
//!
//! Owner during the port: the session engineer. See `docs/engine.md`.

use jiff::Timestamp;
use jiff::civil::Date;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use att_core::Configuration;
use att_core::config::{Interruption, PromptKind, QuietHours};
use att_core::figma::FigmaPreferences;
use att_core::interface_prefs::InterfacePreferences;
use att_core::manual::ManualTrackingKind;

use crate::engine::Engine;
use crate::intent::not_implemented;
use crate::ipc::IpcError;
use crate::shell::{TrayState, TrayStatus};
use crate::state::AppState;

pub mod persist;
pub mod view;

/// Session state (Swift `AppModel` properties). Persisted parts are saved by [`persist`].
#[derive(Default)]
pub struct SessionState {}

/// Intents owned by the session. Field names are camelCase on the wire.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum SessionIntent {
    #[serde(rename = "app.finishOnboarding")]
    FinishOnboarding,
    #[serde(rename = "app.setInterface")]
    SetInterface { preferences: InterfacePreferences },
    /// Refuses while a write is in flight; persists before an update restarts the app.
    #[serde(rename = "app.prepareForRestart")]
    PrepareForRestart,
    #[serde(rename = "app.dismissError")]
    DismissError,
    #[serde(rename = "app.dismissNotice")]
    DismissNotice,

    #[serde(rename = "connection.retry")]
    RetryConnection,
    #[serde(rename = "connection.refresh")]
    Refresh,

    /// Blank secrets keep the stored ones (1.14.x behaviour).
    #[serde(rename = "settings.save")]
    SaveSettings { configuration: Box<Configuration>, azure_pat: String, seven_pace_token: String },
    #[serde(rename = "settings.enableCalendar")]
    EnableCalendar,
    #[serde(rename = "settings.setPromptInterruption")]
    SetPromptInterruption { kind: PromptKind, level: Interruption },
    #[serde(rename = "settings.setQuietHours")]
    SetQuietHours { quiet_hours: QuietHours },
    /// Returns the Settings tester line for `branch` under `pattern` (no state change).
    #[serde(rename = "settings.testBranchPattern")]
    TestBranchPattern { branch: String, pattern: String },

    #[serde(rename = "pairing.generatePin")]
    GeneratePin,
    #[serde(rename = "pairing.cancel")]
    CancelPairing,

    #[serde(rename = "repositories.scan")]
    ScanRepositories { path: String },
    #[serde(rename = "repositories.cancelScan")]
    CancelRepositoryScan,
    #[serde(rename = "repositories.add")]
    AddRepositories { paths: Vec<String> },
    #[serde(rename = "repositories.setEnabled")]
    SetRepositoryEnabled { id: Uuid, enabled: bool },
    #[serde(rename = "repositories.remove")]
    RemoveRepository { id: Uuid },
    #[serde(rename = "repositories.toggleWatching")]
    ToggleWatching,

    #[serde(rename = "branch.keep")]
    KeepBranch { id: Uuid },
    /// Choose an activity for the suggested ticket (or the ticket-free branch remark).
    #[serde(rename = "branch.track")]
    TrackBranch { id: Uuid },
    #[serde(rename = "branch.chooseAnother")]
    ChooseAnotherForBranch { id: Uuid },
    #[serde(rename = "branch.pause")]
    PauseForBranch { id: Uuid },
    #[serde(rename = "branch.stop")]
    StopForBranch { id: Uuid },

    #[serde(rename = "tracking.beginPanel")]
    BeginPanelTracking { branch_id: Option<Uuid> },
    #[serde(rename = "tracking.cancelPanel")]
    CancelPanelTracking,
    #[serde(rename = "tracking.openPicker")]
    OpenTicketPicker,
    #[serde(rename = "tracking.closePicker")]
    CloseTicketPicker,
    #[serde(rename = "tracking.search")]
    Search { query: String },
    #[serde(rename = "tracking.chooseTicket")]
    ChooseTicket { ticket_id: i64 },
    #[serde(rename = "tracking.chooseManual")]
    ChooseManual { kind: ManualTrackingKind },
    #[serde(rename = "tracking.chooseDifferentWork")]
    ChooseDifferentWork,
    #[serde(rename = "tracking.chooseSuggestionTicket")]
    ChooseSuggestionTicket { draft_id: Uuid },
    #[serde(rename = "tracking.continueWithoutTicket")]
    ContinueWithoutTicket,
    /// The only intent that starts a timer.
    #[serde(rename = "tracking.start")]
    StartTracking { draft_id: Uuid, activity_id: String, comment: String, include_ticket: bool },
    #[serde(rename = "tracking.stop")]
    StopTracking,
    #[serde(rename = "tracking.pause")]
    PauseTracking,
    #[serde(rename = "tracking.resume")]
    ResumeTracking,
    #[serde(rename = "tracking.discardPause")]
    DiscardPause,
    #[serde(rename = "tracking.confirmActivity")]
    ConfirmActivity,

    #[serde(rename = "attention.keepStopped")]
    KeepAttentionStopped,
    #[serde(rename = "attention.continue")]
    ContinueAttention,

    #[serde(rename = "quick.switch")]
    QuickSwitch,
    #[serde(rename = "quick.toggleFavorite")]
    ToggleFavorite { ticket_id: i64 },

    #[serde(rename = "completion.keep")]
    KeepCompletedTicket,
    #[serde(rename = "completion.stop")]
    StopCompletedTicket,
    #[serde(rename = "completion.switch")]
    SwitchFromCompletedTicket,

    #[serde(rename = "meeting.begin")]
    BeginMeeting { id: String, use_suggested_ticket: bool },
    #[serde(rename = "meeting.dismiss")]
    DismissMeeting { id: String },
    #[serde(rename = "meeting.returnResume")]
    ResumeAfterMeeting,
    #[serde(rename = "meeting.returnDismiss")]
    DismissMeetingReturn,

    #[serde(rename = "microphone.choose")]
    ChooseMicrophoneActivity { session_id: String, standup: bool },
    #[serde(rename = "microphone.dismiss")]
    DismissMicrophone { session_id: String },
    #[serde(rename = "microphone.endKeep")]
    KeepAfterMicrophone,
    #[serde(rename = "microphone.endPause")]
    PauseAfterMicrophone,
    #[serde(rename = "microphone.endStop")]
    StopAfterMicrophone,

    #[serde(rename = "awareness.keepIdle")]
    KeepIdleTime,
    #[serde(rename = "awareness.reviewIdle")]
    ReviewIdleTime { prompt_id: Uuid },
    #[serde(rename = "awareness.openCorrection")]
    OpenIdleCorrection,
    #[serde(rename = "awareness.discardCorrection")]
    DiscardIdleCorrection,
    #[serde(rename = "awareness.deferForgotten")]
    DeferForgottenTimer { until_tomorrow: bool },
    #[serde(rename = "awareness.chooseForgottenTicket")]
    ChooseForgottenTicket { ticket_id: Option<i64> },

    #[serde(rename = "dayReview.open")]
    OpenDayReview,
    #[serde(rename = "dayReview.markReviewed")]
    MarkDayReviewed { day: Date },
    #[serde(rename = "dayReview.snooze")]
    SnoozeDayReview,

    #[serde(rename = "history.setRange")]
    SetHistoryRange { from: Date, to: Date },
    #[serde(rename = "history.load")]
    LoadHistory,
    #[serde(rename = "history.exportCsv")]
    ExportHistoryCsv { path: String },

    #[serde(rename = "agenda.setDay")]
    SetAgendaDay { day: Date },

    #[serde(rename = "figma.setPreferences")]
    SetFigmaPreferences { preferences: FigmaPreferences },
    #[serde(rename = "figma.requestAccess")]
    RequestFigmaAccess,
    #[serde(rename = "figma.keep")]
    KeepFigma { suggestion_id: Uuid },
    #[serde(rename = "figma.track")]
    TrackFigma { suggestion_id: Uuid, use_linked_ticket: bool },
    #[serde(rename = "figma.link")]
    LinkFigmaFile { file_key: String, ticket_id: Option<i64> },
    #[serde(rename = "figma.unlink")]
    UnlinkFigmaFile { file_key: String },
    #[serde(rename = "figma.open")]
    OpenFigmaFile { file_key: String, desktop: bool },
    #[serde(rename = "figma.clearHistory")]
    ClearFigmaHistory,
    #[serde(rename = "figma.setSearch")]
    SetFigmaSearch { query: String },
}

pub async fn handle(_engine: &Engine, intent: SessionIntent) -> Result<Value, IpcError> {
    not_implemented(&format!("{intent:?}"))
}

/// Runs once before the first tick (Swift `start()`: first-run repository discovery,
/// microphone/Figma/presence configuration, the initial `connect()`).
pub async fn start(_engine: &Engine) {}

/// One pass of the Swift main loop (see `docs/engine.md` §3).
pub async fn tick(_engine: &Engine) {}

/// The menu-bar/tray status at `now` (Swift `MenuBarController`).
pub fn tray_status(_state: &AppState, _now: Timestamp) -> TrayStatus {
    TrayStatus { title: None, tooltip: "Azure timetracker".into(), state: TrayState::Connecting }
}
