//! Port of Tests/AzureTimetrackerCoreTests/APITests.swift (the two Slack tests are dead code and
//! not ported), plus tests for the Azure batch endpoint, the Keychain token format and the token
//! provider's sharing and cancellation behaviour.

mod support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::task::JoinSet;
use wiremock::ResponseTemplate;

use att_core::attention::TrackingAttention;
use att_core::model::{WireValue, WorkItem};
use att_core::service::{TrackingService, WorkLogEditingService, WorkLogMutationService};
use att_core::time::{add_secs, swift_date};
use att_core::worklog::{WorkLogDraft, WorkLogTimeEdit};
use att_core::{AppError, Cal};
use att_net::{
    AzureApi, PersistTokens, SevenPaceApi, SevenPaceOAuth, SevenPacePinStatus,
    SevenPaceTokenProvider, SevenPaceTokens,
};
use support::*;

#[tokio::test]
async fn documented_start_and_stop_contract() {
    let capture = Capture::start(vec![
        ok_json(json_of(&state(Some(33624), None))),
        ok_json(json_of(&state(None, None))),
    ])
    .await;
    let api = capture.seven_pace();
    api.start(Some(33624), None, None).await.unwrap();
    api.stop().await.unwrap();
    let requests = capture.requests().await;
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].url.path(), "/api/tracking/client/startTracking");
    assert_eq!(requests[0].method.as_str(), "POST");
    assert_eq!(header(&requests[0], "authorization").as_deref(), Some("Bearer fixture-token"));
    assert_eq!(header(&requests[0], "accept").as_deref(), Some("application/json"));
    assert_eq!(header(&requests[0], "content-type").as_deref(), Some("application/json"));
    // `timeZone` is the UTC offset in minutes now: Brussels is UTC+2 on 6 October 2026. The
    // unset activity and remark are omitted, not sent as null.
    assert_eq!(json_body(&requests[0]), json!({"timeZone": 120, "tfsId": 33624}));
    assert_eq!(requests[0].url.query(), Some("api-version=3.2"));
    assert_eq!(requests[1].url.path(), "/api/tracking/client/stopTracking");
    assert_eq!(requests[1].method.as_str(), "POST");
    assert_eq!(requests[1].url.query(), Some("api-version=3.2&$reason=0"));
    assert!(requests[1].body.is_empty());
    assert_eq!(header(&requests[1], "content-type"), None);
}

#[tokio::test]
async fn current_expands_and_validates() {
    let capture = Capture::start(vec![ok_json(json_of(&state(Some(42), None)))]).await;
    let current = capture.seven_pace().current().await.unwrap();
    assert_eq!(current.track.unwrap().tfs_id, Some(42));
    let request = &capture.requests().await[0];
    assert_eq!(request.method.as_str(), "GET");
    assert_eq!(request.url.path(), "/api/tracking/client/current");
    assert_eq!(request.url.query(), Some("api-version=3.2&$expand=true"));
}

#[tokio::test]
async fn chosen_activity_is_included_in_start_request() {
    let capture =
        Capture::start(vec![ok_json(json_of(&state(Some(33624), Some("selected-activity"))))])
            .await;
    capture.seven_pace().start(Some(33624), Some("selected-activity"), None).await.unwrap();
    let request = &capture.requests().await[0];
    assert_eq!(
        json_body(request),
        json!({"timeZone": 120, "tfsId": 33624, "activityTypeId": "selected-activity"})
    );
}

#[tokio::test]
async fn standup_request_omits_ticket_and_sends_exact_comment() {
    let mut active = state(None, Some("standup"));
    let track = active.track.as_mut().unwrap();
    track.tracking_state = WireValue::text("tracking");
    track.remark = Some("daily standup".into());
    let capture = Capture::start(vec![ok_json(json_of(&active))]).await;
    capture.seven_pace().start(None, Some("standup"), Some("daily standup")).await.unwrap();
    let request = &capture.requests().await[0];
    assert_eq!(
        json_body(request),
        json!({"timeZone": 120, "remark": "daily standup", "activityTypeId": "standup"})
    );
}

