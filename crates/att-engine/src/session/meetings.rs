//! Calendar and meeting suggestions (Swift `CalendarService`, AppModel L1109–1158,
//! L1380–1384): events from the platform calendar on the probe pool, the agenda day, meeting
//! suggestions once per occurrence with the 5-minute grace, and `enableCalendar`.

use jiff::Timestamp;
use jiff::civil::Date;

use att_core::config::PromptKind;
use att_core::meetings::{MeetingEvent, MeetingSuggestionEngine, meeting_ticket};
use att_core::{AppError, Result};
use att_platform::{CalendarAccess, CalendarEvent, CalendarInfo, EventStatus};

use crate::engine::Engine;
use crate::probes::{PROBE_DEADLINE, blocking};
use crate::state::AppState;

use super::tracking::{self, Choice};
use super::{Effects, announce, busy, update_with};

/// One agenda row (Swift `AgendaEvent`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct AgendaEvent {
    pub id: String,
    pub title: String,
    pub start: Timestamp,
    pub end: Timestamp,
    pub all_day: bool,
    pub calendar: Option<String>,
    pub color: Option<String>,
    pub location: Option<String>,
}

impl AgendaEvent {
    /// Swift `isNow`.
    pub fn is_now(&self, now: Timestamp) -> bool {
        !self.all_day && self.start <= now && self.end > now
    }
}

#[derive(Default)]
pub(crate) struct CalendarState {
    /// Unknown until the first read.
    pub access: Option<CalendarAccess>,
    pub calendars: Vec<CalendarInfo>,
    /// The agenda day's events without cancelled ones, all-day first, then by start.
    pub agenda: Vec<AgendaEvent>,
    /// Today's events as meeting candidates (Swift `meetingEvents`).
    pub meeting_events: Vec<MeetingEvent>,
    /// The agenda day (Swift `selectedDate`); `None` is today.
    pub agenda_day: Option<Date>,
    pub issue: Option<String>,
    /// Swift `lastCalendarCheck`.
    pub last_check: Option<Timestamp>,
    /// Swift `meetingEngine` (its `seen` map is persisted as `meetingReminders`).
    pub engine: MeetingSuggestionEngine,
    /// Swift `pendingMeetings`.
    pub pending: Vec<MeetingEvent>,
    pub popup_pending: bool,
}

impl CalendarState {
    pub fn authorized(&self) -> bool {
        self.access == Some(CalendarAccess::Authorized)
    }
}

/// Swift `CalendarService.refresh(selectedIDs:enabled:organization:)`. Browsing another agenda
/// day never changes the reminder clock: meeting candidates are always today's events.
pub(crate) async fn refresh_calendar(engine: &Engine) {
    let now = engine.now();
    let cal = engine.cal();
    let (selected, enabled, organization, day) = engine.read(|state| {
        (
            state.config.selected_calendar_ids.clone(),
            state.config.calendar_enabled && !engine.preview(),
            state.config.organization.clone(),
            state.session.calendar.agenda_day.unwrap_or_else(|| cal.date(now)),
        )
    });
    let source = engine.services().platform.calendar.clone();
    let probe = source.clone();
    let access = blocking(PROBE_DEADLINE, move || probe.access()).await;
    let Some(access) = access else {
        engine.update(|state| {
            state.session.calendar.issue =
                Some("Calendar is not responding. Retrying automatically.".to_string());
        });
        return;
    };
    if !(enabled && access == CalendarAccess::Authorized) {
        engine.update(|state| {
            let calendar = &mut state.session.calendar;
            calendar.access = Some(access);
            calendar.agenda.clear();
            calendar.meeting_events.clear();
            calendar.calendars.clear();
        });
        return;
    }
    let today = cal.date(now);
    let day_interval = cal.date_interval(day);
    let today_interval = cal.date_interval(today);
    let read = blocking(PROBE_DEADLINE * 3, move || -> std::result::Result<_, String> {
        let calendars = source.calendars().map_err(|error| error.to_string())?;
        let events = source
            .events(day_interval.start, day_interval.end, &selected)
            .map_err(|error| error.to_string())?;
        let current = if day == today {
            events.clone()
        } else {
            source
                .events(today_interval.start, today_interval.end, &selected)
                .map_err(|error| error.to_string())?
        };
        Ok((calendars, events, current))
    })
    .await
    .unwrap_or_else(|| Err("Calendar is not responding. Retrying automatically.".to_string()));
    engine.update(|state| {
        let calendar = &mut state.session.calendar;
        calendar.access = Some(access);
        match read {
            Ok((calendars, events, current)) => {
                calendar.calendars = calendars;
                calendar.agenda = agenda_events(&events);
                calendar.meeting_events =
                    current.iter().map(|event| meeting_event(event, &organization)).collect();
                calendar.issue = None;
            }
            Err(issue) => calendar.issue = Some(issue),
        }
    });
}

