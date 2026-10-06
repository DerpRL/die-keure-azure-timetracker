//! The Statistics page. Port of `StatisticsModel.swift`.
//!
//! Differences from Swift, all deliberate (see `docs/port/engine-controllers.md`):
//! - analyses run on the blocking pool after the same 120 ms debounce; a newer request drops an
//!   older one before and after it runs;
//! - ticket titles are requested from the session in one batch per download, and the analysis
//!   is redone once when that batch has arrived (Swift re-analysed on every single title);
//! - targets are read from the configuration when an analysis runs (Swift captured them when the
//!   connection was configured);
//! - changing the period or anchor resets the zoom at once (Swift reset it when the next
//!   download started).

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use std::time::Duration;

use jiff::Timestamp;
use jiff::civil::Date;
use serde_json::Value;

use att_core::AppError;
use att_core::explorer::{
    ExplorerActivity, ExplorerAnalysis, ExplorerDataset, ExplorerEntry, ExplorerFilter,
    ExplorerOptions, StatisticsZoom,
};
use att_core::explorer_visuals::ExplorerVisuals;
use att_core::statistics::{StatisticsPeriod, StatisticsRange};
use att_core::text::natural_cmp;
use att_core::time::{Cal, Interval, diff_secs};

use super::view::{EntriesPage, StatisticsSection};
use super::{
    detached, done, internal, known_titles, pages, request_titles, still_current, visible,
};
use crate::engine::Engine;
use crate::ipc::IpcError;

/// Swift waited 120 ms before analysing, so typing in the search field analyses once.
pub(crate) const ANALYSIS_DEBOUNCE: Duration = Duration::from_millis(120);
/// A loaded period is downloaded again after 5 minutes; a failed download is retried after 60 s.
const REFRESH_SECONDS: f64 = 300.0;
const RETRY_SECONDS: f64 = 60.0;
/// The largest page `statistics.entries` returns.
pub(crate) const MAX_ENTRIES_PAGE: usize = 500;

pub(crate) struct StatisticsState {
    pub period: StatisticsPeriod,
    /// The local day the period is built around (Swift `anchor`).
    pub anchor: Date,
    pub filter: ExplorerFilter,
    pub section: StatisticsSection,
    pub loading: bool,
    pub analyzing: bool,
    pub issue: Option<String>,
    pub synced_at: Option<Timestamp>,
    pub loaded_range: Option<StatisticsRange>,
    pub analysis: Option<Arc<ExplorerAnalysis>>,
    pub visuals: Option<Arc<ExplorerVisuals>>,
    pub focus: Option<Interval>,
    pub zoom_history: Vec<Interval>,
    pub available_activities: Vec<ExplorerActivity>,
    pub omitted: i64,
    /// A 7pace connection exists (Swift `configured`).
    pub configured: bool,
    dataset: Arc<ExplorerDataset>,
    generation: u64,
    analysis_generation: u64,
    pending_range: Option<StatisticsRange>,
    last_attempt: Option<Timestamp>,
    last_attempt_range: Option<StatisticsRange>,
    title_batch: Option<TitleBatch>,
    /// Analyses that actually ran (debounced ones excluded), for tests.
    pub(crate) analyses_run: u64,
}

impl Default for StatisticsState {
    fn default() -> Self {
        Self {
            period: StatisticsPeriod::Week,
            anchor: Date::default(),
            filter: ExplorerFilter::default(),
            section: StatisticsSection::default(),
            loading: false,
            analyzing: false,
            issue: None,
            synced_at: None,
            loaded_range: None,
            analysis: None,
            visuals: None,
            focus: None,
            zoom_history: Vec::new(),
            available_activities: Vec::new(),
            omitted: 0,
            configured: false,
            dataset: Arc::default(),
            generation: 0,
            analysis_generation: 0,
            pending_range: None,
            last_attempt: None,
            last_attempt_range: None,
            title_batch: None,
            analyses_run: 0,
        }
    }
}

