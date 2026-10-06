//! Tracking flows (Swift AppModel L14–35, L652–894, L1057–1072, L1160–1174, L1242–1253): the
//! draft, the panel and picker flows, ticket search, `chooseActivity`, `startTracking`,
//! stop/pause/resume, manual tracking, activity confirmation and quick switch.
//!
//! Rules: nothing starts, stops or pauses without an explicit intent; a draft is bound to the
//! state identity and the source it was created from, both revalidated before the write and
//! inside `validate_context`; a failed write is never replayed (one `current` read reconciles,
//! the error is shown and the draft is cleared).

use jiff::Timestamp;
use serde_json::Value;
use uuid::Uuid;

use att_core::attention::TrackingAttention;
use att_core::figma::{FigmaSuggestion, design_activity};
use att_core::git::BranchChange;
use att_core::indicator::PausedSession;
use att_core::manual::{ManualTrackingKind, StandupActivity};
use att_core::meetings::{MeetingEvent, meeting_activity};
use att_core::microphone::MicrophoneSession;
use att_core::model::{ActivityType, TrackingState, WorkItem, resolve_activity};
use att_core::productivity::MeetingReturn;
use att_core::text::NonEmpty;
use att_core::{AppError, Result};

use crate::clients::Clients;
use crate::engine::Engine;
use crate::intent::done;
use crate::ipc::IpcError;
use crate::state::AppState;

use super::connection::{self, lookup, reconcile_after_error, refresh_activities, tracking};
use super::{
    branches, busy, completion, figma, history, meetings, microphone, progress, update_with,
};

/// Swift `TrackingDraft`: what the activity chooser would start, bound to the state identity it
/// was created from and to its source.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TrackingDraft {
    pub id: Uuid,
    pub item: Option<WorkItem>,
    pub change: Option<BranchChange>,
    pub expected_identity: String,
    pub microphone_session: Option<MicrophoneSession>,
    pub attention: Option<TrackingAttention>,
    pub standup: bool,
    pub manual: Option<ManualTrackingKind>,
    pub figma_suggestion: Option<FigmaSuggestion>,
    pub figma_file: Option<String>,
    pub figma_scope: Option<String>,
    pub figma_name: Option<String>,
    pub meeting: Option<MeetingEvent>,
    pub resume: Option<PausedSession>,
    pub meeting_return: Option<MeetingReturn>,
}

impl TrackingDraft {
    pub fn new(
        item: Option<WorkItem>,
        change: Option<BranchChange>,
        expected_identity: impl Into<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            item,
            change,
            expected_identity: expected_identity.into(),
            microphone_session: None,
            attention: None,
            standup: false,
            manual: None,
            figma_suggestion: None,
            figma_file: None,
            figma_scope: None,
            figma_name: None,
            meeting: None,
            resume: None,
            meeting_return: None,
        }
    }

    pub fn is_figma(&self) -> bool {
        self.figma_suggestion.is_some() || self.figma_file.is_some()
    }

    /// "Use Azure ticket" can be switched off.
    pub fn allows_no_ticket(&self) -> bool {
        self.resume.is_none()
            && self.attention.is_none()
            && self.meeting_return.is_none()
            && self.microphone_session.is_none()
            && self.manual.is_none()
    }

    pub fn title(&self) -> String {
        if let Some(item) = &self.item {
            return item.title.clone();
        }
        let fallback = || if self.standup { "Daily standup" } else { "Meeting" }.to_string();
        self.figma_name
            .clone()
            .or_else(|| self.meeting.as_ref().map(|meeting| meeting.title.clone()))
            .or_else(|| self.change.as_ref().map(|change| change.branch.clone()))
            .or_else(|| self.attention.as_ref().map(|attention| attention.title.clone()))
            .or_else(|| self.resume.as_ref().and_then(|resume| resume.remark.clone()))
            .or_else(|| self.manual.map(|kind| kind.label().to_string()))
            .unwrap_or_else(fallback)
    }

    pub fn remark(&self) -> Option<String> {
        self.figma_name
            .clone()
            .or_else(|| {
                self.microphone_session.as_ref().map(|session| {
                    if self.standup {
                        StandupActivity::REMARK.to_string()
                    } else {
                        format!("Meeting · {}", session.owner.name)
                    }
                })
            })
            .or_else(|| self.attention.as_ref().and_then(|attention| attention.remark.clone()))
            .or_else(|| self.resume.as_ref().and_then(|resume| resume.remark.clone()))
            .or_else(|| self.meeting.as_ref().map(|meeting| meeting.title.clone()))
            .or_else(|| self.change.as_ref().map(|change| change.branch.clone()))
    }

    pub fn tracking_comment(&self, include_ticket: bool) -> Option<String> {
        self.remark().or_else(|| {
            if include_ticket { None } else { self.item.as_ref().map(|item| item.title.clone()) }
        })
    }
}

/// The ticket search and activity chooser (Swift `trackingDraft`, `menuTracking`,
/// `showTicketPicker`, `selected*`, `search*`).
#[derive(Default)]
pub(crate) struct FlowState {
    pub draft: Option<TrackingDraft>,
    /// The tray panel shows the flow (Swift `menuTracking`).
    pub menu_tracking: bool,
    /// The main window shows the ticket picker sheet (Swift `showTicketPicker`).
    pub show_picker: bool,
    pub menu_generation: u64,
    pub selected_change: Option<BranchChange>,
    pub selected_meeting: Option<MeetingEvent>,
    pub selected_figma: Option<FigmaSuggestion>,
    pub skip_figma_prefill: bool,
    pub search_query: String,
    pub search_results: Vec<WorkItem>,
    pub searching: bool,
    pub search_error: Option<String>,
    pub search_generation: u64,
}

