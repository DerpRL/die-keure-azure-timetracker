//! Controller documents: `offlineLedger`, `timeEditJournal`, and the weekly drafts table.

use crate::ipc::IpcError;
use crate::services::Services;
use crate::state::AppState;

pub(crate) fn load(_services: &Services, _state: &mut AppState) {}

pub(crate) fn save(_services: &Services, _state: &AppState) -> Result<(), IpcError> {
    Ok(())
}
