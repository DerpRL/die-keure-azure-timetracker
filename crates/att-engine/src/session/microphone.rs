//! Microphone meetings (Swift `MicrophoneService` without the Core Audio calls, AppModel
//! L1255–1323): sampling input owners on the probe pool, the meeting engine's start/end
//! debounces, suggestions, the meeting-ended prompt and microphone-started drafts.

use std::collections::BTreeSet;

use jiff::Timestamp;

use att_core::config::PromptKind;
use att_core::microphone::{
    MicrophoneMeetingEngine, MicrophoneOwner, MicrophonePreferences, MicrophoneSession,
};
use att_core::microphone_end::{
    MicrophoneEndObservation, MicrophoneEndPrompt, MicrophoneTrackingMonitor,
};
use att_core::productivity::MeetingReturn;
use att_core::time::diff_secs;
use att_core::{AppError, Result};
use att_platform::InputOwner;

use crate::engine::Engine;
use crate::probes::{PROBE_DEADLINE, blocking};
use crate::state::AppState;

use super::connection::{confirmed, refresh_activities, tracking, workspace};
use super::tracking::{self, TrackingDraft};
use super::{Effects, announce, busy, update_with};

/// A sample counts as fresh for this long (Swift 10 s).
const FRESH_SECONDS: f64 = 10.0;

pub(crate) struct MicrophoneState {
    /// The preferences the sampler runs with; `None` while detection is off (Swift `task ==
    /// nil`).
    pub configured: Option<MicrophonePreferences>,
    pub engine: MicrophoneMeetingEngine,
    /// Every process with input running at the last sample (for diagnostics).
    pub inputs: Vec<InputOwner>,
    /// De-duplicated owners, sorted by name (Swift `owners`).
    pub owners: Vec<MicrophoneOwner>,
    pub connected: bool,
    pub checking: bool,
    pub last_confirmed: Option<Timestamp>,
    pub status: String,
    pub generation: u64,
    /// Swift `microphoneTracking` (persisted).
    pub monitor: MicrophoneTrackingMonitor,
    /// Swift `pendingMicrophoneSessions`.
    pub pending: Vec<MicrophoneSession>,
    pub popup_pending: bool,
}

const OFF: &str = "Microphone meeting suggestions are off";

impl Default for MicrophoneState {
    fn default() -> Self {
        Self {
            configured: None,
            engine: MicrophoneMeetingEngine::new(),
            inputs: Vec::new(),
            owners: Vec::new(),
            connected: false,
            checking: false,
            last_confirmed: None,
            status: OFF.to_string(),
            generation: 0,
            monitor: MicrophoneTrackingMonitor::new(),
            pending: Vec::new(),
            popup_pending: false,
        }
    }
}

impl MicrophoneState {
    /// Swift `fresh`.
    pub fn fresh(&self, now: Timestamp) -> bool {
        self.connected && self.last_confirmed.is_some_and(|at| diff_secs(now, at) < FRESH_SECONDS)
    }

    /// Swift `selectedInputAppIDs`.
    pub fn selected_input_ids(&self) -> BTreeSet<String> {
        let Some(preferences) = &self.configured else { return BTreeSet::new() };
        self.owners
            .iter()
            .filter(|owner| preferences.apps.contains(&owner.category()))
            .map(|owner| owner.id.clone())
            .collect()
    }

    /// Swift `isActive(_:)`.
    pub fn is_active(&self, session: &MicrophoneSession, now: Timestamp) -> bool {
        self.fresh(now) && self.engine.is_active(session)
    }
}

pub(crate) fn is_active(state: &AppState, session: &MicrophoneSession, now: Timestamp) -> bool {
    state.session.microphone.is_active(session, now)
}

/// Swift `validateCurrent(_:)`.
pub(crate) fn validate_current(engine: &Engine, session: &MicrophoneSession) -> Result<()> {
    let now = engine.now();
    if engine.read(|state| is_active(state, session, now)) {
        Ok(())
    } else {
        Err(AppError::message(
            "Microphone use is no longer confirmed. Check meeting detection in Settings or choose tracking manually.",
        ))
    }
}

/// Swift `configureMicrophone()` + `MicrophoneService.configure(_:restoring:)`.
pub(crate) fn configure(engine: &Engine) {
    if engine.preview() {
        return;
    }
    update_with(engine, |state, effects| {
        let preferences = state.config.microphone.clone();
        let workspace = workspace(state);
        let microphone = &mut state.session.microphone;
        if !preferences.enabled {
            for session in microphone.pending.drain(..) {
                effects.remove_notification(announce::microphone_id(&session.id));
            }
            microphone.popup_pending = false;
            microphone.monitor.reset();
        }
        microphone.monitor.restrict(&preferences.apps, &workspace);
        if microphone.configured.as_ref() == Some(&preferences) {
            return;
        }
        microphone.generation += 1;
        microphone.engine = MicrophoneMeetingEngine::new();
        microphone.connected = false;
        microphone.owners.clear();
        microphone.inputs.clear();
        microphone.last_confirmed = None;
        microphone.checking = false;
        if !preferences.enabled {
            microphone.configured = None;
            microphone.status = OFF.to_string();
            effects.sync_microphone();
            return;
        }
        for link in microphone.monitor.links().values() {
            let session = link.session();
            if preferences.apps.contains(&session.owner.category()) {
                microphone.engine.restore(session);
            }
        }
        microphone.configured = Some(preferences);
    });
}

