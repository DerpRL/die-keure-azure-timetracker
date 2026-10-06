//! 7pace Mobile PIN pairing and OAuth tokens. Ported from SevenPaceAuth.swift.
//!
//! Pairing: [`SevenPaceOAuth::create_pin`] → the user enters the PIN in 7pace → poll
//! [`SevenPaceOAuth::status`] → [`SevenPaceOAuth::exchange`] the secret for tokens. The app
//! stores the tokens (Keychain item `7pace-oauth:<host>`) and builds a [`SevenPaceTokenProvider`]
//! that renews them for every client.

use std::future::Future;
use std::sync::Arc;

use async_trait::async_trait;
use jiff::Timestamp;
use reqwest::{Method, Url};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{Mutex, watch};

use att_core::text::NonEmpty;
use att_core::time::{add_secs, diff_secs};
use att_core::{AppError, Result};

use crate::auth::Authorizer;
use crate::endpoint::Endpoint;
use crate::transport::HttpTransport;
use crate::wire;
use crate::{Clock, system_clock};

/// Tokens are renewed when this many seconds or fewer remain.
const RENEW_MARGIN_SECS: f64 = 60.0;

/// OAuth credentials from PIN pairing.
///
/// Persisted as JSON in the Keychain item `7pace-oauth:<host>`. Reads the 1.14.x item directly
/// (`expiresAt` as seconds since 2001) and writes RFC 3339. `Debug` never shows the tokens.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SevenPaceTokens {
    pub access_token: String,
    pub refresh_token: String,
    #[serde(with = "att_core::time::flex_date")]
    pub expires_at: Timestamp,
}

impl std::fmt::Debug for SevenPaceTokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SevenPaceTokens")
            .field("access_token", &"<redacted>")
            .field("refresh_token", &"<redacted>")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

/// A pairing code: `pin` is shown to the user, `secret` stays in the app.
#[derive(Clone, PartialEq, Eq, Deserialize)]
pub struct SevenPacePin {
    pub pin: String,
    pub secret: String,
}

impl std::fmt::Debug for SevenPacePin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SevenPacePin")
            .field("pin", &self.pin)
            .field("secret", &"<redacted>")
            .finish()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SevenPacePinStatus {
    Waiting,
    Validated,
    Expired,
}

/// The unauthenticated PIN and token endpoints of one 7pace workspace.
#[derive(Clone)]
pub struct SevenPaceOAuth {
    base_url: Url,
    transport: HttpTransport,
    clock: Clock,
}

impl std::fmt::Debug for SevenPaceOAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SevenPaceOAuth").field("base_url", &self.base_url.as_str()).finish()
    }
}

impl SevenPaceOAuth {
    /// A client for `base_url` as given. Production code passes a URL from
    /// [`Endpoint::seven_pace`] (or uses [`SevenPaceOAuth::for_workspace`]).
    pub fn new(base_url: Url, transport: HttpTransport) -> Self {
        Self { base_url, transport, clock: system_clock() }
    }

    /// Validates `workspace` like [`Endpoint::seven_pace`] (Swift `init(workspace:transport:)`).
    pub fn for_workspace(workspace: &str, transport: HttpTransport) -> Result<Self> {
        Ok(Self::new(Endpoint::seven_pace(workspace)?, transport))
    }

    /// Replaces the clock that dates token expiry (tests).
    pub fn with_clock(mut self, clock: Clock) -> Self {
        self.clock = clock;
        self
    }

    pub fn base_url(&self) -> &Url {
        &self.base_url
    }

    /// `POST api/pin/create`.
    pub async fn create_pin(&self) -> Result<SevenPacePin> {
        let pin: SevenPacePin = self.pin_request("create", None).await?;
        if pin.pin.is_empty() || pin.secret.is_empty() {
            return Err(AppError::message(
                "7pace returned an incomplete pairing code. Request a new PIN.",
            ));
        }
        Ok(pin)
    }

