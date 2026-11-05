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
use att_platform::AppLookup;

use crate::clients::{accounts, read_secret};
use crate::controllers::hooks as controllers;
use crate::engine::Engine;
use crate::intent::done;
use crate::ipc::IpcError;
use crate::probes::{PROBE_DEADLINE, blocking};
use crate::state::AppState;

use super::view::WorkAppView;
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

/// `settings.testAzurePat`: reads work items with `azure_pat` in `organization`, then checks
/// that `project` exists, without saving anything or touching the current connection. A blank
/// token tests the one stored for the organization.
pub(crate) async fn test_azure_pat(
    engine: &Engine,
    organization: &str,
    project: &str,
    azure_pat: &str,
) -> std::result::Result<Value, IpcError> {
    let organization = organization.trim();
    let project = project.trim();
    if organization.is_empty() {
        return Err(IpcError::new("organization", "Enter your Azure DevOps organization first."));
    }
    if let Err(error) = Endpoint::azure(organization) {
        return Err(IpcError::new("organization", error.to_string()));
    }
    if engine.preview() {
        return Err(IpcError::new("preview", "Preview mode: testing tokens is turned off."));
    }
    let mut pat = azure_pat.trim().to_string();
    if pat.is_empty() {
        let credentials = engine.services().platform.credentials.clone();
        let account = accounts::azure_pat(organization);
        // Keychain reads can wait for a system prompt: blocking pool, no short deadline.
        let stored =
            tokio::task::spawn_blocking(move || read_secret(credentials.as_ref(), &account))
                .await
                .unwrap_or_else(|error| Err(AppError::Message(error.to_string())))
                .map_err(IpcError::from)?;
        pat = stored.unwrap_or_default();
    }
    if pat.is_empty() {
        return Err(IpcError::new("missingToken", "Paste your personal access token first."));
    }
    let client = engine.services().clients.azure(organization, project, &pat)?;
    if let Err(error) = client.verify_organization().await {
        return Err(azure_test_error(error, organization, None));
    }
    if let Err(error) = client.verify_project().await {
        return Err(azure_test_error(error, organization, Some(project)));
    }
    done()
}

/// What went wrong while testing a token, in words that say what to change.
fn azure_test_error(error: AppError, organization: &str, project: Option<&str>) -> IpcError {
    match (error, project) {
        (AppError::Authentication(_), _) => IpcError::new(
            "authentication",
            format!(
                "Azure DevOps did not accept this token for “{organization}”. Check that you copied all of it, that it has not expired, and that it was created for this organization with the Work Items (Read) scope."
            ),
        ),
        (AppError::AccessDenied(_), _) => IpcError::new(
            "accessDenied",
            format!(
                "This token cannot read work items in “{organization}”. Edit it in Azure DevOps and add the Work Items (Read) scope."
            ),
        ),
        (AppError::NotFound, None) => IpcError::new(
            "organizationNotFound",
            format!(
                "Azure DevOps has no organization called “{organization}”. Use the name from dev.azure.com/your-organization."
            ),
        ),
        (AppError::NotFound, Some(project)) => IpcError::new(
            "projectNotFound",
            format!(
                "“{organization}” has no project called “{project}”, or this token cannot see it. Check the spelling, or leave Project empty to search every project."
            ),
        ),
        (AppError::Network(_) | AppError::Timeout, _) => IpcError::new(
            "offline",
            "Azure DevOps could not be reached. Check your internet connection and try again.",
        ),
        (other, _) => other.into(),
    }
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

/// Swift `finishAppearanceOnboarding()`, which opened Settings; 2.2 onboarding sets up the
/// accounts itself, so finishing opens Today.
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
    // The onboarding saved the accounts on its own steps: the app opens on Today.
    engine.services().shell.show_main(Some("overview"));
    engine.update(|state| state.show_page("overview"));
    // The main loop starts the app on its next tick.
    engine.inner.wake.notify_one();
}

/// `app.restartOnboarding`: marks the setup unfinished again, so the main window shows the
/// onboarding instead of the pages until it is finished (which returns to Settings). Saved
/// settings, credentials and a running timer are untouched. Not available in preview, where
/// onboarding never shows.
pub(crate) fn restart_onboarding(engine: &Engine) -> std::result::Result<(), IpcError> {
    if engine.preview() {
        return Ok(());
    }
    let previous = engine.update(|state| state.config.interface_setup_completed.replace(false));
    if let Err(error) = engine.persist() {
        engine.update(|state| state.config.interface_setup_completed = previous);
        return Err(IpcError::new(
            "message",
            format!("The onboarding could not be reopened: {}", error.message),
        ));
    }
    engine.services().shell.show_main(None);
    Ok(())
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
    let known = WorkAppView::new(identity.id.clone(), AppLookup::Found(identity.clone()));
    engine.update(|state| state.session.work_apps.insert(known.id.clone(), known));
    serde_json::to_value(identity).map_err(|error| IpcError::new("internal", error.to_string()))
}

/// Looks up the saved work apps the cache does not know yet (their names and whether they are
/// installed, for Settings) in the background, one lookup at a time. A lookup that does not
/// answer in time marks its apps as unknown, so it is not retried every tick.
pub(crate) fn look_up_work_apps(engine: &Engine) {
    let ids = engine.update(|state| {
        let session = &mut state.session;
        if session.work_apps_pending {
            return Vec::new();
        }
        let ids: Vec<String> = state
            .config
            .awareness
            .work_app_ids
            .iter()
            .filter(|id| !session.work_apps.contains_key(*id))
            .cloned()
            .collect();
        session.work_apps_pending = !ids.is_empty();
        ids
    });
    if ids.is_empty() {
        return;
    }
    let engine = engine.clone();
    tokio::spawn(async move {
        let presence = engine.services().platform.presence.clone();
        let wanted = ids.clone();
        let found = blocking(PROBE_DEADLINE, move || {
            wanted
                .into_iter()
                .map(|id| {
                    let lookup = presence.find_app(&id);
                    WorkAppView::new(id, lookup)
                })
                .collect::<Vec<_>>()
        })
        .await
        .unwrap_or_else(|| ids.into_iter().map(WorkAppView::unknown).collect());
        engine.update(|state| {
            let session = &mut state.session;
            session.work_apps_pending = false;
            for app in found {
                session.work_apps.insert(app.id.clone(), app);
            }
        });
    });
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
