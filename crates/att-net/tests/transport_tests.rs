//! Transport rules from `HTTPTransport` in API.swift that the Swift suite did not cover directly:
//! `Retry-After` dates, the local 429 block, redirect refusal, timeouts, redaction, cookies and
//! HTTPS-only.

mod support;

use std::time::Duration;

use wiremock::matchers::path;
use wiremock::{Mock, MockServer, ResponseTemplate};

use att_core::service::{TrackingService, WorkLogMutationService};
use att_core::time::add_secs;
use att_core::{AppError, Cal};
use att_net::{AzureApi, HttpTransport, SevenPaceApi, TransportOptions, USER_AGENT, Url};
use support::*;

#[tokio::test]
async fn retry_after_http_date_blocks_the_host_until_that_instant() {
    let capture = Capture::start(vec![
        status(429).insert_header("Retry-After", "Tue, 06 Oct 2026 10:05:00 GMT"),
        ok_json(json_of(&state(Some(1), None))),
    ])
    .await;
    let api = capture.seven_pace();
    let until = ts("2026-10-06T10:05:00Z");
    assert_eq!(api.current().await.unwrap_err(), AppError::RateLimited(until));
    capture.clock.set(ts("2026-10-06T10:04:59Z"));
    assert_eq!(api.current().await.unwrap_err(), AppError::RateLimited(until));
    assert_eq!(capture.requests().await.len(), 1, "blocked requests never reach the server");
    capture.clock.set(until);
    assert!(api.current().await.is_ok());
    assert_eq!(capture.requests().await.len(), 2);
}

#[tokio::test]
async fn missing_or_unreadable_retry_after_blocks_for_a_minute() {
    for header_value in [None, Some("soon"), Some("0")] {
        let mut response = status(429);
        if let Some(value) = header_value {
            response = response.insert_header("Retry-After", value);
        }
        let capture = Capture::start(vec![response]).await;
        let seconds = if header_value == Some("0") { 1.0 } else { 60.0 };
        assert_eq!(
            capture.seven_pace().current().await.unwrap_err(),
            AppError::RateLimited(add_secs(now(), seconds)),
            "{header_value:?}"
        );
    }
}

#[tokio::test]
async fn the_429_block_covers_every_client_sharing_the_transport() {
    let capture = Capture::start(vec![status(429).insert_header("Retry-After", "30")]).await;
    assert!(capture.seven_pace().current().await.is_err());
    // Same host (127.0.0.1), same transport: the PIN endpoint and Azure are blocked locally too.
    let blocked = AppError::RateLimited(add_secs(now(), 30.0));
    assert_eq!(capture.oauth().create_pin().await.unwrap_err(), blocked);
    let azure = AzureApi::new(capture.url("/org"), "", "fixture-pat", capture.transport.clone());
    assert_eq!(azure.work_item(1).await.unwrap_err(), blocked);
    assert_eq!(capture.requests().await.len(), 1);
    // A separate transport keeps its own blocks.
    let fresh = SevenPaceApi::with_token(capture.url("/"), "t", local_transport(), Cal::brussels());
    assert_eq!(
        fresh.current().await.unwrap_err().to_string(),
        "127.0.0.1 returned HTTP 500. Refresh to check the actual timer before trying again."
    );
    assert_eq!(capture.requests().await.len(), 2);
}

#[tokio::test]
async fn redirects_are_refused_and_never_followed() {
    for code in [301, 302, 303, 307, 308] {
        let server = MockServer::start().await;
        Mock::given(path("/api/tracking/client/startTracking"))
            .respond_with(
                ResponseTemplate::new(code)
                    .insert_header("Location", format!("{}/elsewhere", server.uri())),
            )
            .mount(&server)
            .await;
        Mock::given(path("/elsewhere"))
            .respond_with(ok_json(json_of(&state(Some(1), None))))
            .expect(0)
            .mount(&server)
            .await;
        let base = Url::parse(&server.uri()).unwrap();
        let api = SevenPaceApi::with_token(base, "t", local_transport(), Cal::brussels());
        let error = api.start(Some(1), None, None).await.unwrap_err();
        assert_eq!(
            error.to_string(),
            "The server redirected the request. Check the exact workspace URL in Settings.",
            "HTTP {code}"
        );
        assert_eq!(server.received_requests().await.unwrap().len(), 1, "HTTP {code}");
    }
}

#[tokio::test]
async fn statuses_map_to_errors_without_bodies() {
    let secret = "secret-response";
    let cases = [
        (
            500,
            AppError::message(
                "127.0.0.1 returned HTTP 500. Refresh to check the actual timer before trying again.",
            ),
        ),
        (
            400,
            AppError::message(
                "127.0.0.1 returned HTTP 400. Refresh to check the actual timer before trying again.",
            ),
        ),
        (403, AppError::AccessDenied("127.0.0.1".into())),
        (404, AppError::NotFound),
    ];
    for (code, expected) in cases {
        let capture =
            Capture::start(vec![ResponseTemplate::new(code).set_body_string(secret)]).await;
        let error = capture.seven_pace().current().await.unwrap_err();
        assert_eq!(error, expected, "HTTP {code}");
        assert!(!error.to_string().contains(secret));
    }
}

#[tokio::test]
async fn malformed_success_bodies_are_reported_without_their_content() {
    for body in [r#"{"track": "secret-value"}"#, "secret-value", ""] {
        let capture = Capture::start(vec![ResponseTemplate::new(200).set_body_string(body)]).await;
        let error = capture.seven_pace().current().await.unwrap_err();
        assert_eq!(
            error.to_string(),
            "The data couldn’t be read because it isn’t in the correct format.",
            "{body:?}"
        );
    }
}

