//! The page controllers: ports of `StatisticsModel`, `TimeEditorModel`, `DayReviewModel`,
//! `WeeklyReportModel`, `OfflineDraftModel` and `TicketContextModel`.
//!
//! Owner during the port: the controllers engineer. See `docs/engine.md`.

use jiff::Timestamp;
use jiff::civil::Date;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use att_core::explorer::ExplorerFilter;
use att_core::offline::OfflineDraft;
use att_core::statistics::StatisticsPeriod;

use crate::engine::Engine;
use crate::intent::not_implemented;
use crate::ipc::IpcError;
use view::{StatisticsSection, TimeEditMode};

pub mod hooks;
pub mod persist;
pub mod view;

/// State of every page controller.
#[derive(Default)]
pub struct ControllerState {}

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
    /// A page of the explorer's entry list (returned, not published).
    #[serde(rename = "statistics.entries")]
    StatisticsEntries { offset: usize, limit: usize },

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
    #[serde(rename = "timeEditor.setSelection")]
    SetTimeEditorSelection { ids: Vec<String> },
    #[serde(rename = "timeEditor.beginMerge")]
    BeginMerge,
    #[serde(rename = "timeEditor.beginUndo")]
    BeginUndo { change_id: Uuid },
    #[serde(rename = "timeEditor.checkOverlaps")]
    CheckOverlaps,
    #[serde(rename = "timeEditor.save")]
    SaveTimeEdit,
    #[serde(rename = "timeEditor.acknowledge")]
    AcknowledgeChange { change_id: Uuid },
    #[serde(rename = "timeEditor.showCorrections")]
    ShowCorrections { show: bool },
    #[serde(rename = "timeEditor.loadCorrections")]
    LoadCorrections,
    #[serde(rename = "timeEditor.prepareCorrection")]
    PrepareCorrection { issue_id: String, option: String },
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
    #[serde(rename = "weekly.generate")]
    GenerateWeeklyReport { replace: bool },
    #[serde(rename = "weekly.setText")]
    SetWeeklyReportText { text: String },
    #[serde(rename = "weekly.exportMarkdown")]
    ExportWeeklyReport { path: String },

    #[serde(rename = "offline.startLocal")]
    StartLocalTimer { ticket_id: Option<i64>, comment: String, activity_id: Option<String> },
    #[serde(rename = "offline.stopLocal")]
    StopLocalTimer,
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

pub async fn handle(_engine: &Engine, intent: ControllerIntent) -> Result<Value, IpcError> {
    not_implemented(&format!("{intent:?}"))
}

/// Per-tick work: page loads while a page is visible (Swift loaded statistics and the day
/// review only while their page was shown).
pub async fn tick(_engine: &Engine) {}
