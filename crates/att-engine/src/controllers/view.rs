//! Controller slices: `statistics`, `timeEditor`, `dayReview`, `weekly`, `offline`,
//! `ticketContext` (see `docs/engine.md` §6).
//!
//! These structs are the UI contract. Their JSON mirrors `apps/desktop/src/ipc/contract.ts`;
//! change both together. Instants are RFC 3339 strings, calendar days `YYYY-MM-DD`.

use jiff::Timestamp;
use jiff::civil::Date;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use att_core::Cal;
use att_core::day_review::{DayReviewRecord, DayReviewSummary};
use att_core::explorer::{
    ExplorerActivity, ExplorerAnalysis, ExplorerBucket, ExplorerEntry, ExplorerFilter,
    ExplorerPattern, ExplorerResolution, ExplorerTask,
};
use att_core::explorer_visuals::ExplorerVisuals;
use att_core::insights::ContextInsights;
use att_core::model::{ActivityType, WorkLog};
use att_core::offline::{OfflineDraft, OfflineDraftStatus, OfflineReview};
use att_core::statistics::{StatisticsPeriod, StatisticsRange};
use att_core::ticket_context::TicketContext;
use att_core::time::{Interval, from_secs, secs};
use att_core::worklog::corrections::TimeCorrectionIssue;
use att_core::worklog::edit::{WorkLogConflict, WorkLogEditReview};
use att_core::worklog::ops::{WorkLogChange, WorkLogPlan};

use super::ticket_context::azure_ticket_url;
use super::time_editor::{correction_options, loaded_conflicts};
use crate::engine::Engine;
use crate::state::AppState;

/// Entries shown before "Show more" in 1.14.x.
pub const ENTRIES_PREVIEW: usize = 8;

// -- statistics -------------------------------------------------------------------------------

/// The three Statistics sections.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StatisticsSection {
    #[default]
    Time,
    Tasks,
    Patterns,
}

/// `ExplorerAnalysis` without its entry list (paged through `statistics.entries`).
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
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

impl AnalysisView {
    pub(crate) fn of(analysis: &ExplorerAnalysis) -> Self {
        Self {
            window: analysis.window,
            tasks: analysis.tasks.clone(),
            activities: analysis.activities.clone(),
            buckets: analysis.buckets.clone(),
            weekdays: analysis.weekdays.clone(),
            hours: analysis.hours.clone(),
            lengths: analysis.lengths.clone(),
            resolution: analysis.resolution,
            total: analysis.total,
            covered: analysis.covered,
            count: analysis.count,
            tracked_days: analysis.tracked_days,
            median: analysis.median,
            billable: analysis.billable,
            billable_known_count: analysis.billable_known_count,
            target: analysis.target,
            context: analysis.context.clone(),
            entry_count: analysis.entries.len(),
            entries_preview: analysis.entries.iter().take(ENTRIES_PREVIEW).cloned().collect(),
        }
    }
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
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
    /// A 7pace connection exists ("Refresh" is available).
    pub configured: bool,
}

/// One page of explorer entries (result of `statistics.entries`).
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntriesPage {
    pub offset: usize,
    pub total: usize,
    pub entries: Vec<ExplorerEntry>,
}

// -- time editor ------------------------------------------------------------------------------

/// Swift `TimeEditMode`.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
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

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionsView {
    pub show: bool,
    pub issues: Vec<TimeCorrectionIssue>,
    pub loading: bool,
    pub issue: Option<String>,
    /// For each of `issues`, in the same order: its id and the correction options with a valid
    /// plan, for `timeEditor.prepareCorrection`.
    pub choices: Vec<CorrectionChoices>,
}

/// The corrections offered for one gap or overlap: `extendEarlier`, `startLaterEarlier` (gaps),
/// `removeFromEarlier`, `removeFromLater`, `boundary` (overlaps).
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionChoices {
    pub issue_id: String,
    pub options: Vec<String>,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
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
    /// A 7pace connection exists.
    pub configured: bool,
    /// Overlaps of the pending change with the loaded day's entries and the running timer,
    /// shown before the optional full check (Swift `loadedConflicts`).
    pub loaded_conflicts: Vec<WorkLogConflict>,
}