/// The agenda list: cancelled events left out, all-day events first, then by start.
fn agenda_events(events: &[CalendarEvent]) -> Vec<AgendaEvent> {
    let mut agenda: Vec<AgendaEvent> = events
        .iter()
        .filter(|event| event.status != EventStatus::Canceled)
        .map(|event| AgendaEvent {
            id: event.occurrence_id.clone(),
            title: if event.title.is_empty() {
                "Untitled event".to_string()
            } else {
                event.title.clone()
            },
            start: event.start,
            end: event.end,
            all_day: event.all_day,
            calendar: event.calendar_title.clone(),
            color: event.calendar_color.clone(),
            location: event.location.clone(),
        })
        .collect();
    agenda.sort_by(|a, b| b.all_day.cmp(&a.all_day).then(a.start.cmp(&b.start)));
    agenda
}

/// Swift `MeetingEvent` from an EventKit occurrence. The id is the 1.14.x occurrence key
/// (`sha256(calendar|item|start)`), so imported `meetingReminders` keep matching.
fn meeting_event(event: &CalendarEvent, organization: &str) -> MeetingEvent {
    let title =
        if event.title.is_empty() { "Untitled meeting".to_string() } else { event.title.clone() };
    MeetingEvent {
        id: event.occurrence_id.clone(),
        title,
        start: event.start,
        end: event.end,
        calendar: event.calendar_title.clone().unwrap_or_default(),
        ticket_id: meeting_ticket::extract(
            &event.title,
            event.url.as_deref(),
            event.notes.as_deref(),
            organization,
        ),
        all_day: event.all_day,
        cancelled: event.status == EventStatus::Canceled,
        declined: event.declined,
        free: event.free,
    }
}

fn suggestions_enabled(state: &AppState, preview: bool) -> bool {
    state.config.calendar_enabled
        && state.session.calendar.authorized()
        && state.config.meetings.enabled
        && !preview
}

/// Swift `checkMeetingSuggestions(now:)`.
pub(crate) fn check_suggestions(engine: &Engine, now: Timestamp) {
    let preview = engine.preview();
    let busy = busy(engine);
    update_with(engine, |state, effects| {
        if !suggestions_enabled(state, preview) {
            let calendar = &mut state.session.calendar;
            calendar.pending.clear();
            calendar.popup_pending = false;
            if state.session.flow.selected_meeting.is_some() {
                tracking::cancel_menu_tracking(state);
            }
            return;
        }
        let default_ticket = state.config.meetings.default_ticket.clone();
        let calendar = &mut state.session.calendar;
        let active: Vec<&MeetingEvent> =
            calendar.meeting_events.iter().filter(|event| event.is_active(now)).collect();
        let valid: Vec<MeetingEvent> = calendar
            .pending
            .iter()
            .filter_map(|old| {
                active.iter().find(|event| event.id == old.id).map(|event| (*event).clone())
            })
            .collect();
        let selected_gone = state
            .session
            .flow
            .selected_meeting
            .as_ref()
            .is_some_and(|selected| !active.iter().any(|event| event.id == selected.id));
        let ended: Vec<String> = calendar
            .pending
            .iter()
            .filter(|old| !valid.iter().any(|event| event.id == old.id))
            .map(|old| old.id.clone())
            .collect();
        calendar.pending = valid;
        for id in ended {
            effects.remove_notification(announce::meeting_id(&id));
        }
        if selected_gone {
            tracking::cancel_menu_tracking(state);
        }
        let calendar = &mut state.session.calendar;
        let due = calendar.engine.due(&calendar.meeting_events, now);
        if !due.is_empty() {
            calendar.pending.extend(due.iter().cloned());
            calendar.popup_pending = true;
        }
        let flow = &state.session.flow;
        if calendar.popup_pending && !busy && !flow.show_picker && !flow.menu_tracking {
            calendar.popup_pending = false;
            if !calendar.pending.is_empty() {
                let notice = calendar
                    .pending
                    .last()
                    .map(|event| announce::meeting(event, ticket(event, &default_ticket)));
                effects.announce(PromptKind::Meeting, notice);
            }
        }
    });
}

