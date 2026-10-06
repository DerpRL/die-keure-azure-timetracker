//! The engine's view of 7pace and Azure DevOps.
//!
//! The engine never calls `att-net` types directly: it goes through these traits, so every flow
//! can be tested with in-memory fakes. [`NetClientFactory`] builds the real clients from the
//! configuration and the stored credentials, exactly as `AppModel.connect()` did.

use std::sync::Arc;

use async_trait::async_trait;
use jiff::Timestamp;

use att_core::attention::TrackingAttention;
use att_core::config::SevenPaceAuthMode;
use att_core::model::{TrackingState, WorkItem, WorkLog};
use att_core::service::{OfflineDraftService, TrackingService};
use att_core::text::NonEmpty;
use att_core::ticket::TicketWorkflowStatus;
use att_core::ticket_context::TicketContext;
use att_core::{AppError, Cal, Configuration, Result};
use att_net::{
    AzureApi, Endpoint, HttpTransport, SevenPaceApi, SevenPaceOAuth, SevenPacePin,
    SevenPacePinStatus, SevenPaceTokenProvider, SevenPaceTokens,
};
use att_platform::Credentials;

/// Everything the engine calls on 7pace.
#[async_trait]
pub trait SevenPaceClient: TrackingService + OfflineDraftService {
    async fn confirm_activity(&self, expected: Option<&TrackingAttention>)
    -> Result<TrackingState>;
    async fn search(&self, query: &str) -> Result<Vec<WorkItem>>;
    /// Worklogs starting in `[from, to)`; `from = None` has no lower bound.
    async fn work_logs(
        &self,
        from: Option<Timestamp>,
        to: Timestamp,
        include_editable: bool,
    ) -> Result<Vec<WorkLog>>;
}

/// Everything the engine calls on Azure DevOps (read-only).
#[async_trait]
pub trait AzureClient: Send + Sync {
    async fn ticket_workflow(&self, id: i64) -> Result<TicketWorkflowStatus>;
    async fn ticket_context(&self, id: i64) -> Result<TicketContext>;
    async fn work_item(&self, id: i64) -> Result<WorkItem>;
    /// Batch title lookup; unknown or inaccessible ids are left out.
    async fn work_items(&self, ids: &[i64]) -> Result<Vec<WorkItem>>;
}

/// 7pace mobile PIN pairing (unauthenticated endpoints).
#[async_trait]
pub trait PairingClient: Send + Sync {
    async fn create_pin(&self) -> Result<SevenPacePin>;
    async fn status(&self, secret: &str) -> Result<SevenPacePinStatus>;
    async fn exchange(&self, secret: &str) -> Result<SevenPaceTokens>;
}

#[async_trait]
impl SevenPaceClient for SevenPaceApi {
    async fn confirm_activity(
        &self,
        expected: Option<&TrackingAttention>,
    ) -> Result<TrackingState> {
        SevenPaceApi::confirm_activity(self, expected).await
    }
    async fn search(&self, query: &str) -> Result<Vec<WorkItem>> {
        SevenPaceApi::search(self, query).await
    }
    async fn work_logs(
        &self,
        from: Option<Timestamp>,
        to: Timestamp,
        include_editable: bool,
    ) -> Result<Vec<WorkLog>> {
        SevenPaceApi::work_logs(self, from, to, include_editable).await
    }
}

#[async_trait]
impl AzureClient for AzureApi {
    async fn ticket_workflow(&self, id: i64) -> Result<TicketWorkflowStatus> {
        AzureApi::ticket_workflow(self, id).await
    }
    async fn ticket_context(&self, id: i64) -> Result<TicketContext> {
        AzureApi::ticket_context(self, id).await
    }
    async fn work_item(&self, id: i64) -> Result<WorkItem> {
        AzureApi::work_item(self, id).await
    }
    async fn work_items(&self, ids: &[i64]) -> Result<Vec<WorkItem>> {
        AzureApi::work_items(self, ids).await
    }
}

#[async_trait]
impl PairingClient for SevenPaceOAuth {
    async fn create_pin(&self) -> Result<SevenPacePin> {
        SevenPaceOAuth::create_pin(self).await
    }
    async fn status(&self, secret: &str) -> Result<SevenPacePinStatus> {
        SevenPaceOAuth::status(self, secret).await
    }
    async fn exchange(&self, secret: &str) -> Result<SevenPaceTokens> {
        SevenPaceOAuth::exchange(self, secret).await
    }
}

/// The clients of one connection. A new connection gets a new `generation`; results computed
/// for an older generation are dropped.
#[derive(Clone)]
pub struct Clients {
    pub generation: u64,
    /// Lower-cased 7pace workspace URL (Swift `workspaceIdentity`).
    pub workspace: String,
    /// The 7pace host, e.g. `org.timehub.7pace.com`.
    pub host: String,
    pub seven_pace: Arc<dyn SevenPaceClient>,
    pub azure: Option<Arc<dyn AzureClient>>,
}

impl std::fmt::Debug for Clients {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Clients")
            .field("generation", &self.generation)
            .field("workspace", &self.workspace)
            .field("azure", &self.azure.is_some())
            .finish()
    }
}

/// Builds clients from settings and stored credentials.
pub trait ClientFactory: Send + Sync {
    /// Swift `connect()` up to the first request: `Ok(None)` when no 7pace URL is configured.
    fn connect(
        &self,
        config: &Configuration,
        credentials: Arc<dyn Credentials>,
        cal: &Cal,
        generation: u64,
    ) -> Result<Option<Clients>>;

    fn pairing(&self, workspace_url: &str) -> Result<Arc<dyn PairingClient>>;
}

