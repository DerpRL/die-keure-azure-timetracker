//! The HTTP transport shared by every client. Ported from `HTTPTransport` and
//! `NoRedirectDelegate` in API.swift.
//!
//! Same rules as the URLSession setup in 1.14.2: an ephemeral session (no cookies, no cache),
//! redirects refused, 20 s idle and 30 s total timeouts, and a per-host block after HTTP 429 that
//! fails later requests locally until `Retry-After` has passed.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use jiff::Timestamp;
use jiff::fmt::rfc2822::DateTimeParser;
use reqwest::header::RETRY_AFTER;
use reqwest::{Client, Request};

use att_core::time::add_secs;
use att_core::{AppError, Result};

use crate::{Clock, system_clock};

/// Sent with every request.
pub const USER_AGENT: &str = "AzureTimetracker/2.0";

/// Seconds to wait after a 429 without a usable `Retry-After`.
const DEFAULT_RETRY_AFTER_SECS: f64 = 60.0;

static HTTP_DATE: DateTimeParser = DateTimeParser::new();

/// Transport settings. The defaults are the production settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransportOptions {
    /// Longest wait for a connection or between two reads (URLSession `timeoutIntervalForRequest`).
    pub idle_timeout: Duration,
    /// Longest time for a whole request including its body (`timeoutIntervalForResource`).
    pub total_timeout: Duration,
    /// Use the OS and environment proxy settings, as URLSession did.
    pub system_proxy: bool,
    /// Refuse anything but `https` URLs. Only tests against a local mock server turn this off;
    /// production URLs come from [`crate::Endpoint`], which already requires HTTPS.
    pub https_only: bool,
}

impl Default for TransportOptions {
    fn default() -> Self {
        Self {
            idle_timeout: Duration::from_secs(20),
            total_timeout: Duration::from_secs(30),
            system_proxy: true,
            https_only: true,
        }
    }
}

/// Sends requests and maps HTTP failures to [`AppError`]s that never contain response bodies,
/// tokens or query strings. Cheap to clone; clones share the connection pool and the 429 blocks,
/// so one transport should serve every client of a workspace (as in 1.14.2).
///
/// No request is ever retried here. reqwest's built-in policy only re-sends HTTP/2 requests the
/// server explicitly refused unprocessed (`REFUSED_STREAM`, graceful `GOAWAY`; RFC 9113 §8.7),
/// so a write that may have reached the server is never replayed.
#[derive(Clone)]
pub struct HttpTransport {
    client: Client,
    https_only: bool,
    clock: Clock,
    blocked_until: Arc<Mutex<HashMap<String, Timestamp>>>,
}

impl std::fmt::Debug for HttpTransport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpTransport")
            .field("https_only", &self.https_only)
            .finish_non_exhaustive()
    }
}

impl HttpTransport {
    /// The production transport.
    pub fn new() -> Result<Self> {
        Self::with_options(TransportOptions::default())
    }

    pub fn with_options(options: TransportOptions) -> Result<Self> {
        let mut builder = Client::builder()
            .user_agent(USER_AGENT)
            .redirect(reqwest::redirect::Policy::none())
            .referer(false)
            .connect_timeout(options.idle_timeout)
            .read_timeout(options.idle_timeout)
            .timeout(options.total_timeout);
        if !options.system_proxy {
            builder = builder.no_proxy();
        }
        let client = builder.build().map_err(|_| {
            AppError::message("Secure connections could not be set up on this computer.")
        })?;
        Ok(Self {
            client,
            https_only: options.https_only,
            clock: system_clock(),
            blocked_until: Arc::default(),
        })
    }

    /// Replaces the clock used for 429 blocks (tests).
    pub fn with_clock(mut self, clock: Clock) -> Self {
        self.clock = clock;
        self
    }