#[tokio::test]
async fn figma_request_omits_ticket_and_preserves_file_name() {
    let name = "Boeke — lesoverzicht / élève";
    let mut active = state(None, Some("design"));
    let track = active.track.as_mut().unwrap();
    track.tracking_state = WireValue::text("tracking");
    track.remark = Some(name.into());
    let capture = Capture::start(vec![ok_json(json_of(&active))]).await;
    capture.seven_pace().start(None, Some("design"), Some(name)).await.unwrap();
    let body = json_body(&capture.requests().await[0]);
    assert_eq!(body.get("tfsId"), None);
    assert_eq!(body["activityTypeId"], "design");
    assert_eq!(body["remark"], name);
}

#[tokio::test]
async fn worklogs_are_paginated_and_deduplicated() {
    let first: Vec<Value> = (0..500)
        .map(|id| {
            json!({"id": id.to_string(), "timestamp": "2026-09-29T10:00:00", "length": 60, "workItemId": 123})
        })
        .collect();
    let second = json!([
        {"id": "499", "timestamp": "2026-09-29T10:00:00", "length": 60},
        {"id": "500", "timestamp": "2026-09-29T11:00:00", "length": 120}
    ]);
    let capture =
        Capture::start(vec![ok_json(json!({"data": first})), ok_json(json!({"data": second}))])
            .await;
    let from = add_secs(now(), -86_400.0);
    let logs = capture.seven_pace().work_logs(Some(from), now(), false).await.unwrap();
    assert_eq!(logs.len(), 501);
    // Newest first; the first copy of a duplicate wins.
    assert_eq!(logs[0].id, "500");
    assert_eq!(logs.iter().find(|log| log.id == "499").unwrap().work_item_id, Some(123));
    let requests = capture.requests().await;
    assert_eq!(requests.len(), 2);
    // Local wall-clock times without offset; the lower bound is one second early.
    assert_eq!(
        requests[0].url.query(),
        Some(
            "api-version=3.2&$toTimestamp=2026-10-06T12:00:00&$count=500&$skip=0&$fromTimestamp=2026-10-05T11:59:59"
        )
    );
    assert_eq!(query_value(&requests[1], "$skip").as_deref(), Some("500"));
}

#[tokio::test]
async fn rate_limit_blocks_subsequent_requests() {
    let capture = Capture::start(vec![status(429).insert_header("Retry-After", "120")]).await;
    let api = capture.seven_pace();
    let first = api.current().await.unwrap_err();
    assert_eq!(first, AppError::RateLimited(add_secs(now(), 120.0)));
    assert_eq!(api.current().await.unwrap_err(), first);
    assert_eq!(capture.requests().await.len(), 1);
}

#[tokio::test]
async fn auth_error_does_not_expose_response_body() {
    let capture =
        Capture::start(vec![ResponseTemplate::new(401).set_body_string("secret-response")]).await;
    let error = capture.seven_pace().current().await.unwrap_err();
    assert_eq!(error, AppError::Authentication("127.0.0.1".into()));
    let text = error.to_string();
    assert!(!text.contains("secret-response"), "{text}");
    assert!(text.contains("Authentication"), "{text}");
}

#[tokio::test]
async fn completion_uses_ticket_project_and_workflow_category_with_read_only_pat_requests() {
    let item = json!({"id": 123, "fields": {"System.Title": "Task", "System.State": "Gereed",
        "System.TeamProject": "Another Project", "System.WorkItemType": "User Story"}});
    let categories = json!({"value": [{"name": "Active", "category": "InProgress"},
        {"name": "Gereed", "category": "Completed"}]});
    let capture = Capture::start(vec![ok_json(item), ok_json(categories)]).await;
    let api = AzureApi::new(capture.url("/example"), "", "fixture-pat", capture.transport.clone());
    let status = api.ticket_workflow(123).await.unwrap();
    assert!(status.completed() && status.state == "Gereed");
    assert_eq!(status.title, "Task");
    let requests = capture.requests().await;
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].url.path(), "/example/_apis/wit/workitems/123");
    assert_eq!(
        requests[0].url.query(),
        Some(
            "api-version=7.1&fields=System.Title,System.State,System.TeamProject,System.WorkItemType"
        )
    );
    // The ticket's own project and type, each one encoded path segment.
    assert_eq!(
        requests[1].url.path(),
        "/example/Another%20Project/_apis/wit/workitemtypes/User%20Story/states"
    );
    assert_eq!(requests[1].url.query(), Some("api-version=7.1"));
    for request in &requests {
        assert_eq!(request.method.as_str(), "GET");
        assert_eq!(header(request, "authorization").as_deref(), Some(PAT_AUTHORIZATION));
    }
    assert!(query_value(&requests[0], "fields").unwrap().contains("System.State"));
}

