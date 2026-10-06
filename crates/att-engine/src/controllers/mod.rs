//! The page controllers: ports of `StatisticsModel`, `TimeEditorModel`, `DayReviewModel`,
//! `WeeklyReportModel`, `OfflineDraftModel` and `TicketContextModel`.
//!
//! Owner during the port: the controllers engineer. See `docs/engine.md` and
//! `docs/port/engine-controllers.md` (traceability and decisions).
//!
//! Every controller follows the same pattern as its Swift model:
//! - state lives in [`ControllerState`] behind the engine lock; the lock is never held across an
//!   `.await` (read what is needed, await the network, re-lock and apply);
//! - each controller has its own generation counter (Swift `generation = UUID()`), and results
//!   are also dropped when [`Engine::connection_generation`] moved on;
//! - network work runs on its own task ([`detached`]), so a caller that goes away never leaves a
//!   `loading` or `working` flag behind, and a started write always reaches its checkpoints.

use std::future::Future;

use jiff::Timestamp;
use jiff::civil::Date;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use att_core::explorer::ExplorerFilter;
use att_core::offline::OfflineDraft;
use att_core::statistics::StatisticsPeriod;

use crate::clients::Clients;
use crate::engine::Engine;
use crate::ipc::IpcError;
use crate::state::AppState;
use view::{StatisticsSection, TimeEditMode};

mod day_review;
pub mod hooks;
mod offline;
pub mod persist;
mod statistics;
#[doc(hidden)]
pub mod testing;
mod ticket_context;
mod time_editor;
pub mod view;
mod weekly;

/// Page ids (see `crate::state::PAGES`).
pub(crate) mod pages {
    pub const STATISTICS: &str = "statistics";
    pub const TIME_EDITOR: &str = "timeEditor";
    pub const DAY_REVIEW: &str = "dayReview";
    pub const WEEKLY_REPORT: &str = "weeklyReport";
}

/// State of every page controller.
#[derive(Default)]
pub struct ControllerState {
    pub(crate) statistics: statistics::StatisticsState,
    pub(crate) time_editor: time_editor::TimeEditorState,
    pub(crate) day_review: day_review::DayReviewState,
    pub(crate) weekly: weekly::WeeklyState,
    pub(crate) offline: offline::OfflineState,
    pub(crate) ticket_context: ticket_context::TicketContextState,
    /// The page the previous tick saw, to run "page appeared" loads (Swift `.task` on appear).
    pub(crate) last_page: Option<String>,
    /// Test seam for ticket titles until the session's `workItems` cache exists (see
    /// [`testing::use_title_seam`]). `None` in production.
    pub(crate) title_seam: Option<TitleSeam>,
}

/// Titles and title requests seen by the controllers in tests.
#[derive(Debug, Default, Clone)]
pub(crate) struct TitleSeam {
    pub titles: std::collections::BTreeMap<i64, String>,
    pub requests: Vec<Vec<i64>>,
}

