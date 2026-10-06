//! Today and this-week progress toward the targets (Swift AppModel L1185–1210): the week's
//! worklogs reload at least every `progressSeconds` (300 s), or 30 s after the ISO week
//! changed; quick switch is seeded from recent work.

use jiff::Timestamp;

use att_core::Interval;
use att_core::model::WorkLog;
use att_core::targets::TargetProgress;
use att_core::time::diff_secs;

use crate::engine::Engine;

use super::busy;

/// A new ISO week reloads after this many seconds (Swift 30 s).
const NEW_WEEK_SECONDS: f64 = 30.0;
/// Quick switch is seeded from at most this many recent worklogs.
const SEED_LOGS: usize = 30;

#[derive(Default)]
pub(crate) struct ProgressState {
    /// Swift `progressLogs`.
    pub logs: Vec<WorkLog>,
    /// Swift `progressLastSync`.
    pub last_sync: Option<Timestamp>,
    /// Swift `progressWeek`.
    pub week: Option<Interval>,
    /// Swift `loadingProgress`.
    pub loading: bool,
    /// Swift `lastProgressCheck`.
    pub last_check: Option<Timestamp>,
    /// Swift `progressIssue`.
    pub issue: Option<String>,
}

/// The main loop's progress condition.
pub(crate) fn is_due(engine: &Engine, now: Timestamp) -> bool {
    let cal = engine.cal();
    let busy = busy(engine);
    engine.read(|state| {
        let progress = &state.session.progress;
        if !state.session.connection.connected || busy || progress.loading {
            return false;
        }
        let interval = f64::from(state.config.cadences.progress_seconds);
        let Some(last) = progress.last_check else { return true };
        let elapsed = diff_secs(now, last);
        elapsed > interval
            || elapsed < 0.0
            || (progress.week != Some(TargetProgress::week_interval(now, &cal))
                && elapsed > NEW_WEEK_SECONDS)
    })
}

/// Swift `loadProgress()`.
pub(crate) async fn load(engine: &Engine) {
    if engine.preview() {
        return;
    }
    let Some(clients) = engine.clients() else { return };
    let now = engine.now();
    let cal = engine.cal();
    let week = TargetProgress::week_interval(now, &cal);
    let started = engine.update(|state| {
        let progress = &mut state.session.progress;
        if progress.loading {
            return false;
        }
        progress.loading = true;
        progress.last_check = Some(now);
        true
    });
    if !started {
        return;
    }
    let result = clients.seven_pace.work_logs(Some(week.start), week.end, false).await;
    if engine.connection_generation() != clients.generation {
        return;
    }
    let now = engine.now();
    engine.update(|state| {
        let session = &mut state.session;
        session.progress.loading = false;
        match result {
            Ok(fetched) => {
                // Seed quick switch from actual recent work without storing work-item titles.
                if session.quick_tickets.recent.is_empty() {
                    let ids: Vec<i64> =
                        fetched.iter().filter_map(|log| log.work_item_id).take(SEED_LOGS).collect();
                    for id in ids.into_iter().rev() {
                        session.quick_tickets.remember(id);
                    }
                }
                session.progress.logs = fetched;
                session.progress.week = Some(week);
                session.progress.last_sync = Some(now);
                session.progress.issue = None;
            }
            Err(error) => session.progress.issue = Some(error.to_string()),
        }
    });
    let _ = engine.persist();
}