/// Swift `meetingTicket(_:)`: the meeting's own ticket, else the default meeting ticket.
pub(crate) fn ticket(meeting: &MeetingEvent, default_ticket: &str) -> Option<i64> {
    meeting.ticket_id.or_else(|| default_ticket.trim().parse::<i64>().ok())
}

/// Swift `validateMeeting(_:)`.
pub(crate) fn validate(engine: &Engine, meeting: &MeetingEvent) -> Result<()> {
    let now = engine.now();
    let preview = engine.preview();
    let valid = engine.read(|state| {
        let calendar = &state.session.calendar;
        suggestions_enabled(state, preview)
            && calendar.pending.iter().any(|pending| pending.id == meeting.id)
            && calendar
                .meeting_events
                .iter()
                .any(|event| event.id == meeting.id && event.is_active(now))
    });
    if valid {
        Ok(())
    } else {
        Err(AppError::message("This meeting suggestion has ended or is no longer available."))
    }
}

/// Swift `beginMeetingTracking(_:useSuggestedTicket:)`.
pub(crate) async fn begin(engine: &Engine, id: &str, use_suggested_ticket: bool) {
    let Some((meeting, default_ticket)) = engine.read(|state| {
        let meeting =
            state.session.calendar.pending.iter().find(|event| event.id == id).cloned()?;
        Some((meeting, state.config.meetings.default_ticket.clone()))
    }) else {
        return;
    };
    let flow_open = engine.read(|state| {
        let flow = &state.session.flow;
        flow.draft.is_some() || flow.show_picker || flow.menu_tracking
    });
    if busy(engine) || flow_open {
        return;
    }
    if let Err(error) = validate(engine, &meeting) {
        engine.update(|state| state.session.error = Some(error.to_string()));
        return;
    }
    tracking::begin_menu_tracking(engine, None);
    let suggested = ticket(&meeting, &default_ticket);
    engine.update(|state| {
        state.session.flow.selected_meeting = Some(meeting.clone());
        state.session.flow.search_query = suggested.map(|id| id.to_string()).unwrap_or_default();
    });
    engine.services().shell.show_panel(true);
    if use_suggested_ticket {
        let choice = Choice {
            ticket: suggested,
            in_menu_bar: true,
            meeting: Some(meeting),
            ..Choice::default()
        };
        tracking::choose_activity(engine, choice).await;
    }
}

/// Swift `dismissMeeting(_:)`.
pub(crate) fn dismiss(engine: &Engine, id: &str) {
    update_with(engine, |state, effects| dismiss_meeting(state, id, effects));
}

pub(crate) fn dismiss_meeting(state: &mut AppState, id: &str, effects: &mut Effects) {
    state.session.calendar.pending.retain(|event| event.id != id);
    effects.remove_notification(announce::meeting_id(id));
}

/// `agenda.setDay`.
pub(crate) async fn set_agenda_day(engine: &Engine, day: Date) {
    let today = super::today(engine);
    engine.update(|state| {
        state.session.calendar.agenda_day = (day != today).then_some(day);
    });
    refresh_calendar(engine).await;
}

/// Swift `enableCalendar()`: asks for full calendar access (the OS prompt), then enables the
/// agenda when granted.
pub(crate) async fn enable_calendar(engine: &Engine) {
    if engine.preview() {
        return;
    }
    let source = engine.services().platform.calendar.clone();
    let result = source.request_access().await;
    let access = match result {
        Ok(access) => access,
        Err(error) => {
            let message = error.to_string();
            engine.update(|state| state.session.calendar.issue = Some(message));
            source.access()
        }
    };
    engine.update(|state| {
        let calendar = &mut state.session.calendar;
        calendar.access = Some(access);
        if access == CalendarAccess::Authorized {
            calendar.issue = None;
        } else if access != CalendarAccess::Unsupported {
            calendar.issue = Some(
                "Calendar access is off. Enable Azure timetracker in System Settings → Privacy & Security → Calendars."
                    .to_string(),
            );
        }
        state.config.calendar_enabled = access == CalendarAccess::Authorized;
    });
    let _ = engine.persist();
    refresh_calendar(engine).await;
}

/// `agenda.openCalendar` (Agenda → Open Calendar).
pub(crate) async fn open_calendar_app(engine: &Engine) {
    let source = engine.services().platform.calendar.clone();
    let result = blocking(PROBE_DEADLINE, move || source.open_calendar_app()).await;
    if let Some(Err(error)) = result {
        let message = error.to_string();
        engine.update(|state| state.session.error = Some(message));
    }
}
