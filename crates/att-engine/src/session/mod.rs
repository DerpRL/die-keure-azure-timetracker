//! The session: port of `AppModel` (+ `FigmaModel`, `PinPairingModel`). Connection, tracking
//! flows, branch watching, every prompt, health, progress, history, settings, repositories,
//! agenda and Figma.
//!
//! Owner during the port: the session engineer. See `docs/engine.md` and
//! `docs/port/engine-session.md` (Swift function → Rust function).
//!
//! Every submodule follows the lock rules in `lib.rs`: state is read or changed in short
//! `Engine::read`/`Engine::update` closures, side effects that call back into the engine or the
//! shell (audit entries, prompts, notifications, title loads) are collected in [`Effects`] and run
//! after the lock is released, and network calls happen between two closures.

use std::collections::{BTreeMap, BTreeSet};

use jiff::Timestamp;
use jiff::civil::Date;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use att_core::Configuration;
use att_core::config::{Interruption, PromptKind, QuietHours};
use att_core::figma::FigmaPreferences;
use att_core::indicator::PausedSession;
use att_core::interface_prefs::InterfacePreferences;
use att_core::manual::ManualTrackingKind;
use att_core::model::{HostOs, WorkItem};
use att_core::productivity::{MeetingReturn, QuickTickets};

use crate::engine::Engine;
use crate::intent::done;
use crate::ipc::IpcError;
use crate::shell::Notification;
use crate::state::AppState;

pub mod hooks;
pub mod persist;
pub mod view;

mod announce;
mod attention;
mod awareness;
mod branches;
mod completion;
mod connection;
mod day_review_prompt;
mod figma;
mod history;
mod meeting_return;
mod meetings;
mod microphone;
mod pairing;
mod progress;
mod repositories;
mod settings;
mod tracking;
mod tray;

pub use tray::tray_status;
use view::{BranchPatternTest, FlowSurface};

/// Session state (Swift `AppModel` properties). Persisted parts are saved by [`persist`].
#[derive(Default)]
pub struct SessionState {
    /// The OS the engine runs on (from `Services::os`), for per-OS texts and the tray tooltip.
    pub(crate) host_os: Option<HostOs>,
    /// `start()` ran: the first connect happened and the samplers run.
    pub(crate) started: bool,
    pub(crate) samplers_spawned: bool,
    /// Saved settings could not be read at launch: onboarding is skipped (Swift `loadError`).
    pub(crate) load_failed: bool,
    /// Session documents that could not be read; they are never overwritten.
    pub(crate) unreadable: BTreeSet<&'static str>,
    /// The latest error, shown in a dismissible banner (Swift `error`).
    pub(crate) error: Option<String>,
    /// Swift `notice`.
    pub(crate) notice: Option<String>,
    pub(crate) connection: connection::ConnectionState,
    pub(crate) flow: tracking::FlowState,
    pub(crate) branches: branches::BranchState,
    pub(crate) attention: attention::AttentionState,
    pub(crate) completion: completion::CompletionState,
    pub(crate) calendar: meetings::CalendarState,
    /// Swift `meetingReturn` (persisted).
    pub(crate) meeting_return: Option<MeetingReturn>,
    pub(crate) microphone: microphone::MicrophoneState,
    pub(crate) awareness: awareness::AwarenessState,
    pub(crate) day_review: day_review_prompt::DayReviewState,
    pub(crate) progress: progress::ProgressState,
    pub(crate) history: history::HistoryState,
    pub(crate) pairing: pairing::PairingState,
    pub(crate) figma: figma::FigmaState,
    pub(crate) scan: repositories::ScanState,
    /// Swift `pausedSession` (persisted).
    pub(crate) paused: Option<PausedSession>,
    /// Swift `quickTickets` (persisted).
    pub(crate) quick_tickets: QuickTickets,
    pub(crate) quick_switch_pending: bool,
    /// Ticket titles (Swift `workItems`), shared with the controllers.
    pub(crate) work_items: BTreeMap<i64, WorkItem>,
    /// Titles being loaded (Swift `loadingTicketIDs`).
    pub(crate) loading_titles: BTreeSet<i64>,
    /// The last successful `settings.save`.
    pub(crate) settings_saved_at: Option<Timestamp>,
    /// Swift `shortcutIssue`, reported by the shell.
    pub(crate) shortcut_issue: Option<String>,
    /// Swift `notificationAuthorized`, reported by the shell; `None` until it does.
    pub(crate) notifications_authorized: Option<bool>,
}

