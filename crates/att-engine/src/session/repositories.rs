//! Repositories (Swift AppModel L257–262, L1081–1108, `RepositoryImportView`): first-run
//! discovery, folder scans on the blocking pool with cancellation, adding, enabling, removing
//! and pausing watching.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use uuid::Uuid;

use att_core::AppError;
use att_core::discovery::{DiscoveredRepository, RepositoryDiscovery};
use att_core::git::{BranchDebouncer, GitProbe};
use att_core::model::Repository;

use crate::engine::Engine;

use super::{branches, figma, update_with};

#[derive(Default)]
pub(crate) struct ScanState {
    pub scanning: bool,
    pub root: Option<String>,
    pub results: Vec<DiscoveredRepository>,
    /// `"<path>: <reason>"` for folders that could not be read.
    pub issues: Vec<String>,
    pub error: Option<String>,
    pub generation: u64,
    pub cancel: Option<Arc<AtomicBool>>,
}

/// Swift `discoverRepositories()`: the immediate children of `root` that contain `.git`,
/// hidden folders skipped, sorted by name.
pub(crate) fn discover(root: &Path) -> Vec<Repository> {
    let Ok(entries) = std::fs::read_dir(root) else { return Vec::new() };
    let mut folders: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .map(|entry| entry.path())
        .filter(|path| path.join(".git").exists())
        .collect();
    folders.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    folders.into_iter().map(|path| Repository::new(path.to_string_lossy().into_owned())).collect()
}

/// `~/Documents/repositories`, the 1.14.x first-run discovery root.
fn discovery_root() -> Option<PathBuf> {
    std::env::home_dir().map(|home| home.join("Documents").join("repositories"))
}

/// First run (no settings existed): add the discovered repositories in the background.
/// Documents access can wait for an OS permission dialog, so it never blocks the start.
pub(crate) fn spawn_first_run_discovery(engine: &Engine) {
    let Some(root) = discovery_root() else { return };
    let Ok(handle) = tokio::runtime::Handle::try_current() else { return };
    let engine = engine.clone();
    handle.spawn(async move {
        let Ok(found) = tokio::task::spawn_blocking(move || discover(&root)).await else { return };
        engine.update(|state| {
            for repository in found {
                if !state.config.repositories.iter().any(|known| known.path == repository.path) {
                    state.config.repositories.push(repository);
                }
            }
        });
        let _ = engine.persist();
    });
}

/// `repositories.scan`: scans a folder; results arrive in the `repositories` slice. A new
/// scan or `repositories.cancelScan` cancels the previous one.
pub(crate) async fn scan(engine: &Engine, path: String) {
    let cancel = Arc::new(AtomicBool::new(false));
    let generation = engine.update(|state| {
        let scan = &mut state.session.scan;
        if let Some(previous) = scan.cancel.replace(cancel.clone()) {
            previous.store(true, Ordering::SeqCst);
        }
        scan.generation += 1;
        scan.scanning = true;
        scan.root = Some(path.clone());
        scan.results.clear();
        scan.issues.clear();
        scan.error = None;
        scan.generation
    });
    let flag = cancel.clone();
    let result = tokio::task::spawn_blocking(move || {
        RepositoryDiscovery::scan(&path, || flag.load(Ordering::SeqCst))
    })
    .await
    .unwrap_or_else(|error| Err(AppError::Message(error.to_string())));
    engine.update(|state| {
        let scan = &mut state.session.scan;
        if scan.generation != generation {
            return;
        }
        scan.scanning = false;
        scan.cancel = None;
        match result {
            Ok(found) => {
                scan.results = found.repositories;
                scan.issues = found.issues;
            }
            // Closing the sheet cancels the scan.
            Err(AppError::Cancelled) => scan.root = None,
            Err(error) => scan.error = Some(error.to_string()),
        }
    });
}

/// `repositories.cancelScan`.
pub(crate) fn cancel_scan(engine: &Engine) {
    engine.update(|state| {
        let scan = &mut state.session.scan;
        if let Some(cancel) = scan.cancel.take() {
            cancel.store(true, Ordering::SeqCst);
        }
        scan.generation += 1;
        scan.scanning = false;
        scan.root = None;
        scan.results.clear();
        scan.issues.clear();
        scan.error = None;
    });
}

/// Swift `addRepositories(_:)`: every path must be a readable repository; new roots are added
/// by canonical path, never duplicated and without enabling paused ones.
pub(crate) async fn add(engine: &Engine, paths: Vec<String>) {
    let existing = engine.read(|state| state.config.repositories.clone());
    let result = tokio::task::spawn_blocking(move || {
        let mut valid = Vec::new();
        let mut error = None;
        for path in paths {
            match GitProbe::read(&path) {
                Ok(_) => valid.push(path),
                Err(failure) => error = Some(failure.to_string()),
            }
        }
        let added: Vec<Repository> = RepositoryDiscovery::adding(valid, &existing)
            .into_iter()
            .filter(|repository| !existing.iter().any(|known| known.id == repository.id))
            .collect();
        (added, error)
    })
    .await;
    let Ok((added, error)) = result else { return };
    engine.update(|state| {
        // Keep changes made while the paths were checked; add only the new roots.
        for repository in added {
            if !state.config.repositories.iter().any(|known| known.path == repository.path) {
                state.config.repositories.push(repository);
            }
        }
        if let Some(error) = error {
            state.session.error = Some(error);
        }
    });
}

/// Swift `setRepository(_:enabled:)`.
pub(crate) fn set_enabled(engine: &Engine, id: Uuid, enabled: bool) {
    update_with(engine, |state, effects| {
        let Some(repository) = state.config.repositories.iter_mut().find(|repo| repo.id == id)
        else {
            return;
        };
        repository.enabled = enabled;
        if !enabled {
            branches::clear_suggestions(state, id, effects);
        }
    });
}

/// Swift `removeRepository(_:)`: the folder itself is untouched.
pub(crate) fn remove(engine: &Engine, id: Uuid) {
    update_with(engine, |state, effects| {
        state.config.repositories.retain(|repo| repo.id != id);
        state.session.branches.snapshots.remove(&id);
        state.session.branches.errors.remove(&id);
        branches::clear_suggestions(state, id, effects);
    });
}

/// Swift `toggleWatching()`: pauses or resumes Git and Figma observation.
pub(crate) fn toggle_watching(engine: &Engine) {
    update_with(engine, |state, effects| {
        state.config.watch_enabled = !state.config.watch_enabled;
        if !state.config.watch_enabled {
            branches::clear_all(state, effects);
        }
        state.session.branches.debouncer = BranchDebouncer::new();
    });
    figma::configure(engine);
}