impl StatisticsState {
    pub(crate) fn range(&self, cal: &Cal) -> StatisticsRange {
        StatisticsRange::new(self.period, cal.start_of_date(self.anchor), cal)
    }

    pub(crate) fn bounds(&self, cal: &Cal) -> Interval {
        self.range(cal).interval()
    }

    pub(crate) fn window(&self, cal: &Cal) -> Interval {
        self.focus.unwrap_or_else(|| self.bounds(cal))
    }

    /// The analysis of the selected period, if it is the one that was downloaded.
    pub(crate) fn current_analysis(&self, cal: &Cal) -> Option<&Arc<ExplorerAnalysis>> {
        self.analysis.as_ref().filter(|_| self.loaded_range == Some(self.range(cal)))
    }

    pub(crate) fn current_visuals(&self, cal: &Cal) -> Option<&Arc<ExplorerVisuals>> {
        self.visuals.as_ref().filter(|_| self.loaded_range == Some(self.range(cal)))
    }

    /// Swift `configure(client, targets:)`: everything but the period, anchor and section.
    pub(crate) fn configure(&mut self, configured: bool) {
        self.configured = configured;
        self.generation += 1;
        self.analysis_generation += 1;
        self.analyzing = false;
        self.loading = false;
        self.pending_range = None;
        self.issue = None;
        self.dataset = Arc::default();
        self.analysis = None;
        self.visuals = None;
        self.loaded_range = None;
        self.synced_at = None;
        self.last_attempt = None;
        self.last_attempt_range = None;
        self.focus = None;
        self.zoom_history.clear();
        self.available_activities.clear();
        self.omitted = 0;
        self.title_batch = None;
        self.filter = ExplorerFilter::default();
    }

    /// Swift `invalidate()`: the next load downloads again.
    pub(crate) fn invalidate(&mut self) {
        self.last_attempt = None;
    }

    /// Ticket numbers in the downloaded dataset (Swift `ticketIDs`).
    fn ticket_ids(&self) -> BTreeSet<i64> {
        self.dataset.records.iter().filter_map(|record| record.ticket_id).collect()
    }

    /// Resets the zoom when the period moved (returns whether the range changed).
    fn range_changed(&mut self, before: StatisticsRange, cal: &Cal) -> bool {
        if self.range(cal) == before {
            return false;
        }
        self.focus = None;
        self.zoom_history.clear();
        true
    }
}

// -- Period and filters ---------------------------------------------------------------------------

pub(crate) async fn set_period(
    engine: &Engine,
    period: StatisticsPeriod,
) -> Result<Value, IpcError> {
    let cal = engine.cal();
    let changed = engine.update(|state| {
        let stats = &mut state.controllers.statistics;
        let before = stats.range(&cal);
        stats.period = period;
        stats.range_changed(before, &cal)
    });
    after_range_change(engine, changed).await
}

/// Swift `move(_:)`: the anchor becomes the start of the shifted period.
pub(crate) async fn move_by(engine: &Engine, amount: i64) -> Result<Value, IpcError> {
    let cal = engine.cal();
    let changed = engine.update(|state| {
        let stats = &mut state.controllers.statistics;
        let before = stats.range(&cal);
        stats.anchor = cal.date(before.shifted(amount, &cal).start);
        stats.range_changed(before, &cal)
    });
    after_range_change(engine, changed).await
}

/// Swift `current()`.
pub(crate) async fn current(engine: &Engine) -> Result<Value, IpcError> {
    let today = engine.cal().date(engine.now());
    jump_to(engine, today).await
}

pub(crate) async fn jump_to(engine: &Engine, date: Date) -> Result<Value, IpcError> {
    let cal = engine.cal();
    let changed = engine.update(|state| {
        let stats = &mut state.controllers.statistics;
        let before = stats.range(&cal);
        stats.anchor = date;
        stats.range_changed(before, &cal)
    });
    after_range_change(engine, changed).await
}