/// Intents owned by the page controllers. Field names are camelCase on the wire.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum ControllerIntent {
    #[serde(rename = "statistics.setPeriod")]
    SetStatisticsPeriod { period: StatisticsPeriod },
    #[serde(rename = "statistics.move")]
    MoveStatistics { amount: i64 },
    #[serde(rename = "statistics.current")]
    CurrentStatistics,
    #[serde(rename = "statistics.jumpTo")]
    JumpStatistics { date: Date },
    #[serde(rename = "statistics.setFilter")]
    SetStatisticsFilter { filter: ExplorerFilter },
    #[serde(rename = "statistics.clearFilters")]
    ClearStatisticsFilters,
    #[serde(rename = "statistics.zoomTo")]
    ZoomStatistics { start: Timestamp, end: Timestamp },
    #[serde(rename = "statistics.scale")]
    ScaleStatistics { factor: f64 },
    #[serde(rename = "statistics.pan")]
    PanStatistics { direction: i64 },
    #[serde(rename = "statistics.back")]
    StatisticsZoomBack,
    #[serde(rename = "statistics.resetZoom")]
    ResetStatisticsZoom,
    #[serde(rename = "statistics.setSection")]
    SetStatisticsSection { section: StatisticsSection },
    #[serde(rename = "statistics.refresh")]
    RefreshStatistics,
    /// A page of the explorer's entry list (returned, not published). With `start` and/or `end`,
    /// only entries overlapping `[start, end)` (a chart bucket or a timeline day).
    #[serde(rename = "statistics.entries")]
    StatisticsEntries {
        offset: usize,
        limit: usize,
        #[cfg_attr(feature = "ts", ts(optional = nullable))]
        #[serde(default)]
        start: Option<Timestamp>,
        #[cfg_attr(feature = "ts", ts(optional = nullable))]
        #[serde(default)]
        end: Option<Timestamp>,
    },

    #[serde(rename = "timeEditor.setDay")]
    SetTimeEditorDay { day: Date },
    #[serde(rename = "timeEditor.setFilter")]
    SetTimeEditorFilter { text: String },
    #[serde(rename = "timeEditor.load")]
    LoadTimeEditor,
    #[serde(rename = "timeEditor.select")]
    SelectWorkLog { log_id: String },
    #[serde(rename = "timeEditor.cancel")]
    CancelTimeEdit,
    #[serde(rename = "timeEditor.setMode")]
    SetTimeEditMode { mode: TimeEditMode },
    #[serde(rename = "timeEditor.setTimes")]
    SetTimeEditTimes { start: Timestamp, end: Timestamp },
    #[serde(rename = "timeEditor.setSplit")]
    SetTimeEditSplit { at: Timestamp, ticket: String, comment: String, activity_id: String },
    /// The second entry's ticket, comment and activity without moving the split point (split
    /// mode and the "separate idle time" option of a guided idle correction).
    #[serde(rename = "timeEditor.setSecondEntry")]
    SetTimeEditSecondEntry { ticket: String, comment: String, activity_id: String },
    #[serde(rename = "timeEditor.setSelection")]
    SetTimeEditorSelection { ids: Vec<String> },
    #[serde(rename = "timeEditor.beginMerge")]
    BeginMerge,
    #[serde(rename = "timeEditor.beginUndo")]
    BeginUndo { change_id: Uuid },
    #[serde(rename = "timeEditor.checkOverlaps")]
    CheckOverlaps,
    /// Returns `true` when 7pace confirmed the change.
    #[serde(rename = "timeEditor.save")]
    SaveTimeEdit,
    #[serde(rename = "timeEditor.acknowledge")]
    AcknowledgeChange { change_id: Uuid },
    #[serde(rename = "timeEditor.showCorrections")]
    ShowCorrections { show: bool },
    #[serde(rename = "timeEditor.loadCorrections")]
    LoadCorrections,
    /// `option` is one of `corrections.choices[].options`; `boundary` is the shared boundary of
    /// the `boundary` option (default: the middle of the overlap).
    #[serde(rename = "timeEditor.prepareCorrection")]
    PrepareCorrection {
        issue_id: String,
        option: String,
        #[cfg_attr(feature = "ts", ts(optional = nullable))]
        #[serde(default)]
        boundary: Option<Timestamp>,
    },
    #[serde(rename = "timeEditor.setSeparateIdle")]
    SetSeparateIdle { separate: bool },

    #[serde(rename = "dayReview.setDay")]
    SetDayReviewDay { day: Date },
    #[serde(rename = "dayReview.refresh")]
    RefreshDayReview,

    #[serde(rename = "weekly.move")]
    MoveWeeklyReport { amount: i64 },
    #[serde(rename = "weekly.jumpTo")]
    JumpWeeklyReport { date: Date },
    #[serde(rename = "weekly.refresh")]
    RefreshWeeklyReport,
    /// Fails with kind `needsConfirmation` when `replace` is false and a draft would be replaced.
    #[serde(rename = "weekly.generate")]
    GenerateWeeklyReport { replace: bool },
    #[serde(rename = "weekly.setText")]
    SetWeeklyReportText { text: String },
    #[serde(rename = "weekly.exportMarkdown")]
    ExportWeeklyReport { path: String },

    /// Returns `true` when the local timer was saved.
    #[serde(rename = "offline.startLocal")]
    StartLocalTimer { ticket_id: Option<i64>, comment: String, activity_id: Option<String> },
    #[serde(rename = "offline.stopLocal")]
    StopLocalTimer,
    /// Returns `true` when the draft was saved.
    #[serde(rename = "offline.save")]
    SaveOfflineDraft { draft: Box<OfflineDraft> },
    #[serde(rename = "offline.remove")]
    RemoveOfflineDraft { draft_id: Uuid },
    #[serde(rename = "offline.review")]
    ReviewOfflineDraft { draft_id: Uuid },
    #[serde(rename = "offline.upload")]
    UploadOfflineDraft,
    #[serde(rename = "offline.link")]
    LinkOfflineDraft { log_id: String },
    #[serde(rename = "offline.allowRetryAfterManualCheck")]
    AllowOfflineRetry,
    #[serde(rename = "offline.setShowSynced")]
    SetShowSyncedDrafts { show: bool },

    #[serde(rename = "ticket.showContext")]
    ShowTicketContext { ticket_id: i64 },
    #[serde(rename = "ticket.closeContext")]
    CloseTicketContext,
    #[serde(rename = "ticket.openInAzure")]
    OpenTicketInAzure { ticket_id: i64 },
}