/// The arguments of Swift `chooseActivity(for:change:requiresIdle:inMenuBar:meeting:resume:
/// meetingReturn:figmaSuggestion:figmaFile:)`.
#[derive(Clone, Debug, Default)]
pub(crate) struct Choice {
    pub ticket: Option<i64>,
    pub change: Option<BranchChange>,
    pub requires_idle: bool,
    pub in_menu_bar: bool,
    pub meeting: Option<MeetingEvent>,
    pub resume: Option<PausedSession>,
    pub meeting_return: Option<MeetingReturn>,
    pub figma_suggestion: Option<FigmaSuggestion>,
    pub figma_file: Option<String>,
}

fn set_error(engine: &Engine, message: impl Into<String>) {
    let message = message.into();
    engine.update(|state| state.session.error = Some(message));
}

fn connected_state(state: &AppState) -> Option<TrackingState> {
    if state.session.connection.connected { tracking(state).cloned() } else { None }
}

/// Swift `beginMenuTracking(_:)`. `false` when the panel flow could not start (an integration
/// branch, or another flow in progress: the main window is shown instead).
pub(crate) fn begin_menu_tracking(engine: &Engine, change: Option<BranchChange>) -> bool {
    if change.as_ref().is_some_and(BranchChange::suggests_break) {
        return false;
    }
    let busy = busy(engine);
    let started = engine.update(|state| {
        let flow = &mut state.session.flow;
        if busy || flow.draft.is_some() || flow.show_picker {
            return false;
        }
        flow.menu_generation += 1;
        flow.skip_figma_prefill = false;
        flow.search_query =
            change.as_ref().and_then(|c| c.ticket_id).map(|id| id.to_string()).unwrap_or_default();
        flow.selected_change = change;
        flow.selected_meeting = None;
        flow.selected_figma = None;
        flow.search_results.clear();
        flow.search_error = None;
        flow.menu_tracking = true;
        true
    });
    if !started {
        engine.services().shell.show_main(None);
    }
    started
}

/// Swift `cancelMenuTracking()`.
pub(crate) fn cancel_menu_tracking(state: &mut AppState) {
    let flow = &mut state.session.flow;
    if !flow.menu_tracking {
        return;
    }
    flow.menu_generation += 1;
    flow.menu_tracking = false;
    flow.draft = None;
    flow.selected_change = None;
    flow.selected_meeting = None;
    flow.selected_figma = None;
    flow.search_generation += 1;
    flow.searching = false;
    flow.search_results.clear();
    flow.search_error = None;
    flow.search_query.clear();
}

/// `tracking.beginPanel`: the panel's ticket search, optionally for a branch change.
pub(crate) fn begin_panel(engine: &Engine, branch_id: Option<Uuid>) {
    let change = branch_id.and_then(|id| branches::pending(engine, id));
    begin_menu_tracking(engine, change);
}

/// `tracking.openPicker` (Swift "Track a ticket" / "Choose ticket…": `selectedChange = nil;
/// showTicketPicker = true`, then the sheet's `prefillFigmaTracking(inMenuBar: false)`).
pub(crate) async fn open_picker(engine: &Engine) {
    engine.update(|state| {
        let flow = &mut state.session.flow;
        flow.selected_change = None;
        flow.show_picker = true;
        flow.search_query.clear();
        flow.search_results.clear();
        flow.search_error = None;
    });
    engine.services().shell.show_main(None);
    figma::prefill(engine, false).await;
}

/// `tracking.closePicker` (the sheet's `onDismiss`); 1.14.x kept the sheet open while busy.
pub(crate) fn close_picker(engine: &Engine) -> std::result::Result<Value, IpcError> {
    let busy = busy(engine);
    let refused = engine.update(|state| {
        let flow = &mut state.session.flow;
        if !flow.show_picker {
            return false;
        }
        if busy {
            return true;
        }
        flow.draft = None;
        flow.selected_change = None;
        flow.selected_meeting = None;
        flow.selected_figma = None;
        flow.skip_figma_prefill = false;
        flow.show_picker = false;
        flow.search_generation += 1;
        flow.searching = false;
        flow.search_results.clear();
        flow.search_error = None;
        flow.search_query.clear();
        false
    });
    if refused { Err(IpcError::busy()) } else { done() }
}

/// Swift `search(_:)`: `#123` and `123` look the ticket up; other text searches 7pace. A newer
/// search or a new connection drops older results.
pub(crate) async fn search(engine: &Engine, query: String) {
    let connection = engine.connection_generation();
    let generation = engine.update(|state| {
        let flow = &mut state.session.flow;
        flow.search_generation += 1;
        flow.search_query = query.clone();
        flow.search_error = None;
        flow.search_results.clear();
        flow.search_generation
    });
    let Some(clients) = engine.clients() else { return };
    if query.trim().is_empty() {
        return;
    }
    engine.update(|state| state.session.flow.searching = true);
    let result = match query.trim_matches(|c| c == '#' || c == ' ').parse::<i64>() {
        Ok(id) => lookup(engine, &clients, id).await.map(|item| vec![item]),
        Err(_) => clients.seven_pace.search(&query).await,
    };
    let current_connection = engine.connection_generation() == connection;
    engine.update(|state| {
        let session = &mut state.session;
        if session.flow.search_generation != generation {
            return;
        }
        session.flow.searching = false;
        match result {
            Ok(items) if current_connection => {
                for item in &items {
                    session.work_items.insert(item.id, item.clone());
                }
                session.flow.search_results = items;
            }
            Ok(_) => {}
            Err(error) => session.flow.search_error = Some(error.to_string()),
        }
    });
}

