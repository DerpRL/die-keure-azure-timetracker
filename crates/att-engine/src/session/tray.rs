//! The menu-bar/tray status (Swift `MenuBarController`): the ` HH:MM:SS` title of
//! `menuElapsed` (the local timer when it leads), the tooltip from
//! `att_core::indicator::status_description` and the icon state. Runs once per second, so it
//! reads the state once and allocates only the two strings it returns.

use jiff::Timestamp;

use att_core::indicator::{TrackingIndicator, status_description};
use att_core::model::HostOs;
use att_core::offline::LocalTimerDisplay;
use att_core::productivity::ConnectionHealth;
use att_core::text::duration_text;

use crate::controllers::hooks::active_local_timer;
use crate::shell::{TrayState, TrayStatus};
use crate::state::AppState;

use super::connection::{elapsed, health, tracking};

/// Swift `trackingIndicator`: a confirmed connection with an open attention prompt shows
/// Attention.
pub(crate) fn indicator(state: &AppState, now: Timestamp) -> TrackingIndicator {
    let connection = &state.session.connection;
    let confirmed = connection.connected && health(state, now) == ConnectionHealth::Confirmed;
    if confirmed && state.session.attention.prompt.is_some() {
        return TrackingIndicator::Attention;
    }
    TrackingIndicator::resolve(
        confirmed,
        connection.connecting,
        tracking(state),
        state.session.paused.is_some(),
    )
}

pub(crate) fn tray_state(indicator: TrackingIndicator) -> TrayState {
    match indicator {
        TrackingIndicator::Running => TrayState::Running,
        TrackingIndicator::Stopped => TrayState::Stopped,
        TrackingIndicator::Paused => TrayState::Paused,
        TrackingIndicator::Disconnected => TrayState::Disconnected,
        TrackingIndicator::Connecting => TrayState::Connecting,
        TrackingIndicator::Attention => TrayState::Attention,
    }
}

/// Swift `showsLocalTimer`.
pub(crate) fn shows_local_timer(state: &AppState, now: Timestamp) -> bool {
    let connection = &state.session.connection;
    let local = active_local_timer(state);
    LocalTimerDisplay::is_primary(
        local.as_ref(),
        tracking(state).is_some_and(|state| state.running()),
        connection.connected && health(state, now) == ConnectionHealth::Confirmed,
    )
}