// -- day review, weekly report, offline drafts, ticket context --------------------------------

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
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
    /// The shortest gap the review reports, in minutes (Day review preferences).
    pub gap_minutes: i64,
    /// A 7pace connection exists ("Refresh review" is available).
    pub configured: bool,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
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
    /// A 7pace connection exists (drafts are saved per workspace).
    pub configured: bool,
    /// The file name the export dialog suggests: `weekly-status-<yyyy-MM-dd>.md`.
    pub export_file_name: String,
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineSlice {
    pub workspace: String,
    /// This workspace's drafts, newest first (synced ones only when `show_synced`).
    pub drafts: Vec<OfflineDraftView>,
    pub show_synced: bool,
    pub active: Option<OfflineDraftView>,
    pub ready_count: usize,
    /// Cached activity types for offline entry.
    pub activities: Vec<ActivityType>,
    pub review: Option<OfflineReview>,
    pub working: bool,
    pub issue: Option<String>,
    pub message: Option<String>,
    pub can_create: bool,
    /// A 7pace connection exists (reviews and uploads are available).
    pub configured: bool,
}

/// A draft as the Offline drafts page shows it: the stored draft plus its title.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineDraftView {
    #[serde(flatten)]
    pub draft: OfflineDraft,
    /// `#ticket`, else the comment, else "Untitled draft" (Swift `OfflineDraft.title`).
    pub title: String,
}

impl From<&OfflineDraft> for OfflineDraftView {
    fn from(draft: &OfflineDraft) -> Self {
        Self { title: draft.title(), draft: draft.clone() }
    }
}

#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
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

// -- assembly ---------------------------------------------------------------------------------

fn to_value<T: Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

pub(crate) fn slices(
    engine: &Engine,
    state: &AppState,
    now: Timestamp,
) -> Vec<(&'static str, Value)> {
    let cal = engine.cal();
    vec![
        ("statistics", to_value(&statistics(state, &cal))),
        ("timeEditor", to_value(&time_editor(state, &cal, now))),
        ("dayReview", to_value(&day_review(state, &cal, now))),
        ("weekly", to_value(&weekly(state, &cal))),
        ("offline", to_value(&offline(state))),
        ("ticketContext", to_value(&ticket_context(state))),
    ]
}

fn statistics(state: &AppState, cal: &Cal) -> StatisticsSlice {
    let stats = &state.controllers.statistics;
    let range = stats.range(cal);
    let bounds = range.interval();
    let window = stats.focus.unwrap_or(bounds);
    StatisticsSlice {
        period: stats.period,
        range,
        bounds,
        window,
        is_zoomed: window != bounds,
        zoom_depth: stats.zoom_history.len(),
        filter: stats.filter.clone(),
        section: stats.section,
        loading: stats.loading,
        analyzing: stats.analyzing,
        issue: stats.issue.clone(),
        synced_at: stats.synced_at,
        omitted: stats.omitted,
        available_activities: stats.available_activities.clone(),
        analysis: stats.current_analysis(cal).map(|analysis| AnalysisView::of(analysis)),
        visuals: stats.current_visuals(cal).map(|visuals| (**visuals).clone()),
        target_comparable: window == bounds && !stats.filter.is_active(),
        configured: stats.configured,
    }
}

fn time_editor(state: &AppState, cal: &Cal, now: Timestamp) -> TimeEditorSlice {
    let editor = &state.controllers.time_editor;
    let tracking = crate::session::hooks::tracking_state(state);
    let running_log_id = tracking
        .as_ref()
        .filter(|tracking| tracking.running())
        .and_then(|tracking| tracking.track.as_ref())
        .and_then(|track| track.work_log_id.clone());
    let mut logs: Vec<WorkLog> = editor.visible_logs().into_iter().cloned().collect();
    // Newest first; unreadable dates last.
    logs.sort_by_cached_key(|log| std::cmp::Reverse(log.date(cal.tz())));
    let selected = editor.selected.is_some();
    let plan = selected.then(|| editor.proposed_plan(now, cal));
    TimeEditorSlice {
        day: editor.day,
        filter: editor.filter.clone(),
        logs,
        running_log_id,
        selection: editor.selection.iter().cloned().collect(),
        selected: editor.selected.clone(),
        mode: editor.mode,
        start: selected.then_some(editor.start),
        end: selected.then_some(editor.end),
        split_at: selected.then_some(editor.split_at),
        second_ticket: editor.second_ticket.clone(),
        second_comment: editor.second_comment.clone(),
        second_activity: editor.second_activity.clone(),
        merge_logs: editor.merge_logs.clone(),
        undo_record: editor.undo_record.clone(),
        validation_issue: plan
            .as_ref()
            .and_then(|plan| plan.as_ref().err())
            .map(|error| error.to_string()),
        plan: plan.and_then(Result::ok),
        review: editor.review.clone(),
        loading: editor.loading,
        working: editor.working,
        issue: editor.issue.clone(),
        message: editor.message.clone(),
        saved_conflicts: editor.saved_conflicts.clone(),
        saved_overlap_issue: editor.saved_overlap_issue.clone(),
        changes: editor.recent_changes().into_iter().cloned().collect(),
        requires_review: editor.requires_review(),
        journal_issue: editor.journal_issue.clone(),
        needs_reload: editor.needs_reload,
        corrections: CorrectionsView {
            show: editor.show_corrections,
            issues: editor.correction_issues.clone(),
            loading: editor.correction_loading,
            issue: editor.correction_issue.clone(),
            choices: editor
                .correction_issues
                .iter()
                .map(|issue| CorrectionChoices {
                    issue_id: issue.id(),
                    options: correction_options(issue, now, cal),
                })
                .collect(),
        },
        guided_plan: editor.guided_plan.clone(),
        idle_interval: editor.idle_interval,
        separate_idle: editor.separate_idle,
        configured: editor.configured,
        loaded_conflicts: if selected {
            loaded_conflicts(editor, tracking.as_ref(), now, cal)
        } else {
            Vec::new()
        },
    }
}