/// Intents owned by the session. Field names are camelCase on the wire.
///
/// Where an action can happen in the tray panel or in the main window's ticket picker, it acts
/// in the surface that is open (see [`view::FlowSurface`]): the prompt actions `branch.track`,
/// `branch.chooseAnother`, `completion.switch` and `tracking.resume` use the picker while it is
/// open (`tracking.openPicker`) and otherwise open the panel flow; `tracking.chooseTicket`,
/// `tracking.chooseManual` and `tracking.continueWithoutTicket` use the panel while its flow is
/// open (`tracking.beginPanel`) and otherwise the picker. Meeting, microphone, Figma, meeting
/// return, forgotten-timer and attention actions always use the panel, as in 1.14.x.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
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
    /// The shell reports why the quick-switch shortcut could not be registered (`null` clears
    /// it); shown as `connection.shortcutIssue`.
    #[serde(rename = "app.reportShortcutIssue")]
    ReportShortcutIssue {
        #[serde(default)]
        #[cfg_attr(feature = "ts", ts(optional = nullable))]
        issue: Option<String>,
    },

    #[serde(rename = "connection.retry")]
    RetryConnection,
    #[serde(rename = "connection.refresh")]
    Refresh,
    /// Connection details → Refresh connection: retry, then check the tracked ticket's
    /// completion state now.
    #[serde(rename = "connection.recheck")]
    RecheckConnection,

    /// Blank secrets keep the stored ones (1.14.x behaviour). Success sets
    /// `settings.savedAt`; a failure is shown in `app.error`.
    #[serde(rename = "settings.save")]
    SaveSettings { configuration: Box<Configuration>, azure_pat: String, seven_pace_token: String },
    #[serde(rename = "settings.enableCalendar")]
    EnableCalendar,
    #[serde(rename = "settings.setPromptInterruption")]
    SetPromptInterruption { kind: PromptKind, level: Interruption },
    #[serde(rename = "settings.setQuietHours")]
    SetQuietHours { quiet_hours: QuietHours },
    /// Returns the Settings tester line for `branch` under `pattern` (`BranchPatternTest`, no
    /// state change).
    #[serde(rename = "settings.testBranchPattern")]
    TestBranchPattern { branch: String, pattern: String },
    /// Returns the identity (`AppIdentity`: `id`, `name`, `path`) of an application chosen in a
    /// file dialog (`.app` bundle or `.exe`), for the work-app list (Settings → Tracking → Add
    /// work application…).
    #[serde(rename = "settings.resolveWorkApp")]
    ResolveWorkApp { path: String },
    /// The shell reports whether the OS allows this app's notifications
    /// (`settings.notificationsAuthorized`).
    #[serde(rename = "app.reportNotificationPermission")]
    ReportNotificationPermission { authorized: bool },

    /// Pairs with `workspace`, the 7pace URL typed in Settings (1.14.x paired with the unsaved
    /// form), or with the saved URL when absent.
    #[serde(rename = "pairing.generatePin")]
    GeneratePin {
        #[serde(default)]
        #[cfg_attr(feature = "ts", ts(optional = nullable))]
        workspace: Option<String>,
    },
    #[serde(rename = "pairing.cancel")]
    CancelPairing,

    /// Results arrive in the `repositories` slice under `scan`.
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
    TrackBranch {
        id: Uuid,
        /// Where the user clicked; absent: the open surface (see the enum docs).
        #[serde(default)]
        #[cfg_attr(feature = "ts", ts(optional = nullable))]
        surface: Option<FlowSurface>,
    },
    #[serde(rename = "branch.chooseAnother")]
    ChooseAnotherForBranch {
        id: Uuid,
        #[serde(default)]
        #[cfg_attr(feature = "ts", ts(optional = nullable))]
        surface: Option<FlowSurface>,
    },
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
    /// Closing the picker sheet clears its draft and selection (refused while busy).
    #[serde(rename = "tracking.closePicker")]
    CloseTicketPicker,
    #[serde(rename = "tracking.search")]
    Search { query: String },
    #[serde(rename = "tracking.chooseTicket")]
    ChooseTicket {
        ticket_id: i64,
        #[serde(default)]
        #[cfg_attr(feature = "ts", ts(optional = nullable))]
        surface: Option<FlowSurface>,
    },
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
    ResumeTracking {
        #[serde(default)]
        #[cfg_attr(feature = "ts", ts(optional = nullable))]
        surface: Option<FlowSurface>,
    },
    #[serde(rename = "tracking.discardPause")]
    DiscardPause,
    #[serde(rename = "tracking.confirmActivity")]
    ConfirmActivity,
    /// Activity chooser → Reload activities.
    #[serde(rename = "tracking.reloadActivities")]
    ReloadActivities,

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
    SwitchFromCompletedTicket {
        #[serde(default)]
        #[cfg_attr(feature = "ts", ts(optional = nullable))]
        surface: Option<FlowSurface>,
    },

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
    /// Settings → Meetings → Check now.
    #[serde(rename = "microphone.checkNow")]
    CheckMicrophoneNow,

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
    /// Agenda → Open Calendar.
    #[serde(rename = "agenda.openCalendar")]
    OpenCalendarApp,

    #[serde(rename = "figma.setPreferences")]
    SetFigmaPreferences { preferences: FigmaPreferences },
    #[serde(rename = "figma.requestAccess")]
    RequestFigmaAccess,
    /// Figma → Check permission again.
    #[serde(rename = "figma.refreshAccess")]
    RefreshFigmaAccess,
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

