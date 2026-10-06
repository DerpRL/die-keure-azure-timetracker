//! 7pace Timetracker REST client (`api-version=3.2`). Ported from `SevenPaceAPI` in API.swift.

use std::collections::HashSet;
use std::sync::Arc;

use async_trait::async_trait;
use jiff::Timestamp;
use reqwest::{Method, Url};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

use att_core::attention::TrackingAttention;
use att_core::model::{ActivityType, TrackingState, WorkItem, WorkLog};
use att_core::service::{
    OfflineDraftService, TrackingService, WorkLogEditingService, WorkLogMutationService,
};
use att_core::time::{add_secs, wire_date};
use att_core::worklog::{WorkLogDraft, WorkLogTimeEdit};
use att_core::{AppError, Cal, Result};

use crate::auth::{Authorizer, BearerToken};
use crate::oauth::SevenPaceTokenProvider;
use crate::transport::HttpTransport;
use crate::wire;
use crate::{Clock, system_clock};

const API_VERSION: &str = "3.2";
const PAGE_SIZE: usize = 500;
/// The last `$skip` that is still requested (201 pages of 500).
const MAX_SKIP: usize = 100_000;
const INVALID_LOG_ID: &str = "This entry has an invalid 7pace worklog ID.";
const INVALID_ID: &str = "Invalid worklog ID.";

/// The 7pace client of one workspace.
///
/// Every request carries `api-version=3.2`, `Authorization` from the [`Authorizer`],
/// `Accept: application/json`, and `Content-Type: application/json` only with a body. No request
/// is ever repeated: a lost or rejected write must be reconciled from the server first.
///
/// Timestamps are sent as local wall-clock time without an offset in the client's [`Cal`], as
/// 7pace expects; build a new client when the user's time zone changes.
#[derive(Clone)]
pub struct SevenPaceApi {
    base_url: Url,
    authorizer: Arc<dyn Authorizer>,
    transport: HttpTransport,
    cal: Cal,
    clock: Clock,
}

impl std::fmt::Debug for SevenPaceApi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SevenPaceApi")
            .field("base_url", &self.base_url.as_str())
            .finish_non_exhaustive()
    }
}

#[derive(Deserialize)]
struct Envelope<T> {
    data: T,
}

impl SevenPaceApi {
    /// A client for `base_url` as given. Production code passes a URL from
    /// [`crate::Endpoint::seven_pace`].
    pub fn new(
        base_url: Url,
        authorizer: Arc<dyn Authorizer>,
        transport: HttpTransport,
        cal: Cal,
    ) -> Self {
        Self { base_url, authorizer, transport, cal, clock: system_clock() }
    }

    /// With a fixed API token.
    pub fn with_token(
        base_url: Url,
        token: impl Into<String>,
        transport: HttpTransport,
        cal: Cal,
    ) -> Self {
        Self::new(base_url, Arc::new(BearerToken::new(token)), transport, cal)
    }

    /// With Mobile PIN (OAuth) tokens that renew themselves.
    pub fn with_token_provider(
        base_url: Url,
        provider: SevenPaceTokenProvider,
        transport: HttpTransport,
        cal: Cal,
    ) -> Self {
        Self::new(base_url, Arc::new(provider), transport, cal)
    }

    /// Replaces the clock used for the `timeZone` offset and the "no future time" checks (tests).
    pub fn with_clock(mut self, clock: Clock) -> Self {
        self.clock = clock;
        self
    }

    pub fn base_url(&self) -> &Url {
        &self.base_url
    }

    pub fn calendar(&self) -> &Cal {
        &self.cal
    }

