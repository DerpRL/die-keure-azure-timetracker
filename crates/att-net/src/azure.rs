//! Azure DevOps work items (`api-version=7.1`, read-only). Ported from `AzureAPI` in API.swift,
//! plus the `workitemsbatch` title lookup that 2.0 adds for statistics and reports.

use std::collections::{HashMap, HashSet};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use reqwest::{Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use att_core::model::WorkItem;
use att_core::text::NonEmpty;
use att_core::ticket::TicketWorkflowStatus;
use att_core::ticket_context::TicketContext;
use att_core::{AppError, Result};

use crate::transport::HttpTransport;
use crate::wire;

const API_VERSION: &str = "7.1";
/// Azure's limit for one `workitemsbatch` request.
const BATCH_LIMIT: usize = 200;
const WORKFLOW_FIELDS: &str = "System.Title,System.State,System.TeamProject,System.WorkItemType";
const ITEM_FIELDS: &str = "System.Title,System.TeamProject,System.WorkItemType";
const BATCH_FIELDS: [&str; 3] = ["System.Title", "System.TeamProject", "System.WorkItemType"];

/// Read-only Azure DevOps client authenticated with a personal access token.
///
/// Requests use `Authorization: Basic base64(":" + PAT)` and never carry 7pace credentials.
/// Project and work-item type names are percent-encoded as single path segments.
#[derive(Clone)]
pub struct AzureApi {
    organization_url: Url,
    project: String,
    authorization: String,
    transport: HttpTransport,
}

impl std::fmt::Debug for AzureApi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AzureApi")
            .field("organization_url", &self.organization_url.as_str())
            .field("project", &self.project)
            .finish_non_exhaustive()
    }
}

/// `{"id": …, "fields": {…}}` with string fields only, as Swift decoded it.
#[derive(Deserialize)]
struct Item {
    id: i64,
    fields: HashMap<String, String>,
}

impl AzureApi {
    /// `organization_url` as given; production code passes [`crate::Endpoint::azure`]. An empty
    /// `project` addresses work items at the organization level.
    pub fn new(
        organization_url: Url,
        project: impl Into<String>,
        pat: &str,
        transport: HttpTransport,
    ) -> Self {
        Self {
            organization_url,
            project: project.into(),
            authorization: format!("Basic {}", STANDARD.encode(format!(":{pat}"))),
            transport,
        }
    }

    pub fn organization_url(&self) -> &Url {
        &self.organization_url
    }

    /// The workflow *category* of a ticket's current state, which decides completion; state
    /// names vary by project and process. Reads the work item, then the states of its own team
    /// project and type. The response must be the requested ticket before states are fetched.
    pub async fn ticket_workflow(&self, id: i64) -> Result<TicketWorkflowStatus> {
        check_ticket(id)?;
        let url =
            self.work_item_url(id, &[("api-version", API_VERSION), ("fields", WORKFLOW_FIELDS)])?;
        let item: Item = wire::decode(&self.get(url).await?)?;
        let incomplete =
            || AppError::message("Azure returned incomplete ticket status. Try again shortly.");
        if item.id != id {
            return Err(incomplete());
        }
        let field = |key: &str| item.fields.get(key).and_then(|value| value.non_empty());
        let state = field("System.State").ok_or_else(incomplete)?;
        let team_project = field("System.TeamProject").ok_or_else(incomplete)?;
        let kind = field("System.WorkItemType").ok_or_else(incomplete)?;
        let states_url = wire::url(
            &self.organization_url,
            [team_project, "_apis", "wit", "workitemtypes", kind, "states"],
            &[("api-version", API_VERSION)],
        )
        .ok_or_else(incomplete)?;
        #[derive(Deserialize)]
        struct WorkflowState {
            name: String,
            category: String,
        }
        #[derive(Deserialize)]
        struct States {
            value: Vec<WorkflowState>,
        }
        let states: States = wire::decode(&self.get(states_url).await?)?;
        // Swift `caseInsensitiveCompare`; the first state with that name decides.
        let wanted = state.to_lowercase();
        let category = states
            .value
            .iter()
            .find(|candidate| candidate.name.to_lowercase() == wanted)
            .and_then(|candidate| candidate.category.non_empty())
            .ok_or_else(|| {
                AppError::message(
                    "Azure could not classify this ticket’s workflow state. Try again shortly.",
                )
            })?;
        Ok(TicketWorkflowStatus {
            ticket_id: id,
            title: item
                .fields
                .get("System.Title")
                .cloned()
                .unwrap_or_else(|| format!("Azure ticket #{id}")),
            state: state.to_string(),
            category: category.to_string(),
        })
    }

    /// Ticket details with relations (`$expand=Relations`) for the context panel.
    pub async fn ticket_context(&self, id: i64) -> Result<TicketContext> {
        check_ticket(id)?;
        let url =
            self.work_item_url(id, &[("api-version", API_VERSION), ("$expand", "Relations")])?;
        let context = TicketContext::decode(&self.get(url).await?, self.organization_url.as_str())?;
        if context.id != id {
            return Err(AppError::message(
                "Azure returned a different ticket. Refresh the details.",
            ));
        }
        Ok(context)
    }

