//! Shared fixtures for the worklog and offline-draft tests. Ports of the Swift test helpers
//! `editableLog`, `localDate` (TimeEditingTests.swift), `state` (CoreTests.swift),
//! `EditingFixture`, `MutationFixture`, `ChangeCapture` and `DraftCheckpoint`.
//!
//! Swift actors become structs with a `tokio::sync::Mutex` around their state. Swift
//! `CancellationError` is simulated by returning `AppError::Cancelled`.
//!
//! Include with `#[path = "support/worklogs.rs"] mod worklogs;`.
#![allow(dead_code)]

use std::collections::BTreeMap;

use async_trait::async_trait;
use jiff::Timestamp;
use tokio::sync::Mutex;
use uuid::Uuid;

use att_core::error::{AppError, Result};
use att_core::model::{ActivityType, TrackingState, WorkLog};
use att_core::offline::{OfflineDraft, OfflineDraftStatus};
use att_core::service::{OfflineDraftService, WorkLogEditingService, WorkLogMutationService};
use att_core::time::{Cal, wire_date};
use att_core::worklog::ops::WorkLogChange;
use att_core::worklog::{WorkLogDraft, WorkLogTimeEdit};

/// `editableLog()`'s default ID.
pub const EDITABLE_ID: &str = "11111111-1111-1111-1111-111111111111";
pub const SECOND_ID: &str = "22222222-2222-2222-2222-222222222222";

/// The Swift tests used the machine's zone; the port pins Europe/Brussels.
pub fn cal() -> Cal {
    Cal::brussels()
}

/// A fixed clock after every fixture date (the Swift tests read `Date()`).
pub fn now() -> Timestamp {
    "2026-10-06T10:00:00Z".parse().expect("valid instant")
}

/// Swift `localDate`: an offset-free local time.
pub fn local(raw: &str) -> Timestamp {
    wire_date::parse(raw, Some(cal().tz())).expect("valid local time")
}

/// Swift `WireDate.localString`.
pub fn local_string(ts: Timestamp) -> String {
    wire_date::local_string(ts, cal().tz())
}

/// Swift `UUID().uuidString`.
pub fn swift_uuid() -> String {
    Uuid::new_v4().hyphenated().to_string().to_uppercase()
}

/// Swift `editableLog(_:start:length:)`.
pub fn editable_log(id: &str, start: &str, length: f64) -> WorkLog {
    let mut log = WorkLog::new(id, start, length);
    log.work_item_id = Some(123);
    log.comment = Some("Development".into());
    log.is_can_edit = Some(true);
    log.edited_timestamp = Some("2026-09-28T12:00:00".into());
    log
}

/// Swift `editableLog()` with its defaults.
pub fn editable() -> WorkLog {
    editable_log(EDITABLE_ID, "2026-09-28T09:00:00", 3600.0)
}

/// Swift `state(_:session:)` from CoreTests.swift: tracking `id` (idle when `None`) with worklog
/// `session`, started at 2026-09-29T08:00:00Z.
pub fn state(id: Option<i64>, session: &str) -> TrackingState {
    let json = format!(
        r#"{{"track":{{"tfsId":{},"trackingState":"{}","workLogId":"{}","currentTrackLength":120,"currentTrackStartedDateTime":"2026-09-29T08:00:00Z"}},"trackSettings":{{"responseState":"OK","isTrackingStartAllowed":true,"responseMessage":"Server validation"}},"timestamp":12}}"#,
        id.map_or_else(|| "null".to_string(), |id| id.to_string()),
        if id.is_none() { "idle" } else { "tracking" },
        session
    );
    serde_json::from_str(&json).expect("valid tracking state")
}

/// Swift `state()`: idle.
pub fn idle() -> TrackingState {
    state(None, "session")
}

/// Swift `EditingFixture` state.
pub struct EditingState {
    pub entry: WorkLog,
    pub entries: Vec<WorkLog>,
    pub tracking: TrackingState,
    pub writes: usize,
    pub fail_write: bool,
    pub fail_history: bool,
    pub cancel_history: bool,
    pub wrong_response: bool,
    pub change_during_history: bool,
}

/// Swift `EditingFixture`: one entry returned for every ID, plus a history.
pub struct EditingFixture {
    pub state: Mutex<EditingState>,
}

