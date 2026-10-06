//! The end-of-day review prompt (Swift AppModel L1325–1378): scheduling with
//! `DayReviewSchedule`, records per workspace and day (45-day pruning), snooze and mark
//! reviewed. The Day review page itself belongs to the controllers.

use std::collections::BTreeMap;

use jiff::Timestamp;
use jiff::civil::Date;

use att_core::config::PromptKind;
use att_core::day_review::{DayReviewRecord, DayReviewSchedule};
use att_core::time::{add_secs, diff_secs};

use crate::controllers::{self, ControllerIntent};
use crate::engine::Engine;
use crate::state::AppState;

use super::connection::{self, workspace};
use super::{announce, busy, today, update_with};

/// Records older than this are pruned when a new prompt is recorded (Swift 45 days).
const RETENTION_SECONDS: f64 = 45.0 * 86_400.0;
/// "Snooze 30 min".
const SNOOZE_SECONDS: f64 = 30.0 * 60.0;

#[derive(Default)]
pub(crate) struct DayReviewState {
    /// Swift `reviewPromptDay`.
    pub prompt_day: Option<Date>,
    /// Swift `dayReviews` (persisted): `workspace|y-m-d` → record.
    pub records: BTreeMap<String, DayReviewRecord>,
}

/// Swift `canSnoozeDayReview`.
pub(crate) fn can_snooze(state: &AppState, now: Timestamp, cal: &att_core::Cal) -> bool {
    let preferences = &state.config.day_review;
    preferences.enabled
        && preferences.weekdays.contains(&i64::from(cal.swift_weekday(now)))
        && add_secs(now, SNOOZE_SECONDS) < cal.day_interval(now).end
}

/// Swift `checkDayReview(now:)`.
pub(crate) fn check(engine: &Engine, now: Timestamp) {
    let cal = engine.cal();
    let preview = engine.preview();
    let has_client = engine.clients().is_some();
    let busy = busy(engine);
    update_with(engine, |state, effects| {
        let preferences = state.config.day_review.clone();
        let applies = !preview
            && has_client
            && preferences.enabled
            && preferences.is_valid()
            && preferences.weekdays.contains(&i64::from(cal.swift_weekday(now)))
            && state.config.targets.daily_seconds(now, &cal) > 0.0;
        if !applies {
            state.session.day_review.prompt_day = None;
            return;
        }
        let day = cal.date(now);
        let key = DayReviewSchedule::key(&workspace(state), now, &cal);
        let flow = &state.session.flow;
        let flow_open = flow.show_picker || flow.menu_tracking;
        let review = &mut state.session.day_review;
        let record = review.records.get(&key).cloned();
        review.prompt_day = DayReviewSchedule::is_pending(now, record.as_ref()).then_some(day);
        if !DayReviewSchedule::is_due(now, &preferences, record.as_ref(), &cal) || busy || flow_open
        {
            return;
        }
        let mut next = record.unwrap_or_default();
        next.prompted_at = Some(now);
        next.snoozed_until = None;
        review.records.retain(|_, record| {
            let anchor = record.reviewed_at.or(record.prompted_at);
            anchor.is_some_and(|at| diff_secs(now, at) < RETENTION_SECONDS)
        });
        review.records.insert(key, next);
        review.prompt_day = Some(day);
        effects.announce(PromptKind::DayReview, Some(announce::day_review()));
    });
}

/// Swift `markDayReviewed(_:)`.
pub(crate) fn mark_reviewed(engine: &Engine, day: Date) {
    if engine.preview() {
        return;
    }
    let cal = engine.cal();
    let now = engine.now();
    let today = today(engine);
    update_with(engine, |state, effects| {
        let key = DayReviewSchedule::key(&workspace(state), cal.start_of_date(day), &cal);
        let review = &mut state.session.day_review;
        let record = review.records.entry(key).or_default();
        record.reviewed_at = Some(now);
        record.snoozed_until = None;
        if day == today {
            review.prompt_day = None;
            effects.remove_notification(announce::DAY_REVIEW_ID);
        }
    });
}

/// Swift `snoozeDayReview()`.
pub(crate) fn snooze(engine: &Engine) {
    if engine.preview() {
        return;
    }
    let cal = engine.cal();
    let now = engine.now();
    update_with(engine, |state, effects| {
        if !can_snooze(state, now, &cal) {
            return;
        }
        let key = DayReviewSchedule::key(&workspace(state), now, &cal);
        let review = &mut state.session.day_review;
        let record = review.records.entry(key).or_default();
        record.prompted_at = Some(now);
        record.snoozed_until = Some(add_secs(now, SNOOZE_SECONDS));
        record.reviewed_at = None;
        review.prompt_day = None;
        effects.remove_notification(announce::DAY_REVIEW_ID);
    });
}

/// Swift `openDayReview()`: today's review in the main window, after a 7pace refresh.
pub(crate) async fn open(engine: &Engine) {
    let today = today(engine);
    engine.services().shell.show_main(Some("dayReview"));
    engine.update(|state| state.visible_page = Some("dayReview".to_string()));
    let _ = controllers::handle(engine, ControllerIntent::SetDayReviewDay { day: today }).await;
    if !busy(engine) {
        connection::refresh(engine).await;
    }
    let _ = controllers::handle(engine, ControllerIntent::RefreshDayReview).await;
}

/// The record of the local day `day`, for the controllers (Swift `dayReviewRecord(for:)`).
pub(crate) fn record(state: &AppState, day: Date, cal: &att_core::Cal) -> Option<DayReviewRecord> {
    let key = DayReviewSchedule::key(&workspace(state), cal.start_of_date(day), cal);
    state.session.day_review.records.get(&key).cloned()
}