/// `tracking.chooseTicket`: a search result or quick ticket in the open flow; with no flow
/// open (History → Track again) the picker shows the activity chooser.
pub(crate) async fn choose_ticket(engine: &Engine, ticket: i64) {
    let (menu, picker, change, meeting, figma) = engine.read(|state| {
        let flow = &state.session.flow;
        (
            flow.menu_tracking,
            flow.show_picker,
            flow.selected_change.clone(),
            flow.selected_meeting.clone(),
            flow.selected_figma.clone(),
        )
    });
    let choice = if menu {
        Choice { ticket: Some(ticket), change, meeting, in_menu_bar: true, ..Choice::default() }
    } else if picker {
        Choice {
            ticket: Some(ticket),
            change,
            meeting,
            figma_suggestion: figma,
            ..Choice::default()
        }
    } else {
        engine.update(|state| state.session.flow.selected_change = None);
        Choice { ticket: Some(ticket), ..Choice::default() }
    };
    choose_activity(engine, choice).await;
}

/// Swift `chooseManualActivity(_:inMenuBar:)`.
pub(crate) async fn choose_manual(engine: &Engine, kind: ManualTrackingKind) {
    if busy(engine) || engine.read(|state| state.session.flow.draft.is_some()) {
        return;
    }
    let Some(current) = engine.read(connected_state) else {
        set_error(engine, "Connect and refresh 7pace before starting a timer.");
        return;
    };
    let in_menu_bar = engine.read(|state| state.session.flow.menu_tracking);
    let connection = engine.connection_generation();
    let menu_generation = engine.read(|state| state.session.flow.menu_generation);
    let Some(_busy) = engine.inner.busy.try_acquire() else { return };
    if !engine.read(|state| state.session.connection.activities_loaded) {
        refresh_activities(engine).await;
    }
    engine.update(|state| {
        let flow = &mut state.session.flow;
        if connection != engine.connection_generation()
            || (in_menu_bar && !(flow.menu_tracking && flow.menu_generation == menu_generation))
            || (!in_menu_bar && !flow.show_picker)
        {
            return;
        }
        // Explicitly choosing no ticket must never inherit a branch, meeting or Figma ticket.
        flow.selected_change = None;
        flow.selected_meeting = None;
        flow.selected_figma = None;
        let mut draft = TrackingDraft::new(None, None, current.identity());
        draft.standup = kind == ManualTrackingKind::Standup;
        draft.manual = Some(kind);
        flow.draft = Some(draft);
        flow.menu_tracking = in_menu_bar;
        flow.show_picker = !in_menu_bar;
        state.session.error = None;
    });
}

/// Swift `chooseDifferentWork()`.
pub(crate) fn choose_different_work(engine: &Engine) {
    if busy(engine) {
        return;
    }
    engine.update(|state| {
        let flow = &mut state.session.flow;
        flow.draft = None;
        flow.selected_figma = None;
        flow.skip_figma_prefill = true;
        flow.search_results.clear();
        flow.search_error = None;
        state.session.error = None;
    });
}

/// Swift `chooseSuggestionTicket(_:)`: back to the search, keeping the suggestion.
pub(crate) fn choose_suggestion_ticket(engine: &Engine, draft_id: Uuid) {
    if busy(engine) {
        return;
    }
    engine.update(|state| {
        let flow = &mut state.session.flow;
        let Some(draft) = flow.draft.take_if(|draft| draft.id == draft_id) else { return };
        flow.selected_change = draft.change;
        flow.selected_meeting = draft.meeting;
        flow.selected_figma = draft.figma_suggestion;
        flow.skip_figma_prefill = true;
        flow.search_results.clear();
        flow.search_error = None;
    });
}

/// Swift `chooseSuggestionWithoutTicket(inMenuBar:)`.
pub(crate) async fn continue_without_ticket(engine: &Engine) {
    let choice = engine.read(|state| {
        let flow = &state.session.flow;
        Choice {
            change: flow.selected_change.clone(),
            in_menu_bar: flow.menu_tracking,
            meeting: flow.selected_meeting.clone(),
            figma_suggestion: flow.selected_figma.clone(),
            ..Choice::default()
        }
    });
    choose_activity(engine, choice).await;
}