impl EditingFixture {
    pub fn new(entry: WorkLog, entries: Vec<WorkLog>, tracking: TrackingState) -> Self {
        Self {
            state: Mutex::new(EditingState {
                entry,
                entries,
                tracking,
                writes: 0,
                fail_write: false,
                fail_history: false,
                cancel_history: false,
                wrong_response: false,
                change_during_history: false,
            }),
        }
    }

    pub fn tracking(tracking: TrackingState) -> Self {
        Self::new(editable(), Vec::new(), tracking)
    }

    pub async fn writes(&self) -> usize {
        self.state.lock().await.writes
    }
}

#[async_trait]
impl WorkLogEditingService for EditingFixture {
    async fn current_tracking(&self) -> Result<TrackingState> {
        Ok(self.state.lock().await.tracking.clone())
    }

    async fn work_log(&self, _id: &str) -> Result<WorkLog> {
        Ok(self.state.lock().await.entry.clone())
    }

    async fn work_logs_before(&self, _end: Timestamp) -> Result<Vec<WorkLog>> {
        let mut state = self.state.lock().await;
        if state.cancel_history {
            return Err(AppError::Cancelled);
        }
        if state.fail_history {
            return Err(AppError::message("Fixture history unavailable"));
        }
        if state.change_during_history {
            state.entry.length += 1.0;
        }
        Ok(state.entries.clone())
    }

    async fn update_work_log_time(&self, _id: &str, edit: &WorkLogTimeEdit) -> Result<WorkLog> {
        let mut state = self.state.lock().await;
        state.writes += 1;
        if state.fail_write {
            return Err(AppError::message("Fixture timeout after write"));
        }
        if !state.wrong_response {
            state.entry.timestamp = local_string(edit.start);
            state.entry.length = edit.seconds() as f64;
        }
        Ok(state.entry.clone())
    }
}

/// Swift `MutationFixture` state.
pub struct MutationState {
    pub entries: BTreeMap<String, WorkLog>,
    pub mutations: Vec<&'static str>,
    pub lose_create_response: bool,
    pub fail_update: bool,
    /// Rust-only: accept deletes without removing the entry (an unconfirmed removal).
    pub ignore_delete: bool,
    /// Rust-only: store and return created entries a minute longer than requested.
    pub alter_create: bool,
    /// The activity types offered to offline drafts (Swift: always Development).
    pub activity_types: Vec<ActivityType>,
    pub tracking: TrackingState,
}

/// Swift `MutationFixture`: an in-memory 7pace with creates, updates and deletes.
pub struct MutationFixture {
    pub state: Mutex<MutationState>,
}

impl MutationFixture {
    pub fn new(logs: Vec<WorkLog>) -> Self {
        Self::with_tracking(logs, idle())
    }

    pub fn with_tracking(logs: Vec<WorkLog>, tracking: TrackingState) -> Self {
        Self {
            state: Mutex::new(MutationState {
                entries: logs.into_iter().map(|log| (log.id.clone(), log)).collect(),
                mutations: Vec::new(),
                lose_create_response: false,
                fail_update: false,
                ignore_delete: false,
                alter_create: false,
                activity_types: vec![ActivityType::new("dev", "Development")],
                tracking,
            }),
        }
    }

    pub async fn mutations(&self) -> Vec<&'static str> {
        self.state.lock().await.mutations.clone()
    }

    pub async fn entries(&self) -> BTreeMap<String, WorkLog> {
        self.state.lock().await.entries.clone()
    }

    pub async fn replace(&self, log: WorkLog) {
        self.state.lock().await.entries.insert(log.id.clone(), log);
    }
}

#[async_trait]
impl WorkLogEditingService for MutationFixture {
    async fn current_tracking(&self) -> Result<TrackingState> {
        Ok(self.state.lock().await.tracking.clone())
    }

    async fn work_log(&self, id: &str) -> Result<WorkLog> {
        self.state.lock().await.entries.get(id).cloned().ok_or(AppError::NotFound)
    }

    async fn work_logs_before(&self, _end: Timestamp) -> Result<Vec<WorkLog>> {
        Ok(self.state.lock().await.entries.values().cloned().collect())
    }

