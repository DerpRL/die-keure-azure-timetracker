//! Idle, lock and forgotten-timer awareness (Swift `WorkPresenceService` without the OS calls,
//! AppModel L939–1023): presence sampling, the unavailable map from system events, the idle
//! review and the forgotten-timer reminder.

use std::collections::BTreeMap;
use std::sync::Arc;

use jiff::Timestamp;
use serde_json::Value;
use uuid::Uuid;

use att_core::awareness::{
    ForgottenTimerMonitor, IdleObservation, IdleTrackingSession, WorkAwarenessLedger,
};
use att_core::config::PromptKind;
use att_core::indicator::PausedSession;
use att_core::model::HostOs;
use att_core::text::NonEmpty;
use att_core::time::add_secs;
use att_core::{AppError, Cal};
use att_platform::{AppIdentity, SystemEvent};
use att_store::keys;

use crate::controllers::hooks as controllers;
use crate::engine::Engine;
use crate::intent::done;
use crate::ipc::IpcError;
use crate::probes::{PROBE_DEADLINE, blocking};
use crate::state::AppState;

use super::connection::{self, confirmed, reconcile_after_error, tracking, workspace};
use super::tracking::{self as flows, Choice};
use super::{announce, branches, busy, history, progress, update_with};

/// "Snooze 15 min".
const SNOOZE_SECONDS: f64 = 15.0 * 60.0;
/// The forgotten-timer reminder needs recent input in the work app (Swift 60 s).
const ACTIVE_INPUT_SECONDS: f64 = 60.0;

#[derive(Default)]
pub(crate) struct AwarenessState {
    /// Swift `workAwareness` (persisted).
    pub ledger: WorkAwarenessLedger,
    /// Swift `forgottenTimer`.
    pub forgotten: ForgottenTimerMonitor,
    /// Swift `WorkPresenceService.unavailable`: `sleep`, `display`, `session`, `lock` → since.
    pub unavailable: BTreeMap<&'static str, Timestamp>,
    pub idle_seconds: f64,
    pub foreground: Option<AppIdentity>,
    /// Swift `awarenessAnnounced`.
    pub announced: Option<Uuid>,
    /// Swift `forgottenAnnounced`.
    pub forgotten_announced: Option<Uuid>,
}

impl AwarenessState {
    /// Swift `unavailableSince`.
    pub fn unavailable_since(&self) -> Option<Timestamp> {
        self.unavailable.values().min().copied()
    }

    /// Swift `reason`, with an OS-neutral wording outside macOS.
    pub fn reason(&self, os: Option<HostOs>) -> &'static str {
        if self.unavailable.contains_key("lock") {
            "Screen locked"
        } else if os == Some(HostOs::Macos) || os.is_none() {
            "Mac asleep or session inactive"
        } else {
            "Computer asleep or session inactive"
        }
    }
}

/// Subscribes to sleep, wake, lock and session events (Swift `WorkPresenceService.start()`).
/// Delivery may happen on the main thread: the sink only records the event and schedules the
/// awareness check on the runtime.
pub(crate) fn subscribe(engine: &Engine) {
    let Ok(handle) = tokio::runtime::Handle::try_current() else { return };
    let weak = engine.clone();
    let sink = Arc::new(move |event: SystemEvent| {
        let engine = weak.clone();
        let now = engine.now();
        engine.update(|state| record_event(&mut state.session.awareness, event, now));
        handle.spawn(async move {
            let now = engine.now();
            check(&engine, now);
        });
    });
    if let Err(error) = engine.services().platform.presence.subscribe(sink) {
        tracing::warn!("system events are unavailable: {error}");
    }
}

fn record_event(awareness: &mut AwarenessState, event: SystemEvent, now: Timestamp) {
    let (key, available) = match event {
        SystemEvent::WillSleep => ("sleep", false),
        SystemEvent::DidWake => ("sleep", true),
        SystemEvent::DisplaysSlept => ("display", false),
        SystemEvent::DisplaysWoke => ("display", true),
        SystemEvent::SessionResigned => ("session", false),
        SystemEvent::SessionActivated => ("session", true),
        SystemEvent::ScreenLocked => ("lock", false),
        SystemEvent::ScreenUnlocked => ("lock", true),
    };
    if available {
        awareness.unavailable.remove(key);
    } else {
        awareness.unavailable.entry(key).or_insert(now);
    }
}

/// One presence sample (Swift's 2 s loop: lock poll + `changed()`), then the awareness check.
pub(crate) async fn sample(engine: &Engine) {
    if engine.preview() {
        return;
    }
    let probe = engine.services().platform.presence.clone();
    let Some(sample) = blocking(PROBE_DEADLINE, move || probe.sample()).await else { return };
    let now = engine.now();
    engine.update(|state| {
        let awareness = &mut state.session.awareness;
        awareness.idle_seconds = sample.idle_seconds;
        awareness.foreground = sample.foreground;
        match sample.locked {
            Some(true) => {
                awareness.unavailable.entry("lock").or_insert(now);
            }
            Some(false) => {
                awareness.unavailable.remove("lock");
            }
            None => {}
        }
    });
    check(engine, now);
}

