//! Offline drafts, the local timer and explicit upload. Ported from OfflineDrafts.swift.
//!
//! Drafts live in the local [`OfflineLedger`] (`offline-drafts.json` in 1.14.x) until the user
//! reviews and uploads them. Reading and writing the ledger file, including its 0700/0600
//! permissions and the rule that an unreadable file is preserved rather than reset, is owned by
//! `att-store`; this module only holds the ledger's types and rules.
//!
//! Upload safety: [`OfflineSync::upload`] re-reviews the draft, re-resolves its activity and
//! checkpoints the draft as `sending` *before* the create request. A draft that stays `sending`
//! (lost response, failed checkpoint, interrupted future) is never sent again automatically; it
//! has to be reconciled with what 7pace recorded.

use std::collections::BTreeMap;

use jiff::Timestamp;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::model::{ActivityType, TrackingState, WorkLog, resolve_activity};
use crate::service::OfflineDraftService;
use crate::text::NonEmpty;
use crate::time::{Cal, diff_secs, secs};
use crate::worklog::WorkLogDraft;
use crate::worklog::edit::{WorkLogConflict, WorkLogOverlap};
use crate::worklog::ops::is_swift_uuid;

/// Upload state of a draft. Serializes as the Swift raw values.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum OfflineDraftStatus {
    #[default]
    #[serde(rename = "Local draft")]
    Draft,
    /// Checkpointed just before the create request; the outcome is unknown until reconciled.
    #[serde(rename = "Check 7pace before retrying")]
    Sending,
    #[serde(rename = "Synced to 7pace")]
    Synced,
}

impl OfflineDraftStatus {
    /// The Swift raw value, which is also the label shown to the user.
    pub fn raw(&self) -> &'static str {
        match self {
            Self::Draft => "Local draft",
            Self::Sending => "Check 7pace before retrying",
            Self::Synced => "Synced to 7pace",
        }
    }
}

/// Locally recorded time, possibly still running. Ported from `OfflineDraft`.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineDraft {
    pub id: Uuid,
    /// The workspace identity (lower-cased 7pace URL) the draft belongs to.
    pub workspace: String,
    #[cfg_attr(feature = "ts", ts(as = "Timestamp"))]
    #[serde(with = "crate::time::flex_date")]
    pub start: Timestamp,
    /// `None` while the local timer runs.
    #[cfg_attr(feature = "ts", ts(as = "Option<Timestamp>"))]
    #[serde(
        default,
        with = "crate::time::flex_date::option",
        skip_serializing_if = "Option::is_none"
    )]
    pub end: Option<Timestamp>,
    #[serde(alias = "ticketID", default, skip_serializing_if = "Option::is_none")]
    pub ticket_id: Option<i64>,
    #[serde(default)]
    pub comment: String,
    #[serde(alias = "activityID", default, skip_serializing_if = "Option::is_none")]
    pub activity_id: Option<String>,
    #[serde(default)]
    pub billable: bool,
    #[serde(default)]
    pub status: OfflineDraftStatus,
    /// The 7pace worklog ID once synced or linked.
    #[serde(alias = "remoteID", default, skip_serializing_if = "Option::is_none")]
    pub remote_id: Option<String>,
}

impl OfflineDraft {
    /// A new local draft with a fresh ID; `end == None` starts the local timer.
    pub fn new(
        workspace: impl Into<String>,
        start: Timestamp,
        end: Option<Timestamp>,
        ticket_id: Option<i64>,
        comment: impl Into<String>,
        activity_id: Option<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            workspace: workspace.into(),
            start,
            end,
            ticket_id,
            comment: comment.into(),
            activity_id,
            billable: false,
            status: OfflineDraftStatus::Draft,
            remote_id: None,
        }
    }

    /// The local timer: no end yet and not uploaded.
    pub fn running(&self) -> bool {
        self.end.is_none() && self.status == OfflineDraftStatus::Draft
    }

    /// `#ticket`, else the comment, else `Untitled draft`.
    pub fn title(&self) -> String {
        match self.ticket_id {
            Some(id) => format!("#{id}"),
            None => self.comment.non_empty().unwrap_or("Untitled draft").to_string(),
        }
    }

    /// The 7pace entry this draft would create. Times round down to whole seconds and must not
    /// lie in the future; a blank comment counts as none.
    pub fn proposal(&self, now: Timestamp, cal: &Cal) -> Result<WorkLogDraft> {
        let Some(end) = self.end else {
            return Err(AppError::message("Stop the local timer before reviewing this draft."));
        };
        WorkLogDraft::from_times(
            self.start,
            end,
            self.ticket_id,
            self.comment.non_empty().map(str::to_string),
            self.activity_id.clone(),
            self.billable,
            now,
            cal,
        )
    }
}