/// Swift's view reloaded through `.task(id: range)` while the page was shown.
async fn after_range_change(engine: &Engine, changed: bool) -> Result<Value, IpcError> {
    if changed && engine.read(|state| visible(state, pages::STATISTICS)) {
        let engine = engine.clone();
        detached(async move { load(&engine, false).await }).await.ok_or_else(internal)?;
    }
    done()
}

/// Swift `filter` `didSet`: analyse again when it changed.
pub(crate) fn set_filter(engine: &Engine, filter: ExplorerFilter) -> Result<Value, IpcError> {
    let changed = engine.update(|state| {
        let stats = &mut state.controllers.statistics;
        if stats.filter == filter {
            return false;
        }
        stats.filter = filter;
        true
    });
    if changed {
        rebuild(engine);
    }
    done()
}

pub(crate) fn set_section(engine: &Engine, section: StatisticsSection) -> Result<Value, IpcError> {
    engine.update(|state| state.controllers.statistics.section = section);
    done()
}

// -- Zoom -----------------------------------------------------------------------------------------

pub(crate) fn zoom_to(
    engine: &Engine,
    start: Timestamp,
    end: Timestamp,
) -> Result<Value, IpcError> {
    zoom_with(engine, |_, _| Interval::new(start, end))
}

pub(crate) fn scale(engine: &Engine, factor: f64) -> Result<Value, IpcError> {
    zoom_with(engine, |window, bounds| StatisticsZoom::scaled(window, factor, bounds))
}

pub(crate) fn pan(engine: &Engine, direction: i64) -> Result<Value, IpcError> {
    zoom_with(engine, |window, bounds| StatisticsZoom::shifted(window, direction, bounds))
}

/// Swift `zoom(to:)`: bounded to the period; a no-op when the window would not change.
fn zoom_with(
    engine: &Engine,
    proposed: impl FnOnce(Interval, Interval) -> Interval,
) -> Result<Value, IpcError> {
    let cal = engine.cal();
    let changed = engine.update(|state| {
        let stats = &mut state.controllers.statistics;
        let (window, bounds) = (stats.window(&cal), stats.bounds(&cal));
        let next = StatisticsZoom::bounded(proposed(window, bounds), bounds);
        if next == window {
            return false;
        }
        stats.zoom_history.push(window);
        stats.focus = Some(next);
        true
    });
    if changed {
        rebuild(engine);
    }
    done()
}

pub(crate) fn back(engine: &Engine) -> Result<Value, IpcError> {
    let changed = engine.update(|state| {
        let stats = &mut state.controllers.statistics;
        let Some(previous) = stats.zoom_history.pop() else { return false };
        stats.focus = Some(previous);
        true
    });
    if changed {
        rebuild(engine);
    }
    done()
}

pub(crate) fn reset_zoom(engine: &Engine) -> Result<Value, IpcError> {
    engine.update(|state| {
        let stats = &mut state.controllers.statistics;
        stats.focus = None;
        stats.zoom_history.clear();
    });
    rebuild(engine);
    done()
}

// -- Loading --------------------------------------------------------------------------------------

/// `statistics.refresh`: Swift `load(force: true)`.
pub(crate) async fn refresh(engine: &Engine) -> Result<Value, IpcError> {
    let engine = engine.clone();
    detached(async move { load(&engine, true).await }).await.ok_or_else(internal)?;
    done()
}