#[tokio::test]
async fn completion_rejects_wrong_ticket_without_fetching_states() {
    let item = json!({"id": 456, "fields": {"System.State": "Done", "System.TeamProject": "Project",
        "System.WorkItemType": "Task"}});
    let capture = Capture::start(vec![ok_json(item)]).await;
    let api = AzureApi::new(capture.url("/example"), "", "fixture-pat", capture.transport.clone());
    let error = api.ticket_workflow(123).await.unwrap_err();
    assert_eq!(error.to_string(), "Azure returned incomplete ticket status. Try again shortly.");
    assert_eq!(capture.requests().await.len(), 1);
}

#[tokio::test]
async fn completion_does_not_guess_when_categories_are_unknown_or_forbidden() {
    let item = json!({"id": 123, "fields": {"System.State": "Done", "System.TeamProject": "Project",
        "System.WorkItemType": "Task"}});
    let cases = [
        (
            ok_json(json!({"value": [{"name": "Active", "category": "InProgress"}]})),
            AppError::message(
                "Azure could not classify this ticket’s workflow state. Try again shortly.",
            ),
        ),
        (status(403), AppError::AccessDenied("127.0.0.1".into())),
    ];
    for (states, expected) in cases {
        let capture = Capture::start(vec![ok_json(item.clone()), states]).await;
        let api =
            AzureApi::new(capture.url("/example"), "", "fixture-pat", capture.transport.clone());
        assert_eq!(api.ticket_workflow(123).await.unwrap_err(), expected);
    }
}

#[tokio::test]
async fn azure_uses_pat_and_encodes_project() {
    let item = json!({"id": 123, "fields": {"System.Title": "Fix timer", "System.TeamProject": "A Project",
        "System.WorkItemType": "Bug"}});
    let capture = Capture::start(vec![ok_json(item)]).await;
    let api = AzureApi::new(
        capture.url("/example"),
        "A Project",
        "fixture-pat",
        capture.transport.clone(),
    );
    let work_item = api.work_item(123).await.unwrap();
    assert_eq!(work_item.title, "Fix timer");
    assert_eq!(work_item.team_project.as_deref(), Some("A Project"));
    assert_eq!(work_item.kind.as_deref(), Some("Bug"));
    assert_eq!(
        work_item.work_item_link,
        Some(format!("{}/example/A%20Project/_workitems/edit/123", capture.server.uri()))
    );
    let request = &capture.requests().await[0];
    assert!(request.url.as_str().contains("A%20Project"));
    assert_eq!(request.url.path(), "/example/A%20Project/_apis/wit/workitems/123");
    assert_eq!(header(request, "authorization").as_deref(), Some(PAT_AUTHORIZATION));
}

#[derive(Clone, Default)]
struct TokenPersistenceFixture {
    writes: Arc<AtomicUsize>,
    failures: Arc<AtomicUsize>,
    saved: Arc<Mutex<Vec<(SevenPaceTokens, SevenPaceTokens)>>>,
}

impl TokenPersistenceFixture {
    fn failing(failures: usize) -> Self {
        let fixture = Self::default();
        fixture.failures.store(failures, Ordering::SeqCst);
        fixture
    }

    fn writes(&self) -> usize {
        self.writes.load(Ordering::SeqCst)
    }

    fn callback(&self) -> impl PersistTokens + 'static {
        let fixture = self.clone();
        move |next: SevenPaceTokens, previous: SevenPaceTokens| {
            let fixture = fixture.clone();
            async move {
                fixture.writes.fetch_add(1, Ordering::SeqCst);
                fixture.saved.lock().unwrap().push((next, previous));
                let fail = fixture
                    .failures
                    .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| left.checked_sub(1))
                    .is_ok();
                if fail { Err(AppError::message("Fixture persistence failure")) } else { Ok(()) }
            }
        }
    }
}

