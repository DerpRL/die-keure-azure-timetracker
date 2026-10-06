//! Network clients for Azure timetracker 2.0, ported from API.swift and SevenPaceAuth.swift
//! (1.14.2):
//!
//! - [`SevenPaceApi`]: 7pace Timetracker REST (`api-version=3.2`). Implements the
//!   `att_core::service` traits used by tracking transactions, worklog operations and offline
//!   drafts.
//! - [`SevenPaceOAuth`] and [`SevenPaceTokenProvider`]: Mobile PIN pairing and OAuth tokens with
//!   one shared, persisted-before-use renewal.
//! - [`AzureApi`]: read-only Azure DevOps work items, workflow categories, ticket context and
//!   batched titles.
//! - [`Endpoint`]: the only way production code should build base URLs; it enforces HTTPS and
//!   the 7pace host.
//!
//! Transport rules, unchanged from 1.14.2 ([`HttpTransport`]): no cookies or cache, redirects
//! refused, 20 s idle and 30 s total timeouts, a per-host 429 `Retry-After` block, errors without
//! response bodies, tokens or query strings, and no replayed requests. The clients take an
//! explicit base URL so contract tests can run against a local mock server.
//!
//! Wiring, as the 1.14.2 app did it:
//!
//! ```no_run
//! # async fn wire(token: String, pat: String) -> att_core::Result<()> {
//! use att_core::Cal;
//! use att_core::service::TrackingService;
//! use att_net::{AzureApi, Endpoint, HttpTransport, SevenPaceApi};
//!
//! let transport = HttpTransport::new()?; // one per workspace, shared by every client
//! let base = Endpoint::seven_pace("https://example.timehub.7pace.com")?;
//! let seven_pace = SevenPaceApi::with_token(base, token, transport.clone(), Cal::system());
//! let azure = AzureApi::new(Endpoint::azure("example")?, "", &pat, transport);
//! let state = seven_pace.current().await?;
//! # let _ = (state, azure);
//! # Ok(()) }
//! ```

use std::sync::Arc;

use jiff::Timestamp;

mod auth;
mod azure;
mod endpoint;
mod oauth;
mod seven_pace;
mod transport;
mod wire;

pub use auth::{Authorizer, BearerToken};
pub use azure::AzureApi;
pub use endpoint::Endpoint;
pub use oauth::{
    PersistTokens, SevenPaceOAuth, SevenPacePin, SevenPacePinStatus, SevenPaceTokenProvider,
    SevenPaceTokens,
};
pub use reqwest::Url;
pub use seven_pace::SevenPaceApi;
pub use transport::{HttpTransport, TransportOptions, USER_AGENT};

/// The current instant. Injected so tests can pin "now"; production uses [`system_clock`].
pub type Clock = Arc<dyn Fn() -> Timestamp + Send + Sync>;

/// [`Timestamp::now`].
pub fn system_clock() -> Clock {
    Arc::new(Timestamp::now)
}
