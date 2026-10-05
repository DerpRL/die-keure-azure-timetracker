//! Async service contracts implemented by the 7pace client (`att-net`) and by test fakes.
//! Ported from the `TrackingService`, `WorkLogEditingService`, `WorkLogMutationService` and
//! `OfflineDraftService` protocols.
//!
//! Cancellation: Swift checked `Task.checkCancellation()` between steps. In Rust a dropped future
//! stops at its next `.await`; fakes simulate cancellation by returning `AppError::Cancelled`.

use async_trait::async_trait;
use jiff::Timestamp;

use crate::error::Result;
use crate::model::{ActivityType, TrackingState, WorkLog};
use crate::worklog::{WorkLogDraft, WorkLogTimeEdit};

#[async_trait]
pub trait TrackingService: Send + Sync {
    /// `GET api/tracking/client/current?$expand=true`, already `checked()`.
    async fn current(&self) -> Result<TrackingState>;
    async fn start(
        &self,
        ticket_id: Option<i64>,
        activity_type: Option<&str>,
        remark: Option<&str>,
    ) -> Result<TrackingState>;
    async fn stop(&self) -> Result<TrackingState>;
}

#[async_trait]
pub trait WorkLogEditingService: Send + Sync {
    /// The current tracking state (Swift `current()`; renamed to avoid clashing with
    /// [`TrackingService::current`] on types that implement both).
    async fn current_tracking(&self) -> Result<TrackingState>;
    async fn work_log(&self, id: &str) -> Result<WorkLog>;
    /// Every log that starts before `end`, with no lower bound.
    async fn work_logs_before(&self, end: Timestamp) -> Result<Vec<WorkLog>>;
    async fn update_work_log_time(&self, id: &str, edit: &WorkLogTimeEdit) -> Result<WorkLog>;
}

#[async_trait]
pub trait WorkLogMutationService: WorkLogEditingService {
    /// `None` only when the server answers 404.
    async fn find_work_log(&self, id: &str) -> Result<Option<WorkLog>>;
    async fn create_work_log(&self, draft: &WorkLogDraft) -> Result<WorkLog>;
    async fn replace_work_log_time(&self, id: &str, draft: &WorkLogDraft) -> Result<WorkLog>;
    async fn delete_work_log(&self, id: &str) -> Result<()>;
}

#[async_trait]
pub trait OfflineDraftService: WorkLogMutationService {
    async fn activity_types(&self) -> Result<Vec<ActivityType>>;
}
