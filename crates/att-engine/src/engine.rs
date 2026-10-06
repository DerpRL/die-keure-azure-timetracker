//! The engine handle: state access, publishing, persistence, the main loop and the tray ticker.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::Duration;

use jiff::Timestamp;
use serde_json::Value;
use tokio::sync::Notify;

use att_core::Cal;
use att_core::git::{AUDIT_LIMIT, AuditEntry};

use crate::clients::Clients;
use crate::guard::{Busy, Generation};
use crate::ipc::IpcError;
use crate::publish::{Publisher, SliceSink, SliceUpdate};
use crate::services::Services;
use crate::shell::TrayStatus;
use crate::state::AppState;
use crate::{controllers, intent, session};

/// Delay that coalesces bursts of state changes into one publish.
const PUBLISH_COALESCE: Duration = Duration::from_millis(16);

/// A cheap, cloneable handle to the engine.
#[derive(Clone)]
pub struct Engine {
    pub(crate) inner: Arc<Inner>,
}

pub(crate) struct Inner {
    pub(crate) services: Services,
    state: Mutex<AppState>,
    publisher: Publisher,
    publish_pending: AtomicBool,
    /// Serializes remote writes (Swift `busy`).
    pub(crate) busy: Busy,
    /// Bumped by every connect/disconnect (Swift `connectionGeneration`).
    pub(crate) connection: Generation,
    clients: RwLock<Option<Arc<Clients>>>,
    /// Wakes the main loop before its next tick (after settings changes, wake from sleep, …).
    pub(crate) wake: Notify,
    started: AtomicBool,
    last_tray: Mutex<Option<TrayStatus>>,
}

impl Engine {
    /// Loads persisted state (importing 1.14.x data first when present). Does not start the loop.
    pub fn new(services: Services) -> Result<Self, IpcError> {
        let mut state = AppState { can_persist: true, ..AppState::default() };
        crate::persist::load(&services, &mut state);
        Ok(Self {
            inner: Arc::new(Inner {
                services,
                state: Mutex::new(state),
                publisher: Publisher::default(),
                publish_pending: AtomicBool::new(false),
                busy: Busy::default(),
                connection: Generation::default(),
                clients: RwLock::new(None),
                wake: Notify::new(),
                started: AtomicBool::new(false),
                last_tray: Mutex::new(None),
            }),
        })
    }

    /// Starts the main loop and the tray ticker on the current Tokio runtime. Idempotent.
    pub fn start(&self) {
        if self.inner.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let engine = self.clone();
        tokio::spawn(async move { engine.run_loop().await });
        let engine = self.clone();
        tokio::spawn(async move { engine.run_tray_ticker().await });
    }

    /// Handles one UI intent: `{ "type": "<namespace>.<name>", …args }`.
    pub async fn dispatch(&self, intent: Value) -> Result<Value, IpcError> {
        let intent = intent::parse(intent)?;
        let result = intent::route(self, intent).await;
        self.changed();
        result
    }

    /// Every slice, for a new UI subscriber.
    pub fn snapshot(&self) -> Vec<SliceUpdate> {
        let now = self.now();
        self.read(|state| crate::view::slices(self, state, now))
            .into_iter()
            .map(|(name, value)| SliceUpdate { name, value })
            .collect()
    }

    /// Sends every slice again through the sink, in order with the regular updates. A window
    /// that just loaded subscribes to the slice event, then calls this, so it can neither miss
    /// an update nor apply an older snapshot over a newer update.
    pub fn resync(&self) {
        self.inner.publisher.reset();
        self.publish_now();
    }

    /// The current settings, for the desktop shell (mini timer, shortcut).
    pub fn configuration(&self) -> att_core::Configuration {
        self.read(|state| state.config.clone())
    }

    /// Where changed slices go (the Tauri app forwards them as `engine://slices`).
    pub fn set_sink(&self, sink: SliceSink) {
        self.inner.publisher.set_sink(sink);
        self.publish_now();
    }

    // -- State ----------------------------------------------------------------------------

    fn lock(&self) -> MutexGuard<'_, AppState> {
        // A panic while holding the lock leaves plain data behind; keep serving it.
        self.inner.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Reads state. Never hold the result across an `.await`.
    pub(crate) fn read<R>(&self, f: impl FnOnce(&AppState) -> R) -> R {
        f(&self.lock())
    }