pub async fn handle(engine: &Engine, intent: ControllerIntent) -> Result<Value, IpcError> {
    use ControllerIntent::*;
    match intent {
        SetStatisticsPeriod { period } => statistics::set_period(engine, period).await,
        MoveStatistics { amount } => statistics::move_by(engine, amount).await,
        CurrentStatistics => statistics::current(engine).await,
        JumpStatistics { date } => statistics::jump_to(engine, date).await,
        SetStatisticsFilter { filter } => statistics::set_filter(engine, filter),
        ClearStatisticsFilters => statistics::set_filter(engine, ExplorerFilter::default()),
        ZoomStatistics { start, end } => statistics::zoom_to(engine, start, end),
        ScaleStatistics { factor } => statistics::scale(engine, factor),
        PanStatistics { direction } => statistics::pan(engine, direction),
        StatisticsZoomBack => statistics::back(engine),
        ResetStatisticsZoom => statistics::reset_zoom(engine),
        SetStatisticsSection { section } => statistics::set_section(engine, section),
        RefreshStatistics => statistics::refresh(engine).await,
        StatisticsEntries { offset, limit, start, end } => {
            statistics::entries(engine, offset, limit, start, end)
        }

        SetTimeEditorDay { day } => time_editor::set_day(engine, day).await,
        SetTimeEditorFilter { text } => time_editor::set_filter(engine, text),
        LoadTimeEditor => time_editor::load_intent(engine).await,
        SelectWorkLog { log_id } => time_editor::select(engine, log_id).await,
        CancelTimeEdit => time_editor::cancel(engine),
        SetTimeEditMode { mode } => time_editor::set_mode(engine, mode),
        SetTimeEditTimes { start, end } => time_editor::set_times(engine, start, end),
        SetTimeEditSplit { at, ticket, comment, activity_id } => {
            time_editor::set_split(engine, Some(at), ticket, comment, activity_id)
        }
        SetTimeEditSecondEntry { ticket, comment, activity_id } => {
            time_editor::set_split(engine, None, ticket, comment, activity_id)
        }
        SetTimeEditorSelection { ids } => time_editor::set_selection(engine, ids),
        BeginMerge => time_editor::begin_merge(engine).await,
        BeginUndo { change_id } => time_editor::begin_undo(engine, change_id),
        CheckOverlaps => time_editor::check_changes(engine).await,
        SaveTimeEdit => time_editor::save_time_edit(engine).await,
        AcknowledgeChange { change_id } => time_editor::acknowledge(engine, change_id),
        ShowCorrections { show } => time_editor::show_corrections(engine, show),
        LoadCorrections => time_editor::load_corrections(engine).await,
        PrepareCorrection { issue_id, option, boundary } => {
            time_editor::prepare_correction(engine, issue_id, option, boundary).await
        }
        SetSeparateIdle { separate } => time_editor::set_separate_idle(engine, separate),

        SetDayReviewDay { day } => day_review::set_day(engine, day).await,
        RefreshDayReview => day_review::refresh(engine).await,

        MoveWeeklyReport { amount } => weekly::move_by(engine, amount).await,
        JumpWeeklyReport { date } => weekly::jump_to(engine, date).await,
        RefreshWeeklyReport => weekly::refresh(engine).await,
        GenerateWeeklyReport { replace } => weekly::generate(engine, replace),
        SetWeeklyReportText { text } => weekly::set_text(engine, text),
        ExportWeeklyReport { path } => weekly::export(engine, path).await,

        StartLocalTimer { ticket_id, comment, activity_id } => {
            offline::start_local(engine, ticket_id, comment, activity_id)
        }
        StopLocalTimer => offline::stop(engine),
        SaveOfflineDraft { draft } => offline::save_intent(engine, *draft),
        RemoveOfflineDraft { draft_id } => offline::remove(engine, draft_id),
        ReviewOfflineDraft { draft_id } => offline::review(engine, draft_id).await,
        UploadOfflineDraft => offline::upload(engine).await,
        LinkOfflineDraft { log_id } => offline::link(engine, log_id).await,
        AllowOfflineRetry => offline::allow_retry_after_manual_check(engine),
        SetShowSyncedDrafts { show } => offline::set_show_synced(engine, show),

        ShowTicketContext { ticket_id } => ticket_context::show(engine, ticket_id).await,
        CloseTicketContext => ticket_context::close(engine),
        OpenTicketInAzure { ticket_id } => ticket_context::open_in_azure(engine, ticket_id),
    }
}