    async fn update_work_log_time(&self, id: &str, edit: &WorkLogTimeEdit) -> Result<WorkLog> {
        let mut draft = WorkLogDraft::from_log(&self.work_log(id).await?, true, &cal())?;
        draft.start = edit.start;
        draft.seconds = edit.seconds();
        self.replace_work_log_time(id, &draft).await
    }
}

#[async_trait]
impl WorkLogMutationService for MutationFixture {
    async fn find_work_log(&self, id: &str) -> Result<Option<WorkLog>> {
        Ok(self.state.lock().await.entries.get(id).cloned())
    }

    async fn create_work_log(&self, draft: &WorkLogDraft) -> Result<WorkLog> {
        let mut state = self.state.lock().await;
        state.mutations.push("create");
        let mut log = editable_log(&swift_uuid(), &local_string(draft.start), draft.seconds as f64);
        log.billable_length = Some(draft.billable_seconds as f64);
        log.work_item_id = draft.ticket_id;
        log.comment = draft.comment.clone();
        log.activity_type = draft.activity_id.as_ref().map(|id| ActivityType {
            id: id.clone(),
            name: None,
            color: None,
        });
        log.is_can_delete = Some(true);
        if state.alter_create {
            log.length += 60.0;
        }
        state.entries.insert(log.id.clone(), log.clone());
        if state.lose_create_response {
            return Err(AppError::message("Response lost after create"));
        }
        Ok(log)
    }

    async fn replace_work_log_time(&self, id: &str, draft: &WorkLogDraft) -> Result<WorkLog> {
        let mut state = self.state.lock().await;
        state.mutations.push("update");
        if state.fail_update {
            return Err(AppError::message("Update unavailable"));
        }
        let mut log = state.entries.get(id).cloned().ok_or(AppError::NotFound)?;
        log.timestamp = local_string(draft.start);
        log.length = draft.seconds as f64;
        log.billable_length = Some(draft.billable_seconds as f64);
        log.edited_timestamp = Some(swift_uuid());
        state.entries.insert(id.to_string(), log.clone());
        Ok(log)
    }

    async fn delete_work_log(&self, id: &str) -> Result<()> {
        let mut state = self.state.lock().await;
        state.mutations.push("delete");
        if !state.ignore_delete {
            state.entries.remove(id);
        }
        Ok(())
    }
}

/// OfflineDraftTests.swift's `extension MutationFixture: OfflineDraftService`.
#[async_trait]
impl OfflineDraftService for MutationFixture {
    async fn activity_types(&self) -> Result<Vec<ActivityType>> {
        Ok(self.state.lock().await.activity_types.clone())
    }
}

/// Swift `ChangeCapture`: records every journal checkpoint, or fails them all.
#[derive(Default)]
pub struct ChangeCapture {
    pub records: Mutex<Vec<WorkLogChange>>,
    pub fail: bool,
}

impl ChangeCapture {
    pub fn failing() -> Self {
        Self { records: Mutex::default(), fail: true }
    }

    pub async fn checkpoint(&self, value: WorkLogChange) -> Result<()> {
        if self.fail {
            return Err(AppError::message("Disk unavailable"));
        }
        self.records.lock().await.push(value);
        Ok(())
    }

    pub async fn records(&self) -> Vec<WorkLogChange> {
        self.records.lock().await.clone()
    }
}

/// Swift `DraftCheckpoint`: records drafts and fails the save with index `fail_at`.
#[derive(Default)]
pub struct DraftCheckpoint {
    pub records: Mutex<Vec<OfflineDraft>>,
    pub fail_at: Option<usize>,
}

impl DraftCheckpoint {
    pub fn failing_at(stage: usize) -> Self {
        Self { records: Mutex::default(), fail_at: Some(stage) }
    }

    pub async fn save(&self, draft: OfflineDraft) -> Result<()> {
        let mut records = self.records.lock().await;
        if Some(records.len()) == self.fail_at {
            return Err(AppError::message("Disk failure"));
        }
        records.push(draft);
        Ok(())
    }

    pub async fn records(&self) -> Vec<OfflineDraft> {
        self.records.lock().await.clone()
    }

    pub async fn statuses(&self) -> Vec<OfflineDraftStatus> {
        self.records.lock().await.iter().map(|draft| draft.status).collect()
    }
}

/// Compile-time check that a future can move to another thread (the engine spawns these).
pub fn assert_send<T: Send>(value: T) -> T {
    value
}
