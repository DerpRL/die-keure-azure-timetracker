//! Controller slices: `statistics`, `timeEditor`, `dayReview`, `weekly`, `offline`,
//! `ticketContext` (see `docs/engine.md` §6).
//!
//! These structs are the UI contract. Their JSON mirrors `apps/desktop/src/ipc/contract.ts`;
//! change both together. Instants are RFC 3339 strings, calendar days `YYYY-MM-DD`.

use jiff::Timestamp;
use jiff::civil::Date;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use att_core::day_review::{DayReviewRecord, DayReviewSummary};
use att_core::explorer::{
    ExplorerActivity, ExplorerBucket, ExplorerEntry, ExplorerFilter, ExplorerPattern,
    ExplorerResolution, ExplorerTask,
};
use att_core::explorer_visuals::ExplorerVisuals;
use att_core::insights::ContextInsights;
use att_core::model::{ActivityType, WorkLog};
use att_core::offline::{OfflineDraft, OfflineReview};
use att_core::statistics::{StatisticsPeriod, StatisticsRange};
use att_core::ticket_context::TicketContext;
use att_core::time::Interval;
use att_core::worklog::corrections::TimeCorrectionIssue;
use att_core::worklog::edit::{WorkLogConflict, WorkLogEditReview};
use att_core::worklog::ops::{WorkLogChange, WorkLogPlan};

use crate::engine::Engine;
use crate::state::AppState;

// -- statistics -------------------------------------------------------------------------------

/// The three Statistics sections.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StatisticsSection {
    #[default]
    Time,
    Tasks,
    Patterns,
}

/// `ExplorerAnalysis` without its entry list (paged through `statistics.entries`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisView {
    pub window: Interval,
    pub tasks: Vec<ExplorerTask>,
    pub activities: Vec<ExplorerActivity>,
    pub buckets: Vec<ExplorerBucket>,
    pub weekdays: Vec<ExplorerPattern>,
    pub hours: Vec<ExplorerPattern>,
    pub lengths: Vec<ExplorerPattern>,
    pub resolution: ExplorerResolution,
    pub total: f64,
    pub covered: f64,
    pub count: i64,
    pub tracked_days: i64,
    pub median: f64,
    pub billable: f64,
    pub billable_known_count: i64,
    pub target: f64,
    pub context: ContextInsights,
    pub entry_count: usize,
    /// The first entries, for the always-visible list (8 in 1.14.x).
    pub entries_preview: Vec<ExplorerEntry>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsSlice {
    pub period: StatisticsPeriod,
    pub range: StatisticsRange,
    /// The downloaded period.
    pub bounds: Interval,
    /// The zoomed window (equals `bounds` when not zoomed).
    pub window: Interval,
    pub is_zoomed: bool,
    /// Steps available for "Back".
    pub zoom_depth: usize,
    pub filter: ExplorerFilter,
    pub section: StatisticsSection,
    pub loading: bool,
    pub analyzing: bool,
    pub issue: Option<String>,
    pub synced_at: Option<Timestamp>,
    /// Invalid worklogs left out of every total.
    pub omitted: i64,
    pub available_activities: Vec<ExplorerActivity>,
    pub analysis: Option<AnalysisView>,
    pub visuals: Option<ExplorerVisuals>,
    /// Targets are compared only for the complete, unfiltered period.
    pub target_comparable: bool,
}

/// One page of explorer entries (result of `statistics.entries`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntriesPage {
    pub offset: usize,
    pub total: usize,
    pub entries: Vec<ExplorerEntry>,
}

// -- time editor ------------------------------------------------------------------------------

/// Swift `TimeEditMode`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimeEditMode {
    Guided,
    #[default]
    Edit,
    Split,
    Merge,
    Undo,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionsView {
    pub show: bool,
    pub issues: Vec<TimeCorrectionIssue>,
    pub loading: bool,
    pub issue: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeEditorSlice {
    pub day: Date,
    pub filter: String,
    /// The day's entries after the filter, newest first.
    pub logs: Vec<WorkLog>,
    /// The running entry, which cannot be edited.
    pub running_log_id: Option<String>,
    pub selection: Vec<String>,
    pub selected: Option<WorkLog>,
    pub mode: TimeEditMode,
    pub start: Option<Timestamp>,
    pub end: Option<Timestamp>,
    pub split_at: Option<Timestamp>,
    pub second_ticket: String,
    pub second_comment: String,
    pub second_activity: String,
    pub merge_logs: Vec<WorkLog>,
    pub undo_record: Option<WorkLogChange>,
    /// The before/after preview of the pending change.
    pub plan: Option<WorkLogPlan>,
    pub validation_issue: Option<String>,
    pub review: Option<WorkLogEditReview>,
    pub loading: bool,
    pub working: bool,
    pub issue: Option<String>,
    pub message: Option<String>,
    pub saved_conflicts: Vec<WorkLogConflict>,
    pub saved_overlap_issue: Option<String>,
    /// Recent edits for this workspace, newest first.
    pub changes: Vec<WorkLogChange>,
    pub requires_review: bool,
    pub journal_issue: Option<String>,
    pub needs_reload: bool,
    pub corrections: CorrectionsView,
    pub guided_plan: Option<WorkLogPlan>,
    pub idle_interval: Option<Interval>,
    pub separate_idle: bool,
}

// -- day review, weekly report, offline drafts, ticket context --------------------------------

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayReviewSlice {
    pub selected_day: Date,
    pub summary: Option<DayReviewSummary>,
    pub record: Option<DayReviewRecord>,
    /// The scheduled target for the day.
    pub target_seconds: f64,
    pub long_entry_minutes: i64,
    pub loading: bool,
    pub issue: Option<String>,
    pub synced_at: Option<Timestamp>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklySlice {
    pub range: StatisticsRange,
    pub text: String,
    /// Worklogs for this week are loaded.
    pub has_data: bool,
    /// A saved draft exists (regenerating asks first).
    pub has_draft: bool,
    pub loading: bool,
    pub issue: Option<String>,
    pub storage_issue: Option<String>,
    pub message: Option<String>,
    pub synced_at: Option<Timestamp>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineSlice {
    pub workspace: String,
    /// This workspace's drafts, newest first (synced ones only when `show_synced`).
    pub drafts: Vec<OfflineDraft>,
    pub show_synced: bool,
    pub active: Option<OfflineDraft>,
    pub ready_count: usize,
    /// Cached activity types for offline entry.
    pub activities: Vec<ActivityType>,
    pub review: Option<OfflineReview>,
    pub working: bool,
    pub issue: Option<String>,
    pub message: Option<String>,
    pub can_create: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketContextSlice {
    /// The ticket whose panel is open.
    pub ticket_id: Option<i64>,
    pub details: Option<TicketContext>,
    pub loading: bool,
    pub issue: Option<String>,
    pub azure_url: Option<String>,
}

pub(crate) fn slices(
    _engine: &Engine,
    _state: &AppState,
    _now: Timestamp,
) -> Vec<(&'static str, Value)> {
    Vec::new()
}