/// Per-tick work (the end of the Swift loop, L306–307, plus the page lifecycle the SwiftUI views
/// drove with `.task`): loads when a page appears, the statistics and day-review refresh while
/// their page is visible, title batches and the weekly draft flush.
pub async fn tick(engine: &Engine) {
    let (page, previous) =
        engine.read(|state| (state.visible_page.clone(), state.controllers.last_page.clone()));
    if page != previous {
        engine.update(|state| state.controllers.last_page = page.clone());
        if previous.as_deref() == Some(pages::WEEKLY_REPORT) {
            weekly::flush_now(engine);
        }
        page_appeared(engine, page.as_deref());
    }
    // Swift: `if page == .statistics, !preview, connected, !busy { await statistics.load() }`,
    // throttled inside `load` (5 minutes, or 60 s after a failure).
    let preview = engine.preview();
    let connected = engine.read(|state| crate::session::hooks::tracking_state(state).is_some());
    let busy = engine.inner.busy.is_busy();
    if !preview && connected && !busy {
        match page.as_deref() {
            Some(pages::STATISTICS) => spawn(engine, |engine| async move {
                statistics::load(&engine, false).await;
            }),
            Some(pages::DAY_REVIEW) => spawn(engine, |engine| async move {
                day_review::load(&engine, false).await;
            }),
            _ => {}
        }
    }
    statistics::check_title_batch(engine);
    weekly::flush_if_due(engine);
}

/// The loads a SwiftUI view ran from `.task` when it appeared.
fn page_appeared(engine: &Engine, page: Option<&str>) {
    match page {
        Some(pages::STATISTICS) => spawn(engine, |engine| async move {
            statistics::load(&engine, false).await;
        }),
        Some(pages::DAY_REVIEW) => spawn(engine, |engine| async move {
            day_review::load(&engine, false).await;
        }),
        Some(pages::TIME_EDITOR) if !engine.preview() => spawn(engine, |engine| async move {
            time_editor::load(&engine).await;
        }),
        Some(pages::WEEKLY_REPORT) => spawn(engine, |engine| async move {
            weekly::load(&engine).await;
        }),
        _ => {}
    }
}