#[tokio::test]
async fn delete_requires_a_json_object_like_swift() {
    let id = "11111111-1111-1111-1111-111111111111";
    for (body, accepted) in
        [("{}", true), (r#"{"data":{"id":"x"}}"#, true), ("", false), ("[]", false)]
    {
        let capture = Capture::start(vec![ResponseTemplate::new(200).set_body_string(body)]).await;
        assert_eq!(capture.seven_pace().delete_work_log(id).await.is_ok(), accepted, "{body:?}");
    }
}

#[tokio::test]
async fn transport_failures_name_only_the_host() {
    // A port that refuses connections.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let base = Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap();
    let api = SevenPaceApi::with_token(base, "secret-token", local_transport(), Cal::brussels());
    let error = api.work_logs(Some(now()), now(), true).await.unwrap_err();
    assert_eq!(
        error,
        AppError::Network(
            "Could not connect to 127.0.0.1. Check your network connection and try again.".into()
        )
    );
    let text = error.to_string();
    for leaked in ["api-version", "Timestamp", "secret-token", &port.to_string()] {
        assert!(!text.contains(leaked), "{text}");
    }
}

#[tokio::test]
async fn slow_responses_time_out() {
    let server = MockServer::start().await;
    Mock::given(path("/api/tracking/client/current"))
        .respond_with(
            ok_json(json_of(&state(Some(1), None))).set_delay(Duration::from_millis(1500)),
        )
        .mount(&server)
        .await;
    let options = TransportOptions {
        idle_timeout: Duration::from_millis(200),
        total_timeout: Duration::from_millis(300),
        ..local_options()
    };
    let transport = HttpTransport::with_options(options).unwrap();
    let api = SevenPaceApi::with_token(
        Url::parse(&server.uri()).unwrap(),
        "t",
        transport,
        Cal::brussels(),
    );
    assert_eq!(api.current().await.unwrap_err(), AppError::Timeout);
}

#[tokio::test]
async fn requests_identify_the_app_and_never_send_cookies() {
    let capture = Capture::start(vec![
        ok_json(json_of(&state(Some(1), None))).insert_header("Set-Cookie", "session=abc; Path=/"),
        ok_json(json_of(&state(Some(1), None))),
    ])
    .await;
    let api = capture.seven_pace();
    api.current().await.unwrap();
    api.current().await.unwrap();
    let requests = capture.requests().await;
    for request in &requests {
        assert_eq!(header(request, "user-agent").as_deref(), Some(USER_AGENT));
        assert_eq!(header(request, "cookie"), None);
    }
    assert_eq!(USER_AGENT, "AzureTimetracker/2.0");
}

#[tokio::test]
async fn the_production_transport_refuses_plain_http_before_sending() {
    let capture = Capture::start(vec![]).await;
    let transport = HttpTransport::with_options(TransportOptions {
        system_proxy: false,
        ..TransportOptions::default()
    })
    .unwrap();
    let api = SevenPaceApi::with_token(capture.url("/"), "t", transport, Cal::brussels());
    assert_eq!(
        api.current().await.unwrap_err().to_string(),
        "Only secure HTTPS connections are allowed."
    );
    assert!(capture.requests().await.is_empty());
    assert_eq!(TransportOptions::default().idle_timeout, Duration::from_secs(20));
    assert_eq!(TransportOptions::default().total_timeout, Duration::from_secs(30));
    assert!(TransportOptions::default().https_only && TransportOptions::default().system_proxy);
}

#[tokio::test]
async fn invalid_worklog_ids_and_writes_never_reach_the_network() {
    use att_core::service::WorkLogEditingService;
    use att_core::worklog::{WorkLogDraft, WorkLogTimeEdit};

    let capture = Capture::start(vec![]).await;
    let api = capture.seven_pace();
    let invalid = "../current";
    assert_eq!(
        api.work_log(invalid).await.unwrap_err().to_string(),
        "This entry has an invalid 7pace worklog ID."
    );
    assert_eq!(api.delete_work_log(invalid).await.unwrap_err().to_string(), "Invalid worklog ID.");
    // An end in the future (the clock is pinned to 2026-10-06T10:00:00Z).
    let future = WorkLogTimeEdit::new(now(), add_secs(now(), 60.0));
    let id = "11111111-1111-1111-1111-111111111111";
    assert_eq!(
        api.update_work_log_time(id, &future).await.unwrap_err().to_string(),
        "Choose an end after the start, with no time in the future."
    );
    // 02:30 on 25 October 2026 happens twice in Brussels. 7pace's offset-free local time reads
    // back as the second one (as with 1.14.x's DateFormatter), so the first cannot be sent.
    let first_half_past_two = ts("2026-10-25T00:30:00Z");
    let ambiguous = WorkLogTimeEdit::new(first_half_past_two, add_secs(first_half_past_two, 60.0));
    capture.clock.set(ts("2026-10-26T00:00:00Z"));
    assert_eq!(
        api.update_work_log_time(id, &ambiguous).await.unwrap_err().to_string(),
        "This start time is ambiguous during a clock change. Choose an unambiguous local time."
    );
    // Ticket-free time needs a comment.
    let draft = WorkLogDraft {
        existing_id: None,
        restored_id: None,
        start: ts("2026-10-05T08:00:00Z"),
        seconds: 600,
        billable_seconds: 0,
        ticket_id: None,
        comment: Some("  ".into()),
        activity_id: None,
        user_id: None,
        allow_default_activity: true,
    };
    assert_eq!(
        api.create_work_log(&draft).await.unwrap_err().to_string(),
        "Choose a valid ticket or add a comment for ticket-free time."
    );
    assert!(capture.requests().await.is_empty());
}