    /// `POST api/pin/status` with the secret as a JSON string.
    pub async fn status(&self, secret: &str) -> Result<SevenPacePinStatus> {
        #[derive(Deserialize)]
        struct Response {
            status: String,
        }
        let response: Response = self.pin_request("status", Some(wire::encode(&secret)?)).await?;
        match response.status.to_lowercase().as_str() {
            "validated" => Ok(SevenPacePinStatus::Validated),
            "validating" => Ok(SevenPacePinStatus::Waiting),
            "wrongorexpired" | "invalid" => Ok(SevenPacePinStatus::Expired),
            _ => Err(AppError::message(
                "7pace returned an unknown pairing status. Request a new PIN.",
            )),
        }
    }

    /// Exchanges a validated pairing secret for tokens (`authorization_code` grant).
    pub async fn exchange(&self, secret: &str) -> Result<SevenPaceTokens> {
        self.tokens("authorization_code", "code", secret, None).await
    }

    /// Renews `previous` (`refresh_token` grant). Keeps the previous refresh token when 7pace
    /// does not rotate it.
    pub async fn refresh(&self, previous: &SevenPaceTokens) -> Result<SevenPaceTokens> {
        let refresh = previous.refresh_token.as_str();
        self.tokens("refresh_token", "refresh_token", refresh, Some(refresh)).await
    }

    async fn pin_request<T: DeserializeOwned>(
        &self,
        action: &str,
        body: Option<Vec<u8>>,
    ) -> Result<T> {
        #[derive(Deserialize)]
        struct Envelope<T> {
            data: T,
        }
        let url = wire::url(&self.base_url, ["api", "pin", action], &[("api-version", "3.2")])
            .ok_or_else(invalid_workspace)?;
        let request = wire::request(Method::POST, url, None, body.map(|body| (wire::JSON, body)));
        let data = self.transport.data(request).await?;
        // PIN endpoints use bare responses; tolerate the common REST envelope as well.
        if let Ok(wrapped) = serde_json::from_slice::<Envelope<T>>(&data) {
            return Ok(wrapped.data);
        }
        serde_json::from_slice(&data).map_err(|_| {
            AppError::message("7pace returned an unreadable pairing response. Request a new PIN.")
        })
    }

    async fn tokens(
        &self,
        grant: &str,
        field: &str,
        value: &str,
        previous_refresh: Option<&str>,
    ) -> Result<SevenPaceTokens> {
        let url = wire::url(&self.base_url, ["token"], &[]).ok_or_else(invalid_workspace)?;
        let body = format!(
            "client_id=OpenApi&grant_type={grant}&{field}={}",
            wire::percent_encode(value, wire::unreserved)
        );
        let request = wire::request(Method::POST, url, None, Some((wire::FORM, body.into_bytes())));
        let data = self.transport.data(request).await?;
        parse_tokens(&data, previous_refresh, (self.clock)())
    }
}

fn invalid_workspace() -> AppError {
    AppError::message("Use your 7pace workspace URL: https://your-organization.timehub.7pace.com")
}

/// Tolerant token parsing (Swift used `JSONSerialization`): `expires_in` as a number or numeric
/// string, an optional `refresh_token`, and `token_type` checked only when it is a string.
fn parse_tokens(
    data: &[u8],
    previous_refresh: Option<&str>,
    now: Timestamp,
) -> Result<SevenPaceTokens> {
    let incomplete = || {
        AppError::message("7pace returned incomplete sign-in credentials. Pair again in Settings.")
    };
    let Ok(Value::Object(response)) = serde_json::from_slice::<Value>(data) else {
        return Err(incomplete());
    };
    let access = response
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|access| !access.is_empty())
        .ok_or_else(incomplete)?;
    let refresh = response
        .get("refresh_token")
        .and_then(Value::as_str)
        .and_then(NonEmpty::non_empty)
        .or(previous_refresh)
        .filter(|refresh| !refresh.is_empty())
        .ok_or_else(incomplete)?;
    let lifetime = match response.get("expires_in") {
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) => text.parse::<f64>().ok(),
        _ => None,
    }
    .filter(|lifetime| lifetime.is_finite() && *lifetime > 0.0)
    .ok_or_else(incomplete)?;
    let bearer = response
        .get("token_type")
        .and_then(Value::as_str)
        .is_none_or(|kind| kind.to_lowercase() == "bearer");
    if !bearer {
        return Err(incomplete());
    }
    Ok(SevenPaceTokens {
        access_token: access.to_string(),
        refresh_token: refresh.to_string(),
        expires_at: add_secs(now, lifetime),
    })
}