/// Swift `load(force:)`: the selected period plus the preceding day (overnight entries), at most
/// every 5 minutes (60 s after a failure) unless forced. A failed refresh keeps the data.
pub(crate) async fn load(engine: &Engine, force: bool) {
    let Some(clients) = engine.clients() else { return };
    let cal = engine.cal();
    let now = engine.now();
    let started = engine.update(|state| {
        let stats = &mut state.controllers.statistics;
        let requested = stats.range(&cal);
        if stats.loading && stats.pending_range == Some(requested) {
            return None;
        }
        let throttle = if stats.issue.is_none() { REFRESH_SECONDS } else { RETRY_SECONDS };
        if !force
            && stats.last_attempt_range == Some(requested)
            && (stats.issue.is_some()
                || (stats.loaded_range == Some(requested) && stats.synced_at.is_some()))
            && stats.last_attempt.is_some_and(|last| diff_secs(now, last) < throttle)
        {
            return None;
        }
        stats.generation += 1;
        stats.pending_range = Some(requested);
        stats.loading = true;
        stats.last_attempt = Some(now);
        stats.last_attempt_range = Some(requested);
        stats.issue = None;
        if stats.loaded_range != Some(requested) {
            stats.analysis_generation += 1;
            stats.analysis = None;
            stats.visuals = None;
            stats.analyzing = false;
            stats.loaded_range = None;
            stats.synced_at = None;
            stats.focus = None;
            stats.zoom_history.clear();
        }
        Some((stats.generation, requested))
    });
    let Some((request, requested)) = started else { return };

    // The API filters by reported start date. Include yesterday for ordinary overnight entries.
    let from = cal.add_days(requested.start, -1);
    let result = match clients.seven_pace.work_logs(Some(from), requested.end, false).await {
        Ok(logs) => {
            let parse_cal = cal.clone();
            tokio::task::spawn_blocking(move || ExplorerDataset::new(&logs, &parse_cal))
                .await
                .map_err(|_| AppError::message("The downloaded worklogs could not be read."))
        }
        Err(error) => Err(error),
    };
    let current = still_current(engine, &clients);
    let synced = engine.now();
    let installed = engine.update(|state| {
        let known = known_titles(state);
        let stats = &mut state.controllers.statistics;
        let valid = current && stats.generation == request && stats.range(&cal) == requested;
        let mut missing = None;
        if valid {
            match result {
                Ok(dataset) => {
                    install(stats, dataset, requested, synced);
                    let ids: BTreeSet<i64> = stats
                        .ticket_ids()
                        .into_iter()
                        .filter(|id| !known.contains_key(id))
                        .collect();
                    stats.title_batch =
                        (!ids.is_empty()).then(|| TitleBatch::new(request, ids.clone(), synced));
                    missing = Some(ids);
                }
                Err(error) => stats.issue = Some(error.to_string()),
            }
        }
        if stats.generation == request {
            stats.loading = false;
            stats.pending_range = None;
        }
        missing
    });
    if let Some(missing) = installed {
        request_titles(engine, missing.into_iter().collect());
        rebuild(engine);
    }
}

/// Swift `install(_:range:)`.
fn install(
    stats: &mut StatisticsState,
    dataset: ExplorerDataset,
    requested: StatisticsRange,
    now: Timestamp,
) {
    if stats.loaded_range != Some(requested) {
        stats.focus = None;
        stats.zoom_history.clear();
    }
    stats.omitted = dataset.omitted;
    stats.loaded_range = Some(requested);
    stats.synced_at = Some(now);
    stats.available_activities = available_activities(&dataset, &requested);
    stats.dataset = Arc::new(dataset);
}

/// Activities of the records inside the period, named after their earliest record, in Finder
/// order (Swift `localizedStandardCompare`; equal names by ID so the order is stable).
fn available_activities(
    dataset: &ExplorerDataset,
    requested: &StatisticsRange,
) -> Vec<ExplorerActivity> {
    let mut seen = std::collections::HashSet::new();
    let mut activities: Vec<ExplorerActivity> = dataset
        .records
        .iter()
        .filter(|record| record.start < requested.end && record.end > requested.start)
        .filter(|record| seen.insert(record.activity_id.as_str()))
        .map(|record| ExplorerActivity {
            id: record.activity_id.clone(),
            name: record.activity_name.clone(),
            seconds: 0.0,
        })
        .collect();
    activities.sort_by(|a, b| natural_cmp(&a.name, &b.name).then_with(|| a.id.cmp(&b.id)));
    activities
}

// -- Analysis -------------------------------------------------------------------------------------