/// Swift `chooseActivity(...)`: validates the source, looks up the ticket and creates the
/// draft. Read-only: the user chooses an activity and confirms before any timer changes.
pub(crate) async fn choose_activity(engine: &Engine, choice: Choice) {
    if busy(engine) || engine.read(|state| state.session.flow.draft.is_some()) {
        return;
    }
    let Some(current) = engine.read(connected_state) else {
        set_error(engine, "Connect and refresh 7pace before starting a timer.");
        return;
    };
    if let Some(id) = choice.ticket
        && !(1..=i64::from(i32::MAX)).contains(&id)
    {
        set_error(engine, "Enter a valid Azure ticket number.");
        return;
    }
    let refuse_idle = engine.read(|state| {
        let flow = &state.session.flow;
        choice.requires_idle && (current.running() || flow.show_picker || flow.menu_tracking)
    });
    if refuse_idle {
        return;
    }
    let connection = engine.connection_generation();
    let (proposal, scope, menu_generation) = engine.update(|state| {
        let proposal = choice.figma_suggestion.clone().or_else(|| {
            if choice.in_menu_bar { state.session.flow.selected_figma.clone() } else { None }
        });
        let scope = figma::scope(state);
        let generation = state.session.flow.menu_generation;
        if choice.in_menu_bar {
            state.session.flow.menu_tracking = true;
        }
        (proposal, scope, generation)
    });
    let Some(_busy) = engine.inner.busy.try_acquire() else { return };
    let result =
        prepare_draft(engine, &choice, &current, proposal, scope, connection, menu_generation)
            .await;
    match result {
        Ok(Some(draft)) => engine.update(|state| {
            let flow = &mut state.session.flow;
            flow.draft = Some(draft);
            flow.selected_change = choice.change;
            flow.selected_meeting = choice.meeting;
            flow.menu_tracking = choice.in_menu_bar;
            flow.show_picker = !choice.in_menu_bar;
            state.session.error = None;
        }),
        Ok(None) => {}
        Err(error) => set_error(engine, error.to_string()),
    }
}

async fn prepare_draft(
    engine: &Engine,
    choice: &Choice,
    current: &TrackingState,
    proposal: Option<FigmaSuggestion>,
    scope: String,
    connection: u64,
    menu_generation: u64,
) -> Result<Option<TrackingDraft>> {
    let file = choice.figma_file.as_deref();
    figma::validate(engine, proposal.as_ref(), file, choice.ticket, Some(&scope))?;
    if choice.change.as_ref().is_some_and(BranchChange::suggests_break) {
        return Err(AppError::message(
            "This branch suggests pausing or stopping your current timer.",
        ));
    }
    if let Some(change) = &choice.change {
        branches::validate(engine, change).await?;
    }
    if let Some(meeting) = &choice.meeting {
        meetings::refresh_calendar(engine).await;
        meetings::validate(engine, meeting)?;
    }
    if let Some(resume) = &choice.resume
        && (engine.read(|state| state.session.paused.as_ref() != Some(resume)) || current.running())
    {
        return Err(AppError::message("This paused session is no longer available."));
    }
    if let Some(plan) = &choice.meeting_return {
        let now = engine.now();
        let stale = engine.read(|state| {
            let workspace = connection::workspace(state);
            state.session.meeting_return.as_ref() != Some(plan)
                || !plan.is_due(Some(current), &workspace, now)
        });
        if stale {
            return Err(AppError::message(
                "The meeting timer changed. Review your current tracking before returning.",
            ));
        }
    }
    let mut item = None;
    if let Some(id) = choice.ticket {
        let found = if engine.preview() {
            engine
                .read(|state| state.session.work_items.get(&id).cloned())
                .ok_or_else(|| AppError::message("This ticket is not in the isolated preview."))?
        } else {
            let clients = engine
                .clients()
                .ok_or_else(|| AppError::message("Connect your account in Settings first."))?;
            lookup(engine, &clients, id).await?
        };
        engine.update(|state| state.session.work_items.insert(id, found.clone()));
        item = Some(found);
    }
    if let Some(change) = &choice.change {
        branches::validate(engine, change).await?;
    }
    if !engine.read(|state| state.session.connection.activities_loaded) {
        refresh_activities(engine).await;
    }
    let still_current = engine.read(|state| {
        let flow = &state.session.flow;
        !choice.in_menu_bar || (flow.menu_tracking && flow.menu_generation == menu_generation)
    });
    if connection != engine.connection_generation() || !still_current {
        return Ok(None);
    }
    if let Some(meeting) = &choice.meeting {
        meetings::validate(engine, meeting)?;
    }
    figma::validate(engine, proposal.as_ref(), file, choice.ticket, Some(&scope))?;
    let design_missing = engine.read(|state| {
        design_activity::selected(&state.session.connection.activity_types).is_none()
    });
    if (proposal.is_some() || file.is_some()) && design_missing {
        return Err(AppError::message(
            "The Design activity is missing in 7pace. Add or enable Design before starting from Figma.",
        ));
    }
    let figma_name = match &proposal {
        Some(proposal) => Some(proposal.name.clone()),
        None => file.and_then(|file| figma::file_name(engine, file)),
    };
    let mut draft = TrackingDraft::new(item, choice.change.clone(), current.identity());
    draft.figma_suggestion = proposal;
    draft.figma_file = choice.figma_file.clone();
    draft.figma_scope = Some(scope);
    draft.figma_name = figma_name;
    draft.meeting = choice.meeting.clone();
    draft.resume = choice.resume.clone();
    draft.meeting_return = choice.meeting_return.clone();
    Ok(Some(draft))
}

