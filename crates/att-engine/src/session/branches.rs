//! Branch watching (Swift AppModel L575–634): HEAD reads for enabled repositories on the probe
//! pool, the debouncer's baseline rules, pending `BranchChange`s, integration-branch
//! suggestions, `autoStartWhenIdle` and revalidation by re-reading HEAD before acting.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use uuid::Uuid;

use att_core::config::PromptKind;
use att_core::git::{
    BranchChange, BranchDebouncer, BranchPattern, BranchPolicy, GitProbe, GitSnapshot,
};
use att_core::model::Repository;
use att_core::{AppError, Result};

use crate::engine::Engine;
use crate::probes::{PROBE_DEADLINE, blocking};
use crate::state::AppState;

use super::connection::{running, running_ticket};
use super::tracking::{self, Choice};
use super::{Effects, announce, update_with};

#[derive(Default)]
pub(crate) struct BranchState {
    /// Swift `pending` (persisted), oldest first.
    pub pending: Vec<BranchChange>,
    /// Swift `branches`: the latest HEAD reading per repository.
    pub snapshots: BTreeMap<Uuid, GitSnapshot>,
    /// Swift `repositoryErrors`.
    pub errors: BTreeMap<Uuid, String>,
    pub debouncer: BranchDebouncer,
    /// A HEAD read that missed its deadline is still running: do not start another.
    pub probe_in_flight: Arc<AtomicBool>,
    /// No settings existed at launch: discover `~/Documents/repositories` on start.
    pub discover_on_start: bool,
}

/// Clears the in-flight flag when the probe finishes, also after a panic.
struct InFlight(Arc<AtomicBool>);