pub async fn handle(engine: &Engine, intent: SessionIntent) -> Result<Value, IpcError> {
    let result = route(engine, intent).await;
    // Swift persisted after every change; unchanged documents are skipped by the store.
    let _ = engine.persist();
    result
}

async fn route(engine: &Engine, intent: SessionIntent) -> Result<Value, IpcError> {
    use SessionIntent as I;
    match intent {
        I::FinishOnboarding => settings::finish_onboarding(engine).await,
        I::SetInterface { preferences } => settings::set_interface(engine, preferences),
        I::PrepareForRestart => return settings::prepare_for_restart(engine),
        I::DismissError => engine.update(|state| state.session.error = None),
        I::DismissNotice => engine.update(|state| state.session.notice = None),
        I::ReportShortcutIssue { issue } => {
            engine.update(|state| state.session.shortcut_issue = issue);
        }

        I::RetryConnection => connection::retry(engine).await,
        I::Refresh => connection::refresh(engine).await,
        I::RecheckConnection => {
            connection::retry(engine).await;
            completion::check(engine, true).await;
        }

        I::SaveSettings { configuration, azure_pat, seven_pace_token } => {
            return settings::save(engine, *configuration, &azure_pat, &seven_pace_token).await;
        }
        I::EnableCalendar => meetings::enable_calendar(engine).await,
        I::SetPromptInterruption { kind, level } => settings::set_interruption(engine, kind, level),
        I::SetQuietHours { quiet_hours } => settings::set_quiet_hours(engine, quiet_hours),
        I::TestBranchPattern { branch, pattern } => {
            let test = BranchPatternTest {
                text: att_core::git::BranchTicket::tester_result(&branch, &pattern),
                valid: att_core::git::BranchTicket::extract(&branch, &pattern).is_ok(),
            };
            return serde_json::to_value(test)
                .map_err(|e| IpcError::new("internal", e.to_string()));
        }
        I::ResolveWorkApp { path } => return settings::app_identity(engine, path).await,
        I::ReportNotificationPermission { authorized } => {
            engine.update(|state| state.session.notifications_authorized = Some(authorized));
        }

        I::GeneratePin { workspace } => {
            let workspace = match workspace {
                Some(workspace) => workspace,
                None => engine.read(|state| state.config.seven_pace_url.clone()),
            };
            pairing::begin(engine, workspace);
        }
        I::CancelPairing => pairing::cancel(engine),

        I::ScanRepositories { path } => repositories::scan(engine, path).await,
        I::CancelRepositoryScan => repositories::cancel_scan(engine),
        I::AddRepositories { paths } => repositories::add(engine, paths).await,
        I::SetRepositoryEnabled { id, enabled } => repositories::set_enabled(engine, id, enabled),
        I::RemoveRepository { id } => repositories::remove(engine, id),
        I::ToggleWatching => repositories::toggle_watching(engine),

        I::KeepBranch { id } => branches::keep(engine, id),
        I::TrackBranch { id, surface } => tracking::track_branch(engine, id, surface).await,
        I::ChooseAnotherForBranch { id, surface } => {
            tracking::choose_another_for_branch(engine, id, surface).await;
        }
        I::PauseForBranch { id } => return tracking::pause_for_branch(engine, id).await,
        I::StopForBranch { id } => return tracking::stop_for_branch(engine, id).await,

        I::BeginPanelTracking { branch_id } => tracking::begin_panel(engine, branch_id),
        I::CancelPanelTracking => engine.update(tracking::cancel_menu_tracking),
        I::OpenTicketPicker => tracking::open_picker(engine).await,
        I::CloseTicketPicker => return tracking::close_picker(engine),
        I::Search { query } => tracking::search(engine, query).await,
        I::ChooseTicket { ticket_id, surface } => {
            tracking::choose_ticket(engine, ticket_id, surface).await;
        }
        I::ChooseManual { kind } => tracking::choose_manual(engine, kind).await,
        I::ChooseDifferentWork => tracking::choose_different_work(engine),
        I::ChooseSuggestionTicket { draft_id } => {
            tracking::choose_suggestion_ticket(engine, draft_id);
        }
        I::ContinueWithoutTicket => tracking::continue_without_ticket(engine).await,
        I::StartTracking { draft_id, activity_id, comment, include_ticket } => {
            return tracking::start(engine, draft_id, &activity_id, &comment, include_ticket).await;
        }
        I::StopTracking => return tracking::stop(engine, tracking::StopReason::User).await,
        I::PauseTracking => return tracking::pause(engine, tracking::StopReason::User).await,
        I::ResumeTracking { surface } => tracking::resume(engine, surface).await,
        I::DiscardPause => tracking::discard_pause(engine),
        I::ConfirmActivity => return tracking::confirm_activity(engine).await,
        I::ReloadActivities => connection::refresh_activities(engine).await,

        I::KeepAttentionStopped => attention::keep_stopped(engine),
        I::ContinueAttention => return attention::continue_tracking(engine).await,

        I::QuickSwitch => tracking::quick_switch(engine).await,
        I::ToggleFavorite { ticket_id } => {
            engine.update(|state| state.session.quick_tickets.toggle_favorite(ticket_id));
        }

        I::KeepCompletedTicket => completion::keep(engine),
        I::StopCompletedTicket => return completion::stop(engine).await,
        I::SwitchFromCompletedTicket { surface } => {
            tracking::switch_from_completed(engine, surface);
        }

        I::BeginMeeting { id, use_suggested_ticket } => {
            meetings::begin(engine, &id, use_suggested_ticket).await;
        }
        I::DismissMeeting { id } => meetings::dismiss(engine, &id),
        I::ResumeAfterMeeting => meeting_return::resume(engine).await,
        I::DismissMeetingReturn => meeting_return::dismiss(engine),

        I::ChooseMicrophoneActivity { session_id, standup } => {
            microphone::choose(engine, &session_id, standup).await;
        }
        I::DismissMicrophone { session_id } => microphone::dismiss(engine, &session_id),
        I::KeepAfterMicrophone => microphone::keep_after_end(engine),
        I::PauseAfterMicrophone => {
            return tracking::pause(engine, tracking::StopReason::MicrophoneEnd).await;
        }
        I::StopAfterMicrophone => {
            return tracking::stop(engine, tracking::StopReason::MicrophoneEnd).await;
        }
        I::CheckMicrophoneNow => {
            microphone::check_now(engine).await;
        }

        I::KeepIdleTime => awareness::keep_idle_time(engine),
        I::ReviewIdleTime { prompt_id } => {
            return awareness::review_idle_time(engine, prompt_id).await;
        }
        I::OpenIdleCorrection => awareness::open_saved_correction(engine).await,
        I::DiscardIdleCorrection => awareness::discard_correction(engine),
        I::DeferForgottenTimer { until_tomorrow } => {
            awareness::defer_forgotten(engine, until_tomorrow)
        }
        I::ChooseForgottenTicket { ticket_id } => {
            awareness::choose_forgotten_ticket(engine, ticket_id).await
        }

        I::OpenDayReview => day_review_prompt::open(engine).await,
        I::MarkDayReviewed { day } => day_review_prompt::mark_reviewed(engine, day),
        I::SnoozeDayReview => day_review_prompt::snooze(engine),

        I::SetHistoryRange { from, to } => history::set_range(engine, from, to),
        I::LoadHistory => history::load(engine).await,
        I::ExportHistoryCsv { path } => history::export_csv(engine, path).await,

        I::SetAgendaDay { day } => meetings::set_agenda_day(engine, day).await,
        I::OpenCalendarApp => meetings::open_calendar_app(engine).await,

        I::SetFigmaPreferences { preferences } => figma::set_preferences(engine, preferences),
        I::RequestFigmaAccess => figma::request_access(engine).await,
        I::RefreshFigmaAccess => figma::refresh_access(engine).await,
        I::KeepFigma { suggestion_id } => figma::keep(engine, suggestion_id),
        I::TrackFigma { suggestion_id, use_linked_ticket } => {
            figma::begin_tracking(engine, suggestion_id, use_linked_ticket).await;
        }
        I::LinkFigmaFile { file_key, ticket_id } => {
            return figma::link(engine, &file_key, ticket_id).await;
        }
        I::UnlinkFigmaFile { file_key } => return figma::link(engine, &file_key, None).await,
        I::OpenFigmaFile { file_key, desktop } => figma::open(engine, &file_key, desktop),
        I::ClearFigmaHistory => figma::clear_history(engine),
        I::SetFigmaSearch { query } => engine.update(|state| state.session.figma.search = query),
    }
    done()
}