/// Revalidates every source of a draft. Runs before the write and twice inside the
/// transaction (`validate_context`): before the first write and between stop and start.
async fn revalidate(engine: &Engine, draft: &TrackingDraft) -> Result<()> {
    let ticket = draft.item.as_ref().map(|item| item.id);
    figma::validate(
        engine,
        draft.figma_suggestion.as_ref(),
        draft.figma_file.as_deref(),
        ticket,
        draft.figma_scope.as_deref(),
    )?;
    if let Some(session) = &draft.microphone_session {
        microphone::validate_current(engine, session)?;
    }
    if let Some(change) = &draft.change {
        branches::validate(engine, change).await?;
    }
    if let Some(meeting) = &draft.meeting {
        meetings::validate(engine, meeting)?;
    }
    if let Some(resume) = &draft.resume
        && engine.read(|state| state.session.paused.as_ref() != Some(resume))
    {
        return Err(AppError::message("This paused session is no longer available."));
    }
    if let Some(plan) = &draft.meeting_return {
        let now = engine.now();
        let stale = engine.read(|state| {
            let workspace = connection::workspace(state);
            state.session.meeting_return.as_ref() != Some(plan)
                || !plan.is_due(tracking(state), &workspace, now)
        });
        if stale {
            return Err(AppError::message("This meeting return is no longer available."));
        }
    }
    Ok(())
}

/// Swift `canStart(_:activityID:)`.
pub(crate) fn can_start(
    state: &AppState,
    draft: &TrackingDraft,
    activity_id: &str,
    busy: bool,
    now: Timestamp,
) -> bool {
    let connection = &state.session.connection;
    let types = &connection.activity_types;
    if !connection.activities_loaded
        || connection.loading_activities
        || busy
        || !connection.connected
        || !(types.is_empty() || types.iter().any(|t| t.id == activity_id))
    {
        return false;
    }
    if draft.is_figma() && !types.iter().any(|t| t.id == activity_id && design_activity::matches(t))
    {
        return false;
    }
    if draft.standup && !types.iter().any(|t| t.id == activity_id && StandupActivity::matches(t)) {
        return false;
    }
    draft
        .microphone_session
        .as_ref()
        .is_none_or(|session| microphone::is_active(state, session, now))
}

/// Swift `preferredActivityID(for:)`.
pub(crate) fn preferred_activity_id(state: &AppState, draft: &TrackingDraft) -> String {
    let types = &state.session.connection.activity_types;
    let meetings = &state.config.meetings;
    let owned = |id: Option<&str>| id.unwrap_or_default().to_string();
    if draft.is_figma() {
        return owned(design_activity::selected(types));
    }
    if draft.standup {
        return owned(StandupActivity::selected(types));
    }
    if draft.microphone_session.is_some() || draft.manual == Some(ManualTrackingKind::Meeting) {
        return owned(meeting_activity::suggested_id("Meeting", &meetings.activity_type_id, types));
    }
    if let Some(plan) = &draft.meeting_return {
        return plan.activity_id.clone().unwrap_or_default();
    }
    if let Some(attention) = &draft.attention {
        return attention.activity_id.clone().unwrap_or_default();
    }
    if let Some(resume) = &draft.resume {
        return resume.activity_id.clone().unwrap_or_default();
    }
    if let Some(meeting) = &draft.meeting {
        return owned(meeting_activity::suggested_id(
            &meeting.title,
            &meetings.activity_type_id,
            types,
        ));
    }
    state.config.activity_type_id.clone()
}

/// What the timer was started, stopped or paused for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StopReason {
    User,
    /// An integration-branch suggestion (`branch.pause`, `branch.stop`).
    Branch(Uuid),
    /// The microphone end prompt.
    MicrophoneEnd,
    /// The completed-ticket prompt.
    Completion,
}

/// The transaction result and what the success path needs.
struct Started {
    next: TrackingState,
    previous: TrackingState,
    previous_return: Option<MeetingReturn>,
    ticket: Option<i64>,
    remark: Option<String>,
    activity: Option<String>,
}

/// Swift `startTracking(_:activityID:comment:includeTicket:)`, the only path that starts a
/// timer.
pub(crate) async fn start(
    engine: &Engine,
    draft_id: Uuid,
    activity_id: &str,
    comment: &str,
    include_ticket: bool,
) -> std::result::Result<Value, IpcError> {
    if busy(engine) {
        return Err(IpcError::busy());
    }
    if engine.preview() {
        return done();
    }
    let Some(clients) = engine.clients() else { return done() };
    let Some((draft, loaded)) = engine.read(|state| {
        let draft = state.session.flow.draft.clone().filter(|draft| draft.id == draft_id)?;
        state
            .session
            .connection
            .connected
            .then_some((draft, state.session.connection.activities_loaded))
    }) else {
        return done();
    };
    if !loaded {
        set_error(engine, "Load the activity types before starting your timer.");
        return done();
    }
    let Some(_busy) = engine.inner.busy.try_acquire() else { return Err(IpcError::busy()) };
    match run_start(engine, &clients, &draft, activity_id, comment, include_ticket).await {
        Ok(started) => {
            finish_start(engine, &draft, started);
            history::load(engine).await;
            progress::load(engine).await;
        }
        Err(error) => {
            let message = error.to_string();
            // A timed-out write may still have reached 7pace. Reconcile with a read only;
            // never replay a mutation or manufacture local worklogs.
            reconcile_after_error(engine, &clients, message.clone()).await;
            // A later attempt needs a new confirmation based on the refreshed state.
            engine.update(|state| {
                let flow = &mut state.session.flow;
                flow.draft = None;
                flow.show_picker = false;
                flow.menu_tracking = false;
                flow.selected_meeting = None;
            });
            engine.record("Tracking needs attention", message);
        }
    }
    done()
}