impl Drop for InFlight {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Swift `scanBranches()`.
pub(crate) async fn scan(engine: &Engine) {
    let Some((repositories, flag)) = engine.update(|state| {
        if !state.config.watch_enabled {
            return None;
        }
        let repositories: Vec<Repository> =
            state.config.repositories.iter().filter(|repo| repo.enabled).cloned().collect();
        let ids: BTreeSet<Uuid> = repositories.iter().map(|repo| repo.id).collect();
        state.session.branches.debouncer.retain(&ids);
        Some((repositories, state.session.branches.probe_in_flight.clone()))
    }) else {
        return;
    };
    if repositories.is_empty() || flag.swap(true, Ordering::SeqCst) {
        return;
    }
    let guard = InFlight(flag);
    // Filesystem reads never block the async threads.
    let readings = blocking(PROBE_DEADLINE, move || {
        let _guard = guard;
        repositories
            .into_iter()
            .map(|repo| {
                let reading = GitProbe::read(&repo.path);
                (repo, reading)
            })
            .collect::<Vec<_>>()
    })
    .await;
    let Some(readings) = readings else { return };
    let now = engine.now();
    let autostart = update_with(engine, |state, effects| {
        let mut autostart = Vec::new();
        let pattern = BranchPattern::new(&state.config.branch_pattern).ok();
        for (repo, reading) in readings {
            if let Some(start) =
                apply_reading(state, effects, &repo, reading, pattern.as_ref(), now)
            {
                autostart.push(start);
            }
        }
        autostart
    });
    for (ticket, change) in autostart {
        let choice = Choice {
            ticket: Some(ticket),
            change: Some(change),
            requires_idle: true,
            in_menu_bar: true,
            ..Choice::default()
        };
        tracking::choose_activity(engine, choice).await;
    }
}

/// One repository's reading. Returns a ticket to open the activity chooser for when
/// `autoStartWhenIdle` applies.
fn apply_reading(
    state: &mut AppState,
    effects: &mut Effects,
    repo: &Repository,
    reading: Result<GitSnapshot>,
    pattern: Option<&BranchPattern>,
    now: jiff::Timestamp,
) -> Option<(i64, BranchChange)> {
    let watching = state.config.watch_enabled
        && state.config.repositories.iter().any(|known| known.id == repo.id && known.enabled);
    if !watching {
        return None;
    }
    let connected = state.session.connection.connected;
    let is_running = running(state);
    let current_ticket = running_ticket(state);
    let auto_start = state.config.auto_start_when_idle;
    let branches = &mut state.session.branches;
    let snapshot = match reading {
        Err(error) => {
            branches.errors.insert(repo.id, error.to_string());
            return None;
        }
        Ok(snapshot) => snapshot,
    };
    branches.errors.remove(&repo.id);
    branches.snapshots.insert(repo.id, snapshot.clone());
    let change = branches.debouncer.sample(snapshot.clone(), repo.id)?;
    let Some(old) = change.old else {
        // Establish a baseline without a burst of notifications for every pre-existing
        // checkout. Preserve only still-valid prompts.
        let stale: Vec<Uuid> = branches
            .pending
            .iter()
            .filter(|pending| {
                pending.repository_id == repo.id
                    && Some(&pending.branch) != snapshot.branch.as_ref()
            })
            .map(|pending| pending.id)
            .collect();
        for id in &stale {
            effects.remove_notification(id.to_string());
        }
        branches.pending.retain(|pending| !stale.contains(&pending.id));
        return None;
    };
    let obsolete: Vec<Uuid> = branches
        .pending
        .iter()
        .filter(|pending| pending.repository_id == repo.id)
        .map(|pending| pending.id)
        .collect();
    for id in &obsolete {
        effects.remove_notification(id.to_string());
    }
    branches.pending.retain(|pending| pending.repository_id != repo.id);
    if state
        .session
        .flow
        .selected_change
        .as_ref()
        .is_some_and(|selected| obsolete.contains(&selected.id))
    {
        tracking::cancel_menu_tracking(state);
    }
    let Some(branch) = change.new.branch.clone() else {
        effects.record("Detached HEAD", format!("{}: tracking unchanged", repo.name()));
        return None;
    };
    let ticket = pattern.and_then(|pattern| pattern.extract(&branch).ok().flatten());
    if let Some(ticket) = ticket
        && connected
        && is_running
        && Some(ticket) == current_ticket
    {
        return None;
    }
    let event = BranchChange::new(repo, &branch, old.branch.as_deref(), ticket, now);
    state.session.branches.pending.push(event.clone());
    effects.record("Branch changed", format!("{} → {}", repo.name(), branch));
    effects.announce(PromptKind::Branch, Some(announce::branch(&event, is_running)));
    if let Some(ticket) = ticket {
        effects.title(ticket);
    }
    if auto_start
        && connected
        && !is_running
        && let Some(ticket) = ticket
    {
        return Some((ticket, event));
    }
    None
}

pub(crate) fn pending(engine: &Engine, id: Uuid) -> Option<BranchChange> {
    engine
        .read(|state| state.session.branches.pending.iter().find(|change| change.id == id).cloned())
}

/// Swift `keep(_:)`.
pub(crate) fn keep(engine: &Engine, id: Uuid) {
    update_with(engine, |state, effects| {
        let Some(change) =
            state.session.branches.pending.iter().find(|change| change.id == id).cloned()
        else {
            return;
        };
        dismiss_change(state, id, effects);
        effects.record(
            "Kept current tracking",
            format!("{} · {}", change.repository_name, change.branch),
        );
    });
}

/// Swift `dismiss(_:)`.
pub(crate) fn dismiss_change(state: &mut AppState, id: Uuid, effects: &mut Effects) {
    state.session.branches.pending.retain(|change| change.id != id);
    effects.remove_notification(id.to_string());
}

/// Swift `clearSuggestions(repositoryID:)`.
pub(crate) fn clear_suggestions(state: &mut AppState, repository: Uuid, effects: &mut Effects) {
    let branches = &mut state.session.branches;
    for change in branches.pending.iter().filter(|change| change.repository_id == repository) {
        effects.remove_notification(change.id.to_string());
    }
    branches.pending.retain(|change| change.repository_id != repository);
}

/// Every pending suggestion goes (settings saved, watching paused).
pub(crate) fn clear_all(state: &mut AppState, effects: &mut Effects) {
    for change in state.session.branches.pending.drain(..) {
        effects.remove_notification(change.id.to_string());
    }
}

/// Swift `validate(_:)`: the suggestion is still pending and watched, and HEAD still shows its
/// branch (re-read from disk now).
pub(crate) async fn validate(engine: &Engine, change: &BranchChange) -> Result<()> {
    let repository = engine.read(|state| {
        let pending = state.session.branches.pending.iter().any(|pending| pending.id == change.id);
        let repository = state
            .config
            .repositories
            .iter()
            .find(|repo| repo.id == change.repository_id && repo.enabled)
            .cloned();
        repository.filter(|_| pending && state.config.watch_enabled)
    });
    let Some(repository) = repository else {
        return Err(AppError::message("This branch suggestion is no longer active."));
    };
    let snapshot = blocking(PROBE_DEADLINE, move || GitProbe::read(&repository.path))
        .await
        .unwrap_or_else(|| Err(AppError::message("Git HEAD is temporarily unreadable.")))?;
    if snapshot.branch.as_deref() != Some(change.branch.as_str()) {
        update_with(engine, |state, effects| dismiss_change(state, change.id, effects));
        return Err(AppError::message(
            "This repository changed branches again. Review the latest suggestion.",
        ));
    }
    Ok(())
}

/// Swift `forgottenTickets`: tickets on the branches of enabled repositories.
pub(crate) fn forgotten_tickets(state: &AppState) -> Vec<(String, i64)> {
    let pattern = BranchPattern::new(&state.config.branch_pattern).ok();
    state
        .config
        .repositories
        .iter()
        .filter(|repo| repo.enabled)
        .filter_map(|repo| {
            let branch = state.session.branches.snapshots.get(&repo.id)?.branch.as_deref()?;
            if BranchPolicy::suggests_break(branch) {
                return None;
            }
            let ticket = pattern.as_ref()?.extract(branch).ok().flatten()?;
            Some((repo.name().to_string(), ticket))
        })
        .collect()
}
