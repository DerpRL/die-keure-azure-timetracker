//! Shared fakes and helpers for the session tests: an in-memory 7pace server, Azure and the
//! PIN pairing endpoints, and a harness around `att_engine::testing::TestEngine`.
//!
//! The harness never reads the machine's 1.14.x data: the store is marked as imported before
//! the engine opens it, so `Engine::new` skips the legacy importer.

#![allow(dead_code)]

use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use jiff::Timestamp;
use serde_json::{Value, json};
use tokio::sync::Semaphore;

use att_core::attention::TrackingAttention;
use att_core::config::SevenPaceAuthMode;
use att_core::model::{
    ActivityType, Repository, Track, TrackingState, WireValue, WorkItem, WorkLog,
};
use att_core::service::{
    OfflineDraftService, TrackingService, WorkLogEditingService, WorkLogMutationService,
};
use att_core::ticket::TicketWorkflowStatus;
use att_core::ticket_context::TicketContext;
use att_core::worklog::{WorkLogDraft, WorkLogTimeEdit};
use att_core::{AppError, Configuration, Result};
use att_engine::clients::{AzureClient, Clients, PairingClient, SevenPaceClient};
use att_engine::testing::TestEngine;
use att_net::{SevenPacePin, SevenPacePinStatus, SevenPaceTokens};
use att_store::Store;

pub const WORKSPACE: &str = "https://contoso.timehub.7pace.com";
pub const HOST: &str = "contoso.timehub.7pace.com";

/// A track as 7pace reports it.
pub fn track(
    ticket: Option<i64>,
    activity: Option<&str>,
    remark: Option<&str>,
    log: &str,
    started: &str,
) -> Track {
    let mut track = Track::with_state(WireValue::text("Tracking"));
    track.tfs_id = ticket;
    track.activity_type_id = activity.map(str::to_string);
    track.remark = remark.map(str::to_string);
    track.work_log_id = Some(log.to_string());
    track.current_track_started_date_time = Some(started.to_string());
    track.current_track_length = Some(600.0);
    track
}

pub fn running(ticket: Option<i64>, activity: Option<&str>, remark: Option<&str>) -> TrackingState {
    TrackingState::with_track(track(ticket, activity, remark, "wl-0", "2026-10-06T09:50:00"))
}

pub fn idle() -> TrackingState {
    TrackingState::with_track(Track::with_state(WireValue::text("Idle")))
}

/// A server-side stop at the single-track limit (an attention prompt).
pub fn stopped_at_limit(ticket: i64) -> TrackingState {
    let mut track = Track::with_state(WireValue::text("Idle"));
    track.tfs_id = Some(ticket);
    track.activity_type_id = Some("dev".into());
    track.work_log_id = Some("wl-limit".into());
    track.current_track_started_date_time = Some("2026-10-06T01:00:00".into());
    track.track_status_change_date = Some("2026-10-06T09:00:00".into());
    track.stopped_track_type = Some(WireValue::text("StoppedByMaxSingleTrackLengthExceeded"));
    TrackingState::with_track(track)
}

pub fn activities() -> Vec<ActivityType> {
    vec![
        ActivityType::new("dev", "Development"),
        ActivityType::new("design", "Design"),
        ActivityType::new("meeting", "Meeting"),
        ActivityType::new("standup", "Standup"),
    ]
}

/// The in-memory 7pace server.
pub struct Server {
    pub current: TrackingState,
    pub calls: Vec<String>,
    pub next_log: u32,
    pub fail_start: Option<AppError>,
    pub fail_stop: Option<AppError>,
    /// Failures returned by the next `current()` calls, in order.
    pub fail_current: VecDeque<AppError>,
    /// States returned by the next `current()` calls instead of `current`, in order.
    pub scripted_current: VecDeque<TrackingState>,
    pub activity_types: Vec<ActivityType>,
    pub logs: Vec<WorkLog>,
    pub search: BTreeMap<String, Vec<WorkItem>>,
}

pub struct FakeSevenPace {
    pub server: Mutex<Server>,
    /// When set, `current()` waits for a permit (stale-result tests).
    pub gate: Mutex<Option<Arc<Semaphore>>>,
    /// Per query: `search(query)` waits for a permit.
    pub search_gates: Mutex<BTreeMap<String, Arc<Semaphore>>>,
}

impl Default for FakeSevenPace {
    fn default() -> Self {
        Self {
            server: Mutex::new(Server {
                current: idle(),
                calls: Vec::new(),
                next_log: 1,
                fail_start: None,
                fail_stop: None,
                fail_current: VecDeque::new(),
                scripted_current: VecDeque::new(),
                activity_types: activities(),
                logs: Vec::new(),
                search: BTreeMap::new(),
            }),
            gate: Mutex::new(None),
            search_gates: Mutex::new(BTreeMap::new()),
        }
    }
}

