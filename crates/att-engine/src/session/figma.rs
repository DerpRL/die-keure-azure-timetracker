//! Figma context (Swift `FigmaModel` and the app half of `FigmaService`): polling the Figma
//! window on the probe pool, dwell activation, the per-workspace ledger, suggestions, links,
//! Design tracking with the file name as comment, and history.

use std::collections::BTreeSet;

use jiff::Timestamp;
use serde_json::Value;
use uuid::Uuid;

use att_core::AppError;
use att_core::Result;
use att_core::config::PromptKind;
use att_core::figma::{
    FigmaActivation, FigmaDocument, FigmaLedger, FigmaObservation, FigmaPreferences, FigmaStore,
    FigmaSuggestion,
};
use att_core::model::HostOs;
use att_platform::WindowObservation;
use att_store::keys;

use crate::engine::Engine;
use crate::intent::done;
use crate::ipc::IpcError;
use crate::probes::{PROBE_DEADLINE, blocking};
use crate::state::AppState;

use super::connection::{lookup, running_ticket, workspace};
use super::tracking::{self, Choice, TrackingDraft};
use super::{Effects, announce, busy, update_with};

const STORAGE_ISSUE: &str =
    "Figma context could not be saved on this Mac. Resolve the storage error before quitting.";

pub(crate) struct FigmaState {
    /// Swift `figmaStore` (persisted): every workspace's ledger.
    pub store: FigmaStore,
    pub storage_issue: Option<String>,
    pub activation: FigmaActivation,
    pub current_scope: String,
    /// The last observation (Swift `FigmaService.observation`).
    pub observation: FigmaObservation,
    /// `notForeground` when Figma was not in front at the last read.
    pub raw: &'static str,
    pub last_foreground: Option<FigmaObservation>,
    pub last_foreground_at: Option<Timestamp>,
    pub last_focused_file: Option<String>,
    pub enabled: bool,
    pub paused: bool,
    /// The sampler reads the window (Swift `loop != nil`).
    pub running: bool,
    pub has_access: bool,
    pub installed: bool,
    pub search: String,
    pub generation: u64,
}

impl Default for FigmaState {
    fn default() -> Self {
        Self {
            store: FigmaStore::default(),
            storage_issue: None,
            activation: FigmaActivation::new(),
            current_scope: String::new(),
            observation: FigmaObservation::Waiting,
            raw: "waiting",
            last_foreground: None,
            last_foreground_at: None,
            last_focused_file: None,
            enabled: false,
            paused: false,
            running: false,
            has_access: false,
            installed: false,
            search: String::new(),
            generation: 0,
        }
    }
}

/// Swift `figmaScope`: `organization|workspace`.
pub(crate) fn scope(state: &AppState) -> String {
    format!("{}|{}", state.config.organization.to_lowercase().trim(), workspace(state))
}

/// Swift `figmaLedger` (get).
pub(crate) fn ledger(state: &AppState) -> Option<&FigmaLedger> {
    state.session.figma.store.workspaces.get(&scope(state))
}

/// Swift `figmaLedger` (set) without the save: stores the ledger when it changed. Returns
/// whether it changed.
fn store_ledger(state: &mut AppState, ledger: FigmaLedger) -> bool {
    let scope = scope(state);
    let workspaces = &mut state.session.figma.store.workspaces;
    if workspaces.get(&scope).cloned().unwrap_or_default() == ledger {
        return false;
    }
    workspaces.insert(scope, ledger);
    true
}

/// The save half of the Swift `figmaLedger` setter.
pub(crate) fn persist_ledger(engine: &Engine) {
    if engine.preview() {
        engine.update(|state| state.session.figma.storage_issue = None);
        return;
    }
    let saved = engine.persist().is_ok()
        && !engine.read(|state| state.session.unreadable.contains(keys::FIGMA_STORE));
    engine.update(|state| {
        state.session.figma.storage_issue = (!saved).then(|| STORAGE_ISSUE.to_string());
    });
}