/// Swift `MicrophoneService.checkNow()` followed by `syncMicrophone()`.
pub(crate) async fn check_now(engine: &Engine) {
    let Some(generation) = engine.update(|state| {
        let microphone = &mut state.session.microphone;
        if microphone.configured.is_none() || microphone.checking {
            return None;
        }
        microphone.checking = true;
        Some(microphone.generation)
    }) else {
        return;
    };
    let probe = engine.services().platform.microphone.clone();
    let sample = blocking(PROBE_DEADLINE, move || probe.sample()).await;
    let now = engine.now();
    let current = engine.update(|state| {
        let microphone = &mut state.session.microphone;
        if microphone.generation != generation {
            return false;
        }
        microphone.checking = false;
        let Some(preferences) = microphone.configured.clone() else { return false };
        match sample {
            Some(Ok(inputs)) => {
                let mut seen = BTreeSet::new();
                let mut owners: Vec<MicrophoneOwner> = inputs
                    .iter()
                    .map(|input| MicrophoneOwner::new(input.id.clone(), input.name.clone()))
                    .filter(|owner| seen.insert(owner.id.clone()))
                    .collect();
                owners.sort_by(|a, b| a.name.cmp(&b.name));
                let watched: Vec<MicrophoneOwner> = owners
                    .iter()
                    .filter(|owner| preferences.apps.contains(&owner.category()))
                    .cloned()
                    .collect();
                microphone.engine.sample(Some(&watched), now);
                microphone.connected = true;
                microphone.last_confirmed = Some(now);
                microphone.status = if owners.is_empty() {
                    "Watching microphone status · checked every 2 seconds".to_string()
                } else {
                    let names: Vec<&str> = owners.iter().map(|owner| owner.name.as_str()).collect();
                    format!("Microphone in use: {}", names.join(", "))
                };
                microphone.owners = owners;
                microphone.inputs = inputs;
            }
            failure => {
                microphone.engine.sample(None, now);
                microphone.connected = false;
                microphone.status = match failure {
                    Some(Err(error)) => error.to_string(),
                    _ => "Microphone status did not respond in time. Retrying automatically."
                        .to_string(),
                };
            }
        }
        true
    });
    if current {
        sync(engine);
    }
}

/// Swift `microphoneEndPrompt`.
pub(crate) fn end_prompt(
    state: &AppState,
    now: Timestamp,
    preview: bool,
) -> Option<MicrophoneEndPrompt> {
    let microphone = &state.session.microphone;
    if !state.config.microphone.enabled {
        return None;
    }
    let prompt = microphone.monitor.pending()?;
    if !prompt.is_valid(tracking(state), &workspace(state)) {
        return None;
    }
    if !preview
        && (!microphone.fresh(now)
            || !microphone.selected_input_ids().is_empty()
            || !microphone.engine.sessions().is_empty())
    {
        return None;
    }
    Some(prompt.clone())
}

/// Swift `validateMicrophoneEnd(_:)`.
pub(crate) fn validate_end(engine: &Engine, prompt: &MicrophoneEndPrompt) -> Result<()> {
    let now = engine.now();
    let preview = engine.preview();
    let current = engine.read(|state| {
        end_prompt(state, now, preview).is_some_and(|current| current.id == prompt.id)
            && super::connection::health(state, now)
                == att_core::productivity::ConnectionHealth::Confirmed
    });
    if current {
        Ok(())
    } else {
        Err(AppError::message(
            "This microphone reminder is no longer current. Check the active timer before changing it.",
        ))
    }
}

/// Swift `syncMicrophone()`: a temporary sampling error never dismisses a choice or ends a
/// meeting; only fresh samples do.
pub(crate) fn sync(engine: &Engine) {
    let now = engine.now();
    let preview = engine.preview();
    let busy = busy(engine);
    update_with(engine, |state, effects| sync_state(state, effects, now, preview, busy));
}