impl FakeSevenPace {
    pub fn set_current(&self, state: TrackingState) {
        self.server.lock().unwrap().current = state;
    }

    pub fn current_state(&self) -> TrackingState {
        self.server.lock().unwrap().current.clone()
    }

    /// Calls since the last `take_calls`.
    pub fn take_calls(&self) -> Vec<String> {
        std::mem::take(&mut self.server.lock().unwrap().calls)
    }

    pub fn writes(&self) -> Vec<String> {
        self.server
            .lock()
            .unwrap()
            .calls
            .iter()
            .filter(|call| {
                call.starts_with("start") || call.starts_with("stop") || call.starts_with("confirm")
            })
            .cloned()
            .collect()
    }

    fn call(&self, name: String) {
        self.server.lock().unwrap().calls.push(name);
    }
}

#[async_trait]
impl TrackingService for FakeSevenPace {
    async fn current(&self) -> Result<TrackingState> {
        let gate = self.gate.lock().unwrap().clone();
        if let Some(gate) = gate {
            let _permit = gate.acquire().await.expect("gate");
        }
        let mut server = self.server.lock().unwrap();
        server.calls.push("current".into());
        if let Some(error) = server.fail_current.pop_front() {
            return Err(error);
        }
        if let Some(state) = server.scripted_current.pop_front() {
            return state.checked();
        }
        server.current.clone().checked()
    }

    async fn start(
        &self,
        ticket_id: Option<i64>,
        activity_type: Option<&str>,
        remark: Option<&str>,
    ) -> Result<TrackingState> {
        let mut server = self.server.lock().unwrap();
        server.calls.push(format!("start({ticket_id:?},{activity_type:?},{remark:?})"));
        if let Some(error) = server.fail_start.take() {
            return Err(error);
        }
        let log = format!("wl-{}", server.next_log);
        let started = format!("2026-10-06T10:{:02}:00", server.next_log);
        server.next_log += 1;
        let mut started_track = track(ticket_id, activity_type, remark, &log, &started);
        started_track.current_track_length = Some(0.0);
        server.current = TrackingState::with_track(started_track);
        Ok(server.current.clone())
    }

    async fn stop(&self) -> Result<TrackingState> {
        let mut server = self.server.lock().unwrap();
        server.calls.push("stop".into());
        if let Some(error) = server.fail_stop.take() {
            return Err(error);
        }
        server.current = idle();
        Ok(server.current.clone())
    }
}

#[async_trait]
impl WorkLogEditingService for FakeSevenPace {
    async fn current_tracking(&self) -> Result<TrackingState> {
        self.current().await
    }
    async fn work_log(&self, _id: &str) -> Result<WorkLog> {
        Err(AppError::NotFound)
    }
    async fn work_logs_before(&self, _end: Timestamp) -> Result<Vec<WorkLog>> {
        Ok(self.server.lock().unwrap().logs.clone())
    }
    async fn update_work_log_time(&self, _id: &str, _edit: &WorkLogTimeEdit) -> Result<WorkLog> {
        Err(AppError::message("Not supported by the fake."))
    }
}

#[async_trait]
impl WorkLogMutationService for FakeSevenPace {
    async fn find_work_log(&self, _id: &str) -> Result<Option<WorkLog>> {
        Ok(None)
    }
    async fn create_work_log(&self, _draft: &WorkLogDraft) -> Result<WorkLog> {
        Err(AppError::message("Not supported by the fake."))
    }
    async fn replace_work_log_time(&self, _id: &str, _draft: &WorkLogDraft) -> Result<WorkLog> {
        Err(AppError::message("Not supported by the fake."))
    }
    async fn delete_work_log(&self, _id: &str) -> Result<()> {
        Err(AppError::message("Not supported by the fake."))
    }
}

#[async_trait]
impl OfflineDraftService for FakeSevenPace {
    async fn activity_types(&self) -> Result<Vec<ActivityType>> {
        self.call("activityTypes".into());
        Ok(self.server.lock().unwrap().activity_types.clone())
    }
}

#[async_trait]
impl SevenPaceClient for FakeSevenPace {
    async fn confirm_activity(
        &self,
        expected: Option<&TrackingAttention>,
    ) -> Result<TrackingState> {
        let mut server = self.server.lock().unwrap();
        server.calls.push(format!("confirm({:?})", expected.map(|prompt| prompt.id.clone())));
        if let Some(track) = server.current.track.as_mut() {
            track.activity_check = None;
            track.tracking_state = WireValue::text("Tracking");
        }
        Ok(server.current.clone())
    }