/// Swift `figmaSuggestions`.
pub(crate) fn suggestions(state: &AppState, now: Timestamp) -> Vec<FigmaSuggestion> {
    if !state.config.figma.enabled || !state.config.watch_enabled {
        return Vec::new();
    }
    let current = running_ticket(state);
    ledger(state)
        .map(|ledger| {
            ledger
                .suggestions
                .iter()
                .filter(|s| s.is_fresh(now) && !(s.ticket_id.is_some() && s.ticket_id == current))
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn file_name(engine: &Engine, file: &str) -> Option<String> {
    engine.read(|state| ledger(state)?.files.get(file).map(|file| file.name.clone()))
}

/// Swift `configureFigma()` + `FigmaService.configure(enabled:paused:preview:)`.
pub(crate) fn configure(engine: &Engine) {
    let preview = engine.preview();
    let observer = engine.services().platform.figma.clone();
    let stopped = update_with(engine, |state, effects| {
        let scope = scope(state);
        let enabled = state.config.figma.enabled;
        let watching = state.config.watch_enabled;
        let figma = &mut state.session.figma;
        if figma.current_scope != scope {
            if let Some(ledger) = figma.store.workspaces.get(&figma.current_scope) {
                for suggestion in &ledger.suggestions {
                    effects.remove_notification(suggestion.id.to_string());
                }
            }
            figma.current_scope = scope.clone();
            figma.last_focused_file = None;
            figma.last_foreground = None;
            figma.last_foreground_at = None;
            figma.activation = FigmaActivation::new();
            state.session.flow.selected_figma = None;
        }
        let figma = &mut state.session.figma;
        if !enabled || !watching {
            if let Some(ledger) = figma.store.workspaces.get_mut(&scope) {
                for suggestion in ledger.suggestions.drain(..) {
                    effects.remove_notification(suggestion.id.to_string());
                }
            }
            figma.activation = FigmaActivation::new();
            state.session.flow.selected_figma = None;
        }
        let figma = &mut state.session.figma;
        if figma.enabled == enabled && figma.paused == !watching && figma.running {
            return false;
        }
        figma.enabled = enabled;
        figma.paused = !watching;
        figma.generation += 1;
        figma.running = enabled && watching && !preview;
        !figma.running
    });
    let installed = observer.figma_installed();
    let access = observer.has_access();
    engine.update(|state| {
        state.session.figma.installed = installed;
        state.session.figma.has_access = access;
    });
    persist_ledger(engine);
    if stopped {
        observe(engine, FigmaObservation::Waiting, engine.now(), "waiting");
    }
}

/// Swift `setFigmaPreferences(_:)`: saved immediately, bounds applied.
pub(crate) fn set_preferences(engine: &Engine, preferences: FigmaPreferences) {
    let mut valid = preferences;
    valid.dismissal_minutes = valid.dismissal_minutes.clamp(0, 120);
    valid.history_days = valid.history_days.clamp(1, 365);
    let old = engine.update(|state| std::mem::replace(&mut state.config.figma, valid));
    if !engine.preview() && engine.persist().is_err() {
        engine.update(|state| state.config.figma = old);
        return;
    }
    configure(engine);
}

/// One read of the Figma window (Swift `FigmaService` loop body), then `observeFigma`.
pub(crate) async fn poll(engine: &Engine) {
    let (running, generation, os) = engine.read(|state| {
        let figma = &state.session.figma;
        (figma.running, figma.generation, state.session.host_os.unwrap_or(HostOs::current()))
    });
    if !running {
        return;
    }
    let observer = engine.services().platform.figma.clone();
    let read = blocking(PROBE_DEADLINE, move || (observer.has_access(), observer.observe())).await;
    let now = engine.now();
    let (access, observation, raw) = match read {
        Some((false, _)) | Some((_, WindowObservation::MissingAccess)) => {
            (false, FigmaObservation::MissingAccess, "missingAccess")
        }
        Some((true, WindowObservation::NotForeground)) => {
            (true, FigmaObservation::Waiting, "notForeground")
        }
        // Figma is in front but its window could not be read (Swift `.noAddress`).
        Some((true, WindowObservation::Waiting)) => {
            (true, FigmaObservation::NoAddress, "noAddress")
        }
        Some((true, WindowObservation::Window { title, url })) => {
            let observation = FigmaObservation::from_window(url.as_deref(), title.as_deref(), os);
            let raw = if observation.document().is_some() { "file" } else { "noAddress" };
            (true, observation, raw)
        }
        // A late read is discarded, as when focus changed during the read.
        None => (true, FigmaObservation::Waiting, "waiting"),
    };
    let current = engine.update(|state| {
        let figma = &mut state.session.figma;
        if figma.generation != generation || !figma.running {
            return false;
        }
        figma.has_access = access;
        figma.observation = observation.clone();
        figma.raw = raw;
        if observation.foreground() {
            figma.last_foreground = Some(observation.clone());
            figma.last_foreground_at = Some(now);
        }
        if let Some(document) = observation.document() {
            figma.last_focused_file = Some(document.key.clone());
        }
        true
    });
    if current {
        observe(engine, observation, now, raw);
    }
}

/// Swift `observeFigma(_:at:)`.
fn observe(engine: &Engine, observation: FigmaObservation, now: Timestamp, _raw: &str) {
    let flow_busy = busy(engine);
    let outcome = update_with(engine, |state, effects| {
        if !state.config.figma.enabled || !state.config.watch_enabled {
            return None;
        }
        let preferences = state.config.figma.clone();
        let active_ticket = running_ticket(state);
        let mut ledger = ledger(state).cloned().unwrap_or_default();
        let old_ids: BTreeSet<Uuid> = ledger.suggestions.iter().map(|s| s.id).collect();
        ledger.prune(now, &preferences);
        let figma = &mut state.session.figma;
        if let Some(file) = observation.document() {
            ledger.observe(file);
            if figma.activation.observe(Some(file), now) {
                let _ = ledger.activate(file, now, active_ticket, &preferences);
            }
        } else {
            let _ = figma.activation.observe(None, now);
        }
        if let Some(ticket) = active_ticket {
            ledger.suggestions.retain(|suggestion| suggestion.ticket_id != Some(ticket));
        }
        let remaining: BTreeSet<Uuid> = ledger.suggestions.iter().map(|s| s.id).collect();
        for id in old_ids.difference(&remaining) {
            effects.remove_notification(id.to_string());
        }
        let new: Vec<FigmaSuggestion> =
            ledger.suggestions.iter().filter(|s| !old_ids.contains(&s.id)).cloned().collect();
        let changed = store_ledger(state, ledger);
        let flow = &state.session.flow;
        let panel = !flow_busy && !flow.menu_tracking && !flow.show_picker;
        Some((new, changed, panel, scope(state)))
    });
    let Some((new, changed, panel, scope)) = outcome else { return };
    if changed {
        persist_ledger(engine);
    }
    for proposal in new {
        announce_suggestion(engine, proposal, panel, scope.clone());
    }
}

/// The panel opens right away (unless busy or in a flow); the notification follows once the
/// linked ticket's title is known, and is withdrawn if the suggestion changed meanwhile.
fn announce_suggestion(engine: &Engine, proposal: FigmaSuggestion, panel: bool, scope: String) {
    let now = engine.now();
    let cal = engine.cal();
    let preview = engine.preview();
    let decision =
        engine.read(|state| announce::decide(state, PromptKind::Figma, now, &cal, preview, panel));
    if let Some(focus) = decision.panel {
        engine.services().shell.show_panel(focus);
    }
    if !decision.notify {
        return;
    }
    let Ok(handle) = tokio::runtime::Handle::try_current() else { return };
    let engine = engine.clone();
    handle.spawn(async move {
        if let Some(id) = proposal.ticket_id
            && !engine.read(|state| state.session.work_items.contains_key(&id))
            && let Some(clients) = engine.clients()
            && let Ok(item) = lookup(&engine, &clients, id).await
            && engine.connection_generation() == clients.generation
        {
            engine.update(|state| state.session.work_items.insert(id, item));
        }
        let still_valid = |engine: &Engine| {
            let now = engine.now();
            engine.read(|state| {
                scope == self::scope(state)
                    && suggestions(state, now).iter().any(|s| s.id == proposal.id)
            })
        };
        if !still_valid(&engine) {
            return;
        }
        let title = proposal.ticket_id.and_then(|id| {
            engine.read(|state| state.session.work_items.get(&id).map(|item| item.title.clone()))
        });
        let shell = engine.services().shell.clone();
        shell.notify(&announce::figma(&proposal, title.as_deref()));
        if !still_valid(&engine) {
            shell.remove_notification(&proposal.id.to_string());
        }
    });
}

/// Swift `keepFigma(_:)`.
pub(crate) fn keep(engine: &Engine, id: Uuid) {
    let now = engine.now();
    let changed = update_with(engine, |state, effects| {
        let minutes = state.config.figma.dismissal_minutes;
        let mut ledger = ledger(state).cloned().unwrap_or_default();
        ledger.dismiss(id, now, minutes);
        effects.remove_notification(id.to_string());
        store_ledger(state, ledger)
    });
    if changed {
        persist_ledger(engine);
    }
}

/// Swift `validateFigma(_:file:ticket:scope:)`.
pub(crate) fn validate(
    engine: &Engine,
    proposal: Option<&FigmaSuggestion>,
    file: Option<&str>,
    ticket: Option<i64>,
    draft_scope: Option<&str>,
) -> Result<()> {
    if proposal.is_none() && file.is_none() {
        return Ok(());
    }
    let now = engine.now();
    engine.read(|state| {
        if draft_scope != Some(scope(state).as_str())
            || !state.config.figma.enabled
            || !state.config.watch_enabled
        {
            return Err(AppError::message(
                "Figma observation was paused, disabled or its workspace changed. Review the current context.",
            ));
        }
        let empty = FigmaLedger::default();
        let ledger = ledger(state).unwrap_or(&empty);
        if let Some(proposal) = proposal {
            ledger.validate(proposal.id, now)?;
        } else if let Some(file) = file
            && ledger.links.get(file).copied() != ticket
        {
            return Err(AppError::message("This Figma file’s ticket link changed. Choose the ticket again."));
        }
        Ok(())
    })
}

/// Swift `beginFigmaTracking(_:useLinkedTicket:)`.
pub(crate) async fn begin_tracking(engine: &Engine, id: Uuid, use_linked_ticket: bool) {
    let open = engine.read(|state| {
        let flow = &state.session.flow;
        flow.draft.is_some() || flow.menu_tracking || flow.show_picker
    });
    if busy(engine) || open {
        return;
    }
    let now = engine.now();
    let validated = engine.read(|state| {
        let empty = FigmaLedger::default();
        ledger(state).unwrap_or(&empty).validate(id, now)
    });
    let proposal = match validated {
        Ok(proposal) => proposal,
        Err(error) => {
            engine.update(|state| state.session.error = Some(error.to_string()));
            return;
        }
    };
    tracking::begin_menu_tracking(engine, None);
    engine.update(|state| state.session.flow.selected_figma = Some(proposal.clone()));
    engine.services().shell.show_panel(true);
    if use_linked_ticket {
        let choice = Choice {
            ticket: proposal.ticket_id,
            in_menu_bar: true,
            figma_suggestion: Some(proposal),
            ..Choice::default()
        };
        tracking::choose_activity(engine, choice).await;
    }
}

/// Swift `prefillFigmaTracking(inMenuBar:)`: the focused file's linked ticket opens the
/// activity chooser.
pub(crate) async fn prefill(engine: &Engine, in_menu_bar: bool) {
    let target = engine.read(|state| {
        let flow = &state.session.flow;
        let figma = &state.session.figma;
        let eligible = !flow.skip_figma_prefill
            && state.config.figma.enabled
            && state.config.watch_enabled
            && flow.selected_change.is_none()
            && flow.selected_meeting.is_none()
            && flow.selected_figma.is_none()
            && flow.draft.is_none();
        let file = figma.last_focused_file.clone().filter(|_| eligible)?;
        let ticket = ledger(state)?.links.get(&file).copied()?;
        Some((file, ticket))
    });
    let Some((file, ticket)) = target else { return };
    let choice =
        Choice { ticket: Some(ticket), in_menu_bar, figma_file: Some(file), ..Choice::default() };
    tracking::choose_activity(engine, choice).await;
}

/// Swift `linkFigmaFile(_:ticketID:)` (`ticket_id: None` unlinks). The ticket is verified
/// before the link is saved.
pub(crate) async fn link(
    engine: &Engine,
    key: &str,
    ticket: Option<i64>,
) -> std::result::Result<Value, IpcError> {
    if busy(engine) {
        return Err(IpcError::busy());
    }
    let Some(_busy) = engine.inner.busy.try_acquire() else { return Err(IpcError::busy()) };
    let scope = engine.read(scope);
    let result: Result<bool> = async {
        if let Some(id) = ticket {
            if !(1..=i64::from(i32::MAX)).contains(&id) {
                return Err(AppError::message("Enter a valid ticket number."));
            }
            let clients = engine
                .clients()
                .ok_or_else(|| AppError::message("Connect your account in Settings first."))?;
            let item = lookup(engine, &clients, id).await?;
            if engine.read(self::scope) != scope {
                return Err(AppError::message("Workspace changed. Review the link again."));
            }
            engine.update(|state| state.session.work_items.insert(item.id, item));
        }
        update_with(engine, |state, effects| {
            let mut ledger = ledger(state).cloned().unwrap_or_default();
            for suggestion in ledger.suggestions.iter().filter(|s| s.file == key) {
                effects.remove_notification(suggestion.id.to_string());
            }
            ledger.link(key, ticket)?;
            store_ledger(state, ledger);
            Ok(true)
        })
    }
    .await;
    match result {
        Ok(_) => {
            persist_ledger(engine);
            engine.update(|state| {
                if state.session.figma.storage_issue.is_none() {
                    state.session.error = None;
                }
            });
        }
        Err(error) => engine.update(|state| state.session.error = Some(error.to_string())),
    }
    done()
}

/// Swift `completeFigmaTracking(_:ticketID:)`: a ticket becomes the file's link, ticket-free
/// tracking only clears its suggestions.
pub(crate) fn complete_tracking(
    state: &mut AppState,
    draft: &TrackingDraft,
    ticket: Option<i64>,
    effects: &mut Effects,
) {
    if draft.figma_scope.as_deref() != Some(scope(state).as_str()) {
        return;
    }
    let Some(file) = draft
        .figma_suggestion
        .as_ref()
        .map(|suggestion| suggestion.file.clone())
        .or_else(|| draft.figma_file.clone())
    else {
        return;
    };
    let mut ledger = ledger(state).cloned().unwrap_or_default();
    let ids: Vec<Uuid> =
        ledger.suggestions.iter().filter(|s| s.file == file).map(|s| s.id).collect();
    match ledger.complete_tracking(&file, ticket) {
        Ok(()) => {
            for id in ids {
                effects.remove_notification(id.to_string());
            }
            store_ledger(state, ledger);
        }
        Err(error) => state.session.error = Some(error.to_string()),
    }
    state.session.flow.selected_figma = None;
}

/// Swift `openFigma(_:desktop:)`.
pub(crate) fn open(engine: &Engine, key: &str, desktop: bool) {
    let url = if !FigmaDocument::valid_key(key) {
        Err("This Figma file key is invalid.")
    } else if desktop {
        if engine.services().platform.figma.figma_installed() {
            FigmaDocument::desktop_url(key).ok_or("This Figma file key is invalid.")
        } else {
            Err("Install Figma Desktop to open this file in Figma.")
        }
    } else {
        FigmaDocument::web_url(key).ok_or("This Figma file key is invalid.")
    };
    match url {
        Ok(url) => engine.services().shell.open_url(&url),
        Err(message) => engine.update(|state| state.session.error = Some(message.to_string())),
    }
}

/// Swift `clearFigmaHistory()`.
pub(crate) fn clear_history(engine: &Engine) {
    let changed = engine.update(|state| {
        let mut ledger = ledger(state).cloned().unwrap_or_default();
        ledger.history.clear();
        store_ledger(state, ledger)
    });
    if changed {
        persist_ledger(engine);
    }
}

/// Swift `FigmaService.requestAccess()`: the macOS Accessibility prompt.
pub(crate) async fn request_access(engine: &Engine) {
    let observer = engine.services().platform.figma.clone();
    if let Some(access) = blocking(PROBE_DEADLINE, move || observer.request_access()).await {
        engine.update(|state| state.session.figma.has_access = access);
    }
}

/// Swift `FigmaService.refreshPermission()`.
pub(crate) async fn refresh_access(engine: &Engine) {
    let observer = engine.services().platform.figma.clone();
    if let Some(access) = blocking(PROBE_DEADLINE, move || observer.has_access()).await {
        engine.update(|state| state.session.figma.has_access = access);
    }
}

/// Swift `FigmaService.status`, without the time of the last foreground read (the slice
/// carries it for the UI to format).
pub(crate) fn status_label(state: &AppState) -> String {
    let figma = &state.session.figma;
    if !state.config.figma.enabled {
        return "Disabled".into();
    }
    if !state.config.watch_enabled {
        return "Paused".into();
    }
    match &figma.observation {
        FigmaObservation::MissingAccess => "Accessibility permission needed".into(),
        FigmaObservation::Waiting => {
            let previous = figma
                .last_foreground
                .as_ref()
                .and_then(FigmaObservation::document)
                .map(|document| format!("Seen: {}", document.name))
                .unwrap_or_else(|| "No file address found".into());
            if figma.last_foreground_at.is_some() {
                format!("Waiting for Figma · {previous}")
            } else {
                "Waiting for Figma".into()
            }
        }
        FigmaObservation::NoAddress => "Figma is active · no file address found".into(),
        FigmaObservation::File(file) => format!("File: {}", file.name),
    }
}