    /// Answers an activity check with `POST api/tracking/client/activityCheck`, after re-reading
    /// the timer: the current state must still ask for this check (`expected`, when given) and must
    /// not be a server stop. The answer must show the timer running without a pending check.
    pub async fn confirm_activity(
        &self,
        expected: Option<&TrackingAttention>,
    ) -> Result<TrackingState> {
        let actual = self.current_state().await?;
        let still_asked = TrackingAttention::from_state(&actual).is_some_and(|attention| {
            !attention.stopped() && expected.is_none_or(|expected| expected.id == attention.id)
        });
        if !still_asked {
            return Err(AppError::RemoteChanged);
        }
        let state: TrackingState =
            self.call(Method::POST, "api/tracking/client/activityCheck", &[], None).await?;
        let checked = state.checked()?;
        let confirmed = checked.running()
            && checked.track.as_ref().map(|track| track.needs_activity_check()) != Some(true);
        if !confirmed {
            return Err(AppError::message(
                "7pace did not confirm continued tracking. Refresh your timer before trying again.",
            ));
        }
        Ok(checked)
    }

    /// Ticket search (`POST api/tracking/client/searchByQuery`).
    pub async fn search(&self, query: &str) -> Result<Vec<WorkItem>> {
        #[derive(Serialize)]
        struct Search<'a> {
            query: &'a str,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Item {
            work_item: WorkItem,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Results {
            work_items: Vec<Item>,
        }
        let body = wire::encode(&Search { query })?;
        let results: Results =
            self.call(Method::POST, "api/tracking/client/searchByQuery", &[], Some(body)).await?;
        Ok(results.work_items.into_iter().map(|item| item.work_item).collect())
    }

    /// Worklogs that start before `to` and, with `from`, not before `from − 1 s`.
    ///
    /// Pages with `$count=500` until a short page; fails when `$skip` would pass 100,000.
    /// Duplicates across pages are dropped (first wins) and the result is newest first, logs
    /// without a readable date last.
    pub async fn work_logs(
        &self,
        from: Option<Timestamp>,
        to: Timestamp,
        include_editable: bool,
    ) -> Result<Vec<WorkLog>> {
        let tz = self.cal.tz();
        let to_text = wire_date::local_string(to, tz);
        let from_text = from.map(|from| wire_date::local_string(add_secs(from, -1.0), tz));
        let count = PAGE_SIZE.to_string();
        let mut logs = Vec::new();
        let mut skip = 0;
        loop {
            let skip_text = skip.to_string();
            let mut query = vec![
                ("$toTimestamp", to_text.as_str()),
                ("$count", count.as_str()),
                ("$skip", skip_text.as_str()),
            ];
            if let Some(from_text) = &from_text {
                query.push(("$fromTimestamp", from_text));
            }
            if include_editable {
                query.push(("$includeEditable", "true"));
            }
            let page: Envelope<Vec<WorkLog>> =
                self.call(Method::GET, "api/rest/workLogs", &query, None).await?;
            let full = page.data.len() >= PAGE_SIZE;
            logs.extend(page.data);
            if !full {
                break;
            }
            skip += PAGE_SIZE;
            if skip > MAX_SKIP {
                return Err(AppError::message(
                    "Select a shorter history range to load these worklogs.",
                ));
            }
        }
        let mut seen = HashSet::new();
        logs.retain(|log| seen.insert(log.id.clone()));
        logs.sort_by_cached_key(|log| std::cmp::Reverse(log.date(tz).unwrap_or(Timestamp::MIN)));
        Ok(logs)
    }

    async fn current_state(&self) -> Result<TrackingState> {
        let state: TrackingState = self
            .call(Method::GET, "api/tracking/client/current", &[("$expand", "true")], None)
            .await?;
        state.checked()
    }

    async fn work_log_by_id(&self, id: &str) -> Result<WorkLog> {
        check_id(id, INVALID_LOG_ID)?;
        let log: Envelope<WorkLog> =
            self.call(Method::GET, &log_path(id), &[("$includeEditable", "true")], None).await?;
        Ok(log.data)
    }