/// Runs once before the first tick (Swift `start()`: first-run repository discovery,
/// microphone/Figma/presence configuration, the initial `connect()`). While the appearance
/// onboarding is open nothing starts, as in 1.14.x; the first tick after it finishes starts.
pub async fn start(engine: &Engine) {
    if engine.read(|state| state.session.started) || onboarding_pending(engine) {
        return;
    }
    start_now(engine).await;
}

async fn start_now(engine: &Engine) {
    let preview = engine.preview();
    let discover = engine.update(|state| {
        state.session.started = true;
        std::mem::take(&mut state.session.branches.discover_on_start)
    });
    if discover {
        repositories::spawn_first_run_discovery(engine);
    }
    microphone::configure(engine);
    figma::configure(engine);
    if !preview {
        awareness::subscribe(engine);
    }
    spawn_samplers(engine);
    if !preview {
        connection::connect(engine).await;
    }
}

/// One pass of the Swift main loop (`AppModel.start()`, see `docs/engine.md` §3), in the same
/// order. Statistics and day-review page loads belong to `controllers::tick`.
pub async fn tick(engine: &Engine) {
    if !engine.read(|state| state.session.started) {
        if onboarding_pending(engine) {
            return;
        }
        start_now(engine).await;
    }
    let preview = engine.preview();
    branches::scan(engine).await;

    let now = engine.now();
    let refresh_due = engine.read(|state| {
        let connection = &state.session.connection;
        connection
            .last_remote_check
            .is_none_or(|last| att_core::time::diff_secs(now, last) >= state.config.poll_interval())
    });
    if !preview && engine.clients().is_some() && !busy(engine) && refresh_due {
        connection::refresh(engine).await;
    }

    let now = engine.now();
    let calendar_due = engine.read(|state| {
        let interval = f64::from(state.config.cadences.calendar_seconds);
        state
            .session
            .calendar
            .last_check
            .is_none_or(|last| att_core::time::diff_secs(now, last) > interval)
    });
    if calendar_due {
        meetings::refresh_calendar(engine).await;
        let now = engine.now();
        engine.update(|state| state.session.calendar.last_check = Some(now));
    }

    attention::show_if_ready(engine);
    meetings::check_suggestions(engine, engine.now());
    microphone::sync(engine);
    meeting_return::check(engine, engine.now());
    if !preview && !busy(engine) {
        completion::check(engine, false).await;
    }
    completion::show_if_ready(engine);
    day_review_prompt::check(engine, engine.now());
    let quick = engine.update(|state| {
        let pending = state.session.quick_switch_pending && !busy(engine);
        if pending {
            state.session.quick_switch_pending = false;
        }
        pending
    });
    if quick {
        tracking::quick_switch(engine).await;
    }
    if !preview && progress::is_due(engine, engine.now()) {
        progress::load(engine).await;
    }
}

