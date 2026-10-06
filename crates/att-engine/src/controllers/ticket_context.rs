//! The ticket context panel. Port of `TicketContextModel` (ProductivityModels.swift) plus
//! `AppModel.showContext/openTicket`.

use serde_json::Value;

use att_core::ticket_context::TicketContext;
use att_net::Endpoint;

use super::{detached, done, internal, still_current};
use crate::engine::Engine;
use crate::ipc::IpcError;

/// Swift's text when no Azure PAT is configured.
pub(crate) const NOT_CONFIGURED: &str =
    "Add your Azure organization and PAT in Settings to load ticket details.";

#[derive(Default)]
pub(crate) struct TicketContextState {
    /// The ticket whose panel is open (Swift `AppModel.contextRequest`).
    pub request: Option<i64>,
    pub details: Option<TicketContext>,
    pub loading: bool,
    pub issue: Option<String>,
    /// Azure DevOps is configured (Swift `api != nil`).
    pub configured: bool,
    generation: u64,
}

impl TicketContextState {
    /// Swift `configure(_:)`; `connect()` also closed the panel.
    pub(crate) fn configure(&mut self, configured: bool) {
        self.configured = configured;
        self.generation += 1;
        self.request = None;
        self.details = None;
        self.issue = None;
        self.loading = false;
    }
}

/// The browser link of a ticket (Swift `openTicket`): `<organization URL>/_workitems/edit/<id>`.
pub(crate) fn azure_ticket_url(organization: &str, ticket_id: i64) -> Option<String> {
    let base = Endpoint::azure(organization).ok()?;
    Some(format!("{}/_workitems/edit/{ticket_id}", base.as_str().trim_end_matches('/')))
}

/// `ticket.showContext`: opens the panel and loads the ticket (Swift `load(_:)`). A newer
/// request or closing the panel drops the answer.
pub(crate) async fn show(engine: &Engine, ticket_id: i64) -> Result<Value, IpcError> {
    let request = engine.update(|state| {
        let context = &mut state.controllers.ticket_context;
        context.request = Some(ticket_id);
        context.generation += 1;
        context.details = None;
        context.issue = None;
        context.generation
    });
    let azure = engine.clients().and_then(|clients| {
        let azure = clients.azure.clone()?;
        Some((clients, azure))
    });
    let Some((clients, azure)) = azure else {
        engine.update(|state| {
            let context = &mut state.controllers.ticket_context;
            if context.generation == request {
                context.loading = false;
                context.issue = Some(NOT_CONFIGURED.into());
            }
        });
        return done();
    };
    engine.update(|state| state.controllers.ticket_context.loading = true);
    let engine = engine.clone();
    detached(async move {
        let result = azure.ticket_context(ticket_id).await;
        let current = still_current(&engine, &clients);
        engine.update(|state| {
            let context = &mut state.controllers.ticket_context;
            if context.generation != request {
                return;
            }
            context.loading = false;
            if !current {
                return;
            }
            match result {
                Ok(details) => context.details = Some(details),
                Err(error) => context.issue = Some(error.to_string()),
            }
        });
    })
    .await
    .ok_or_else(internal)?;
    done()
}

/// `ticket.closeContext`.
pub(crate) fn close(engine: &Engine) -> Result<Value, IpcError> {
    engine.update(|state| {
        let context = &mut state.controllers.ticket_context;
        context.generation += 1;
        context.request = None;
        context.details = None;
        context.issue = None;
        context.loading = false;
    });
    done()
}

/// `ticket.openInAzure`: nothing happens without a valid organization (as in Swift).
pub(crate) fn open_in_azure(engine: &Engine, ticket_id: i64) -> Result<Value, IpcError> {
    let organization = engine.read(|state| state.config.organization.clone());
    if let Some(url) = azure_ticket_url(&organization, ticket_id) {
        engine.services().shell.open_url(&url);
    }
    done()
}
