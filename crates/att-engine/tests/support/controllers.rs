//! Shared fixtures for the controller tests: in-memory 7pace and Azure fakes, an engine wired to
//! them, and slice helpers.
//!
//! Include with `#[path = "support/controllers.rs"] mod support;`.
#![allow(dead_code)]

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use jiff::Timestamp;
use jiff::tz::TimeZone;
use serde_json::Value;
use tokio::sync::Notify;
use uuid::Uuid;

use att_core::attention::TrackingAttention;
use att_core::model::{ActivityType, TrackingState, WorkItem, WorkLog, WorkLogUser};
use att_core::service::{
    OfflineDraftService, TrackingService, WorkLogEditingService, WorkLogMutationService,
};
use att_core::ticket::TicketWorkflowStatus;
use att_core::ticket_context::TicketContext;
use att_core::time::{add_secs, wire_date};
use att_core::worklog::{WorkLogDraft, WorkLogTimeEdit};
use att_core::{AppError, Configuration, Result};
use att_engine::clients::{AzureClient, Clients, SevenPaceClient};
use att_engine::testing::TestEngine;
use att_store::{Store, keys};

pub const WORKSPACE_URL: &str = "https://acme.timehub.7pace.com";
pub const ORGANIZATION: &str = "acme";

/// The 2.0 workspace identity of [`WORKSPACE_URL`] (with the URL parser's trailing slash).
pub fn workspace() -> String {
    att_engine::clients::workspace_identity(WORKSPACE_URL)
}

pub fn tz() -> TimeZone {
    TimeZone::get("Europe/Brussels").expect("tzdb")
}

/// An offset-free local time in Brussels (7pace's wire format).
pub fn local(text: &str) -> Timestamp {
    wire_date::parse(text, Some(&tz())).expect("valid local time")
}

pub fn local_string(ts: Timestamp) -> String {
    wire_date::local_string(ts, &tz())
}

pub fn configuration() -> Configuration {
    Configuration {
        seven_pace_url: WORKSPACE_URL.into(),
        organization: ORGANIZATION.into(),
        ..Configuration::default()
    }
}

/// An in-memory store with `config` saved. The 1.14.x import is marked as done, so the
/// developer machine's real `~/Library/Application Support/Azure timetracker` is never read.
pub fn store_with(config: &Configuration) -> Arc<Store> {
    let store = Store::open_in_memory().expect("in-memory store");
    store.set_meta(att_store::legacy::IMPORTED_META, "controller tests").expect("meta");
    store.put(keys::CONFIGURATION, config).expect("configuration");
    Arc::new(store)
}

/// An editable 7pace entry starting at a local time.
pub fn log(id: &str, start: &str, seconds: f64, ticket: Option<i64>, comment: &str) -> WorkLog {
    let mut log = WorkLog::new(id, start, seconds);
    log.work_item_id = ticket;
    log.comment = (!comment.is_empty()).then(|| comment.to_string());
    log.activity_type = Some(ActivityType::new("dev", "Development"));
    log.is_can_edit = Some(true);
    log.is_can_delete = Some(true);
    log.edited_timestamp = Some("2026-10-01T12:00:00".into());
    log.user = Some(WorkLogUser { id: Some("user-1".into()) });
    log
}

