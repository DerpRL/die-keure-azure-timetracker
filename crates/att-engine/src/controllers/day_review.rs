//! The Day review page. Port of `DayReviewModel.swift`; the summary itself
//! (`DayReviewSummary::calculate`, Swift `DayReviewView.summary`) is computed by the slice
//! builder from the loaded logs, the configuration and the confirmed tracking state.
//!
//! The prompt side (`dayReview.open`, `markReviewed`, `snooze`, the schedule check) belongs to
//! the session.

use jiff::Timestamp;
use jiff::civil::Date;
use serde_json::Value;

use att_core::model::WorkLog;
use att_core::time::diff_secs;

use super::{detached, done, internal, pages, still_current, visible};
use crate::engine::Engine;
use crate::ipc::IpcError;

/// Swift throttled automatic day-review downloads to one per minute.
const THROTTLE_SECONDS: f64 = 60.0;

#[derive(Default)]
pub(crate) struct DayReviewState {
    pub selected_day: Date,
    /// The previous day and the selected day (overnight entries).
    pub logs: Vec<WorkLog>,
    pub loaded_day: Option<Date>,
    pub synced_at: Option<Timestamp>,
    pub loading: bool,
    pub issue: Option<String>,
    pub configured: bool,
    generation: u64,
    pending_day: Option<Date>,
    last_attempt: Option<Timestamp>,
    attempted_day: Option<Date>,
}

impl DayReviewState {
    /// Swift `configure(_:)`.
    pub(crate) fn configure(&mut self, configured: bool) {
        self.configured = configured;
        self.generation += 1;
        self.logs.clear();
        self.loaded_day = None;
        self.synced_at = None;
        self.issue = None;
        self.loading = false;
        self.pending_day = None;
        self.attempted_day = None;
    }

    /// Swift `invalidate()`.
    pub(crate) fn invalidate(&mut self) {
        self.last_attempt = None;
    }
}

/// `dayReview.setDay`: Swift's view reloaded through `.task(id: review.day)` while shown.
pub(crate) async fn set_day(engine: &Engine, day: Date) -> Result<Value, IpcError> {
    let reload = engine.update(|state| {
        let review = &mut state.controllers.day_review;
        let changed = review.selected_day != day;
        review.selected_day = day;
        changed && visible(state, pages::DAY_REVIEW)
    });
    if reload {
        let engine = engine.clone();
        detached(async move { load(&engine, false).await }).await.ok_or_else(internal)?;
    }
    done()
}

/// `dayReview.refresh`: Swift `load(force: true)`. (Swift's `refreshDayReview` also refreshed
/// the 7pace timer first; that is the session's `connection.refresh`.)
pub(crate) async fn refresh(engine: &Engine) -> Result<Value, IpcError> {
    let engine = engine.clone();
    detached(async move { load(&engine, true).await }).await.ok_or_else(internal)?;
    done()
}

/// Swift `load(force:)`: the selected day and the day before, at most once a minute unless forced.
pub(crate) async fn load(engine: &Engine, force: bool) {
    let Some(clients) = engine.clients() else { return };
    let cal = engine.cal();
    let now = engine.now();
    let started = engine.update(|state| {
        let review = &mut state.controllers.day_review;
        let requested = review.selected_day;
        if review.loading && review.pending_day == Some(requested) {
            return None;
        }
        if !force
            && review.attempted_day == Some(requested)
            && (review.issue.is_some() || review.loaded_day == Some(requested))
            && review.last_attempt.is_some_and(|last| diff_secs(now, last) < THROTTLE_SECONDS)
        {
            return None;
        }
        review.generation += 1;
        review.pending_day = Some(requested);
        review.loading = true;
        review.issue = None;
        review.last_attempt = Some(now);
        review.attempted_day = Some(requested);
        if review.loaded_day != Some(requested) {
            review.logs.clear();
            review.loaded_day = None;
            review.synced_at = None;
        }
        Some((review.generation, requested))
    });
    let Some((request, requested)) = started else { return };
    let start = cal.start_of_date(requested);
    let from = cal.add_days(start, -1);
    let to = cal.add_days(start, 1);
    let result = clients.seven_pace.work_logs(Some(from), to, false).await;
    let current = still_current(engine, &clients);
    let synced = engine.now();
    engine.update(|state| {
        let review = &mut state.controllers.day_review;
        let valid = current && review.generation == request && review.selected_day == requested;
        if valid {
            match result {
                Ok(logs) => {
                    review.logs = logs;
                    review.loaded_day = Some(requested);
                    review.synced_at = Some(synced);
                }
                Err(error) => review.issue = Some(error.to_string()),
            }
        }
        if review.generation == request {
            review.loading = false;
            review.pending_day = None;
        }
    });
}
