//! Loading and saving state through the store.
//!
//! The configuration and the audit log are handled here; the session and the controllers load
//! and save their own documents (`session::persist`, `controllers::persist`).

use att_core::Configuration;
use att_core::git::AUDIT_LIMIT;
use att_store::keys;

use crate::ipc::IpcError;
use crate::services::Services;
use crate::state::AppState;
use crate::{controllers, session};

pub(crate) fn load(services: &Services, state: &mut AppState) {
    if !services.preview
        && let Some(dir) = att_platform::paths::legacy_data_dir()
    {
        match services.store.import_legacy(&dir) {
            Ok(report) if report.imported => {
                tracing::info!(
                    documents = report.documents.len(),
                    audit = report.audit_entries,
                    skipped = report.skipped.len(),
                    "imported 1.14.x data"
                );
            }
            Ok(_) => {}
            Err(error) => {
                state.storage_issue = Some(format!(
                    "Settings from Azure timetracker 1.x could not be imported: {error}"
                ));
            }
        }
    }
    match services.store.get::<Configuration>(keys::CONFIGURATION) {
        Ok(Some(config)) => {
            state.config = config;
            state.has_saved_settings = true;
        }
        Ok(None) => {}
        Err(error) => {
            // Swift: keep the original file and stop writing until it is resolved.
            state.can_persist = false;
            state.storage_issue = Some(format!(
                "Saved settings could not be read. The original data has been preserved: {error}"
            ));
        }
    }
    state.audit = services.store.audit(AUDIT_LIMIT).unwrap_or_default();
    session::persist::load(services, state);
    controllers::persist::load(services, state);
}

pub(crate) fn save(services: &Services, state: &AppState) -> Result<(), IpcError> {
    if !state.can_persist {
        return Err(IpcError::new(
            "storage",
            "Local settings could not be saved because the saved data could not be read.",
        ));
    }
    services.store.put(keys::CONFIGURATION, &state.config)?;
    session::persist::save(services, state)?;
    controllers::persist::save(services, state)?;
    Ok(())
}