/// Every local draft plus activity types cached for offline use. Ported from `OfflineLedger`.
///
/// Decodes the 1.14.x `offline-drafts.json` directly (Swift dates, uppercase UUIDs, raw status
/// values).
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfflineLedger {
    #[serde(default)]
    pub drafts: Vec<OfflineDraft>,
    /// Activity types per workspace identity: the normalized, lower-cased 7pace URL that is also
    /// stored in [`OfflineDraft::workspace`].
    #[serde(default)]
    pub activities: BTreeMap<String, Vec<ActivityType>>,
}

impl OfflineLedger {
    /// Inserts or replaces `draft` (matched by ID, moved to the end). Only one local timer may
    /// run at a time, across all workspaces.
    pub fn replace(&mut self, draft: OfflineDraft) -> Result<()> {
        if draft.workspace.is_empty() {
            return Err(AppError::message("Set a 7pace workspace URL in Settings first."));
        }
        if draft.running() && self.drafts.iter().any(|d| d.id != draft.id && d.running()) {
            return Err(AppError::message("Stop the existing local timer first."));
        }
        self.drafts.retain(|d| d.id != draft.id);
        self.drafts.push(draft);
        Ok(())
    }

    /// The running local timer, in any workspace.
    pub fn active(&self) -> Option<&OfflineDraft> {
        self.drafts.iter().find(|draft| draft.running())
    }

    /// The cached activity types for a workspace identity.
    pub fn activities_for(&self, workspace: &str) -> &[ActivityType] {
        self.activities.get(workspace).map_or(&[], Vec::as_slice)
    }

    /// Replaces the cached activity types for a workspace identity.
    pub fn cache_activities(&mut self, workspace: impl Into<String>, types: Vec<ActivityType>) {
        self.activities.insert(workspace.into(), types);
    }
}

/// A stopped draft checked against 7pace before upload. Ported from `OfflineReview`.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineReview {
    pub draft: OfflineDraft,
    /// Advisory overlaps; they never block an upload by themselves.
    pub conflicts: Vec<WorkLogConflict>,
    /// Why the overlap check is incomplete.
    pub overlap_issue: Option<String>,
    /// Existing entries identical to the draft's proposal (link one instead of uploading).
    pub matches: Vec<WorkLog>,
}

impl OfflineReview {
    /// Fails only when the draft has no valid proposal; overlap failures become `overlap_issue`.
    pub fn new(
        draft: OfflineDraft,
        logs: &[WorkLog],
        state: &TrackingState,
        now: Timestamp,
        cal: &Cal,
    ) -> Result<Self> {
        let proposal = draft.proposal(now, cal)?;
        let matches = logs.iter().filter(|log| proposal.matches(log, cal)).cloned().collect();
        let (conflicts, overlap_issue) =
            match WorkLogOverlap::conflicts(&proposal.edit(), "", logs, state, now, cal) {
                Ok(conflicts) => (conflicts, None),
                Err(error) => (Vec::new(), Some(error.to_string())),
            };
        Ok(Self { draft, conflicts, overlap_issue, matches })
    }

    /// Fingerprint of the overlap advice the user saw. An upload is refused when a fresh review
    /// produces a different key. Numbers use Swift's `Double` text (`1790578800.0`); the key is
    /// only compared in memory.
    pub fn warning_key(&self) -> String {
        let mut parts: Vec<String> = self
            .conflicts
            .iter()
            .map(|c| format!("{}:{:?}:{:?}", c.id, secs(c.start), c.overlap.round()))
            .collect();
        parts.sort();
        format!("{}{}", self.overlap_issue.as_deref().unwrap_or(""), parts.join("|"))
    }
}

