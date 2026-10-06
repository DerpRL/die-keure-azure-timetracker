//! Session documents: `pending`, `meetingReminders`, `pausedSession`, `meetingReturn`,
//! `workAwareness`, `ticketCompletion`, `microphoneTracking`, `quickTickets`, `dayReviews`,
//! `attentionNotified`, `attentionDismissed`, `figmaStore` (see `att_store::keys`).

use crate::ipc::IpcError;
use crate::services::Services;
use crate::state::AppState;

pub(crate) fn load(_services: &Services, _state: &mut AppState) {}

pub(crate) fn save(_services: &Services, _state: &AppState) -> Result<(), IpcError> {
    Ok(())
}