    /// Mutates state and schedules a publish.
    pub(crate) fn update<R>(&self, f: impl FnOnce(&mut AppState) -> R) -> R {
        let result = f(&mut self.lock());
        self.changed();
        result
    }

    pub(crate) fn services(&self) -> &Services {
        &self.inner.services
    }

    pub(crate) fn now(&self) -> Timestamp {
        self.inner.services.clock.now()
    }

    pub(crate) fn cal(&self) -> Cal {
        self.inner.services.clock.cal()
    }

    pub(crate) fn preview(&self) -> bool {
        self.inner.services.preview
    }

    // -- Connection -------------------------------------------------------------------------

    pub(crate) fn clients(&self) -> Option<Arc<Clients>> {
        self.inner.clients.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Replaces the clients and returns the new connection generation.
    pub(crate) fn set_clients(&self, clients: Option<Clients>) -> u64 {
        let generation = self.inner.connection.bump();
        let clients = clients.map(|mut c| {
            c.generation = generation;
            Arc::new(c)
        });
        *self.inner.clients.write().unwrap_or_else(|e| e.into_inner()) = clients;
        generation
    }

    pub(crate) fn connection_generation(&self) -> u64 {
        self.inner.connection.current()
    }

    // -- Publishing and persistence ---------------------------------------------------------

    /// Schedules one publish shortly after a burst of changes.
    pub(crate) fn changed(&self) {
        if self.inner.publish_pending.swap(true, Ordering::SeqCst) {
            return;
        }
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => {
                let engine = self.clone();
                handle.spawn(async move {
                    tokio::time::sleep(PUBLISH_COALESCE).await;
                    engine.publish_now();
                });
            }
            Err(_) => self.publish_now(),
        }
    }

    /// Computes every slice and emits the ones whose JSON changed.
    pub(crate) fn publish_now(&self) {
        self.inner.publish_pending.store(false, Ordering::SeqCst);
        let now = self.now();
        let slices = self.read(|state| crate::view::slices(self, state, now));
        self.inner.publisher.publish(slices);
    }

    /// Writes every changed document. Returns an error the caller must handle where Swift
    /// required a durable save before continuing (idle review, journal checkpoints, …).
    pub(crate) fn persist(&self) -> Result<(), IpcError> {
        if self.preview() {
            return Ok(());
        }
        let result = self.read(|state| crate::persist::save(&self.inner.services, state));
        if let Err(error) = &result {
            let message = format!("Could not save local settings: {}", error.message);
            self.update(|state| state.storage_issue = Some(message));
        }
        result
    }

    /// Records an App activity entry (Swift `record`).
    pub(crate) fn record(&self, title: impl Into<String>, detail: impl Into<String>) {
        let entry = AuditEntry::new(title, detail, self.now());
        self.update(|state| {
            state.audit.insert(0, entry.clone());
            state.audit.truncate(AUDIT_LIMIT);
        });
        if !self.preview()
            && self.read(|state| state.can_persist)
            && let Err(error) = self.inner.services.store.append_audit(&entry, AUDIT_LIMIT)
        {
            tracing::warn!("could not save app activity: {error}");
        }
    }

    // -- Loops ------------------------------------------------------------------------------

    async fn run_loop(&self) {
        session::start(self).await;
        loop {
            session::tick(self).await;
            controllers::tick(self).await;
            let _ = self.persist();
            self.publish_now();
            let seconds = self.read(|state| state.config.cadences.probe_seconds).clamp(1, 10);
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(u64::from(seconds))) => {}
                _ = self.inner.wake.notified() => {}
            }
        }
    }

    /// Updates the tray once per second; calls the shell only when the text or state changed.
    async fn run_tray_ticker(&self) {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let now = self.now();
            let status = self.read(|state| session::tray_status(state, now));
            let mut last = self.inner.last_tray.lock().unwrap_or_else(|e| e.into_inner());
            if last.as_ref() != Some(&status) {
                self.inner.services.shell.set_tray(&status);
                *last = Some(status);
            }
        }
    }
}