    /// Sends `request` and returns the body of a 2xx response (Swift `data(for:)`).
    ///
    /// - 401 → [`AppError::Authentication`], 403 → [`AppError::AccessDenied`] (both name the
    ///   host), 404 → [`AppError::NotFound`].
    /// - 429 → [`AppError::RateLimited`]; every later request to the host fails the same way,
    ///   without touching the network, until the `Retry-After` instant.
    /// - 3xx is never followed. Other statuses name the host and the code only.
    /// - Timeouts → [`AppError::Timeout`]; other transport failures → [`AppError::Network`].
    pub async fn data(&self, request: Request) -> Result<Vec<u8>> {
        let host = request.url().host_str().unwrap_or_default().to_string();
        if self.https_only && request.url().scheme() != "https" {
            return Err(AppError::message("Only secure HTTPS connections are allowed."));
        }
        if let Some(until) = self.blocked(&host) {
            return Err(AppError::RateLimited(until));
        }
        let response =
            self.client.execute(request).await.map_err(|error| transport_error(&error, &host))?;
        let status = response.status().as_u16();
        match status {
            200..=299 => response
                .bytes()
                .await
                .map(|body| body.to_vec())
                .map_err(|error| transport_error(&error, &host)),
            401 => Err(AppError::Authentication(host)),
            403 => Err(AppError::AccessDenied(host)),
            404 => Err(AppError::NotFound),
            429 => {
                let header = response.headers().get(RETRY_AFTER).and_then(|v| v.to_str().ok());
                let until = retry_after(header, (self.clock)());
                self.lock().insert(host, until);
                Err(AppError::RateLimited(until))
            }
            300..=399 => Err(AppError::message(
                "The server redirected the request. Check the exact workspace URL in Settings.",
            )),
            _ => Err(AppError::message(format!(
                "{host} returned HTTP {status}. Refresh to check the actual timer before trying again."
            ))),
        }
    }

    fn blocked(&self, host: &str) -> Option<Timestamp> {
        let now = (self.clock)();
        let mut blocked = self.lock();
        match blocked.get(host) {
            Some(until) if *until > now => Some(*until),
            Some(_) => {
                blocked.remove(host);
                None
            }
            None => None,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Timestamp>> {
        // The map holds plain values, so a panic elsewhere cannot leave it inconsistent.
        self.blocked_until.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// When a 429 block ends: `Retry-After` as seconds (at least 1) or as an HTTP-date; 60 s when the
/// header is missing or unreadable. Non-finite seconds count as unreadable, so `inf` cannot block
/// a host until the app restarts.
pub(crate) fn retry_after(value: Option<&str>, now: Timestamp) -> Timestamp {
    let Some(value) = value.map(str::trim) else {
        return add_secs(now, DEFAULT_RETRY_AFTER_SECS);
    };
    if let Ok(seconds) = value.parse::<f64>()
        && seconds.is_finite()
    {
        return add_secs(now, seconds.max(1.0));
    }
    // IMF-fixdate (`Sun, 06 Nov 1994 08:49:37 GMT`) is an RFC 2822 date with the zone "GMT".
    HTTP_DATE.parse_timestamp(value).unwrap_or_else(|_| add_secs(now, DEFAULT_RETRY_AFTER_SECS))
}

/// A short message without the URL: reqwest's own text includes the query string.
fn transport_error(error: &reqwest::Error, host: &str) -> AppError {
    if error.is_timeout() {
        AppError::Timeout
    } else if error.is_connect() {
        AppError::Network(format!(
            "Could not connect to {host}. Check your network connection and try again."
        ))
    } else {
        AppError::Network(format!(
            "The connection to {host} was interrupted. Refresh to check the actual timer before trying again."
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_after_reads_seconds_dates_and_defaults() {
        let now: Timestamp = "2026-10-06T10:00:00Z".parse().unwrap();
        let at = |value: Option<&str>| retry_after(value, now).to_string();
        assert_eq!(at(Some("120")), "2026-10-06T10:02:00Z");
        assert_eq!(at(Some(" 1.5 ")), "2026-10-06T10:00:01.5Z");
        assert_eq!(at(Some("0")), "2026-10-06T10:00:01Z");
        assert_eq!(at(Some("-30")), "2026-10-06T10:00:01Z");
        assert_eq!(at(Some("Tue, 06 Oct 2026 10:05:00 GMT")), "2026-10-06T10:05:00Z");
        assert_eq!(at(Some("Tue, 06 Oct 2026 12:05:00 +0200")), "2026-10-06T10:05:00Z");
        for unusable in [None, Some(""), Some("soon"), Some("inf"), Some("NaN")] {
            assert_eq!(at(unusable), "2026-10-06T10:01:00Z", "{unusable:?}");
        }
    }
}