// -- Shared helpers -------------------------------------------------------------------------------

/// Whether `page` is the page the main window shows.
pub(crate) fn visible(state: &AppState, page: &str) -> bool {
    state.visible_page.as_deref() == Some(page)
}

/// Whether results computed with `clients` may still be applied.
pub(crate) fn still_current(engine: &Engine, clients: &Clients) -> bool {
    engine.connection_generation() == clients.generation
}

/// Runs `future` on its own task and waits for it. A caller that is dropped (a closed window, a
/// cancelled IPC call) no longer cancels the work, so flags are always reset and a started write
/// always reaches its journal or ledger checkpoints. `None` when the task panicked.
pub(crate) async fn detached<F, T>(future: F) -> Option<T>
where
    F: Future<Output = T> + Send + 'static,
    T: Send + 'static,
{
    match tokio::spawn(future).await {
        Ok(value) => Some(value),
        Err(error) => {
            tracing::error!("controller task failed: {error}");
            None
        }
    }
}

/// Starts `work` in the background when a Tokio runtime is available.
pub(crate) fn spawn<F, Fut>(engine: &Engine, work: F)
where
    F: FnOnce(Engine) -> Fut,
    Fut: Future<Output = ()> + Send + 'static,
{
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => {
            handle.spawn(work(engine.clone()));
        }
        Err(_) => tracing::debug!("no runtime for a background controller task"),
    }
}

/// The intent result for "nothing to return".
pub(crate) fn done() -> Result<Value, IpcError> {
    Ok(Value::Null)
}

/// The error a detached task reports when it panicked.
pub(crate) fn internal() -> IpcError {
    IpcError::new("internal", "The operation stopped unexpectedly. Refresh and try again.")
}

/// Workspace identities compare without a trailing slash or the default port: 1.14.x stored the
/// URL as typed (`https://org.timehub.7pace.com`), 2.0 normalises it with a trailing slash, and
/// imported drafts, journal records and weekly drafts must still match.
pub(crate) fn same_workspace(a: &str, b: &str) -> bool {
    normalized_workspace(a) == normalized_workspace(b)
}

pub(crate) fn normalized_workspace(workspace: &str) -> String {
    let lower = workspace.trim().to_lowercase();
    let trimmed = lower.trim_end_matches('/');
    trimmed.strip_suffix(":443").unwrap_or(trimmed).to_string()
}

/// Ticket titles the session knows (Swift `model.workItems`), or the test seam's.
pub(crate) fn known_titles(state: &AppState) -> std::collections::BTreeMap<i64, String> {
    match &state.controllers.title_seam {
        Some(seam) => seam.titles.clone(),
        None => crate::session::hooks::work_items(state)
            .into_iter()
            .map(|(id, item)| (id, item.title))
            .collect(),
    }
}

/// Asks the session to load missing titles in one batch.
pub(crate) fn request_titles(engine: &Engine, ids: Vec<i64>) {
    if ids.is_empty() {
        return;
    }
    let seam = engine.update(|state| match &mut state.controllers.title_seam {
        Some(seam) => {
            seam.requests.push(ids.clone());
            true
        }
        None => false,
    });
    if !seam {
        crate::session::hooks::request_titles(engine, ids);
    }
}

/// The confirmed timer for reviews: the tracking state, when it was confirmed, and whether the
/// connection is confirmed (Swift `state`, `lastSync`, `connectionHealth == .confirmed`).
///
/// `session::hooks` only exposes the state (present while connected), so the confirmation time
/// is unknown here: a running timer then hides gap estimates instead of guessing (see the port
/// notes; requested from the session as `tracking_confirmation`).
pub(crate) fn confirmed_timer(
    state: &AppState,
) -> (Option<att_core::model::TrackingState>, Option<Timestamp>, bool) {
    let tracking = crate::session::hooks::tracking_state(state);
    let confirmed = tracking.is_some();
    (tracking, None, confirmed)
}