/// Swift `rebuild()`: analyse the downloaded period off the async threads, 120 ms after the last
/// change. Superseded requests never run or never apply.
pub(crate) fn rebuild(engine: &Engine) {
    let cal = engine.cal();
    let job = engine.update(|state| {
        let titles = known_titles(state);
        let targets = state.config.targets.clone();
        let stats = &mut state.controllers.statistics;
        let range = stats.range(&cal);
        if stats.loaded_range != Some(range) {
            return None;
        }
        stats.analysis_generation += 1;
        stats.analyzing = true;
        let ids = stats.ticket_ids();
        let titles: HashMap<i64, String> =
            titles.into_iter().filter(|(id, _)| ids.contains(id)).collect();
        Some(AnalysisJob {
            token: stats.analysis_generation,
            range,
            dataset: stats.dataset.clone(),
            window: stats.window(&cal),
            options: ExplorerOptions {
                filter: stats.filter.clone(),
                titles,
                targets,
                resolution: None,
            },
        })
    });
    let Some(job) = job else { return };
    super::spawn(engine, move |engine| async move { analyse(engine, job, cal).await });
}

struct AnalysisJob {
    token: u64,
    range: StatisticsRange,
    dataset: Arc<ExplorerDataset>,
    window: Interval,
    options: ExplorerOptions,
}

async fn analyse(engine: Engine, job: AnalysisJob, cal: Cal) {
    tokio::time::sleep(ANALYSIS_DEBOUNCE).await;
    let superseded = engine.update(|state| {
        let stats = &mut state.controllers.statistics;
        let superseded = stats.analysis_generation != job.token;
        if !superseded {
            stats.analyses_run += 1;
        }
        superseded
    });
    if superseded {
        return;
    }
    let now = engine.now();
    let AnalysisJob { token, range, dataset, window, options } = job;
    let run_cal = cal.clone();
    let result = tokio::task::spawn_blocking(move || {
        let analysis = dataset.analyze(window, &options, &run_cal, now);
        let visuals = ExplorerVisuals::new(&analysis, &options.targets, &run_cal, now);
        (analysis, visuals)
    })
    .await;
    engine.update(|state| {
        let stats = &mut state.controllers.statistics;
        if stats.analysis_generation != token || stats.range(&cal) != range {
            return;
        }
        stats.analyzing = false;
        match result {
            Ok((analysis, visuals)) => {
                stats.analysis = Some(Arc::new(analysis));
                stats.visuals = Some(Arc::new(visuals));
            }
            Err(error) => tracing::error!("statistics analysis failed: {error}"),
        }
    });
}

// -- Ticket titles --------------------------------------------------------------------------------

/// Missing titles requested together after one download. The analysis is redone once, when every
/// title arrived or when nothing new arrived for [`TitleBatch::QUIET_SECONDS`] (inaccessible
/// tickets never arrive).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TitleBatch {
    /// The load generation the batch belongs to.
    request: u64,
    ids: BTreeSet<i64>,
    arrived: usize,
    progress_at: Timestamp,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum BatchStep {
    /// Nothing changed.
    Wait,
    /// More titles arrived; keep waiting for the rest.
    Progress(usize),
    /// The batch is over; analyse again when any title arrived.
    Done { reanalyse: bool },
}

impl TitleBatch {
    pub(crate) const QUIET_SECONDS: f64 = 10.0;

    pub(crate) fn new(request: u64, ids: BTreeSet<i64>, now: Timestamp) -> Self {
        Self { request, ids, arrived: 0, progress_at: now }
    }

    pub(crate) fn step(&self, known: impl Fn(i64) -> bool, now: Timestamp) -> BatchStep {
        let arrived = self.ids.iter().filter(|id| known(**id)).count();
        if arrived == self.ids.len() {
            return BatchStep::Done { reanalyse: arrived > 0 };
        }
        if arrived > self.arrived {
            return BatchStep::Progress(arrived);
        }
        let quiet = diff_secs(now, self.progress_at);
        if !(0.0..Self::QUIET_SECONDS).contains(&quiet) {
            return BatchStep::Done { reanalyse: arrived > 0 };
        }
        BatchStep::Wait
    }
}