/// The review summary moves with the clock; minute steps keep the slice from changing on every
/// publish while the page shows durations in minutes.
fn whole_minute(now: Timestamp) -> Timestamp {
    from_secs((secs(now) / 60.0).floor() * 60.0)
}

fn day_review(state: &AppState, cal: &Cal, now: Timestamp) -> DayReviewSlice {
    let review = &state.controllers.day_review;
    let preferences = &state.config.day_review;
    let summary = (review.loaded_day == Some(review.selected_day)).then(|| {
        let (tracking, confirmed_at, confirmed) = super::confirmed_timer(state, now);
        DayReviewSummary::calculate(
            &review.logs,
            cal.start_of_date(review.selected_day),
            whole_minute(now),
            preferences,
            tracking.as_ref(),
            confirmed_at,
            confirmed,
            cal,
        )
    });
    DayReviewSlice {
        selected_day: review.selected_day,
        summary,
        record: crate::session::hooks::day_review_record(state, review.selected_day),
        target_seconds: state.config.targets.daily_seconds_on(review.selected_day),
        long_entry_minutes: preferences.long_session_minutes,
        loading: review.loading,
        issue: review.issue.clone(),
        synced_at: review.synced_at,
        gap_minutes: preferences.gap_minutes,
        configured: review.configured,
    }
}

fn weekly(state: &AppState, cal: &Cal) -> WeeklySlice {
    let weekly = &state.controllers.weekly;
    WeeklySlice {
        range: weekly.range(cal),
        text: weekly.text.clone(),
        has_data: weekly.has_data(cal),
        has_draft: !weekly.text.is_empty(),
        loading: weekly.loading,
        issue: weekly.issue.clone(),
        storage_issue: weekly.storage_issue.clone(),
        message: weekly.message.clone(),
        synced_at: weekly.synced_at,
        configured: weekly.configured,
        export_file_name: weekly.export_file_name(cal),
    }
}

fn offline(state: &AppState) -> OfflineSlice {
    let workspace = crate::session::hooks::workspace(state);
    let offline = &state.controllers.offline;
    OfflineSlice {
        drafts: offline
            .drafts(&workspace)
            .into_iter()
            .filter(|draft| offline.show_synced || draft.status != OfflineDraftStatus::Synced)
            .map(OfflineDraftView::from)
            .collect(),
        show_synced: offline.show_synced,
        active: offline.ledger.active().map(OfflineDraftView::from),
        ready_count: offline.ready_count(&workspace),
        activities: offline.activities(&workspace),
        review: offline.review.clone(),
        working: offline.working,
        issue: offline.issue.clone(),
        message: offline.message.clone(),
        can_create: offline.can_create(&workspace),
        configured: offline.configured,
        workspace,
    }
}

fn ticket_context(state: &AppState) -> TicketContextSlice {
    let context = &state.controllers.ticket_context;
    TicketContextSlice {
        ticket_id: context.request,
        details: context.details.clone().filter(|details| Some(details.id) == context.request),
        loading: context.loading,
        issue: context.issue.clone(),
        azure_url: context.request.and_then(|id| azure_ticket_url(&state.config.organization, id)),
    }
}