/// Swift `checkWorkAwareness(now:)`.
pub(crate) fn check(engine: &Engine, now: Timestamp) {
    if engine.preview() {
        return;
    }
    let cal = engine.cal();
    let busy = busy(engine);
    update_with(engine, |state, effects| {
        let workspace = workspace(state);
        let preferences = state.config.awareness.clone();
        let is_confirmed = confirmed(state, now) && !state.session.connection.connecting;
        let meeting = meeting_in_progress(state, now);
        let working_hours = working_hours(state, now, &cal);
        let local_timer = controllers::active_local_timer(state).is_some();
        let editor_busy = controllers::time_editor_busy(state);
        let host_os = state.session.host_os;
        let is_running = connection::running(state);
        let has_state = tracking(state).is_some();
        let paused = state.session.paused.is_some();
        let idle_session = IdleTrackingSession::from_state(
            tracking(state),
            state.session.connection.last_sync,
            &cal,
        );
        let flow_open = state.session.flow.show_picker || state.session.flow.menu_tracking;
        let awareness = &mut state.session.awareness;
        awareness.ledger.scope(&workspace);
        if !(preferences.idle_enabled || preferences.lock_enabled || preferences.forgotten_enabled)
        {
            awareness.ledger.idle.dismiss();
            awareness.forgotten.reset();
            return;
        }
        let unavailable_since = awareness.unavailable_since();
        let reason = awareness.reason(host_os);
        // Retain pending evidence through a temporary outage, but never act on it without
        // revalidation.
        if is_confirmed {
            let observation = IdleObservation {
                now,
                idle_seconds: awareness.idle_seconds,
                unavailable_since,
                reason,
                session: idle_session.as_ref(),
                preferences: &preferences,
                meeting,
            };
            awareness.ledger.idle.observe(&observation);
        }
        let eligible = preferences.forgotten_enabled
            && is_confirmed
            && has_state
            && !is_running
            && !paused
            && !local_timer
            && !meeting
            && working_hours
            && unavailable_since.is_none()
            && awareness.ledger.correction.is_none();
        if awareness.forgotten.pending().is_none() || !eligible {
            let app = awareness.foreground.as_ref();
            let watched = preferences.watches(app.map(|app| app.id.as_str()));
            let name =
                app.and_then(|app| app.name.non_empty()).unwrap_or("your work app").to_string();
            let deferral = awareness.ledger.deferral.clone();
            awareness.forgotten.observe(
                now,
                eligible && awareness.idle_seconds < ACTIVE_INPUT_SECONDS && watched,
                &name,
                preferences.forgotten_minutes,
                &deferral,
                &cal,
            );
        }
        if busy || flow_open || editor_busy || unavailable_since.is_some() {
            return;
        }
        if let Some(prompt) = awareness.ledger.idle.pending().cloned() {
            if awareness.announced != Some(prompt.id) {
                awareness.announced = Some(prompt.id);
                effects.announce(PromptKind::Idle, Some(announce::idle()));
            }
        } else if let Some(prompt) = awareness.forgotten.pending().cloned()
            && awareness.forgotten_announced != Some(prompt.id)
        {
            awareness.forgotten_announced = Some(prompt.id);
            effects.announce(PromptKind::ForgottenTimer, Some(announce::forgotten()));
            // The reminder offers the tickets on watched branches, with their titles.
            for (_, ticket) in branches::forgotten_tickets(state) {
                effects.title(ticket);
            }
        }
    });
}

/// A microphone or calendar meeting is in progress (Swift `meeting` in `checkWorkAwareness`).
fn meeting_in_progress(state: &AppState, now: Timestamp) -> bool {
    let microphone = &state.session.microphone;
    let calendar = &state.session.calendar;
    (microphone.fresh(now) && !microphone.selected_input_ids().is_empty())
        || (state.config.calendar_enabled
            && state.config.meetings.enabled
            && calendar.meeting_events.iter().any(|event| event.is_active(now)))
}

/// Inside the Day review workday on a day with a target.
fn working_hours(state: &AppState, now: Timestamp, cal: &Cal) -> bool {
    let review = &state.config.day_review;
    now >= review.time(review.start_minute, now, cal)
        && now < review.time(review.finish_minute, now, cal)
        && state.config.targets.daily_seconds(now, cal) > 0.0
}

/// Swift `keepIdleTime()`.
pub(crate) fn keep_idle_time(engine: &Engine) {
    update_with(engine, |state, effects| {
        let ledger = &mut state.session.awareness.ledger;
        if ledger.correction.as_ref().map(|c| c.id) == ledger.idle.pending().map(|p| p.id) {
            ledger.correction = None;
        }
        ledger.idle.dismiss();
        effects.remove_notification(announce::AWARENESS_ID);
    });
}