    async fn search(&self, query: &str) -> Result<Vec<WorkItem>> {
        let gate = self.search_gates.lock().unwrap().get(query).cloned();
        if let Some(gate) = gate {
            let _permit = gate.acquire().await.expect("gate");
        }
        let mut server = self.server.lock().unwrap();
        server.calls.push(format!("search({query})"));
        Ok(server.search.get(query).cloned().unwrap_or_default())
    }

    async fn work_logs(
        &self,
        _from: Option<Timestamp>,
        _to: Timestamp,
        _include_editable: bool,
    ) -> Result<Vec<WorkLog>> {
        let mut server = self.server.lock().unwrap();
        server.calls.push("workLogs".into());
        Ok(server.logs.clone())
    }
}

/// Azure DevOps: titles, workflow states.
#[derive(Default)]
pub struct FakeAzure {
    pub items: Mutex<BTreeMap<i64, WorkItem>>,
    pub workflow: Mutex<BTreeMap<i64, TicketWorkflowStatus>>,
    /// Returned by every work item request when set.
    pub error: Mutex<Option<AppError>>,
    pub calls: Mutex<Vec<String>>,
    /// When set, batch title requests wait for a permit.
    pub gate: Mutex<Option<Arc<Semaphore>>>,
}

impl FakeAzure {
    pub fn with_items(items: &[(i64, &str)]) -> Self {
        let azure = Self::default();
        for (id, title) in items {
            azure.items.lock().unwrap().insert(*id, WorkItem::new(*id, *title));
        }
        azure
    }

    pub fn complete(&self, id: i64, title: &str, state: &str, category: &str) {
        self.workflow.lock().unwrap().insert(
            id,
            TicketWorkflowStatus {
                ticket_id: id,
                title: title.into(),
                state: state.into(),
                category: category.into(),
            },
        );
    }
}

#[async_trait]
impl AzureClient for FakeAzure {
    async fn ticket_workflow(&self, id: i64) -> Result<TicketWorkflowStatus> {
        self.calls.lock().unwrap().push(format!("workflow({id})"));
        self.workflow.lock().unwrap().get(&id).cloned().ok_or(AppError::NotFound)
    }

    async fn ticket_context(&self, _id: i64) -> Result<TicketContext> {
        Err(AppError::NotFound)
    }

    async fn work_item(&self, id: i64) -> Result<WorkItem> {
        self.calls.lock().unwrap().push(format!("workItem({id})"));
        if let Some(error) = self.error.lock().unwrap().clone() {
            return Err(error);
        }
        self.items.lock().unwrap().get(&id).cloned().ok_or_else(|| {
            AppError::Message(format!("Azure ticket #{id} was not found or is not accessible."))
        })
    }

    async fn work_items(&self, ids: &[i64]) -> Result<Vec<WorkItem>> {
        self.calls.lock().unwrap().push(format!("workItems({ids:?})"));
        let gate = self.gate.lock().unwrap().clone();
        if let Some(gate) = gate {
            let _permit = gate.acquire().await.expect("gate");
        }
        if let Some(error) = self.error.lock().unwrap().clone() {
            return Err(error);
        }
        let items = self.items.lock().unwrap();
        Ok(ids.iter().filter_map(|id| items.get(id).cloned()).collect())
    }
}

/// The unauthenticated PIN endpoints.
pub struct FakePairing {
    pub statuses: Mutex<VecDeque<SevenPacePinStatus>>,
    pub calls: Mutex<Vec<String>>,
}

impl FakePairing {
    pub fn new(statuses: &[SevenPacePinStatus]) -> Self {
        Self { statuses: Mutex::new(statuses.iter().copied().collect()), calls: Mutex::default() }
    }
}

#[async_trait]
impl PairingClient for FakePairing {
    async fn create_pin(&self) -> Result<SevenPacePin> {
        self.calls.lock().unwrap().push("createPin".into());
        Ok(serde_json::from_value(json!({"pin": "482913", "secret": "s3cret"})).expect("pin"))
    }

    async fn status(&self, secret: &str) -> Result<SevenPacePinStatus> {
        self.calls.lock().unwrap().push(format!("status({secret})"));
        Ok(self.statuses.lock().unwrap().pop_front().unwrap_or(SevenPacePinStatus::Waiting))
    }

    async fn exchange(&self, secret: &str) -> Result<SevenPaceTokens> {
        self.calls.lock().unwrap().push(format!("exchange({secret})"));
        Ok(SevenPaceTokens {
            access_token: "access".into(),
            refresh_token: "refresh".into(),
            expires_at: "2026-10-06T09:00:00Z".parse().expect("timestamp"),
        })
    }
}

/// A temporary folder removed on drop.
pub struct TempDir(pub PathBuf);