pub fn idle() -> TrackingState {
    serde_json::from_str(r#"{"track":{"trackingState":"idle"}}"#).expect("idle state")
}

// -- 7pace ----------------------------------------------------------------------------------------

#[derive(Default)]
pub struct SevenPaceState {
    pub logs: BTreeMap<String, WorkLog>,
    pub tracking: Option<TrackingState>,
    pub activity_types: Vec<ActivityType>,
    /// Every request, e.g. `work_logs(2026-10-04T00:00:00..2026-10-12T00:00:00)`.
    pub calls: Vec<String>,
    /// Writes only: `create`, `update <id>`, `delete <id>`.
    pub mutations: Vec<String>,
    /// For each write, what the probe saw in the store just before it (see `probe`).
    pub probed: Vec<String>,
    pub fail_work_logs: Option<AppError>,
    pub fail_update: bool,
    pub lose_create_response: bool,
}

/// An in-memory 7pace with editable worklogs.
pub struct FakeSevenPace {
    pub state: Mutex<SevenPaceState>,
    holds: Mutex<HashMap<&'static str, VecDeque<Arc<Notify>>>>,
    /// Reads this store's document before every write (journal or ledger checkpoints).
    probe: Mutex<Option<(Arc<Store>, &'static str)>>,
}

impl Default for FakeSevenPace {
    fn default() -> Self {
        Self {
            state: Mutex::new(SevenPaceState {
                activity_types: vec![ActivityType::new("dev", "Development")],
                ..SevenPaceState::default()
            }),
            holds: Mutex::default(),
            probe: Mutex::default(),
        }
    }
}

impl FakeSevenPace {
    pub fn with_logs(logs: Vec<WorkLog>) -> Self {
        let fake = Self::default();
        fake.state.lock().unwrap().logs =
            logs.into_iter().map(|log| (log.id.clone(), log)).collect();
        fake
    }

    pub fn add(&self, log: WorkLog) {
        self.state.lock().unwrap().logs.insert(log.id.clone(), log);
    }

    pub fn calls(&self) -> Vec<String> {
        self.state.lock().unwrap().calls.clone()
    }

    pub fn calls_to(&self, method: &str) -> usize {
        self.calls().iter().filter(|call| call.starts_with(method)).count()
    }

    pub fn mutations(&self) -> Vec<String> {
        self.state.lock().unwrap().mutations.clone()
    }

    pub fn probed(&self) -> Vec<String> {
        self.state.lock().unwrap().probed.clone()
    }

    pub fn logs(&self) -> BTreeMap<String, WorkLog> {
        self.state.lock().unwrap().logs.clone()
    }

    /// The next call of `method` waits until the returned notify is signalled.
    pub fn hold_next(&self, method: &'static str) -> Arc<Notify> {
        let notify = Arc::new(Notify::new());
        self.holds.lock().unwrap().entry(method).or_default().push_back(notify.clone());
        notify
    }

    /// Before each write, record the `key` document's JSON as the store has it.
    pub fn probe(&self, store: Arc<Store>, key: &'static str) {
        *self.probe.lock().unwrap() = Some((store, key));
    }

    async fn enter(&self, method: &'static str, call: String) {
        self.state.lock().unwrap().calls.push(call);
        let hold = self.holds.lock().unwrap().get_mut(method).and_then(VecDeque::pop_front);
        if let Some(hold) = hold {
            hold.notified().await;
        }
    }

    fn write(&self, mutation: String) {
        let probed = self
            .probe
            .lock()
            .unwrap()
            .as_ref()
            .map(|(store, key)| store.get_raw(key).unwrap_or_default().unwrap_or_default());
        let mut state = self.state.lock().unwrap();
        state.mutations.push(mutation);
        if let Some(probed) = probed {
            state.probed.push(probed);
        }
    }

    fn tracking(&self) -> TrackingState {
        self.state.lock().unwrap().tracking.clone().unwrap_or_else(idle)
    }
}

/// Swift `UUID().uuidString`.
pub fn swift_uuid() -> String {
    Uuid::new_v4().hyphenated().to_string().to_uppercase()
}

#[async_trait]
impl TrackingService for FakeSevenPace {
    async fn current(&self) -> Result<TrackingState> {
        self.enter("current", "current".into()).await;
        Ok(self.tracking())
    }
    async fn start(
        &self,
        _ticket_id: Option<i64>,
        _activity_type: Option<&str>,
        _remark: Option<&str>,
    ) -> Result<TrackingState> {
        Err(AppError::message("Not used by the controllers."))
    }
    async fn stop(&self) -> Result<TrackingState> {
        Err(AppError::message("Not used by the controllers."))
    }
}

#[async_trait]
impl WorkLogEditingService for FakeSevenPace {
    async fn current_tracking(&self) -> Result<TrackingState> {
        self.enter("current", "current".into()).await;
        Ok(self.tracking())
    }
    async fn work_log(&self, id: &str) -> Result<WorkLog> {
        self.enter("work_log", format!("work_log({id})")).await;
        self.state.lock().unwrap().logs.get(id).cloned().ok_or(AppError::NotFound)
    }
    async fn work_logs_before(&self, end: Timestamp) -> Result<Vec<WorkLog>> {
        self.enter("work_logs_before", format!("work_logs_before({})", local_string(end))).await;
        let limit = add_secs(end, 1.0);
        Ok(self
            .state
            .lock()
            .unwrap()
            .logs
            .values()
            .filter(|log| log.date(&tz()).is_some_and(|start| start < limit))
            .cloned()
            .collect())
    }
    async fn update_work_log_time(&self, id: &str, edit: &WorkLogTimeEdit) -> Result<WorkLog> {
        let log = self.work_log(id).await?;
        let mut draft = WorkLogDraft::from_log(&log, true, &att_core::Cal::new(tz()))?;
        draft.start = edit.start;
        draft.seconds = edit.seconds();
        self.replace_work_log_time(id, &draft).await
    }
}

#[async_trait]
impl WorkLogMutationService for FakeSevenPace {
    async fn find_work_log(&self, id: &str) -> Result<Option<WorkLog>> {
        self.enter("find_work_log", format!("find_work_log({id})")).await;
        Ok(self.state.lock().unwrap().logs.get(id).cloned())
    }
    async fn create_work_log(&self, draft: &WorkLogDraft) -> Result<WorkLog> {
        self.enter("create", "create".into()).await;
        self.write("create".into());
        let mut log = log(
            &swift_uuid(),
            &local_string(draft.start),
            draft.seconds as f64,
            draft.ticket_id,
            draft.comment.as_deref().unwrap_or(""),
        );
        log.billable_length = Some(draft.billable_seconds as f64);
        log.activity_type = draft.activity_id.as_ref().map(|id| ActivityType {
            id: id.clone(),
            name: None,
            color: None,
        });
        log.user = draft.user_id.as_ref().map(|id| WorkLogUser { id: Some(id.clone()) });
        let mut state = self.state.lock().unwrap();
        state.logs.insert(log.id.clone(), log.clone());
        if state.lose_create_response {
            return Err(AppError::Timeout);
        }
        Ok(log)
    }
    async fn replace_work_log_time(&self, id: &str, draft: &WorkLogDraft) -> Result<WorkLog> {
        self.enter("update", format!("update({id})")).await;
        self.write(format!("update {id}"));
        let mut state = self.state.lock().unwrap();
        if state.fail_update {
            return Err(AppError::message("Update unavailable"));
        }
        let mut log = state.logs.get(id).cloned().ok_or(AppError::NotFound)?;
        log.timestamp = local_string(draft.start);
        log.length = draft.seconds as f64;
        log.billable_length = Some(draft.billable_seconds as f64);
        log.edited_timestamp = Some(swift_uuid());
        state.logs.insert(id.to_string(), log.clone());
        Ok(log)
    }
    async fn delete_work_log(&self, id: &str) -> Result<()> {
        self.enter("delete", format!("delete({id})")).await;
        self.write(format!("delete {id}"));
        self.state.lock().unwrap().logs.remove(id);
        Ok(())
    }
}

#[async_trait]
impl OfflineDraftService for FakeSevenPace {
    async fn activity_types(&self) -> Result<Vec<ActivityType>> {
        self.enter("activity_types", "activity_types".into()).await;
        Ok(self.state.lock().unwrap().activity_types.clone())
    }
}

#[async_trait]
impl SevenPaceClient for FakeSevenPace {
    async fn confirm_activity(
        &self,
        _expected: Option<&TrackingAttention>,
    ) -> Result<TrackingState> {
        Err(AppError::message("Not used by the controllers."))
    }
    async fn search(&self, _query: &str) -> Result<Vec<WorkItem>> {
        Ok(Vec::new())
    }
    async fn work_logs(
        &self,
        from: Option<Timestamp>,
        to: Timestamp,
        include_editable: bool,
    ) -> Result<Vec<WorkLog>> {
        let range = format!(
            "{}..{}{}",
            from.map(local_string).unwrap_or_default(),
            local_string(to),
            if include_editable { " editable" } else { "" }
        );
        self.enter("work_logs", format!("work_logs({range})")).await;
        let mut state = self.state.lock().unwrap();
        if let Some(error) = state.fail_work_logs.take() {
            return Err(error);
        }
        Ok(state
            .logs
            .values()
            .filter(|log| {
                log.date(&tz())
                    .is_some_and(|start| from.is_none_or(|from| start >= from) && start < to)
            })
            .cloned()
            .collect())
    }
}

// -- Azure ----------------------------------------------------------------------------------------

#[derive(Default)]
pub struct FakeAzure {
    pub contexts: Mutex<BTreeMap<i64, TicketContext>>,
    pub calls: Mutex<Vec<String>>,
    holds: Mutex<VecDeque<Arc<Notify>>>,
}

impl FakeAzure {
    pub fn with_tickets(ids: &[i64]) -> Self {
        let azure = Self::default();
        for id in ids {
            azure.contexts.lock().unwrap().insert(*id, context(*id));
        }
        azure
    }

    /// The next `ticket_context` call waits until the returned notify is signalled.
    pub fn hold_next(&self) -> Arc<Notify> {
        let notify = Arc::new(Notify::new());
        self.holds.lock().unwrap().push_back(notify.clone());
        notify
    }

    pub fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
}

pub fn context(id: i64) -> TicketContext {
    TicketContext {
        id,
        title: format!("Ticket {id}"),
        state: "Active".into(),
        kind: "User Story".into(),
        assigned_to: "Preview user".into(),
        project: "Sample project".into(),
        iteration: String::new(),
        tags: String::new(),
        description: "Improve the recorded-time workflow.".into(),
        acceptance_criteria: String::new(),
        links: Vec::new(),
    }
}

#[async_trait]
impl AzureClient for FakeAzure {
    async fn ticket_workflow(&self, id: i64) -> Result<TicketWorkflowStatus> {
        Ok(TicketWorkflowStatus {
            ticket_id: id,
            title: String::new(),
            state: "Active".into(),
            category: "InProgress".into(),
        })
    }
    async fn ticket_context(&self, id: i64) -> Result<TicketContext> {
        self.calls.lock().unwrap().push(format!("ticket_context({id})"));
        let hold = self.holds.lock().unwrap().pop_front();
        if let Some(hold) = hold {
            hold.notified().await;
        }
        self.contexts.lock().unwrap().get(&id).cloned().ok_or(AppError::NotFound)
    }
    async fn work_item(&self, id: i64) -> Result<WorkItem> {
        Ok(WorkItem::new(id, format!("Ticket {id}")))
    }
    async fn work_items(&self, ids: &[i64]) -> Result<Vec<WorkItem>> {
        Ok(ids.iter().map(|id| WorkItem::new(*id, format!("Ticket {id}"))).collect())
    }
}

// -- Engine harness -------------------------------------------------------------------------------

pub struct Harness {
    pub t: TestEngine,
    pub seven_pace: Arc<FakeSevenPace>,
    pub azure: Arc<FakeAzure>,
}

pub fn clients(seven_pace: &Arc<FakeSevenPace>, azure: Option<&Arc<FakeAzure>>) -> Clients {
    Clients {
        generation: 0,
        workspace: workspace(),
        host: "acme.timehub.7pace.com".into(),
        seven_pace: seven_pace.clone(),
        azure: azure.map(|azure| azure.clone() as Arc<dyn AzureClient>),
    }
}

impl Harness {
    /// An engine on `store`, connected to fresh fakes.
    pub async fn on(store: Arc<Store>, seven_pace: FakeSevenPace) -> Self {
        let t = TestEngine::with_store(store);
        let seven_pace = Arc::new(seven_pace);
        let azure = Arc::new(FakeAzure::with_tickets(&[1, 2]));
        att_engine::controllers::testing::install_clients(
            &t.engine,
            Some(clients(&seven_pace, Some(&azure))),
        )
        .await;
        Self { t, seven_pace, azure }
    }

    /// Connected, with the default configuration and these 7pace entries.
    pub async fn new(logs: Vec<WorkLog>) -> Self {
        Self::on(store_with(&configuration()), FakeSevenPace::with_logs(logs)).await
    }

    pub async fn dispatch(
        &self,
        intent: Value,
    ) -> std::result::Result<Value, att_engine::IpcError> {
        self.t.engine.dispatch(intent).await
    }

    pub async fn ok(&self, intent: Value) -> Value {
        let text = intent.to_string();
        self.dispatch(intent).await.unwrap_or_else(|error| panic!("{text} failed: {error:?}"))
    }

    pub async fn show(&self, page: Option<&str>) {
        self.ok(serde_json::json!({"type": "app.setVisiblePage", "page": page})).await;
    }

    pub async fn tick(&self) {
        att_engine::controllers::tick(&self.t.engine).await;
    }

    /// Hides and shows `page`, then ticks: the "page appeared" load.
    pub async fn reopen(&self, page: &str) {
        self.show(None).await;
        self.tick().await;
        self.show(Some(page)).await;
        self.tick().await;
    }

    pub fn slice(&self, name: &str) -> Value {
        slice(&self.t, name)
    }

    /// Waits until `name` satisfies `done` (5 s at most).
    pub async fn wait_for(&self, name: &str, done: impl Fn(&Value) -> bool) -> Value {
        wait_for(&self.t, name, done).await
    }
}

pub fn slice(t: &TestEngine, name: &str) -> Value {
    t.engine
        .snapshot()
        .into_iter()
        .find(|update| update.name == name)
        .map(|update| update.value)
        .unwrap_or_else(|| panic!("no slice {name}"))
}

pub async fn wait_for(t: &TestEngine, name: &str, done: impl Fn(&Value) -> bool) -> Value {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let value = slice(t, name);
        if done(&value) {
            return value;
        }
        if std::time::Instant::now() > deadline {
            panic!("timed out waiting for {name}: {value:#}");
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Lets spawned tasks run (debounced analyses, delayed writes).
pub async fn settle(duration: Duration) {
    tokio::time::sleep(duration).await;
}

/// Waits until `check` holds (5 s at most).
pub async fn eventually(what: &str, check: impl Fn() -> bool) {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !check() {
        if std::time::Instant::now() > deadline {
            panic!("timed out waiting until {what}");
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// The stored document `key`, decoded.
pub fn document<T: serde::de::DeserializeOwned>(store: &Store, key: &str) -> Option<T> {
    store.get_raw(key).expect("readable").map(|text| serde_json::from_str(&text).expect("json"))
}
