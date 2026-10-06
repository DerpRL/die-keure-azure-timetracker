//! Returning to the previous ticket after a meeting (Swift AppModel L1212–1240).

use jiff::Timestamp;

use att_core::config::PromptKind;

use crate::engine::Engine;
use crate::state::AppState;

use super::connection::{confirmed, tracking, workspace};
use super::microphone;
use super::tracking::{self as flows, Choice};
use super::{announce, busy, update_with};

/// Swift `meetingReturnReady`.
pub(crate) fn ready(state: &AppState, now: Timestamp, preview: bool) -> bool {
    microphone::end_prompt(state, now, preview).is_none()
        && state
            .session
            .meeting_return
            .as_ref()
            .is_some_and(|plan| plan.is_due(tracking(state), &workspace(state), now))
}

/// Swift `canReturnAfterMicrophone`.
pub(crate) fn can_return_after_microphone(state: &AppState, now: Timestamp) -> bool {
    state
        .session
        .meeting_return
        .as_ref()
        .is_some_and(|plan| plan.is_due(tracking(state), &workspace(state), now))
}

/// Swift `checkMeetingReturn(now:)`: follows a moved calendar end, drops a plan that no longer
/// fits the timer, and announces it once when due.
pub(crate) fn check(engine: &Engine, now: Timestamp) {
    let preview = engine.preview();
    let busy = busy(engine);
    update_with(engine, |state, effects| {
        let Some(mut plan) = state.session.meeting_return.clone() else { return };
        let calendar = &state.session.calendar;
        if state.config.calendar_enabled
            && calendar.authorized()
            && let Some(event) = calendar
                .meeting_events
                .iter()
                .find(|event| event.id == plan.occurrence_id && !event.cancelled)
            && plan.end != event.end
        {
            if event.end > now {
                plan.notified = false;
            }
            plan.end = event.end;
            state.session.meeting_return = Some(plan.clone());
        }
        // A disconnected snapshot cannot invalidate a persisted return before reconnecting.
        if !state.session.connection.connected {
            return;
        }
        let workspace = workspace(state);
        if !plan.is_valid(tracking(state), &workspace, now) {
            state.session.meeting_return = None;
            effects.remove_notification(announce::MEETING_RETURN_ID);
            return;
        }
        let flow = &state.session.flow;
        let due = plan.is_due(tracking(state), &workspace, now)
            && !plan.notified
            && confirmed(state, now)
            && microphone::end_prompt(state, now, preview).is_none()
            && !busy
            && !flow.show_picker
            && !flow.menu_tracking;
        if due {
            plan.notified = true;
            let title =
                state.session.work_items.get(&plan.ticket_id).map(|item| item.title.clone());
            effects.announce(
                PromptKind::MeetingReturn,
                Some(announce::meeting_return(&plan, title.as_deref())),
            );
            effects.title(plan.ticket_id);
            state.session.meeting_return = Some(plan);
        }
    });
}

/// Swift `returnAfterMeeting()`: the activity chooser for the previous ticket.
pub(crate) async fn resume(engine: &Engine) {
    let now = engine.now();
    let plan = engine.read(|state| {
        let session = &state.session;
        let plan = session.meeting_return.clone()?;
        let ready = plan.is_due(tracking(state), &workspace(state), now)
            && session.connection.connected
            && !session.flow.show_picker
            && session.flow.draft.is_none();
        ready.then_some(plan)
    });
    let Some(plan) = plan.filter(|_| !busy(engine)) else { return };
    flows::begin_menu_tracking(engine, None);
    engine.services().shell.show_panel(true);
    engine.services().shell.remove_notification(announce::MEETING_RETURN_ID);
    let choice = Choice {
        ticket: Some(plan.ticket_id),
        in_menu_bar: true,
        meeting_return: Some(plan),
        ..Choice::default()
    };
    flows::choose_activity(engine, choice).await;
}

/// Swift `dismissMeetingReturn()`.
pub(crate) fn dismiss(engine: &Engine) {
    update_with(engine, |state, effects| {
        state.session.meeting_return = None;
        effects.remove_notification(announce::MEETING_RETURN_ID);
    });
}
