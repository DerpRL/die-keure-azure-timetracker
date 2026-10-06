//! Shared fixtures for the contract tests.
//!
//! [`Capture`] is the port of Swift's `RequestCapture` + `MockURLProtocol`: a wiremock server on
//! 127.0.0.1 that answers every request with the next queued response (500 once the queue is
//! empty) and records what it received. The Swift test helpers `state`, `editableLog`,
//! `localDate` and `TrackingAttentionTests.stopped` are ported below, with the calendar pinned to
//! Europe/Brussels where Swift used the machine's zone.
#![allow(dead_code)]

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use jiff::Timestamp;
use serde::Serialize;
use serde_json::{Value, json};
use wiremock::matchers::any;
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

use att_core::Cal;
use att_core::model::{TrackingState, WorkLog};
use att_core::time::{add_secs, wire_date};
use att_net::{Clock, HttpTransport, SevenPaceApi, SevenPaceOAuth, TransportOptions, Url};

/// `Basic base64(":fixture-pat")`.
pub const PAT_AUTHORIZATION: &str = "Basic OmZpeHR1cmUtcGF0";

/// 2026-10-06T10:00:00Z, 12:00 in Brussels (summer time, UTC+2).
pub fn now() -> Timestamp {
    ts("2026-10-06T10:00:00Z")
}

pub fn ts(text: &str) -> Timestamp {
    text.parse().unwrap()
}

/// A clock the test can move.
#[derive(Clone)]
pub struct TestClock(Arc<Mutex<Timestamp>>);

impl TestClock {
    pub fn new(at: Timestamp) -> Self {
        Self(Arc::new(Mutex::new(at)))
    }

    pub fn clock(&self) -> Clock {
        let at = self.0.clone();
        Arc::new(move || *at.lock().unwrap())
    }

    pub fn set(&self, at: Timestamp) {
        *self.0.lock().unwrap() = at;
    }

    pub fn advance(&self, seconds: f64) {
        let mut at = self.0.lock().unwrap();
        *at = add_secs(*at, seconds);
    }
}

/// Answers with queued responses in order, then 500.
struct Queue(Mutex<VecDeque<ResponseTemplate>>);

impl Respond for Queue {
    fn respond(&self, _request: &Request) -> ResponseTemplate {
        self.0.lock().unwrap().pop_front().unwrap_or_else(|| ResponseTemplate::new(500))
    }
}

pub struct Capture {
    pub server: MockServer,
    pub clock: TestClock,
    pub transport: HttpTransport,
}

impl Capture {
    pub async fn start(responses: Vec<ResponseTemplate>) -> Self {
        let server = MockServer::start().await;
        Mock::given(any()).respond_with(Queue(Mutex::new(responses.into()))).mount(&server).await;
        let clock = TestClock::new(now());
        let transport = local_transport().with_clock(clock.clock());
        Self { server, clock, transport }
    }

    pub fn url(&self, path: &str) -> Url {
        Url::parse(&format!("{}{path}", self.server.uri())).unwrap()
    }

    /// `SevenPaceAPI(baseURL:token: "fixture-token")` against the mock server.
    pub fn seven_pace(&self) -> SevenPaceApi {
        SevenPaceApi::with_token(
            self.url("/"),
            "fixture-token",
            self.transport.clone(),
            Cal::brussels(),
        )
        .with_clock(self.clock.clock())
    }

    pub fn oauth(&self) -> SevenPaceOAuth {
        SevenPaceOAuth::new(self.url("/"), self.transport.clone()).with_clock(self.clock.clock())
    }

    pub async fn requests(&self) -> Vec<Request> {
        self.server.received_requests().await.unwrap_or_default()
    }
}

/// The production transport settings, minus HTTPS-only and proxies, for 127.0.0.1.
pub fn local_options() -> TransportOptions {
    TransportOptions { system_proxy: false, https_only: false, ..TransportOptions::default() }
}

pub fn local_transport() -> HttpTransport {
    HttpTransport::with_options(local_options()).unwrap()
}

pub fn ok_json(body: Value) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(body)
}

pub fn status(code: u16) -> ResponseTemplate {
    ResponseTemplate::new(code)
}

pub fn json_of(value: &impl Serialize) -> Value {
    serde_json::to_value(value).unwrap()
}

pub fn methods(requests: &[Request]) -> Vec<&str> {
    requests.iter().map(|request| request.method.as_str()).collect()
}

pub fn query_value(request: &Request, name: &str) -> Option<String> {
    request.url.query_pairs().find(|(key, _)| key == name).map(|(_, value)| value.into_owned())
}

pub fn header(request: &Request, name: &str) -> Option<String> {
    request.headers.get(name).map(|value| value.to_str().unwrap().to_string())
}

pub fn json_body(request: &Request) -> Value {
    serde_json::from_slice(&request.body).unwrap()
}

/// Swift `state(_:session:response:allowed:activity:)` with the defaults the API tests use.
pub fn state(id: Option<i64>, activity: Option<&str>) -> TrackingState {
    let mut state: TrackingState = serde_json::from_value(json!({
        "track": {
            "tfsId": id,
            "trackingState": if id.is_none() { "idle" } else { "tracking" },
            "workLogId": "session",
            "currentTrackLength": 120,
            "currentTrackStartedDateTime": "2026-09-29T08:00:00Z"
        },
        "trackSettings": {
            "responseState": "OK",
            "isTrackingStartAllowed": true,
            "responseMessage": "Server validation"
        },
        "timestamp": 12
    }))
    .unwrap();
    if let Some(track) = state.track.as_mut() {
        track.activity_type_id = activity.map(str::to_string);
    }
    state
}

/// Swift `TrackingAttentionTests.stopped(_:log:)`.
pub fn stopped(reason: i64, log: &str) -> TrackingState {
    serde_json::from_value(json!({
        "track": {
            "trackingState": "clientInputRequired",
            "stoppedTrackType": reason,
            "tfsId": 123,
            "workLogId": log,
            "activityTypeId": "dev",
            "remark": "Work",
            "trackStatusChangeDate": "2026-09-28T11:00:00"
        }
    }))
    .unwrap()
}

/// Swift `editableLog()`.
pub fn editable_log() -> WorkLog {
    let mut log =
        WorkLog::new("11111111-1111-1111-1111-111111111111", "2026-09-28T09:00:00", 3600.0);
    log.work_item_id = Some(123);
    log.comment = Some("Development".into());
    log.is_can_edit = Some(true);
    log.edited_timestamp = Some("2026-09-28T12:00:00".into());
    log
}

/// Swift `localDate(_:)` in Brussels.
pub fn local_date(raw: &str) -> Timestamp {
    wire_date::parse(raw, Some(Cal::brussels().tz())).unwrap()
}
