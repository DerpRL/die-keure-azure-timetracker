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