impl TempDir {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join(format!("att-session-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("temp dir");
        Self(path)
    }

    /// A Git working tree named `name` on `branch`.
    pub fn repository(&self, name: &str, branch: &str) -> PathBuf {
        let root = self.0.join(name);
        std::fs::create_dir_all(root.join(".git")).expect("repository");
        set_branch(&root, branch);
        root
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub fn set_branch(root: &Path, branch: &str) {
    std::fs::write(root.join(".git/HEAD"), format!("ref: refs/heads/{branch}\n")).expect("HEAD");
}

/// Settings of a configured user (onboarding done) for `TestEngine`.
pub fn configuration(repositories: Vec<Repository>) -> Configuration {
    Configuration {
        organization: "contoso".into(),
        seven_pace_url: WORKSPACE.into(),
        seven_pace_auth_mode: SevenPaceAuthMode::ApiToken,
        repositories,
        interface_setup_completed: Some(true),
        // `TestEngine` runs as macOS everywhere, so its work apps are the macOS bundle IDs (the
        // default follows the OS the tests are built for).
        awareness: att_core::awareness::WorkAwarenessPreferences::default_for(
            att_core::model::HostOs::Macos,
        ),
        // Prompts open the panel without focus by default; tests check the shell calls.
        ..Configuration::default()
    }
}

/// A store whose 1.14.x import already ran, so the engine never reads this machine's data.
pub fn store() -> Arc<Store> {
    let store = Store::open_in_memory().expect("store");
    store.set_meta(att_store::legacy::IMPORTED_META, "test").expect("meta");
    Arc::new(store)
}

pub struct Harness {
    pub t: TestEngine,
    pub seven_pace: Arc<FakeSevenPace>,
    pub azure: Arc<FakeAzure>,
}

impl Harness {
    /// A configured engine with fake clients installed (not connected yet).
    pub fn new(config: Configuration) -> Self {
        Self::with_store(store(), config)
    }

    pub fn with_store(store: Arc<Store>, config: Configuration) -> Self {
        store.put(att_store::keys::CONFIGURATION, &config).expect("configuration");
        Self::with_engine(TestEngine::with_store(store))
    }

    /// Like [`new`](Self::new), also watching repository HEAD files with real file events.
    pub fn with_file_events(config: Configuration) -> Self {
        let store = store();
        store.put(att_store::keys::CONFIGURATION, &config).expect("configuration");
        Self::with_engine(TestEngine::with_file_events(store))
    }

    fn with_engine(t: TestEngine) -> Self {
        let seven_pace = Arc::new(FakeSevenPace::default());
        let azure = Arc::new(FakeAzure::with_items(&[
            (33984, "Improve loading"),
            (4790, "Invoice VAT number"),
            (4821, "Card retry"),
        ]));
        let harness = Self { t, seven_pace, azure };
        harness.install_clients();
        harness
    }

    pub fn install_clients(&self) {
        let seven_pace: Arc<dyn SevenPaceClient> = self.seven_pace.clone();
        let azure: Arc<dyn AzureClient> = self.azure.clone();
        *self.t.clients.clients.lock().unwrap() = Some(Clients {
            generation: 0,
            workspace: WORKSPACE.to_lowercase(),
            host: HOST.into(),
            seven_pace,
            azure: Some(azure),
        });
    }

    pub fn engine(&self) -> &att_engine::Engine {
        &self.t.engine
    }

    /// `session::start`: the first connect, as at launch.
    pub async fn start(&self) {
        att_engine::session::start(self.engine()).await;
        settle().await;
    }

    pub async fn tick(&self) {
        att_engine::session::tick(self.engine()).await;
        settle().await;
    }

    pub async fn dispatch(
        &self,
        intent: Value,
    ) -> std::result::Result<Value, att_engine::IpcError> {
        let result = self.engine().dispatch(intent).await;
        settle().await;
        result
    }

    /// Dispatches and expects success.
    pub async fn ok(&self, intent: Value) -> Value {
        let description = intent.to_string();
        self.dispatch(intent).await.unwrap_or_else(|error| panic!("{description}: {error:?}"))
    }

    pub fn slice(&self, name: &str) -> Value {
        slice(self.engine(), name)
    }

    pub fn shell(&self) -> Vec<String> {
        self.t.shell.take()
    }

    pub fn advance(&self, seconds: f64) {
        self.t.clock.advance(seconds);
    }
}

/// One slice of the engine's snapshot.
pub fn slice(engine: &att_engine::Engine, name: &str) -> Value {
    engine
        .snapshot()
        .into_iter()
        .find(|update| update.name == name)
        .map(|update| update.value)
        .unwrap_or_else(|| panic!("no slice {name}"))
}

/// Lets spawned background work (title loads, pairing) run.
pub async fn settle() {
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
}

pub fn ts(text: &str) -> Timestamp {
    text.parse().expect("timestamp")
}