    async fn call<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, &str)],
        body: Option<Vec<u8>>,
    ) -> Result<T> {
        let data = self.send(method, path, query, body).await?;
        wire::decode(&data)
    }

    async fn send(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, &str)],
        body: Option<Vec<u8>>,
    ) -> Result<Vec<u8>> {
        let mut pairs = vec![("api-version", API_VERSION)];
        pairs.extend_from_slice(query);
        let url = wire::url(&self.base_url, path.split('/'), &pairs).ok_or_else(|| {
            AppError::message(
                "Use your 7pace workspace URL: https://your-organization.timehub.7pace.com",
            )
        })?;
        // Swift checked for cancellation here; a dropped future stops at this await instead.
        let authorization = wire::secret_header(&self.authorizer.authorization().await?)?;
        let request =
            wire::request(method, url, Some(authorization), body.map(|body| (wire::JSON, body)));
        self.transport.data(request).await
    }

    fn now(&self) -> Timestamp {
        (self.clock)()
    }
}

fn log_path(id: &str) -> String {
    format!("api/rest/workLogs/{id}")
}

/// Swift `UUID(uuidString:)`: only the 36-character hyphenated form, either case. Checked before
/// any request so a malformed ID can never change the request path.
fn check_id(id: &str, message: &'static str) -> Result<()> {
    if id.len() == 36 && Uuid::try_parse(id).is_ok() {
        Ok(())
    } else {
        Err(AppError::message(message))
    }
}

/// Swift `WorkLogTimeEdit.validate(now:)`, which the API repeated before every write.
#[async_trait]
impl TrackingService for SevenPaceApi {
    async fn current(&self) -> Result<TrackingState> {
        self.current_state().await
    }

    /// `POST api/tracking/client/startTracking` with `timeZone` (minutes east of UTC now) and
    /// only the fields that are set.
    async fn start(
        &self,
        ticket_id: Option<i64>,
        activity_type: Option<&str>,
        remark: Option<&str>,
    ) -> Result<TrackingState> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Parameters<'a> {
            time_zone: i32,
            #[serde(skip_serializing_if = "Option::is_none")]
            tfs_id: Option<i64>,
            #[serde(skip_serializing_if = "Option::is_none")]
            remark: Option<&'a str>,
            #[serde(skip_serializing_if = "Option::is_none")]
            activity_type_id: Option<&'a str>,
        }
        let body = wire::encode(&Parameters {
            time_zone: self.cal.utc_offset_minutes(self.now()),
            tfs_id: ticket_id,
            remark,
            activity_type_id: activity_type,
        })?;
        let state: TrackingState =
            self.call(Method::POST, "api/tracking/client/startTracking", &[], Some(body)).await?;
        state.checked()
    }

    /// `POST api/tracking/client/stopTracking?$reason=0`.
    async fn stop(&self) -> Result<TrackingState> {
        let state: TrackingState = self
            .call(Method::POST, "api/tracking/client/stopTracking", &[("$reason", "0")], None)
            .await?;
        state.checked()
    }
}

#[async_trait]
impl WorkLogEditingService for SevenPaceApi {
    async fn current_tracking(&self) -> Result<TrackingState> {
        self.current_state().await
    }

    /// `GET api/rest/workLogs/{id}?$includeEditable=true`.
    async fn work_log(&self, id: &str) -> Result<WorkLog> {
        self.work_log_by_id(id).await
    }

    /// No lower date bound: a long, older entry can still overlap the proposed time.
    async fn work_logs_before(&self, end: Timestamp) -> Result<Vec<WorkLog>> {
        self.work_logs(None, add_secs(end, 1.0), false).await
    }

    /// `PATCH api/rest/workLogs/{id}` with only `timeStamp` and `length`.
    async fn update_work_log_time(&self, id: &str, edit: &WorkLogTimeEdit) -> Result<WorkLog> {
        // Swift's edit is always whole seconds; normalise in case the fields were set directly.
        let edit = WorkLogTimeEdit::new(edit.start, edit.end);
        edit.validate(self.now(), &self.cal)?;
        check_id(id, INVALID_LOG_ID)?;
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body {
            time_stamp: String,
            length: i64,
        }
        let body = wire::encode(&Body {
            time_stamp: wire_date::local_string(edit.start, self.cal.tz()),
            length: edit.seconds(),
        })?;
        let log: Envelope<WorkLog> =
            self.call(Method::PATCH, &log_path(id), &[], Some(body)).await?;
        Ok(log.data)
    }
}