/// The appearance onboarding is open: the app does not start until it finishes.
fn onboarding_pending(engine: &Engine) -> bool {
    let preview = engine.preview();
    engine.read(|state| settings::needs_onboarding(state, preview))
}

/// Swift `busy`.
pub(crate) fn busy(engine: &Engine) -> bool {
    engine.inner.busy.is_busy()
}

/// Samplers on their own cadence, as the Swift microphone, Figma and presence services ran
/// their own 2 s loops: a slow 7pace request in the main loop must not stall the debounces.
/// Each loop sleeps first, so the first sample comes one interval after start.
fn spawn_samplers(engine: &Engine) {
    let Ok(handle) = tokio::runtime::Handle::try_current() else { return };
    if engine.update(|state| std::mem::replace(&mut state.session.samplers_spawned, true)) {
        return;
    }
    let preview = engine.preview();
    if !preview {
        let presence = engine.clone();
        handle.spawn(async move {
            loop {
                tokio::time::sleep(sampler_interval(&presence, 10)).await;
                awareness::sample(&presence).await;
            }
        });
    }
    let microphone = engine.clone();
    handle.spawn(async move {
        loop {
            // The meeting engine resets after a 10 s gap between samples.
            tokio::time::sleep(sampler_interval(&microphone, 4)).await;
            microphone::check_now(&microphone).await;
        }
    });
    let figma = engine.clone();
    handle.spawn(async move {
        loop {
            // The dwell resets after a 6 s gap between samples.
            let interval = sampler_interval(&figma, 4);
            let began = tokio::time::Instant::now();
            figma::poll(&figma).await;
            tokio::time::sleep_until(began + interval).await;
        }
    });
}