async fn run_start(
    engine: &Engine,
    clients: &Clients,
    draft: &TrackingDraft,
    activity_id: &str,
    comment: &str,
    include_ticket: bool,
) -> Result<Started> {
    let types: Vec<ActivityType> =
        engine.read(|state| state.session.connection.activity_types.clone());
    let activity = resolve_activity(activity_id, &types)?;
    let ticket = if include_ticket || !draft.allows_no_ticket() {
        draft.item.as_ref().map(|item| item.id)
    } else {
        None
    };
    let chosen = |matches: fn(&ActivityType) -> bool| {
        types.iter().any(|activity| activity.id == activity_id && matches(activity))
    };
    if draft.is_figma() && !chosen(design_activity::matches) {
        return Err(AppError::message("Choose Design to start tracking from Figma."));
    }
    figma::validate(
        engine,
        draft.figma_suggestion.as_ref(),
        draft.figma_file.as_deref(),
        draft.item.as_ref().map(|item| item.id),
        draft.figma_scope.as_deref(),
    )?;
    if draft.standup && !chosen(StandupActivity::matches) {
        return Err(AppError::message("The Standup activity is required to track daily standup."));
    }
    let remark = match draft.manual {
        Some(kind) => Some(kind.remark(comment, types.iter().find(|t| t.id == activity_id))),
        None => draft.tracking_comment(ticket.is_some()),
    };
    if let Some(session) = &draft.microphone_session {
        microphone::validate_current(engine, session)?;
        if draft.standup && !chosen(StandupActivity::matches) {
            return Err(AppError::message(
                "Choose the Standup activity before starting daily standup tracking.",
            ));
        }
    }
    if let Some(change) = &draft.change {
        branches::validate(engine, change).await?;
    }
    if let Some(meeting) = &draft.meeting {
        meetings::refresh_calendar(engine).await;
        meetings::validate(engine, meeting)?;
    }
    if let Some(resume) = &draft.resume
        && engine.read(|state| state.session.paused.as_ref() != Some(resume))
    {
        return Err(AppError::message("This paused session is no longer available."));
    }
    let now = engine.now();
    let (previous, previous_return, stale_return) = engine.read(|state| {
        let workspace = connection::workspace(state);
        let previous = tracking(state).cloned();
        let stale = draft.meeting_return.as_ref().is_some_and(|plan| {
            state.session.meeting_return.as_ref() != Some(plan)
                || !plan.is_due(previous.as_ref(), &workspace, now)
        });
        (previous, state.session.meeting_return.clone(), stale)
    });
    if stale_return {
        return Err(AppError::message("This meeting return is no longer available."));
    }
    let previous = previous.ok_or(AppError::RemoteChanged)?;
    let next = att_core::tracking::switch_to(
        ticket,
        &draft.expected_identity,
        activity.as_deref(),
        remark.as_deref(),
        draft.attention.as_ref(),
        clients.seven_pace.as_ref(),
        || {
            let engine = engine.clone();
            let draft = draft.clone();
            async move { revalidate(&engine, &draft).await }
        },
    )
    .await?;
    Ok(Started { next, previous, previous_return, ticket, remark, activity })
}

/// The success path of Swift `startTracking`: apply, meeting return, Figma, quick tickets,
/// dismissals and the audit entry.
fn finish_start(engine: &Engine, draft: &TrackingDraft, started: Started) {
    let Started { next, previous, previous_return, ticket, remark, activity } = started;
    connection::apply(engine, next.clone());
    update_with(engine, |state, effects| {
        let workspace = connection::workspace(state);
        let plan = if let Some(meeting) = &draft.meeting {
            MeetingReturn::after_starting(
                &meeting.id,
                meeting.end,
                &previous,
                &next,
                &workspace,
                previous_return.as_ref(),
            )
        } else if let Some(session) = &draft.microphone_session {
            MeetingReturn::after_starting(
                &format!("microphone:{}", session.id),
                MeetingReturn::open_end(),
                &previous,
                &next,
                &workspace,
                previous_return.as_ref(),
            )
            .map(|mut plan| {
                plan.microphone_session_id = Some(session.id.clone());
                plan.microphone_app_id = Some(session.owner.id.clone());
                plan
            })
        } else {
            None
        };
        state.session.meeting_return = plan;
        figma::complete_tracking(state, draft, ticket, effects);
        if let Some(ticket) = ticket {
            state.session.quick_tickets.remember(ticket);
        }
        if let Some(session) = &draft.microphone_session {
            microphone::dismiss_session(state, &session.id, effects);
        }
        let flow = &mut state.session.flow;
        flow.draft = None;
        flow.show_picker = false;
        flow.menu_tracking = false;
        flow.selected_meeting = None;
        if let Some(change) = &draft.change {
            branches::dismiss_change(state, change.id, effects);
        }
        if let Some(meeting) = &draft.meeting {
            meetings::dismiss_meeting(state, &meeting.id, effects);
        }
        let types = &state.session.connection.activity_types;
        let activity_name = types
            .iter()
            .find(|type_| Some(&type_.id) == activity.as_ref())
            .and_then(|type_| type_.name.clone())
            .unwrap_or_else(|| "7pace default".to_string());
        let prefix = ticket.map(|id| format!("#{id} · ")).unwrap_or_default();
        let what = match ticket {
            None => remark.clone().unwrap_or_else(|| draft.title()),
            Some(_) => draft.title(),
        };
        effects.record("Tracking started", format!("{prefix}{what} · {activity_name}"));
    });
    figma::persist_ledger(engine);
    engine.update(|state| state.session.error = state.session.figma.storage_issue.clone());
    let _ = engine.persist();
}