#[async_trait]
impl WorkLogMutationService for SevenPaceApi {
    /// Only a 404 means the log is gone; every other failure is an error.
    async fn find_work_log(&self, id: &str) -> Result<Option<WorkLog>> {
        match self.work_log_by_id(id).await {
            Ok(log) => Ok(Some(log)),
            Err(AppError::NotFound) => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// `POST api/rest/workLogs`; unset ticket, comment, activity and user are omitted.
    async fn create_work_log(&self, draft: &WorkLogDraft) -> Result<WorkLog> {
        draft.validate(self.now(), &self.cal)?;
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            time_stamp: String,
            length: i64,
            billable_length: i64,
            #[serde(skip_serializing_if = "Option::is_none")]
            work_item_id: Option<i64>,
            #[serde(skip_serializing_if = "Option::is_none")]
            comment: Option<&'a str>,
            #[serde(skip_serializing_if = "Option::is_none")]
            activity_type_id: Option<&'a str>,
            #[serde(skip_serializing_if = "Option::is_none")]
            user_id: Option<&'a str>,
        }
        let body = wire::encode(&Body {
            time_stamp: wire_date::local_string(draft.start, self.cal.tz()),
            length: draft.seconds,
            billable_length: draft.billable_seconds,
            work_item_id: draft.ticket_id,
            comment: draft.comment.as_deref(),
            activity_type_id: draft.activity_id.as_deref(),
            user_id: draft.user_id.as_deref(),
        })?;
        let log: Envelope<WorkLog> =
            self.call(Method::POST, "api/rest/workLogs", &[], Some(body)).await?;
        Ok(log.data)
    }

    /// `PATCH api/rest/workLogs/{id}` with `timeStamp`, `length` and `billableLength` only.
    async fn replace_work_log_time(&self, id: &str, draft: &WorkLogDraft) -> Result<WorkLog> {
        draft.validate(self.now(), &self.cal)?;
        check_id(id, INVALID_ID)?;
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body {
            time_stamp: String,
            length: i64,
            billable_length: i64,
        }
        let body = wire::encode(&Body {
            time_stamp: wire_date::local_string(draft.start, self.cal.tz()),
            length: draft.seconds,
            billable_length: draft.billable_seconds,
        })?;
        let log: Envelope<WorkLog> =
            self.call(Method::PATCH, &log_path(id), &[], Some(body)).await?;
        Ok(log.data)
    }

    /// `DELETE api/rest/workLogs/{id}`. As in Swift, the response must be a JSON object (its
    /// content is ignored); anything else, including an empty body, is reported as unreadable.
    async fn delete_work_log(&self, id: &str) -> Result<()> {
        check_id(id, INVALID_ID)?;
        let _: Map<String, Value> = self.call(Method::DELETE, &log_path(id), &[], None).await?;
        Ok(())
    }
}

#[async_trait]
impl OfflineDraftService for SevenPaceApi {
    /// `GET api/rest/activityTypes`; empty when the workspace has activity types disabled.
    async fn activity_types(&self) -> Result<Vec<ActivityType>> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Types {
            enabled: bool,
            #[serde(default)]
            activity_types: Option<Vec<ActivityType>>,
        }
        let result: Envelope<Types> =
            self.call(Method::GET, "api/rest/activityTypes", &[], None).await?;
        Ok(if result.data.enabled {
            result.data.activity_types.unwrap_or_default()
        } else {
            Vec::new()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_hyphenated_uuids_are_worklog_ids() {
        assert!(check_id("11111111-1111-1111-1111-111111111111", INVALID_ID).is_ok());
        assert!(check_id("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE", INVALID_ID).is_ok());
        for bad in [
            "",
            "11111111111111111111111111111111",
            "{11111111-1111-1111-1111-111111111111}",
            "urn:uuid:11111111-1111-1111-1111-111111111111",
            "11111111-1111-1111-1111-11111111111/",
            "../../../api/tracking/client/stopTra",
        ] {
            assert_eq!(check_id(bad, INVALID_ID), Err(AppError::message(INVALID_ID)), "{bad}");
        }
    }
}