fn sampler_interval(engine: &Engine, max_seconds: u32) -> std::time::Duration {
    let seconds = engine.read(|state| state.config.cadences.probe_seconds).clamp(1, max_seconds);
    std::time::Duration::from_secs(u64::from(seconds))
}

/// Samples presence once (idle time, lock, foreground app) and runs the awareness check.
/// The sampler calls this every probe interval; tests call it directly.
pub async fn sample_presence(engine: &Engine) {
    awareness::sample(engine).await;
}

/// Samples microphone use once and syncs the meeting prompts (Swift `checkNow` +
/// `syncMicrophone`). The sampler calls this every probe interval; tests call it directly.
pub async fn sample_microphone(engine: &Engine) {
    microphone::check_now(engine).await;
}

/// Reads the Figma window once and updates the file context (Swift `FigmaService` loop body
/// + `observeFigma`). The sampler calls this every probe interval; tests call it directly.
pub async fn sample_figma(engine: &Engine) {
    figma::poll(engine).await;
}

/// Side effects collected under the state lock and run after it is released, in order:
/// withdrawn notifications, audit entries, worklog invalidation, title loads, prompts.
#[derive(Default)]
pub(crate) struct Effects {
    removed: Vec<String>,
    records: Vec<(String, String)>,
    invalidate: bool,
    titles: Vec<i64>,
    announcements: Vec<(PromptKind, Option<Notification>)>,
    sync_microphone: bool,
}

impl Effects {
    pub(crate) fn remove_notification(&mut self, id: impl Into<String>) {
        self.removed.push(id.into());
    }

    pub(crate) fn record(&mut self, title: impl Into<String>, detail: impl Into<String>) {
        self.records.push((title.into(), detail.into()));
    }

    pub(crate) fn invalidate_worklogs(&mut self) {
        self.invalidate = true;
    }

    pub(crate) fn title(&mut self, id: i64) {
        self.titles.push(id);
    }

    /// A prompt that may open the panel (see [`announce::announce`]).
    pub(crate) fn announce(&mut self, kind: PromptKind, notification: Option<Notification>) {
        self.announcements.push((kind, notification));
    }

    pub(crate) fn sync_microphone(&mut self) {
        self.sync_microphone = true;
    }

    pub(crate) fn run(self, engine: &Engine) {
        let shell = &engine.services().shell;
        for id in &self.removed {
            shell.remove_notification(id);
        }
        for (title, detail) in self.records {
            engine.record(title, detail);
        }
        if self.invalidate {
            crate::controllers::hooks::invalidate_worklogs(engine);
        }
        if !self.titles.is_empty() {
            connection::request_titles(engine, self.titles);
        }
        for (kind, notification) in self.announcements {
            announce::announce(engine, kind, notification, true);
        }
        if self.sync_microphone {
            microphone::sync(engine);
        }
    }
}

/// Runs `f` under the lock and its collected effects after it.
pub(crate) fn update_with<R>(
    engine: &Engine,
    f: impl FnOnce(&mut AppState, &mut Effects) -> R,
) -> R {
    let (result, effects) = engine.update(|state| {
        let mut effects = Effects::default();
        let result = f(state, &mut effects);
        (result, effects)
    });
    effects.run(engine);
    result
}

/// The local calendar day of `now`.
pub(crate) fn today(engine: &Engine) -> Date {
    engine.cal().date(engine.now())
}