/// Keychain / Credential Manager account names, unchanged from 1.14.x (`kind:scope`, scope
/// lower-cased).
pub mod accounts {
    pub fn account(kind: &str, scope: &str) -> String {
        format!("{kind}:{}", scope.to_lowercase())
    }
    pub fn seven_pace_token(host: &str) -> String {
        account("7pace", host)
    }
    pub fn seven_pace_oauth(host: &str) -> String {
        account("7pace-oauth", host)
    }
    pub fn azure_pat(organization: &str) -> String {
        account("azure", organization)
    }
}

/// The lower-cased workspace URL, or empty when the setting is not a valid 7pace URL.
pub fn workspace_identity(seven_pace_url: &str) -> String {
    Endpoint::seven_pace(seven_pace_url).map(|url| url.as_str().to_lowercase()).unwrap_or_default()
}

/// Production clients on `att-net`. One transport per factory, shared by every client, so a
/// 429 back-off applies to every caller.
pub struct NetClientFactory {
    transport: HttpTransport,
}

impl NetClientFactory {
    pub fn new() -> Result<Self> {
        Ok(Self { transport: HttpTransport::new()? })
    }
}

fn read_secret(credentials: &dyn Credentials, account: &str) -> Result<Option<String>> {
    credentials.get(account).map_err(|error| {
        AppError::Message(format!("Keychain could not read the saved credential ({error})."))
    })
}

/// Reads the 1.14.x OAuth token JSON (Swift `SecretStore.readOAuth`).
pub fn read_oauth(credentials: &dyn Credentials, host: &str) -> Result<Option<SevenPaceTokens>> {
    let Some(raw) = read_secret(credentials, &accounts::seven_pace_oauth(host))? else {
        return Ok(None);
    };
    serde_json::from_str(&raw).map(Some).map_err(|_| {
        AppError::message("The saved 7pace pairing could not be read. Pair again in Settings.")
    })
}

/// Saves OAuth tokens (Swift `SecretStore.saveOAuth`).
pub fn save_oauth(
    credentials: &dyn Credentials,
    host: &str,
    tokens: &SevenPaceTokens,
) -> Result<()> {
    let raw = serde_json::to_string(tokens).map_err(|e| AppError::Message(e.to_string()))?;
    credentials.set(&accounts::seven_pace_oauth(host), &raw).map_err(|error| {
        AppError::Message(format!("Keychain could not save the credential ({error})."))
    })
}

impl ClientFactory for NetClientFactory {
    fn connect(
        &self,
        config: &Configuration,
        credentials: Arc<dyn Credentials>,
        cal: &Cal,
        generation: u64,
    ) -> Result<Option<Clients>> {
        if config.seven_pace_url.non_empty().is_none() {
            return Ok(None);
        }
        let base = Endpoint::seven_pace(&config.seven_pace_url)?;
        let host = base.host_str().unwrap_or_default().to_string();
        let seven_pace: Arc<dyn SevenPaceClient> = match config.seven_pace_auth_mode {
            SevenPaceAuthMode::MobilePin => {
                let Some(tokens) = read_oauth(credentials.as_ref(), &host)? else {
                    return Err(AppError::message(
                        "Pair this Mac with a mobile PIN in Settings → Accounts.",
                    ));
                };
                let oauth = SevenPaceOAuth::new(base.clone(), self.transport.clone());
                let store = credentials.clone();
                let scope = host.clone();
                // Swift `renewOAuth`: a stale client never overwrites a newer pairing.
                let provider = SevenPaceTokenProvider::new(tokens, oauth, move |next, previous| {
                    let store = store.clone();
                    let scope = scope.clone();
                    async move {
                        tokio::task::spawn_blocking(move || {
                            if read_oauth(store.as_ref(), &scope)?.as_ref() != Some(&previous) {
                                return Err(AppError::message(
                                    "7pace pairing changed. Reconnect to use the saved credentials.",
                                ));
                            }
                            save_oauth(store.as_ref(), &scope, &next)
                        })
                        .await
                        .map_err(|e| AppError::Message(e.to_string()))?
                    }
                });
                Arc::new(SevenPaceApi::with_token_provider(
                    base.clone(),
                    provider,
                    self.transport.clone(),
                    cal.clone(),
                ))
            }
            SevenPaceAuthMode::ApiToken => {
                let token = read_secret(credentials.as_ref(), &accounts::seven_pace_token(&host))?
                    .filter(|token| !token.is_empty())
                    .ok_or_else(|| {
                        AppError::message(
                            "Pair with a mobile PIN or add your 7pace API token in Settings → Accounts.",
                        )
                    })?;
                Arc::new(SevenPaceApi::with_token(
                    base.clone(),
                    token,
                    self.transport.clone(),
                    cal.clone(),
                ))
            }
        };
        let mut azure: Option<Arc<dyn AzureClient>> = None;
        if let Some(org) = config.organization.non_empty() {
            let url = Endpoint::azure(org)?;
            if let Some(pat) = read_secret(credentials.as_ref(), &accounts::azure_pat(org))?
                .filter(|p| !p.is_empty())
            {
                azure = Some(Arc::new(AzureApi::new(
                    url,
                    config.project.clone(),
                    &pat,
                    self.transport.clone(),
                )));
            }
        }
        Ok(Some(Clients {
            generation,
            workspace: base.as_str().to_lowercase(),
            host,
            seven_pace,
            azure,
        }))
    }

    fn pairing(&self, workspace_url: &str) -> Result<Arc<dyn PairingClient>> {
        Ok(Arc::new(SevenPaceOAuth::for_workspace(workspace_url, self.transport.clone())?))
    }
}