fn expired_tokens() -> SevenPaceTokens {
    SevenPaceTokens {
        access_token: "expired".into(),
        refresh_token: "old".into(),
        expires_at: ts("0001-01-01T00:00:00Z"),
    }
}

fn renewed_response() -> ResponseTemplate {
    ok_json(json!({"access_token": "renewed", "refresh_token": "rotated", "expires_in": 3600}))
}

#[tokio::test]
async fn pin_creation_status_and_expiry_use_documented_requests() {
    let capture = Capture::start(vec![
        ok_json(json!({"pin": "123456", "secret": "fixture-secret"})),
        ok_json(json!({"status": "Validating"})),
        ok_json(json!({"data": {"status": "Validated"}})),
        ok_json(json!({"status": "WrongOrExpired"})),
    ])
    .await;
    let oauth = capture.oauth();
    let pin = oauth.create_pin().await.unwrap();
    assert_eq!(pin.pin, "123456");
    assert_eq!(oauth.status(&pin.secret).await.unwrap(), SevenPacePinStatus::Waiting);
    assert_eq!(oauth.status(&pin.secret).await.unwrap(), SevenPacePinStatus::Validated);
    assert_eq!(oauth.status(&pin.secret).await.unwrap(), SevenPacePinStatus::Expired);
    let requests = capture.requests().await;
    assert_eq!(requests[0].url.path(), "/api/pin/create");
    assert_eq!(requests[1].url.path(), "/api/pin/status");
    assert!(
        requests
            .iter()
            .all(|r| r.method.as_str() == "POST" && header(r, "authorization").is_none())
    );
    assert_eq!(requests[1].url.query(), Some("api-version=3.2"));
    assert_eq!(serde_json::from_slice::<String>(&requests[1].body).unwrap(), pin.secret);
    assert_eq!(header(&requests[1], "content-type").as_deref(), Some("application/json"));
    assert!(requests[0].body.is_empty());
    assert_eq!(header(&requests[0], "content-type"), None);
}