/// The prompt a stop or pause acts on, captured before the write.
enum Prompt {
    None,
    Branch(Option<BranchChange>),
    MicrophoneEnd(att_core::microphone_end::MicrophoneEndPrompt),
    Completion(att_core::completion::TicketCompletionPrompt),
}

fn prompt_for(engine: &Engine, reason: StopReason) -> Option<Prompt> {
    let now = engine.now();
    let preview = engine.preview();
    engine.read(|state| match reason {
        StopReason::User => Some(Prompt::None),
        StopReason::Branch(id) => Some(Prompt::Branch(
            state.session.branches.pending.iter().find(|change| change.id == id).cloned(),
        )),
        StopReason::MicrophoneEnd => {
            microphone::end_prompt(state, now, preview).map(Prompt::MicrophoneEnd)
        }
        StopReason::Completion => completion::prompt(state, now, preview).map(Prompt::Completion),
    })
}

/// Validates the prompt and returns the identity the write must still see.
async fn validate_prompt(
    engine: &Engine,
    prompt: &Prompt,
    shown: &TrackingState,
) -> Result<String> {
    match prompt {
        Prompt::None => Ok(shown.identity()),
        Prompt::Branch(change) => {
            let change = change
                .as_ref()
                .ok_or_else(|| AppError::message("This branch suggestion is no longer active."))?;
            branches::validate(engine, change).await?;
            Ok(shown.identity())
        }
        Prompt::MicrophoneEnd(prompt) => {
            microphone::validate_end(engine, prompt)?;
            Ok(prompt.tracking_identity.clone())
        }
        Prompt::Completion(prompt) => {
            completion::validate(engine, prompt).await?;
            Ok(prompt.tracking_identity.clone())
        }
    }
}

/// Swift `stopTracking(for:afterMicrophone:afterCompletion:)`.
pub(crate) async fn stop(
    engine: &Engine,
    reason: StopReason,
) -> std::result::Result<Value, IpcError> {
    if busy(engine) {
        return Err(IpcError::busy());
    }
    let Some(clients) = engine.clients().filter(|_| !engine.preview()) else { return done() };
    let Some(shown) = engine.read(connected_state) else { return done() };
    let Some(prompt) = prompt_for(engine, reason) else { return done() };
    let Some(_busy) = engine.inner.busy.try_acquire() else { return Err(IpcError::busy()) };
    let result = async {
        let expected = validate_prompt(engine, &prompt, &shown).await?;
        att_core::tracking::stop(&expected, clients.seven_pace.as_ref()).await
    }
    .await;
    match result {
        Ok(stopped) => {
            connection::apply(engine, stopped);
            update_with(engine, |state, effects| {
                state.session.paused = None;
                if let Prompt::Branch(Some(change)) = &prompt {
                    branches::dismiss_change(state, change.id, effects);
                }
                state.session.error = None;
                effects.record("Tracking stopped", "Stopped the active 7pace timer");
            });
            let _ = engine.persist();
            history::load(engine).await;
            progress::load(engine).await;
        }
        Err(error) => reconcile_after_error(engine, &clients, error.to_string()).await,
    }
    done()
}

/// Swift `pauseTracking(for:afterMicrophone:)`: stops the timer and remembers it locally, so
/// the paused interval is never logged.
pub(crate) async fn pause(
    engine: &Engine,
    reason: StopReason,
) -> std::result::Result<Value, IpcError> {
    if busy(engine) {
        return Err(IpcError::busy());
    }
    let Some(clients) = engine.clients().filter(|_| !engine.preview()) else { return done() };
    let Some(shown) = engine.read(connected_state).filter(TrackingState::running) else {
        return done();
    };
    let Some(prompt) = prompt_for(engine, reason) else { return done() };
    let now = engine.now();
    let paused = engine.read(|state| {
        PausedSession::from_state(
            &shown,
            connection::workspace(state),
            now,
            connection::elapsed(state, now),
        )
    });
    let Some(_busy) = engine.inner.busy.try_acquire() else { return Err(IpcError::busy()) };
    let result = async {
        let expected = validate_prompt(engine, &prompt, &shown).await?;
        att_core::tracking::stop(&expected, clients.seven_pace.as_ref()).await
    }
    .await;
    match result {
        Ok(stopped) => {
            connection::apply(engine, stopped);
            update_with(engine, |state, effects| {
                state.session.paused = Some(paused);
                state.session.error = None;
                if let Prompt::Branch(Some(change)) = &prompt {
                    branches::dismiss_change(state, change.id, effects);
                }
                effects.record("Tracking paused", "No time is logged until you resume");
            });
            let _ = engine.persist();
            history::load(engine).await;
            progress::load(engine).await;
        }
        Err(error) => reconcile_after_error(engine, &clients, error.to_string()).await,
    }
    done()
}

/// `branch.pause`.
pub(crate) async fn pause_for_branch(
    engine: &Engine,
    id: Uuid,
) -> std::result::Result<Value, IpcError> {
    pause(engine, StopReason::Branch(id)).await
}

/// `branch.stop`.
pub(crate) async fn stop_for_branch(
    engine: &Engine,
    id: Uuid,
) -> std::result::Result<Value, IpcError> {
    stop(engine, StopReason::Branch(id)).await
}

