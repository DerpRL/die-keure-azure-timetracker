//! Settings and app preferences (Swift AppModel L318–341, L512–548): saving with validation
//! and credential writes, interface preferences, interruption levels and quiet hours (2.0),
//! onboarding and the restart guard.

use std::path::PathBuf;

use serde_json::Value;

use att_core::config::{Interruption, PromptKind, QuietHours, SevenPaceAuthMode};
use att_core::git::BranchDebouncer;
use att_core::interface_prefs::InterfacePreferences;
use att_core::{AppError, Configuration, Result};
use att_net::Endpoint;

use crate::clients::accounts;
use crate::controllers::hooks as controllers;
use crate::engine::Engine;
use crate::intent::done;
use crate::ipc::IpcError;
use crate::probes::{PROBE_DEADLINE, blocking};
use crate::state::AppState;

use super::{branches, busy, connection, figma, meetings, microphone, update_with};

/// The appearance onboarding is shown instead of the app (Swift `showAppearanceOnboarding`):
/// never in preview or after saved settings could not be read.
pub(crate) fn needs_onboarding(state: &AppState, preview: bool) -> bool {
    !preview
        && !state.session.load_failed
        && InterfacePreferences::needs_onboarding(
            state.has_saved_settings,
            state.config.interface_setup_completed,
        )
}

/// Swift `saveSettings(_:pat:token:)`. Blank secrets keep the stored ones; appearance, Figma,
/// repositories and the 2.0 interruption settings are applied immediately elsewhere and are
/// never overwritten by an older Settings draft.
pub(crate) async fn save(
    engine: &Engine,
    draft: Configuration,
    azure_pat: &str,
    seven_pace_token: &str,
) -> std::result::Result<Value, IpcError> {
    if engine.preview() {
        return done();
    }
    if busy(engine) || engine.read(controllers::offline_working) {
        return Err(IpcError::busy());
    }
    let pat = azure_pat.trim().to_string();
    let token = seven_pace_token.trim().to_string();
    if let Err(error) = validate_and_store(engine, &draft, pat, token).await {
        let message = error.to_string();
        engine.update(|state| state.session.error = Some(message));
        return done();
    }
    let now = engine.now();
    update_with(engine, |state, effects| {
        let current = &state.config;
        let mut updated = draft;
        updated.figma = current.figma.clone();
        updated.interface = current.interface;
        updated.interface_setup_completed = current.interface_setup_completed;
        updated.repositories = current.repositories.clone();
        updated.interruptions = current.interruptions.clone();
        updated.quiet_hours = current.quiet_hours;
        state.config = updated;
        // Saving account settings invalidates previous decisions and snapshots.
        branches::clear_all(state, effects);
        state.session.branches.debouncer = BranchDebouncer::new();
        state.session.settings_saved_at = Some(now);
    });
    let _ = engine.persist();
    meetings::refresh_calendar(engine).await;
    microphone::configure(engine);
    figma::configure(engine);
    connection::connect(engine).await;
    done()
}

async fn validate_and_store(
    engine: &Engine,
    draft: &Configuration,
    pat: String,
    token: String,
) -> Result<()> {
    draft.validate()?;
    if !draft.seven_pace_url.is_empty() {
        Endpoint::seven_pace(&draft.seven_pace_url)?;
    }
    if !draft.organization.is_empty() {
        Endpoint::azure(&draft.organization)?;
    }
    let mut writes = Vec::new();
    if !pat.is_empty() {
        Endpoint::azure(&draft.organization)?;
        writes.push((accounts::azure_pat(&draft.organization), pat));
    }
    if !token.is_empty() && draft.seven_pace_auth_mode != SevenPaceAuthMode::MobilePin {
        let url = Endpoint::seven_pace(&draft.seven_pace_url)?;
        let host = url.host_str().unwrap_or_default().to_string();
        writes.push((accounts::seven_pace_token(&host), token));
    }
    if writes.is_empty() {
        return Ok(());
    }
    let credentials = engine.services().platform.credentials.clone();
    // Keychain writes can wait for a system prompt: blocking pool, no short deadline.
    tokio::task::spawn_blocking(move || {
        for (account, secret) in writes {
            credentials
                .set(&account, &secret)
                .map_err(|error| AppError::Message(error.to_string()))?;
        }
        Ok(())
    })
    .await
    .unwrap_or_else(|error| Err(AppError::Message(error.to_string())))
}