#[tokio::test]
async fn oauth_exchanges_secret_and_rotates_refresh_token() {
    let capture = Capture::start(vec![
        ok_json(json!({"access_token": "access-1", "refresh_token": "refresh+/=1", "expires_in": "3600", "token_type": "bearer"})),
        ok_json(json!({"access_token": "access-2", "refresh_token": "refresh-2", "expires_in": 3600})),
        ok_json(json!({"access_token": "access-3", "expires_in": 3600})),
    ])
    .await;
    let oauth = capture.oauth();
    let first = oauth.exchange("secret+/= &").await.unwrap();
    let second = oauth.refresh(&first).await.unwrap();
    let third = oauth.refresh(&second).await.unwrap();
    assert_eq!(first.access_token, "access-1");
    assert_eq!(first.expires_at, add_secs(now(), 3600.0));
    assert_eq!(second.refresh_token, "refresh-2");
    assert_eq!(third.refresh_token, "refresh-2");
    assert_eq!(third.access_token, "access-3");
    let requests = capture.requests().await;
    assert!(requests.iter().all(|r| r.method.as_str() == "POST"
        && r.url.path() == "/token"
        && r.url.query().is_none()
        && header(r, "authorization").is_none()
        && header(r, "content-type").as_deref() == Some("application/x-www-form-urlencoded")));
    assert_eq!(
        String::from_utf8_lossy(&requests[0].body),
        "client_id=OpenApi&grant_type=authorization_code&code=secret%2B%2F%3D%20%26"
    );
    assert_eq!(
        String::from_utf8_lossy(&requests[1].body),
        "client_id=OpenApi&grant_type=refresh_token&refresh_token=refresh%2B%2F%3D1"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn oauth_refresh_is_shared_and_persisted_before_requests() {
    let capture =
        Capture::start(vec![renewed_response().set_delay(Duration::from_millis(200))]).await;
    let persistence = TokenPersistenceFixture::default();
    let provider =
        SevenPaceTokenProvider::new(expired_tokens(), capture.oauth(), persistence.callback());
    let mut tasks = JoinSet::new();
    for _ in 0..20 {
        let provider = provider.clone();
        let persistence = persistence.clone();
        tasks.spawn(async move {
            let token = provider.access_token().await;
            // Nobody receives the new token before it is stored.
            assert_eq!(persistence.writes(), 1);
            token
        });
    }
    let values = tasks.join_all().await;
    assert_eq!(values.len(), 20);
    assert!(values.iter().all(|value| value.as_deref() == Ok("renewed")), "{values:?}");
    assert_eq!(capture.requests().await.len(), 1);
    assert_eq!(persistence.writes(), 1);
    let saved = persistence.saved.lock().unwrap().clone();
    assert_eq!(saved[0].0.refresh_token, "rotated");
    assert_eq!(saved[0].1, expired_tokens());
    assert_eq!(provider.access_token().await.unwrap(), "renewed");
    assert_eq!(capture.requests().await.len(), 1);
}

#[tokio::test]
async fn persistence_failure_retries_storage_without_rotating_again() {
    let capture = Capture::start(vec![renewed_response()]).await;
    let persistence = TokenPersistenceFixture::failing(1);
    let provider =
        SevenPaceTokenProvider::new(expired_tokens(), capture.oauth(), persistence.callback());
    assert_eq!(
        provider.access_token().await.unwrap_err(),
        AppError::message("Fixture persistence failure")
    );
    assert_eq!(provider.access_token().await.unwrap(), "renewed");
    assert_eq!(capture.requests().await.len(), 1);
    assert_eq!(persistence.writes(), 2);
    // Both attempts stored the same rotated tokens over the same previous ones.
    let saved = persistence.saved.lock().unwrap().clone();
    assert_eq!(saved[0], saved[1]);
    assert_eq!(provider.tokens().await.refresh_token, "rotated");
}

#[tokio::test]
async fn oauth_tracking_writes_are_not_replayed_on_unauthorized_response() {
    let capture =
        Capture::start(vec![ResponseTemplate::new(401).set_body_string("secret-response")]).await;
    let tokens = SevenPaceTokens {
        access_token: "paired".into(),
        refresh_token: "refresh".into(),
        expires_at: add_secs(now(), 3600.0),
    };
    let provider = SevenPaceTokenProvider::new(
        tokens,
        capture.oauth(),
        |_: SevenPaceTokens, _: SevenPaceTokens| async { Ok(()) },
    );
    let api = SevenPaceApi::with_token_provider(
        capture.url("/"),
        provider,
        capture.transport.clone(),
        Cal::brussels(),
    )
    .with_clock(capture.clock.clock());
    assert!(api.start(Some(123), Some("dev"), None).await.is_err());
    let requests = capture.requests().await;
    assert_eq!(requests.len(), 1);
    assert_eq!(header(&requests[0], "authorization").as_deref(), Some("Bearer paired"));
}

#[tokio::test]
async fn malformed_pairing_responses_never_expose_secrets() {
    let capture = Capture::start(vec![
        ok_json(json!({"status": "unknown-secret"})),
        ok_json(json!({"access_token": "secret-value", "expires_in": 0})),
    ])
    .await;
    let oauth = capture.oauth();
    let error = oauth.status("secret").await.unwrap_err().to_string();
    assert!(!error.contains("unknown-secret"), "{error}");
    let error = oauth.exchange("secret").await.unwrap_err().to_string();
    assert!(!error.contains("secret-value"), "{error}");
    assert!(SevenPaceOAuth::for_workspace("https://attacker.test", local_transport()).is_err());
}

#[tokio::test]
async fn worklog_read_requests_editability_and_patch_only_changes_time() {
    let original = editable_log();
    let mut changed = original.clone();
    changed.length = 7200.0;
    let capture =
        Capture::start(vec![ok_json(json!({"data": original})), ok_json(json!({"data": changed}))])
            .await;
    let api = capture.seven_pace();
    assert_eq!(api.work_log(&original.id).await.unwrap().is_can_edit, Some(true));
    let start = original.date(Cal::brussels().tz()).unwrap();
    let edit = WorkLogTimeEdit::new(start, add_secs(start, 7200.0));
    assert_eq!(api.update_work_log_time(&original.id, &edit).await.unwrap().length, 7200.0);
    let requests = capture.requests().await;
    assert!(requests[0].url.query().unwrap().contains("$includeEditable=true"));
    assert_eq!(requests[1].method.as_str(), "PATCH");
    assert_eq!(requests[1].url.path(), format!("/api/rest/workLogs/{}", original.id));
    assert_eq!(json_body(&requests[1]), json!({"timeStamp": original.timestamp, "length": 7200}));
}

#[tokio::test]
async fn overlap_history_has_no_lower_bound_that_could_hide_long_entries() {
    let capture = Capture::start(vec![ok_json(json!({"data": []}))]).await;
    capture.seven_pace().work_logs_before(local_date("2026-09-28T10:00:00")).await.unwrap();
    let request = &capture.requests().await[0];
    assert_eq!(query_value(request, "$fromTimestamp"), None);
    assert_eq!(query_value(request, "$toTimestamp").as_deref(), Some("2026-09-28T10:00:01"));
}

#[tokio::test]
async fn confirming_expired_activity_prompt_does_not_send_write() {
    let mut checking = state(Some(123), None);
    checking.track.as_mut().unwrap().tracking_state = WireValue::Number(3);
    let capture = Capture::start(vec![ok_json(json_of(&stopped(1, "first")))]).await;
    let expected = TrackingAttention::from_state(&checking);
    let error = capture.seven_pace().confirm_activity(expected.as_ref()).await.unwrap_err();
    assert_eq!(error, AppError::RemoteChanged);
    let requests = capture.requests().await;
    assert_eq!(methods(&requests), ["GET"]);
}

#[tokio::test]
async fn activity_confirmation_rechecks_and_verifies_continued_tracking() {
    let mut checking = state(Some(123), None);
    checking.track.as_mut().unwrap().tracking_state = WireValue::Number(3);
    let capture = Capture::start(vec![
        ok_json(json_of(&checking)),
        ok_json(json_of(&state(Some(123), None))),
    ])
    .await;
    let expected = TrackingAttention::from_state(&checking);
    assert!(capture.seven_pace().confirm_activity(expected.as_ref()).await.unwrap().running());
    let requests = capture.requests().await;
    assert_eq!(methods(&requests), ["GET", "POST"]);
    assert_eq!(requests[1].url.path(), "/api/tracking/client/activityCheck");
    assert!(requests[1].body.is_empty());
}

#[tokio::test]
async fn mutation_crud_uses_documented_bodies_and_only_404_means_absent() {
    let mut log = editable_log();
    log.is_can_delete = Some(true);
    log.billable_length = Some(1800.0);
    let payload = json!({"data": log});
    let capture = Capture::start(vec![
        ok_json(payload.clone()),
        ok_json(payload),
        ok_json(json!({"data": {}})),
        status(404),
        status(403),
    ])
    .await;
    let api = capture.seven_pace();
    // Swift `WorkLogDraft(log)`; its constructor is ported with `att_core::worklog::ops`.
    let draft = WorkLogDraft {
        existing_id: Some(log.id.clone()),
        restored_id: None,
        start: log.date(Cal::brussels().tz()).unwrap(),
        seconds: 3600,
        billable_seconds: 1800,
        ticket_id: Some(123),
        comment: Some("Development".into()),
        activity_id: None,
        user_id: None,
        allow_default_activity: false,
    };
    api.create_work_log(&draft).await.unwrap();
    api.replace_work_log_time(&log.id, &draft).await.unwrap();
    api.delete_work_log(&log.id).await.unwrap();
    assert_eq!(api.find_work_log(&log.id).await.unwrap(), None);
    assert_eq!(
        api.find_work_log(&log.id).await.unwrap_err(),
        AppError::AccessDenied("127.0.0.1".into())
    );
    let requests = capture.requests().await;
    assert_eq!(methods(&requests), ["POST", "PATCH", "DELETE", "GET", "GET"]);
    assert_eq!(requests[0].url.path(), "/api/rest/workLogs");
    assert_eq!(
        json_body(&requests[0]),
        json!({"timeStamp": log.timestamp, "length": 3600, "billableLength": 1800,
            "workItemId": 123, "comment": "Development"})
    );
    assert_eq!(
        json_body(&requests[1]),
        json!({"timeStamp": log.timestamp, "length": 3600, "billableLength": 1800})
    );
    assert_eq!(requests[2].url.path(), format!("/api/rest/workLogs/{}", log.id));
    assert!(requests[2].body.is_empty());
    assert_eq!(header(&requests[2], "content-type"), None);
}

#[tokio::test]
async fn azure_context_requests_relations_and_uses_azure_authentication_only() {
    let capture = Capture::start(vec![ok_json(json!({"id": 123,
        "fields": {"System.Title": "Context", "System.State": "Active"}, "relations": []}))])
    .await;
    let api =
        AzureApi::new(capture.url("/test"), "Sample", "fixture-pat", capture.transport.clone());
    let result = api.ticket_context(123).await.unwrap();
    assert!(result.id == 123 && result.state == "Active");
    let request = &capture.requests().await[0];
    assert_eq!(request.url.path(), "/test/Sample/_apis/wit/workitems/123");
    assert_eq!(request.url.query(), Some("api-version=7.1&$expand=Relations"));
    assert_eq!(header(request, "authorization").as_deref(), Some(PAT_AUTHORIZATION));
}

// ---------------------------------------------------------------------------------------------
// New in 2.0

fn batch_item(id: i64) -> Value {
    json!({"id": id, "rev": 3, "fields": {"System.Title": format!("Ticket {id}"),
        "System.TeamProject": "A Project", "System.WorkItemType": "Task"},
        "url": format!("https://dev.azure.com/example/_apis/wit/workItems/{id}")})
}

#[tokio::test]
async fn work_items_are_read_in_batches_of_200_unique_ids() {
    // 250 tickets plus duplicates and IDs that cannot be tickets.
    let ids: Vec<i64> = (1..=250).chain([5, 7, 0, -3, i64::from(i32::MAX) + 1]).collect();
    let first: Vec<Value> = (1..=200).map(batch_item).collect();
    // Azure answers `null` for an item it omits (deleted or not readable).
    let second: Vec<Value> =
        (201..=250).map(|id| if id == 230 { Value::Null } else { batch_item(id) }).collect();
    let capture = Capture::start(vec![
        ok_json(json!({"count": 200, "value": first})),
        ok_json(json!({"count": 50, "value": second})),
    ])
    .await;
    let api = AzureApi::new(
        capture.url("/example"),
        "A Project",
        "fixture-pat",
        capture.transport.clone(),
    );
    let items = api.work_items(&ids).await.unwrap();
    assert_eq!(items.len(), 249);
    assert_eq!(
        items[0],
        WorkItem {
            id: 1,
            title: "Ticket 1".into(),
            team_project: Some("A Project".into()),
            kind: Some("Task".into()),
            work_item_link: Some(format!(
                "{}/example/A%20Project/_workitems/edit/1",
                capture.server.uri()
            )),
        }
    );
    assert!(!items.iter().any(|item| item.id == 230));
    let requests = capture.requests().await;
    assert_eq!(requests.len(), 2);
    for request in &requests {
        assert_eq!(request.method.as_str(), "POST");
        // Organization level, whatever the configured project.
        assert_eq!(request.url.path(), "/example/_apis/wit/workitemsbatch");
        assert_eq!(request.url.query(), Some("api-version=7.1"));
        assert_eq!(header(request, "authorization").as_deref(), Some(PAT_AUTHORIZATION));
        assert_eq!(header(request, "content-type").as_deref(), Some("application/json"));
    }
    assert_eq!(
        json_body(&requests[0]),
        json!({"ids": (1..=200).collect::<Vec<i64>>(),
            "fields": ["System.Title", "System.TeamProject", "System.WorkItemType"],
            "errorPolicy": "omit"})
    );
    assert_eq!(json_body(&requests[1])["ids"], json!((201..=250).collect::<Vec<i64>>()));
}

#[tokio::test]
async fn work_items_tolerate_odd_fields_and_skip_requests_without_ids() {
    let capture = Capture::start(vec![ok_json(json!({"value": [
        {"id": 9, "fields": {"System.Title": 5, "System.WorkItemType": "Bug"}},
        {"id": 10}
    ]}))])
    .await;
    let api = AzureApi::new(capture.url("/example"), "", "fixture-pat", capture.transport.clone());
    assert_eq!(api.work_items(&[]).await.unwrap(), Vec::new());
    assert_eq!(api.work_items(&[0, -1]).await.unwrap(), Vec::new());
    assert!(capture.requests().await.is_empty());
    let items = api.work_items(&[9, 10]).await.unwrap();
    assert_eq!(items[0].title, "Work item #9");
    assert_eq!(items[0].kind.as_deref(), Some("Bug"));
    assert_eq!(items[1].title, "Work item #10");
    assert_eq!(
        items[1].work_item_link,
        Some(format!("{}/example/_workitems/edit/10", capture.server.uri()))
    );
}

#[test]
fn oauth_tokens_decode_the_1_14_keychain_item() {
    // `JSONEncoder` default: `expiresAt` in seconds since 2001-01-01.
    let swift = r#"{"accessToken":"access","refreshToken":"refresh","expiresAt":781351200}"#;
    let tokens: SevenPaceTokens = serde_json::from_str(swift).unwrap();
    assert_eq!(tokens.access_token, "access");
    assert_eq!(tokens.expires_at, swift_date::to_timestamp(781_351_200.0));
    assert_eq!(tokens.expires_at, ts("2025-10-05T10:00:00Z"));
    let written = serde_json::to_value(&tokens).unwrap();
    assert_eq!(
        written,
        json!({"accessToken": "access", "refreshToken": "refresh", "expiresAt": "2025-10-05T10:00:00Z"})
    );
    assert_eq!(serde_json::from_value::<SevenPaceTokens>(written).unwrap(), tokens);
}

#[tokio::test]
async fn token_provider_renews_only_in_the_last_minute() {
    let capture = Capture::start(vec![renewed_response()]).await;
    let tokens = SevenPaceTokens {
        access_token: "current".into(),
        refresh_token: "refresh".into(),
        expires_at: add_secs(now(), 61.0),
    };
    let persistence = TokenPersistenceFixture::default();
    let provider = SevenPaceTokenProvider::new(tokens, capture.oauth(), persistence.callback());
    assert_eq!(provider.access_token().await.unwrap(), "current");
    assert!(capture.requests().await.is_empty());
    capture.clock.advance(1.0);
    assert_eq!(provider.access_token().await.unwrap(), "renewed");
    let requests = capture.requests().await;
    assert_eq!(requests.len(), 1);
    assert_eq!(
        String::from_utf8_lossy(&requests[0].body),
        "client_id=OpenApi&grant_type=refresh_token&refresh_token=refresh"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_callers_share_a_failed_renewal_and_the_next_call_retries() {
    let capture =
        Capture::start(vec![status(401).set_delay(Duration::from_millis(200)), renewed_response()])
            .await;
    let persistence = TokenPersistenceFixture::default();
    let provider =
        SevenPaceTokenProvider::new(expired_tokens(), capture.oauth(), persistence.callback());
    let mut tasks = JoinSet::new();
    for _ in 0..20 {
        let provider = provider.clone();
        tasks.spawn(async move { provider.access_token().await });
    }
    let values = tasks.join_all().await;
    assert!(
        values.iter().all(|value| value == &Err(AppError::Authentication("127.0.0.1".into()))),
        "{values:?}"
    );
    assert_eq!(capture.requests().await.len(), 1);
    assert_eq!(persistence.writes(), 0);
    assert_eq!(provider.access_token().await.unwrap(), "renewed");
    assert_eq!(capture.requests().await.len(), 2);
}

#[tokio::test]
async fn a_cancelled_caller_does_not_lose_rotated_tokens() {
    let capture =
        Capture::start(vec![renewed_response().set_delay(Duration::from_millis(300))]).await;
    let persistence = TokenPersistenceFixture::default();
    let provider =
        SevenPaceTokenProvider::new(expired_tokens(), capture.oauth(), persistence.callback());
    let cancelled = tokio::time::timeout(Duration::from_millis(50), provider.access_token()).await;
    assert!(cancelled.is_err(), "the caller gave up before the refresh answered");
    // The renewal finishes on its own task and stores the rotated tokens.
    assert_eq!(provider.access_token().await.unwrap(), "renewed");
    assert_eq!(capture.requests().await.len(), 1);
    assert_eq!(persistence.writes(), 1);
}
