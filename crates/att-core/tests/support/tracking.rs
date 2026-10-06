//! Tracking fixtures shared by the tracking test files, ported from CoreTests.swift: the
//! `state(...)` builder and the `StubTracker` fake. Include it with
//! `#[path = "support/tracking.rs"] mod support;`.

#![allow(dead_code)]

use async_trait::async_trait;
use att_core::model::{TrackingState, WireValue};
use att_core::service::TrackingService;
use att_core::{AppError, Result};
use tokio::sync::Mutex;

/// Swift `state(_ id:session:response:allowed:activity:)`, with the same defaults.
#[derive(Clone, Debug)]
pub struct StateSpec {
    pub id: Option<i64>,
    pub session: String,
    pub response: String,
    pub allowed: bool,
    pub activity: Option<String>,
}

impl StateSpec {
    pub fn new(id: Option<i64>) -> Self {
        Self {
            id,
            session: "session".to_string(),
            response: "OK".to_string(),
            allowed: true,
            activity: None,
        }
    }

    pub fn session(mut self, session: &str) -> Self {
        self.session = session.to_string();
        self
    }

    pub fn response(mut self, response: &str) -> Self {
        self.response = response.to_string();
        self
    }

    pub fn allowed(mut self, allowed: bool) -> Self {
        self.allowed = allowed;
        self
    }

    pub fn activity(mut self, activity: &str) -> Self {
        self.activity = Some(activity.to_string());
        self
    }

    /// Decodes the same JSON document as the Swift helper.
    pub fn build(&self) -> TrackingState {
        let tfs_id = self.id.map_or_else(|| "null".to_string(), |id| id.to_string());
        let tracking = if self.id.is_none() { "idle" } else { "tracking" };
        let json = format!(
            r#"{{"track":{{"tfsId":{tfs_id},"trackingState":"{tracking}","workLogId":"{session}","currentTrackLength":120,"currentTrackStartedDateTime":"2026-09-29T08:00:00Z"}},"trackSettings":{{"responseState":"{response}","isTrackingStartAllowed":{allowed},"responseMessage":"Server validation"}},"timestamp":12}}"#,
            session = self.session,
            response = self.response,
            allowed = self.allowed,
        );
        let mut result: TrackingState = serde_json::from_str(&json).expect("fixture JSON decodes");
        if let Some(track) = result.track.as_mut() {
            track.activity_type_id = self.activity.clone();
        }
        result
    }
}

/// `state(id)` with the Swift defaults: running with `id`, idle without.
pub fn state(id: Option<i64>) -> TrackingState {
    StateSpec::new(id).build()
}

/// Swift `actor StubTracker`. `current` always answers `initial`; every call is recorded.
/// A failing write answers [`AppError::Timeout`] (Swift `URLError(.timedOut)`).
pub struct StubTracker {
    inner: Mutex<StubState>,
}

struct StubState {
    calls: Vec<String>,
    started_activities: Vec<Option<String>>,
    initial: TrackingState,
    stop_error: bool,
    stopped: TrackingState,
    start_error: bool,
}

impl StubTracker {
    pub fn new(initial: TrackingState, stopped: TrackingState) -> Self {
        Self::with_errors(initial, stopped, false, false)
    }

    pub fn with_errors(
        initial: TrackingState,
        stopped: TrackingState,
        stop_error: bool,
        start_error: bool,
    ) -> Self {
        Self {
            inner: Mutex::new(StubState {
                calls: Vec::new(),
                started_activities: Vec::new(),
                initial,
                stop_error,
                stopped,
                start_error,
            }),
        }
    }

    pub async fn calls(&self) -> Vec<String> {
        self.inner.lock().await.calls.clone()
    }

    pub async fn started_activities(&self) -> Vec<Option<String>> {
        self.inner.lock().await.started_activities.clone()
    }
}

#[async_trait]
impl TrackingService for StubTracker {
    async fn current(&self) -> Result<TrackingState> {
        let mut inner = self.inner.lock().await;
        inner.calls.push("current".to_string());
        Ok(inner.initial.clone())
    }

    async fn start(
        &self,
        ticket_id: Option<i64>,
        activity_type: Option<&str>,
        remark: Option<&str>,
    ) -> Result<TrackingState> {
        let mut inner = self.inner.lock().await;
        let ticket = ticket_id.map_or_else(|| "unassigned".to_string(), |id| id.to_string());
        inner.calls.push(format!("start:{ticket}"));
        inner.started_activities.push(activity_type.map(str::to_string));
        if inner.start_error {
            return Err(AppError::Timeout);
        }
        let mut spec = StateSpec::new(ticket_id);
        spec.activity = activity_type.map(str::to_string);
        let mut next = spec.build();
        if let Some(track) = next.track.as_mut() {
            track.tracking_state = WireValue::text("tracking");
            track.remark = remark.map(str::to_string);
        }
        Ok(next)
    }

    async fn stop(&self) -> Result<TrackingState> {
        let mut inner = self.inner.lock().await;
        inner.calls.push("stop".to_string());
        if inner.stop_error {
            return Err(AppError::Timeout);
        }
        Ok(inner.stopped.clone())
    }
}