/// Stores renewed tokens before they are used.
///
/// Receives `(next, previous)`. The app's implementation should write `next` only while the
/// stored item still equals `previous`, so a stale client cannot overwrite a newer pairing
/// (Swift `SecretStore.renewOAuth`). Any `Fn(next, previous) -> impl Future<Output = Result<()>>`
/// closure works. It runs on the renewal's Tokio task, so blocking Keychain or Credential Manager
/// calls belong in `tokio::task::spawn_blocking`.
#[async_trait]
pub trait PersistTokens: Send + Sync {
    async fn persist(&self, next: SevenPaceTokens, previous: SevenPaceTokens) -> Result<()>;
}

#[async_trait]
impl<F, Fut> PersistTokens for F
where
    F: Fn(SevenPaceTokens, SevenPaceTokens) -> Fut + Send + Sync,
    Fut: Future<Output = Result<()>> + Send,
{
    async fn persist(&self, next: SevenPaceTokens, previous: SevenPaceTokens) -> Result<()> {
        self(next, previous).await
    }
}

type Outcome = Option<Result<SevenPaceTokens>>;

/// One renewal shared by all API clients (Swift actor `SevenPaceTokenProvider`).
///
/// - Tokens are renewed when 60 s or less remain. Concurrent callers wait for the same renewal
///   and share its result, including its error; the next call after a failure tries again.
/// - New tokens are persisted before any caller receives them. If persisting fails, the next
///   renewal persists the already-rotated tokens again instead of refreshing a second time with
///   a refresh token the server may have retired.
/// - The renewal runs as its own Tokio task (like Swift's unstructured `Task`), so a caller that
///   is cancelled mid-refresh cannot lose rotated tokens. Must be used inside a Tokio runtime.
///
/// Cheap to clone; clones share state.
#[derive(Clone)]
pub struct SevenPaceTokenProvider {
    inner: Arc<ProviderInner>,
}

struct ProviderInner {
    oauth: SevenPaceOAuth,
    persist: Box<dyn PersistTokens>,
    state: Mutex<ProviderState>,
}

struct ProviderState {
    tokens: SevenPaceTokens,
    /// Rotated by 7pace but not yet stored.
    unpersisted: Option<SevenPaceTokens>,
    /// The renewal in flight, if any.
    renewal: Option<watch::Receiver<Outcome>>,
}

impl std::fmt::Debug for SevenPaceTokenProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SevenPaceTokenProvider").field("oauth", &self.inner.oauth).finish()
    }
}

impl SevenPaceTokenProvider {
    /// `oauth`'s clock decides when tokens are due.
    pub fn new(
        tokens: SevenPaceTokens,
        oauth: SevenPaceOAuth,
        persist: impl PersistTokens + 'static,
    ) -> Self {
        let state = ProviderState { tokens, unpersisted: None, renewal: None };
        Self {
            inner: Arc::new(ProviderInner {
                oauth,
                persist: Box::new(persist),
                state: Mutex::new(state),
            }),
        }
    }

    /// A valid access token, renewing and persisting first when it is due.
    pub async fn access_token(&self) -> Result<String> {
        let mut renewal = {
            let mut state = self.inner.state.lock().await;
            match state.renewal.clone().filter(|renewal| !abandoned(renewal)) {
                Some(renewal) => renewal,
                None => {
                    let now = (self.inner.oauth.clock)();
                    if diff_secs(state.tokens.expires_at, now) > RENEW_MARGIN_SECS {
                        return Ok(state.tokens.access_token.clone());
                    }
                    let (done, renewal) = watch::channel(None);
                    state.renewal = Some(renewal.clone());
                    tokio::spawn(ProviderInner::renew(self.inner.clone(), done));
                    renewal
                }
            }
        };
        let outcome = renewal.wait_for(Option::is_some).await.map(|outcome| outcome.clone());
        match outcome {
            Ok(Some(Ok(tokens))) => Ok(tokens.access_token),
            Ok(Some(Err(error))) => Err(error),
            // The renewal task ended without a result (runtime shutdown or a panic in `persist`).
            Ok(None) | Err(_) => {
                Err(AppError::message("The 7pace sign-in could not be renewed. Try again."))
            }
        }
    }