fn sync_state(
    state: &mut AppState,
    effects: &mut Effects,
    now: Timestamp,
    preview: bool,
    busy: bool,
) {
    let workspace = workspace(state);
    let is_confirmed = confirmed(state, now);
    let microphone = &mut state.session.microphone;
    let fresh = microphone.fresh(now);
    if fresh {
        let engine = &microphone.engine;
        let gone: Vec<String> = microphone
            .pending
            .iter()
            .filter(|session| !engine.is_active(session))
            .map(|session| session.id.clone())
            .collect();
        microphone.pending.retain(|session| !gone.contains(&session.id));
        for id in gone {
            effects.remove_notification(announce::microphone_id(&id));
        }
        let draft_ended = state
            .session
            .flow
            .draft
            .as_ref()
            .and_then(|draft| draft.microphone_session.as_ref())
            .is_some_and(|session| !state.session.microphone.engine.is_active(session));
        if draft_ended && !busy {
            tracking::cancel_menu_tracking(state);
        }
    }
    let microphone = &mut state.session.microphone;
    let suggestions = if fresh { microphone.engine.suggestions() } else { Vec::new() };
    if !suggestions.is_empty() {
        microphone.pending.extend(suggestions);
        microphone.popup_pending = true;
    }
    let ended = microphone.engine.ended().clone();
    if let Some(plan) = state.session.meeting_return.as_mut()
        && fresh
        && plan.microphone_session_id.as_ref().is_some_and(|session| ended.contains(session))
        && plan.end == MeetingReturn::open_end()
    {
        plan.end = now;
    }
    let microphone = &mut state.session.microphone;
    let sessions: Vec<MicrophoneSession> = microphone.engine.sessions().values().cloned().collect();
    let inputs = microphone.selected_input_ids();
    let observation = MicrophoneEndObservation {
        sessions: &sessions,
        input_app_ids: &inputs,
        ended: &ended,
        state: state.session.connection.tracking.as_ref(),
        workspace: &workspace,
        fresh,
        confirmed: is_confirmed,
        now,
    };
    state.session.microphone.monitor.observe(&observation);
    if let Some(prompt) = end_prompt(state, now, preview) {
        let flow = &state.session.flow;
        if !prompt.notified
            && state.session.connection.connected
            && is_confirmed
            && !busy
            && !flow.show_picker
            && !flow.menu_tracking
        {
            state.session.microphone.monitor.mark_notified();
            effects.announce(PromptKind::MicrophoneEnd, Some(announce::microphone_end(&prompt)));
        }
    }
    let flow = &state.session.flow;
    let flow_open = flow.show_picker || flow.menu_tracking;
    let microphone = &mut state.session.microphone;
    if microphone.popup_pending && !busy && !flow_open {
        microphone.popup_pending = false;
        if let Some(session) = microphone.pending.last() {
            effects.announce(PromptKind::Microphone, Some(announce::microphone(session)));
        }
    }
}

/// Swift `dismissMicrophone(_:)`.
pub(crate) fn dismiss(engine: &Engine, session: &str) {
    update_with(engine, |state, effects| dismiss_session(state, session, effects));
}

pub(crate) fn dismiss_session(state: &mut AppState, session: &str, effects: &mut Effects) {
    state.session.microphone.pending.retain(|pending| pending.id != session);
    effects.remove_notification(announce::microphone_id(session));
}

/// Swift `keepTrackingAfterMicrophone()`.
pub(crate) fn keep_after_end(engine: &Engine) {
    let now = engine.now();
    let preview = engine.preview();
    update_with(engine, |state, effects| {
        if end_prompt(state, now, preview).is_none() {
            return;
        }
        state.session.microphone.monitor.dismiss();
        if state
            .session
            .meeting_return
            .as_ref()
            .is_some_and(|plan| plan.microphone_session_id.is_some())
        {
            state.session.meeting_return = None;
        }
        effects.remove_notification(announce::MICROPHONE_END_ID);
    });
}

/// Swift `chooseMicrophoneActivity(_:standup:)`: a ticket-free meeting or stand-up draft.
pub(crate) async fn choose(engine: &Engine, session_id: &str, standup: bool) {
    let Some((session, current)) = engine.read(|state| {
        let session =
            state.session.microphone.pending.iter().find(|s| s.id == session_id).cloned()?;
        let flow = &state.session.flow;
        let ready = state.session.connection.connected && flow.draft.is_none() && !flow.show_picker;
        let current = tracking(state).cloned().filter(|_| ready)?;
        Some((session, current))
    }) else {
        return;
    };
    if busy(engine) || engine.preview() {
        return;
    }
    if let Err(error) = validate_current(engine, &session) {
        engine.update(|state| state.session.error = Some(error.to_string()));
        return;
    }
    tracking::begin_menu_tracking(engine, None);
    engine.services().shell.show_panel(true);
    let generation = engine.read(|state| state.session.flow.menu_generation);
    let connection = engine.connection_generation();
    let Some(_busy) = engine.inner.busy.try_acquire() else { return };
    if !engine.read(|state| state.session.connection.activities_loaded) {
        refresh_activities(engine).await;
    }
    let still_current = engine.read(|state| {
        let flow = &state.session.flow;
        flow.menu_tracking && flow.menu_generation == generation
    });
    if !still_current || connection != engine.connection_generation() {
        return;
    }
    match validate_current(engine, &session) {
        Ok(()) => engine.update(|state| {
            let mut draft = TrackingDraft::new(None, None, current.identity());
            draft.microphone_session = Some(session);
            draft.standup = standup;
            state.session.flow.draft = Some(draft);
        }),
        Err(error) => engine.update(|state| {
            state.session.error = Some(error.to_string());
            tracking::cancel_menu_tracking(state);
        }),
    }
}