/// Review and upload of offline drafts. Ported from `OfflineSync`.
pub enum OfflineSync {}

impl OfflineSync {
    /// Checks a stopped draft against the full history before its end and the current timer.
    pub async fn review(
        draft: &OfflineDraft,
        service: &dyn OfflineDraftService,
        now: Timestamp,
        cal: &Cal,
    ) -> Result<OfflineReview> {
        let proposal = draft.proposal(now, cal)?;
        let logs = service.work_logs_before(proposal.edit().end).await?;
        let state = service.current_tracking().await?.checked()?;
        OfflineReview::new(draft.clone(), &logs, &state, now, cal)
    }

    /// Uploads a reviewed draft once. The draft must belong to `workspace` and still be a local
    /// draft; a fresh review must find no matching entry and the same overlap advice; the saved
    /// activity must still exist. `checkpoint` persists the draft as `sending` before the request
    /// and as `synced` after 7pace confirmed it. When the first checkpoint fails nothing is sent.
    /// After the request, nothing is ever resent: the draft stays `sending` until reconciled.
    pub async fn upload<F, Fut>(
        reviewed: &OfflineReview,
        workspace: &str,
        service: &dyn OfflineDraftService,
        now: Timestamp,
        cal: &Cal,
        mut checkpoint: F,
    ) -> Result<OfflineDraft>
    where
        F: FnMut(OfflineDraft) -> Fut,
        Fut: Future<Output = Result<()>>,
    {
        let draft = &reviewed.draft;
        if draft.workspace != workspace || draft.status != OfflineDraftStatus::Draft {
            return Err(AppError::message(
                "This draft belongs to another workspace or has an unconfirmed upload. Review it before sending.",
            ));
        }
        let fresh = Self::review(draft, service, now, cal).await?;
        if !fresh.matches.is_empty() {
            return Err(AppError::message(
                "A matching entry already exists. Refresh the review and link it instead of uploading again.",
            ));
        }
        if fresh.warning_key() != reviewed.warning_key() {
            return Err(AppError::message(
                "Overlap details changed. Refresh the review before uploading.",
            ));
        }
        let activities = service.activity_types().await?;
        let selected = resolve_activity(draft.activity_id.as_deref().unwrap_or(""), &activities)?;
        if selected != draft.activity_id {
            return Err(AppError::message(
                "The saved activity is no longer available. Edit the draft’s activity.",
            ));
        }
        let proposal = draft.proposal(now, cal)?;
        let mut pending = draft.clone();
        pending.status = OfflineDraftStatus::Sending;
        // Persist BEFORE the request. If the response or final checkpoint is lost, never replay
        // the create automatically.
        checkpoint(pending.clone()).await?;
        let created = service.create_work_log(&proposal).await?;
        if !is_swift_uuid(&created.id) || !proposal.matches(&created, cal) {
            return Err(AppError::message(
                "7pace did not confirm this draft exactly. Check 7pace before retrying.",
            ));
        }
        pending.status = OfflineDraftStatus::Synced;
        pending.remote_id = Some(created.id);
        checkpoint(pending.clone()).await?;
        Ok(pending)
    }
}

/// Display policy only. Local time never participates in confirmed 7pace totals.
/// Ported from `LocalTimerDisplay`.
pub enum LocalTimerDisplay {}

impl LocalTimerDisplay {
    /// The local clock is shown unless 7pace confirms a running timer of its own.
    pub fn is_primary(
        local: Option<&OfflineDraft>,
        remote_running: bool,
        remote_confirmed: bool,
    ) -> bool {
        local.is_some_and(OfflineDraft::running) && !(remote_running && remote_confirmed)
    }

    /// Seconds recorded by a draft at `now`, never negative.
    pub fn elapsed(draft: &OfflineDraft, now: Timestamp) -> f64 {
        diff_secs(draft.end.unwrap_or(now), draft.start).max(0.0)
    }
}