    /// Title, project and type of one work item, with its browser link
    /// `<organization>[/<project>]/_workitems/edit/<id>`. (Swift did not range-check this ID.)
    pub async fn work_item(&self, id: i64) -> Result<WorkItem> {
        let url =
            self.work_item_url(id, &[("api-version", API_VERSION), ("fields", ITEM_FIELDS)])?;
        let item: Item = wire::decode(&self.get(url).await?)?;
        let field = |key: &str| item.fields.get(key).cloned();
        Ok(WorkItem {
            id: item.id,
            title: field("System.Title").unwrap_or_else(|| format!("Work item #{id}")),
            team_project: field("System.TeamProject"),
            kind: field("System.WorkItemType"),
            work_item_link: Some(self.browser_link(id)?),
        })
    }

    /// Title, project and type of many work items via
    /// `POST <organization>/_apis/wit/workitemsbatch` (read-only), 200 IDs per request.
    ///
    /// IDs are deduplicated (first occurrence wins) and IDs outside `1…i32::MAX` are skipped.
    /// Requests use `errorPolicy: omit`, so a deleted or inaccessible ticket is left out instead
    /// of failing its whole chunk. Results keep Azure's order; titles missing from a response
    /// become `Work item #<id>`, like [`AzureApi::work_item`].
    pub async fn work_items(&self, ids: &[i64]) -> Result<Vec<WorkItem>> {
        let max = i64::from(i32::MAX);
        let mut seen = HashSet::new();
        let unique: Vec<i64> =
            ids.iter().copied().filter(|id| (1..=max).contains(id) && seen.insert(*id)).collect();
        if unique.is_empty() {
            return Ok(Vec::new());
        }
        let url = wire::url(
            &self.organization_url,
            ["_apis", "wit", "workitemsbatch"],
            &[("api-version", API_VERSION)],
        )
        .ok_or_else(|| {
            AppError::message("Enter the organization name from dev.azure.com/your-organization.")
        })?;
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Batch<'a> {
            ids: &'a [i64],
            fields: [&'a str; 3],
            error_policy: &'a str,
        }
        #[derive(Deserialize)]
        struct BatchItem {
            id: i64,
            #[serde(default)]
            fields: HashMap<String, Value>,
        }
        #[derive(Deserialize)]
        struct Page {
            #[serde(default)]
            value: Vec<Option<BatchItem>>,
        }
        let mut items = Vec::with_capacity(unique.len());
        for chunk in unique.chunks(BATCH_LIMIT) {
            let body =
                wire::encode(&Batch { ids: chunk, fields: BATCH_FIELDS, error_policy: "omit" })?;
            let request = wire::request(
                Method::POST,
                url.clone(),
                Some(wire::secret_header(&self.authorization)?),
                Some((wire::JSON, body)),
            );
            let page: Page = wire::decode(&self.transport.data(request).await?)?;
            for item in page.value.into_iter().flatten() {
                // Unlike the single-item read, one odd field must not fail a whole batch.
                let text =
                    |key: &str| item.fields.get(key).and_then(Value::as_str).map(str::to_string);
                items.push(WorkItem {
                    id: item.id,
                    title: text("System.Title")
                        .unwrap_or_else(|| format!("Work item #{}", item.id)),
                    team_project: text("System.TeamProject"),
                    kind: text("System.WorkItemType"),
                    work_item_link: Some(self.browser_link(item.id)?),
                });
            }
        }
        Ok(items)
    }

    async fn get(&self, url: Url) -> Result<Vec<u8>> {
        let authorization = wire::secret_header(&self.authorization)?;
        self.transport.data(wire::request(Method::GET, url, Some(authorization), None)).await
    }

    /// `<organization>[/<project>]` followed by `segments`.
    fn project_url(&self, segments: &[&str], query: &[(&str, &str)]) -> Result<Url> {
        let project = (!self.project.is_empty()).then_some(self.project.as_str());
        wire::url(
            &self.organization_url,
            project.into_iter().chain(segments.iter().copied()),
            query,
        )
        .ok_or_else(|| {
            AppError::message("Enter the Azure DevOps project name exactly as it appears in Azure.")
        })
    }

    fn work_item_url(&self, id: i64, query: &[(&str, &str)]) -> Result<Url> {
        self.project_url(&["_apis", "wit", "workitems", &id.to_string()], query)
    }

    fn browser_link(&self, id: i64) -> Result<String> {
        self.project_url(&["_workitems", "edit", &id.to_string()], &[]).map(String::from)
    }
}

fn check_ticket(id: i64) -> Result<()> {
    if (1..=i64::from(i32::MAX)).contains(&id) {
        Ok(())
    } else {
        Err(AppError::message("Enter a valid Azure ticket number."))
    }
}