/// Per tick: finish the title batch of the current download.
pub(crate) fn check_title_batch(engine: &Engine) {
    let now = engine.now();
    let step = engine.read(|state| {
        let batch = state.controllers.statistics.title_batch.as_ref()?;
        let known = known_titles(state);
        Some((batch.request, batch.step(|id| known.contains_key(&id), now)))
    });
    let Some((request, step)) = step else { return };
    let reanalyse = match step {
        BatchStep::Wait => false,
        BatchStep::Progress(arrived) => {
            engine.update(|state| {
                if let Some(batch) = state.controllers.statistics.title_batch.as_mut()
                    && batch.request == request
                {
                    batch.arrived = arrived;
                    batch.progress_at = now;
                }
            });
            false
        }
        BatchStep::Done { reanalyse } => engine.update(|state| {
            let stats = &mut state.controllers.statistics;
            if stats.title_batch.as_ref().is_some_and(|batch| batch.request == request) {
                stats.title_batch = None;
                reanalyse
            } else {
                false
            }
        }),
    };
    if reanalyse {
        rebuild(engine);
    }
}

// -- Entries --------------------------------------------------------------------------------------

/// `statistics.entries`: a page of the current analysis' entries, optionally only those
/// overlapping `[start, end)` (Swift filtered `data.entries` the same way for a chart bucket or a
/// timeline day).
pub(crate) fn entries(
    engine: &Engine,
    offset: usize,
    limit: usize,
    start: Option<Timestamp>,
    end: Option<Timestamp>,
) -> Result<Value, IpcError> {
    let cal = engine.cal();
    let page = engine.read(|state| {
        let stats = &state.controllers.statistics;
        let matching: Vec<&ExplorerEntry> = stats
            .current_analysis(&cal)
            .map(|analysis| {
                analysis
                    .entries
                    .iter()
                    .filter(|entry| end.is_none_or(|end| entry.start < end))
                    .filter(|entry| start.is_none_or(|start| entry.end > start))
                    .collect()
            })
            .unwrap_or_default();
        EntriesPage {
            offset,
            total: matching.len(),
            entries: matching
                .into_iter()
                .skip(offset)
                .take(limit.min(MAX_ENTRIES_PAGE))
                .cloned()
                .collect(),
        }
    });
    serde_json::to_value(page).map_err(|error| IpcError::new("internal", error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use att_core::time::add_secs;

    fn at(seconds: f64) -> Timestamp {
        add_secs(Timestamp::UNIX_EPOCH, 1_790_000_000.0 + seconds)
    }

    #[test]
    fn a_title_batch_reanalyses_once_when_complete() {
        let batch = TitleBatch::new(1, BTreeSet::from([1, 2]), at(0.0));
        assert_eq!(batch.step(|_| false, at(1.0)), BatchStep::Wait);
        assert_eq!(batch.step(|id| id == 1, at(1.0)), BatchStep::Progress(1));
        assert_eq!(batch.step(|_| true, at(2.0)), BatchStep::Done { reanalyse: true });
    }

    #[test]
    fn a_title_batch_ends_after_a_quiet_period_and_only_reanalyses_with_new_titles() {
        let mut batch = TitleBatch::new(1, BTreeSet::from([1, 2]), at(0.0));
        assert_eq!(batch.step(|_| false, at(9.9)), BatchStep::Wait);
        assert_eq!(batch.step(|_| false, at(10.0)), BatchStep::Done { reanalyse: false });
        // One title arrived, the other ticket is inaccessible.
        batch.arrived = 1;
        batch.progress_at = at(5.0);
        assert_eq!(batch.step(|id| id == 1, at(14.0)), BatchStep::Wait);
        assert_eq!(batch.step(|id| id == 1, at(15.0)), BatchStep::Done { reanalyse: true });
        assert_eq!(batch.step(|id| id == 1, at(-1.0)), BatchStep::Done { reanalyse: true });
    }
}