/// Swift `deferForgottenTimer(untilTomorrow:)`.
pub(crate) fn defer_forgotten(engine: &Engine, until_tomorrow: bool) {
    let now = engine.now();
    update_with(engine, |state, effects| {
        let awareness = &mut state.session.awareness;
        if until_tomorrow {
            awareness.ledger.deferral.ignored_day = Some(now);
        } else {
            awareness.ledger.deferral.until = Some(add_secs(now, SNOOZE_SECONDS));
        }
        awareness.forgotten.reset();
        effects.remove_notification(announce::AWARENESS_ID);
    });
}

/// `awareness.chooseForgottenTicket`: a ticket on a watched branch opens the activity chooser,
/// none opens the panel's ticket search.
pub(crate) async fn choose_forgotten_ticket(engine: &Engine, ticket: Option<i64>) {
    match ticket {
        Some(ticket) => {
            let choice = Choice {
                ticket: Some(ticket),
                requires_idle: true,
                in_menu_bar: true,
                ..Choice::default()
            };
            flows::choose_activity(engine, choice).await;
        }
        None => {
            flows::begin_menu_tracking(engine, None);
            engine.services().shell.show_panel(true);
        }
    }
}

/// Swift `reviewIdleTime(_:)` ("Pause & review…"): the review is saved before the timer
/// stops, so an interrupted request never loses the idle interval.
pub(crate) async fn review_idle_time(
    engine: &Engine,
    prompt_id: Uuid,
) -> std::result::Result<Value, IpcError> {
    if busy(engine) {
        return Err(IpcError::busy());
    }
    let Some(clients) = engine.clients().filter(|_| !engine.preview()) else { return done() };
    let now = engine.now();
    let Some((prompt, state_now)) = engine.read(|state| {
        let prompt = state.session.awareness.ledger.idle.pending()?.clone();
        let current = tracking(state)?.clone();
        let valid = state.session.connection.connected
            && confirmed(state, now)
            && prompt.id == prompt_id
            && current.identity() == prompt.session.identity;
        valid.then_some((prompt, current))
    }) else {
        return done();
    };
    let Some(_busy) = engine.inner.busy.try_acquire() else { return Err(IpcError::busy()) };
    let paused = engine.read(|state| {
        PausedSession::from_state(
            &state_now,
            workspace(state),
            now,
            connection::elapsed(state, now),
        )
    });
    engine.update(|state| state.session.awareness.ledger.correction = Some(prompt.clone()));
    let durable = engine.persist().is_ok()
        && !engine.read(|state| state.session.unreadable.contains(keys::WORK_AWARENESS));
    let result = if durable {
        att_core::tracking::stop(&prompt.session.identity, clients.seven_pace.as_ref()).await
    } else {
        Err(AppError::message(
            "The idle review could not be saved locally. Your timer has not been stopped.",
        ))
    };
    match result {
        Ok(stopped) => {
            connection::apply(engine, stopped);
            engine.update(|state| state.session.paused = Some(paused));
            let _ = engine.persist();
            open_correction(engine, &prompt).await;
            history::load(engine).await;
            progress::load(engine).await;
        }
        Err(error) => {
            let message =
                format!("{error} Check the timer before continuing; no correction was applied.");
            reconcile_after_error(engine, &clients, message).await;
        }
    }
    done()
}

/// Swift `openIdleCorrection(_:)`: the time editor on the idle interval of the stopped
/// session.
async fn open_correction(engine: &Engine, prompt: &att_core::awareness::IdlePeriod) {
    let saved = engine.read(|state| {
        state.session.awareness.ledger.correction.as_ref().map(|c| c.id) == Some(prompt.id)
    });
    let Some(end) = prompt.end.filter(|_| saved) else { return };
    engine.update(flows::cancel_menu_tracking);
    let shell = engine.services().shell.clone();
    shell.hide_panel();
    shell.show_main(Some("timeEditor"));
    engine.update(|state| state.visible_page = Some("timeEditor".to_string()));
    controllers::prepare_idle_correction_for(
        engine,
        prompt.id,
        Some(prompt.session.work_log_id.clone()),
        prompt.start,
        end,
    )
    .await;
}

/// `awareness.openCorrection`: the saved review ("Open correction preview…").
pub(crate) async fn open_saved_correction(engine: &Engine) {
    let Some(prompt) = engine.read(|state| state.session.awareness.ledger.correction.clone())
    else {
        return;
    };
    open_correction(engine, &prompt).await;
}

/// Swift `discardIdleCorrection()`.
pub(crate) fn discard_correction(engine: &Engine) {
    engine.update(|state| state.session.awareness.ledger.correction = None);
}

/// Swift `saveTimeEdit()`: a guided idle correction was applied.
pub(crate) fn correction_applied(state: &mut AppState, id: Uuid) {
    let ledger = &mut state.session.awareness.ledger;
    if ledger.correction.as_ref().is_some_and(|correction| correction.id == id) {
        ledger.correction = None;
    }
}