/// Swift `setInterfacePreferences(_:)`: saved immediately; reverted when it cannot be saved.
pub(crate) fn set_interface(engine: &Engine, preferences: InterfacePreferences) {
    let previous =
        engine.update(|state| std::mem::replace(&mut state.config.interface, preferences));
    if !engine.preview() && engine.persist().is_err() {
        engine.update(|state| state.config.interface = previous);
    }
}

/// `settings.setPromptInterruption` (2.0), saved immediately.
pub(crate) fn set_interruption(engine: &Engine, kind: PromptKind, level: Interruption) {
    engine.update(|state| {
        state.config.interruptions.insert(kind, level);
    });
}

/// `settings.setQuietHours` (2.0), saved immediately.
pub(crate) fn set_quiet_hours(engine: &Engine, quiet_hours: QuietHours) {
    if !quiet_hours.is_valid() {
        engine.update(|state| {
            state.session.error = Some("Choose quiet hours between 00:00 and 23:59.".to_string());
        });
        return;
    }
    engine.update(|state| state.config.quiet_hours = quiet_hours);
}

/// Swift `finishAppearanceOnboarding()`.
pub(crate) async fn finish_onboarding(engine: &Engine) {
    let observer = engine.services().platform.figma.clone();
    let access = blocking(PROBE_DEADLINE, move || observer.has_access()).await.unwrap_or(false);
    engine.update(|state| state.session.figma.has_access = access);
    if engine.read(|state| state.config.figma.enabled) && !access {
        engine.update(|state| {
            state.session.error = Some(
                "Allow Accessibility for Figma detection, or turn Figma detection off to continue."
                    .to_string(),
            );
        });
        return;
    }
    let previous = engine.update(|state| state.config.interface_setup_completed.replace(true));
    if !engine.preview() && engine.persist().is_err() {
        engine.update(|state| state.config.interface_setup_completed = previous);
        return;
    }
    engine.services().shell.show_main(Some("settings"));
    engine.update(|state| state.visible_page = Some("settings".to_string()));
    // The main loop starts the app on its next tick.
    engine.inner.wake.notify_one();
}

/// `settings.appIdentity`: the identity of an application chosen in a file dialog.
pub(crate) async fn app_identity(
    engine: &Engine,
    path: String,
) -> std::result::Result<Value, IpcError> {
    let presence = engine.services().platform.presence.clone();
    let result = blocking(PROBE_DEADLINE, move || presence.app_identity(&PathBuf::from(path)))
        .await
        .ok_or_else(|| IpcError::new("timeout", "The application could not be read in time."))?;
    let identity = result.map_err(|error| IpcError::new("message", error.to_string()))?;
    serde_json::to_value(identity).map_err(|error| IpcError::new("internal", error.to_string()))
}

/// `app.prepareForRestart` (Swift `installUpdate()` guards): refused while a write, an
/// offline upload, a time edit or a pairing is in progress; persists before the restart.
pub(crate) fn prepare_for_restart(engine: &Engine) -> std::result::Result<Value, IpcError> {
    let working = engine.read(|state| {
        controllers::offline_working(state)
            || controllers::time_editor_busy(state)
            || state.session.pairing.busy
    });
    if busy(engine) || working || engine.preview() {
        return Err(IpcError::new(
            "busy",
            "Wait for the current save or connection operation to finish before restarting.",
        ));
    }
    engine.persist().map_err(|_| {
        IpcError::new(
            "storage",
            "Local settings could not be saved. Resolve the storage error before updating.",
        )
    })?;
    done()
}
