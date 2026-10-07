//! Branch changes by file events (rewrite plan §16): the Git directory of every watched
//! repository is observed (FSEvents on macOS, ReadDirectoryChangesW on Windows, through
//! `notify`). A change to HEAD reads the repositories at once and again [`CONFIRM`] later, the
//! two matching readings the branch debouncer needs, so a checkout is usually confirmed within a
//! second. The scan on the probe interval stays as the fallback (events can be missed, for
//! example on network drives) and pauses while a burst runs.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;

use att_core::git::GitProbe;

use super::branches;
use crate::engine::Engine;
use crate::probes::{PROBE_DEADLINE, blocking};

/// The events of one checkout arrive together; they lead to one reading.
const COALESCE: Duration = Duration::from_millis(100);
/// The confirming reading follows the first after this pause.
const CONFIRM: Duration = Duration::from_millis(400);

/// The watcher and what it watches. Created on the first reconcile with repositories.
#[derive(Default)]
pub(crate) struct HeadWatch {
    /// The repository roots of the last reconcile (`None` before the first).
    roots: Option<Vec<PathBuf>>,
    /// Wakes the burst task; set with the task.
    events: Option<mpsc::UnboundedSender<()>>,
    watching: Arc<Mutex<Option<Watching>>>,
    /// A burst is reading: the probe-interval scan waits.
    pub(crate) burst: bool,
}

struct Watching {
    watcher: RecommendedWatcher,
    dirs: BTreeSet<PathBuf>,
}

/// Follows the watched repositories: watches the Git directory of each enabled one while
/// watching is on, and nothing otherwise. Cheap when nothing changed.
pub(crate) async fn reconcile(engine: &Engine) {
    if !engine.services().file_events {
        return;
    }
    let roots = engine.read(|state| {
        let wanted: Vec<PathBuf> = if state.config.watch_enabled {
            state
                .config
                .repositories
                .iter()
                .filter(|repo| repo.enabled)
                .map(|repo| PathBuf::from(&repo.path))
                .collect()
        } else {
            Vec::new()
        };
        (state.session.branches.watch.roots.as_ref() != Some(&wanted)).then_some(wanted)
    });
    let Some(roots) = roots else { return };
    let (events, watching) = engine.update(|state| {
        let watch = &mut state.session.branches.watch;
        watch.roots = Some(roots.clone());
        (watch.events.clone(), watch.watching.clone())
    });
    let events = match events {
        Some(events) => events,
        None => {
            let (sender, receiver) = mpsc::unbounded_channel();
            tokio::spawn(bursts(engine.clone(), receiver));
            engine.update(|state| state.session.branches.watch.events = Some(sender.clone()));
            sender
        }
    };
    // Resolving `.git` pointer files and registering watches touch the disk.
    let applied = blocking(PROBE_DEADLINE, move || apply(&watching, &roots, events)).await;
    if applied.is_none() {
        // Try again on the next tick.
        engine.update(|state| state.session.branches.watch.roots = None);
    }
}

/// Watches exactly the Git directories of `roots` (those that resolve).
fn apply(watching: &Mutex<Option<Watching>>, roots: &[PathBuf], events: mpsc::UnboundedSender<()>) {
    let dirs: BTreeSet<PathBuf> =
        roots.iter().filter_map(|root| GitProbe::git_dir(root).ok()).collect();
    let mut guard = watching.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if guard.is_none() {
        if dirs.is_empty() {
            return;
        }
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if event.is_ok_and(|event| touches_head(&event)) {
                let _ = events.send(());
            }
        });
        match watcher {
            Ok(watcher) => *guard = Some(Watching { watcher, dirs: BTreeSet::new() }),
            Err(error) => {
                tracing::warn!(%error, "file events are unavailable; branches are polled");
                return;
            }
        }
    }
    let Some(watching) = guard.as_mut() else { return };
    let gone: Vec<PathBuf> = watching.dirs.difference(&dirs).cloned().collect();
    for dir in gone {
        let _ = watching.watcher.unwatch(&dir);
        watching.dirs.remove(&dir);
    }
    for dir in dirs {
        if watching.dirs.contains(&dir) {
            continue;
        }
        match watching.watcher.watch(&dir, RecursiveMode::NonRecursive) {
            Ok(()) => {
                watching.dirs.insert(dir);
            }
            Err(error) => tracing::warn!(%error, dir = %dir.display(), "could not watch HEAD"),
        }
    }
}

/// A write, rename or removal of a `HEAD` file (not `ORIG_HEAD`, `FETCH_HEAD` or reads).
fn touches_head(event: &notify::Event) -> bool {
    !matches!(event.kind, EventKind::Access(_))
        && event.paths.iter().any(|path| path.file_name().is_some_and(|name| name == "HEAD"))
}

/// Reads after HEAD events: once after [`COALESCE`], then again after each [`CONFIRM`] pause
/// until no new event arrived during it, so the last state always gets its second reading.
async fn bursts(engine: Engine, mut events: mpsc::UnboundedReceiver<()>) {
    while events.recv().await.is_some() {
        engine.update(|state| state.session.branches.watch.burst = true);
        tokio::time::sleep(COALESCE).await;
        drain(&mut events);
        branches::scan(&engine).await;
        loop {
            tokio::time::sleep(CONFIRM).await;
            let changed = drain(&mut events);
            branches::scan(&engine).await;
            if !changed {
                break;
            }
        }
        engine.update(|state| state.session.branches.watch.burst = false);
    }
}

/// Empties the queue; whether anything was in it.
fn drain(events: &mut mpsc::UnboundedReceiver<()>) -> bool {
    let mut any = false;
    while events.try_recv().is_ok() {
        any = true;
    }
    any
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(kind: EventKind, path: &str) -> notify::Event {
        notify::Event::new(kind).add_path(PathBuf::from(path))
    }

    #[test]
    fn only_head_writes_count() {
        use notify::event::{AccessKind, CreateKind, ModifyKind, RenameMode};
        assert!(touches_head(&event(EventKind::Modify(ModifyKind::Any), "/r/.git/HEAD")));
        assert!(touches_head(&event(
            EventKind::Modify(ModifyKind::Name(RenameMode::To)),
            "/r/.git/HEAD"
        )));
        assert!(touches_head(&event(EventKind::Create(CreateKind::File), "/r/.git/HEAD")));
        assert!(!touches_head(&event(EventKind::Access(AccessKind::Any), "/r/.git/HEAD")));
        assert!(!touches_head(&event(EventKind::Modify(ModifyKind::Any), "/r/.git/ORIG_HEAD")));
        assert!(!touches_head(&event(EventKind::Modify(ModifyKind::Any), "/r/.git/HEAD.lock")));
        assert!(!touches_head(&event(EventKind::Modify(ModifyKind::Any), "/r/.git/index")));
    }
}