/// Swift `resumeTracking(inMenuBar:)`: a new session after confirmation; paused time is never
/// logged. Acts in the picker while it is open, else in the panel.
pub(crate) async fn resume(engine: &Engine) {
    let in_menu_bar = !engine.read(|state| state.session.flow.show_picker);
    let ready = engine.read(|state| {
        let session = &state.session;
        let running = tracking(state).map(TrackingState::running);
        session.connection.connected
            && running == Some(false)
            && session.flow.draft.is_none()
            && session.paused.is_some()
    });
    if busy(engine) || !ready {
        return;
    }
    let Some(paused) = engine.read(|state| state.session.paused.clone()) else { return };
    if in_menu_bar {
        begin_menu_tracking(engine, None);
        engine.services().shell.show_panel(true);
    }
    if let Some(id) = paused.ticket_id {
        let choice =
            Choice { ticket: Some(id), in_menu_bar, resume: Some(paused), ..Choice::default() };
        choose_activity(engine, choice).await;
        return;
    }
    if paused.remark.non_empty().is_none() {
        return;
    }
    let Some(current) = engine.read(|state| tracking(state).cloned()) else { return };
    let Some(_busy) = engine.inner.busy.try_acquire() else { return };
    if !engine.read(|state| state.session.connection.activities_loaded) {
        refresh_activities(engine).await;
    }
    engine.update(|state| {
        let session = &mut state.session;
        if session.paused.as_ref() != Some(&paused) || (in_menu_bar && !session.flow.menu_tracking)
        {
            return;
        }
        let mut draft = TrackingDraft::new(None, None, current.identity());
        draft.resume = Some(paused);
        session.flow.draft = Some(draft);
        session.flow.menu_tracking = in_menu_bar;
        session.flow.show_picker = !in_menu_bar;
    });
}

/// Swift `discardPause()`.
pub(crate) fn discard_pause(engine: &Engine) {
    if busy(engine) {
        return;
    }
    engine.update(|state| state.session.paused = None);
}

/// Swift `confirmActivity()`: answers a 7pace activity check.
pub(crate) async fn confirm_activity(engine: &Engine) -> std::result::Result<Value, IpcError> {
    if busy(engine) {
        return Err(IpcError::busy());
    }
    let Some(clients) = engine.clients().filter(|_| !engine.preview()) else { return done() };
    let Some(_busy) = engine.inner.busy.try_acquire() else { return Err(IpcError::busy()) };
    let expected = engine.read(|state| state.session.attention.prompt.clone());
    match clients.seven_pace.confirm_activity(expected.as_ref()).await {
        Ok(state) => {
            if engine.connection_generation() == clients.generation {
                connection::apply(engine, state);
                engine.update(|state| state.session.error = None);
            }
        }
        Err(error) => reconcile_after_error(engine, &clients, error.to_string()).await,
    }
    done()
}

/// `branch.track`: the activity chooser for the suggested ticket (or the branch remark).
pub(crate) async fn track_branch(engine: &Engine, id: Uuid) {
    let Some(change) = branches::pending(engine, id) else { return };
    let in_menu_bar = !engine.read(|state| state.session.flow.show_picker);
    if in_menu_bar {
        begin_menu_tracking(engine, Some(change.clone()));
        engine.services().shell.show_panel(true);
    }
    let choice =
        Choice { ticket: change.ticket_id, change: Some(change), in_menu_bar, ..Choice::default() };
    choose_activity(engine, choice).await;
}

/// `branch.chooseAnother`: the ticket search for a branch change.
pub(crate) async fn choose_another_for_branch(engine: &Engine, id: Uuid) {
    let Some(change) = branches::pending(engine, id) else { return };
    if engine.read(|state| state.session.flow.show_picker) {
        let ticket = change.ticket_id;
        engine.update(|state| state.session.flow.selected_change = Some(change));
        // The sheet searched the suggested ticket when it appeared.
        if let Some(ticket) = ticket {
            search(engine, ticket.to_string()).await;
        }
    } else if begin_menu_tracking(engine, Some(change)) {
        engine.services().shell.show_panel(true);
    }
}

/// `completion.switch`: the ticket search after a completed ticket.
pub(crate) fn switch_from_completed(engine: &Engine) {
    if engine.read(|state| state.session.flow.show_picker) {
        engine.update(|state| state.session.flow.selected_change = None);
    } else if begin_menu_tracking(engine, None) {
        engine.services().shell.show_panel(true);
    }
}

/// Swift `quickSwitch()` (⌃⌥T / Ctrl+Alt+Shift+T, "Switch ticket…"): favourites and recent
/// tickets in the panel, Figma prefill, titles in one batch.
pub(crate) async fn quick_switch(engine: &Engine) {
    let shell = engine.services().shell.clone();
    if busy(engine) {
        engine.update(|state| state.session.quick_switch_pending = true);
        shell.show_panel(true);
        return;
    }
    if engine.read(|state| state.session.flow.show_picker) {
        shell.show_main(None);
        return;
    }
    if !engine.read(|state| state.session.flow.menu_tracking) {
        begin_menu_tracking(engine, None);
    }
    shell.show_panel(true);
    let ids: Vec<i64> = engine
        .read(|state| state.session.quick_tickets.ordered_ids().into_iter().take(12).collect());
    connection::request_titles(engine, ids);
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        let engine = engine.clone();
        handle.spawn(async move { figma::prefill(&engine, true).await });
    }
}