    /// The current tokens (they may be due for renewal).
    pub async fn tokens(&self) -> SevenPaceTokens {
        self.inner.state.lock().await.tokens.clone()
    }
}

/// A renewal whose task is gone without sending a result. Completed renewals are removed from
/// the state before their result is sent, so they never look abandoned.
fn abandoned(renewal: &watch::Receiver<Outcome>) -> bool {
    renewal.has_changed().is_err() && renewal.borrow().is_none()
}

impl ProviderInner {
    async fn renew(self: Arc<Self>, done: watch::Sender<Outcome>) {
        let outcome = self.rotate().await;
        {
            let mut state = self.state.lock().await;
            if let Ok(next) = &outcome {
                state.tokens = next.clone();
            }
            state.renewal = None;
        }
        done.send_replace(Some(outcome));
    }

    async fn rotate(&self) -> Result<SevenPaceTokens> {
        let (previous, pending) = {
            let state = self.state.lock().await;
            (state.tokens.clone(), state.unpersisted.clone())
        };
        let next = match pending {
            Some(next) => next,
            None => {
                let next = self.oauth.refresh(&previous).await?;
                self.state.lock().await.unpersisted = Some(next.clone());
                next
            }
        };
        // Retry local persistence, not a second refresh with an already-rotated token.
        self.persist.persist(next.clone(), previous).await?;
        self.state.lock().await.unpersisted = None;
        Ok(next)
    }
}

#[async_trait]
impl Authorizer for SevenPaceTokenProvider {
    async fn authorization(&self) -> Result<String> {
        Ok(format!("Bearer {}", self.access_token().await?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> Timestamp {
        "2026-10-06T10:00:00Z".parse().unwrap()
    }

    #[test]
    fn token_responses_are_parsed_tolerantly() {
        let parse =
            |json: &str, previous: Option<&str>| parse_tokens(json.as_bytes(), previous, now());
        let tokens = parse(
            r#"{"access_token":"a","refresh_token":"r","expires_in":"3600","token_type":"Bearer"}"#,
            None,
        )
        .unwrap();
        assert_eq!(tokens.refresh_token, "r");
        assert_eq!(tokens.expires_at.to_string(), "2026-10-06T11:00:00Z");
        let kept = parse(
            r#"{"access_token":"a","refresh_token":"  ","expires_in":60.5,"token_type":7}"#,
            Some("old"),
        )
        .unwrap();
        assert_eq!(kept.refresh_token, "old");
        assert_eq!(kept.expires_at.to_string(), "2026-10-06T10:01:00.5Z");
        for rejected in [
            r#"{"access_token":"","refresh_token":"r","expires_in":60}"#,
            r#"{"access_token":"a","expires_in":60}"#,
            r#"{"access_token":"a","refresh_token":"r","expires_in":0}"#,
            r#"{"access_token":"a","refresh_token":"r","expires_in":"inf"}"#,
            r#"{"access_token":"a","refresh_token":"r","expires_in":true}"#,
            r#"{"access_token":"a","refresh_token":"r","expires_in":60,"token_type":"mac"}"#,
            r#"[{"access_token":"a"}]"#,
            "not json",
        ] {
            let error = parse(rejected, None).unwrap_err();
            assert_eq!(
                error.to_string(),
                "7pace returned incomplete sign-in credentials. Pair again in Settings.",
                "{rejected}"
            );
        }
    }

    #[test]
    fn tokens_debug_output_hides_secrets() {
        let tokens = SevenPaceTokens {
            access_token: "access-secret".into(),
            refresh_token: "refresh-secret".into(),
            expires_at: now(),
        };
        let text = format!("{tokens:?}");
        assert!(!text.contains("secret"), "{text}");
        let pin = SevenPacePin { pin: "123456".into(), secret: "pin-secret".into() };
        assert!(!format!("{pin:?}").contains("pin-secret"));
    }
}
