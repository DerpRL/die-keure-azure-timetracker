//! Credentials for 7pace requests. Swift passed an `authorization` closure to `SevenPaceAPI`.

use async_trait::async_trait;

use att_core::Result;

/// Supplies the `Authorization` header for each 7pace request.
#[async_trait]
pub trait Authorizer: Send + Sync {
    /// The complete header value, e.g. `Bearer <token>`. Called once per request, right before it
    /// is sent; an implementation may renew credentials first (see
    /// [`crate::SevenPaceTokenProvider`]). A request that then fails with 401 is not retried.
    async fn authorization(&self) -> Result<String>;
}

/// A fixed 7pace API token (Settings → Accounts → API token).
#[derive(Clone, PartialEq, Eq)]
pub struct BearerToken(String);

impl BearerToken {
    pub fn new(token: impl Into<String>) -> Self {
        Self(token.into())
    }
}

impl std::fmt::Debug for BearerToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BearerToken(<redacted>)")
    }
}

#[async_trait]
impl Authorizer for BearerToken {
    async fn authorization(&self) -> Result<String> {
        Ok(format!("Bearer {}", self.0))
    }
}