/// The menu-bar/tray status at `now` (Swift `MenuBarController`).
pub fn tray_status(state: &AppState, now: Timestamp) -> TrayStatus {
    let connection = &state.session.connection;
    let health = health(state, now);
    let confirmed = connection.connected && health == ConnectionHealth::Confirmed;
    let local = active_local_timer(state);
    let running = tracking(state).is_some_and(|state| state.running());
    let local_leads = LocalTimerDisplay::is_primary(local.as_ref(), running, confirmed);
    let seconds = match &local {
        Some(draft) if local_leads => LocalTimerDisplay::elapsed(draft, now),
        _ => elapsed(state, now),
    };
    let seconds = if seconds.is_finite() { seconds.clamp(0.0, f64::from(i32::MAX)) } else { 0.0 };
    let clock = duration_text::clock(seconds);
    let tooltip = match &local {
        Some(draft) if local_leads => format!(
            "Azure timetracker — Local tracking · {} · Not uploaded to 7pace",
            draft.title()
        ),
        _ => {
            // The tooltip uses the indicator without the attention override, as 1.14.x did.
            let status = TrackingIndicator::resolve(
                confirmed,
                connection.connecting,
                tracking(state),
                state.session.paused.is_some(),
            );
            status_description(
                status,
                health.label(),
                tracking(state),
                state.session.paused.as_ref(),
                |id| state.session.work_items.get(&id).map(|item| item.title.clone()),
            )
        }
    };
    // The Windows notification area cannot show text: the clock leads the tooltip there.
    let tooltip = if state.session.host_os == Some(HostOs::Windows) {
        format!("{clock} · {tooltip}")
    } else {
        tooltip
    };
    TrayStatus {
        title: Some(format!(" {clock}")),
        tooltip,
        state: tray_state(indicator(state, now)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use att_core::indicator::PausedSession;
    use att_core::model::{Track, TrackingState, WireValue, WorkItem};
    use att_core::offline::OfflineDraft;

    fn now() -> Timestamp {
        "2026-10-06T08:00:00Z".parse().unwrap()
    }

    fn connected(state: &mut AppState, tracking: TrackingState) {
        let connection = &mut state.session.connection;
        connection.tracking = Some(tracking);
        connection.connected = true;
        connection.has_seven_pace_token = true;
        connection.last_sync = Some(now());
    }

    fn running(length: f64) -> TrackingState {
        let mut track = Track::with_state(WireValue::text("Tracking"));
        track.tfs_id = Some(33984);
        track.work_log_id = Some("wl".into());
        track.current_track_length = Some(length);
        TrackingState::with_track(track)
    }

    #[test]
    fn the_title_is_the_running_clock_and_the_tooltip_names_the_ticket() {
        let mut state = AppState::default();
        connected(&mut state, running(3_725.0));
        state.session.work_items.insert(33984, WorkItem::new(33984, "Improve loading"));
        let status = tray_status(&state, att_core::time::add_secs(now(), 10.0));
        assert_eq!(status.title.as_deref(), Some(" 01:02:15"), "extrapolated while confirmed");
        assert_eq!(status.state, TrayState::Running);
        assert_eq!(
            status.tooltip,
            "Azure timetracker — Tracking · 7pace connected\n#33984 · Improve loading"
        );
        // Stale: the clock stands still and the tooltip says so.
        let status = tray_status(&state, att_core::time::add_secs(now(), 600.0));
        assert_eq!(status.title.as_deref(), Some(" 01:02:05"));
        assert!(status.tooltip.contains("7pace status is out of date"), "{}", status.tooltip);
        // Disconnected: the last known ticket.
        state.session.connection.connected = false;
        let status = tray_status(&state, now());
        assert_eq!(status.state, TrayState::Disconnected);
        assert_eq!(
            status.tooltip,
            "Azure timetracker — Disconnected · 7pace offline\nLast known: #33984 · Improve loading"
        );
    }

    #[test]
    fn paused_and_stopped_timers_and_the_windows_tooltip() {
        let mut state = AppState::default();
        let idle = TrackingState::with_track(Track::with_state(WireValue::text("Idle")));
        connected(&mut state, idle);
        let status = tray_status(&state, now());
        assert_eq!(status.title.as_deref(), Some(" 00:00:00"));
        assert_eq!(status.state, TrayState::Stopped);
        let paused = PausedSession::new(None, None, "", now(), 1_800.0, Some("Planning"));
        state.session.paused = Some(paused);
        let status = tray_status(&state, now());
        assert_eq!(status.title.as_deref(), Some(" 00:30:00"));
        assert_eq!(status.state, TrayState::Paused);
        assert_eq!(status.tooltip, "Azure timetracker — Paused · 7pace connected\nPlanning");
        state.session.host_os = Some(HostOs::Windows);
        let status = tray_status(&state, now());
        assert!(status.tooltip.starts_with("00:30:00 · Azure timetracker — Paused"));
    }

    #[test]
    fn a_leading_local_timer_drives_the_title() {
        let mut state = AppState::default();
        let start = att_core::time::add_secs(now(), -90.0);
        let draft = OfflineDraft::new("ws", start, None, None, "Offline notes", None);
        state.controllers.offline.ledger.drafts.push(draft);
        let status = tray_status(&state, now());
        assert_eq!(status.title.as_deref(), Some(" 00:01:30"));
        assert_eq!(
            status.tooltip,
            "Azure timetracker — Local tracking · Offline notes · Not uploaded to 7pace"
        );
    }
}
