//! Offline drafts and the local timer. Port of `OfflineDraftModel.swift`.
//!
//! The ledger is the `offlineLedger` document. Every change is written to the store before it
//! is applied in memory (Swift `commit`), so a failed write never leaves memory ahead of disk. An
//! unreadable document is reported and preserved: nothing is written until it is resolved.
//! Uploads checkpoint the draft as `sending` (durably) before the create request and never send
//! it again automatically (`OfflineSync::upload`).

use std::future::ready;
use std::sync::Arc;

use serde_json::Value;
use uuid::Uuid;

use att_core::AppError;
use att_core::model::ActivityType;
use att_core::offline::{
    OfflineDraft, OfflineDraftStatus, OfflineLedger, OfflineReview, OfflineSync,
};
use att_core::service::OfflineDraftService;

use super::{detached, done, internal, persist, same_workspace, still_current};
use crate::clients::Clients;
use crate::engine::Engine;
use crate::ipc::IpcError;
use crate::services::Services;
use crate::state::AppState;

#[derive(Default)]
pub(crate) struct OfflineState {
    pub ledger: OfflineLedger,
    /// The ledger document could not be read; it is preserved and nothing is written.
    pub unreadable: bool,
    pub working: bool,
    pub issue: Option<String>,
    pub message: Option<String>,
    pub review: Option<OfflineReview>,
    /// A 7pace connection exists (reviews and uploads need one).
    pub configured: bool,
    pub show_synced: bool,
    generation: u64,
}

impl OfflineState {
    /// This workspace's drafts, newest first (Swift `drafts`).
    pub(crate) fn drafts(&self, workspace: &str) -> Vec<&OfflineDraft> {
        let mut drafts: Vec<&OfflineDraft> = self
            .ledger
            .drafts
            .iter()
            .filter(|draft| same_workspace(&draft.workspace, workspace))
            .collect();
        drafts.sort_by(|a, b| b.start.cmp(&a.start).then_with(|| a.id.cmp(&b.id)));
        drafts
    }

    /// Cached activity types of this workspace (Swift `activities`).
    pub(crate) fn activities(&self, workspace: &str) -> Vec<ActivityType> {
        if let Some(types) = self.ledger.activities.get(workspace) {
            return types.clone();
        }
        self.ledger
            .activities
            .iter()
            .find(|(key, _)| same_workspace(key, workspace))
            .map(|(_, types)| types.clone())
            .unwrap_or_default()
    }

    /// Stopped drafts that still need a review or upload (Swift `readyCount`).
    pub(crate) fn ready_count(&self, workspace: &str) -> usize {
        self.drafts(workspace)
            .iter()
            .filter(|draft| !draft.running() && draft.status != OfflineDraftStatus::Synced)
            .count()
    }

    /// Swift `canCreate`.
    pub(crate) fn can_create(&self, workspace: &str) -> bool {
        !self.unreadable && !workspace.is_empty() && !self.working
    }

    /// Swift `ledger.drafts.contains(draft)`: the exact stored version.
    fn contains(&self, draft: &OfflineDraft) -> bool {
        self.ledger.drafts.iter().any(|stored| stored == draft)
    }

    /// Swift `configure(_:workspace:)`, refused while a check or upload runs.
    pub(crate) fn configure(&mut self, configured: bool) {
        if self.working {
            return;
        }
        self.configured = configured;
        self.generation += 1;
        self.review = None;
        self.message = None;
    }
}

/// Swift `commit(_:)`: write first, then apply.
fn commit(
    services: &Services,
    offline: &mut OfflineState,
    next: OfflineLedger,
) -> att_core::Result<()> {
    if offline.unreadable {
        return Err(AppError::message(
            "The saved drafts are unreadable; the original file has been preserved.",
        ));
    }
    if !services.preview {
        persist::write_ledger(services, &next)
            .map_err(|error| AppError::Message(error.to_string()))?;
    }
    offline.ledger = next;
    Ok(())
}

/// Swift `checkpoint(_:)`: replace one draft (the one-running-timer rule applies).
fn checkpoint(
    services: &Services,
    offline: &mut OfflineState,
    draft: OfflineDraft,
) -> att_core::Result<()> {
    let mut next = offline.ledger.clone();
    next.replace(draft)?;
    commit(services, offline, next)
}

/// The upload and link checkpoint: durable before it returns.
fn checkpoint_draft(engine: &Engine, draft: OfflineDraft) -> att_core::Result<()> {
    let services = engine.services();
    engine.update(|state| checkpoint(services, &mut state.controllers.offline, draft))
}

/// Swift `cacheActivities(_:workspace:)`, after every successful activity download.
pub(crate) fn cache_activities(engine: &Engine, workspace: &str, types: &[ActivityType]) {
    let services = engine.services();
    engine.update(|state| {
        let offline = &mut state.controllers.offline;
        if !offline.unreadable
            && offline.ledger.activities.get(workspace).is_some_and(|cached| cached == types)
        {
            return;
        }
        let mut next = offline.ledger.clone();
        next.cache_activities(workspace, types.to_vec());
        if let Err(error) = commit(services, offline, next) {
            offline.issue = Some(format!("Could not save activities for offline use: {error}"));
        }
    });
}

// -- Editing --------------------------------------------------------------------------------------

/// Why a save did not happen.
enum Refusal {
    /// Swift returned `false` without a message.
    Guard(IpcError),
    /// Swift set `issue` and returned `false`.
    Issue(AppError),
}

/// Swift `save(_:)`. On success the draft is stored and `message` explains what happened.
fn save_draft(
    services: &Services,
    state: &mut AppState,
    draft: OfflineDraft,
    now: jiff::Timestamp,
    cal: &att_core::Cal,
) -> Result<(), Refusal> {
    let workspace = crate::session::hooks::workspace(state);
    let offline = &mut state.controllers.offline;
    if offline.working {
        return Err(Refusal::Guard(IpcError::new(
            "busy",
            "Wait for the current check with 7pace to finish, then try again.",
        )));
    }
    if !same_workspace(&draft.workspace, &workspace) {
        return Err(Refusal::Guard(IpcError::new(
            "refused",
            "This draft belongs to another 7pace workspace.",
        )));
    }
    if draft.status != OfflineDraftStatus::Draft {
        return Err(Refusal::Guard(IpcError::new(
            "refused",
            "An uploaded or unconfirmed draft cannot be edited.",
        )));
    }
    let running = draft.running();
    let result =
        validate(offline, &draft, now, cal).and_then(|()| checkpoint(services, offline, draft));
    match result {
        Ok(()) => {
            offline.review = None;
            offline.issue = None;
            offline.message = Some(
                if running {
                    "Local timer saved. This does not change the 7pace timer."
                } else {
                    "Draft saved on this Mac."
                }
                .into(),
            );
            Ok(())
        }
        Err(error) => {
            offline.issue = Some(error.to_string());
            Err(Refusal::Issue(error))
        }
    }
}

fn validate(
    offline: &OfflineState,
    draft: &OfflineDraft,
    now: jiff::Timestamp,
    cal: &att_core::Cal,
) -> att_core::Result<()> {
    if offline
        .ledger
        .drafts
        .iter()
        .any(|old| old.id == draft.id && old.status != OfflineDraftStatus::Draft)
    {
        return Err(AppError::message("An uploaded or unconfirmed draft cannot be edited."));
    }
    let target = match draft.ticket_id {
        Some(id) => (1..=i64::from(i32::MAX)).contains(&id),
        None => !draft.comment.trim().is_empty(),
    };
    if !target {
        return Err(AppError::message("Choose a ticket or add a comment for ticket-free work."));
    }
    if draft.start > now {
        return Err(AppError::message("The local timer cannot start in the future."));
    }
    if draft.end.is_some() {
        draft.proposal(now, cal)?;
    }
    Ok(())
}

fn save_result(result: Result<(), Refusal>) -> Result<Value, IpcError> {
    match result {
        Ok(()) => done(),
        Err(Refusal::Guard(error)) => Err(error),
        Err(Refusal::Issue(error)) => Err(error.into()),
    }
}

/// `offline.save`: resolves when stored; rejects with Swift's message otherwise (also shown as
/// the page's `issue`, as in Swift).
pub(crate) fn save_intent(engine: &Engine, draft: OfflineDraft) -> Result<Value, IpcError> {
    let (now, cal, services) = (engine.now(), engine.cal(), engine.services());
    save_result(engine.update(|state| save_draft(services, state, draft, now, &cal)))
}

/// `offline.startLocal`: a running draft from now (Swift's "Start local timer…" sheet).
pub(crate) fn start_local(
    engine: &Engine,
    ticket_id: Option<i64>,
    comment: String,
    activity_id: Option<String>,
) -> Result<Value, IpcError> {
    let (now, cal, services) = (engine.now(), engine.cal(), engine.services());
    save_result(engine.update(|state| {
        let workspace = crate::session::hooks::workspace(state);
        let draft = OfflineDraft::new(workspace, now, None, ticket_id, comment, activity_id);
        save_draft(services, state, draft, now, &cal)
    }))
}

/// Swift `stop()`: the running local timer, in any workspace, ends now.
pub(crate) fn stop(engine: &Engine) -> Result<Value, IpcError> {
    let (now, cal, services) = (engine.now(), engine.cal(), engine.services());
    engine.update(|state| {
        let offline = &mut state.controllers.offline;
        if offline.working {
            return;
        }
        let Some(mut draft) = offline.ledger.active().cloned() else { return };
        draft.end = Some(now);
        let result = draft.proposal(now, &cal).and_then(|_| checkpoint(services, offline, draft));
        match result {
            Ok(()) => {
                offline.review = None;
                offline.issue = None;
                offline.message =
                    Some("Local timer stopped. Review the draft before uploading.".into());
            }
            Err(error) => offline.issue = Some(error.to_string()),
        }
    });
    done()
}

/// Swift `remove(_:)`: never while an upload is unconfirmed.
pub(crate) fn remove(engine: &Engine, draft_id: Uuid) -> Result<Value, IpcError> {
    let services = engine.services();
    engine.update(|state| {
        let offline = &mut state.controllers.offline;
        let removable = offline
            .ledger
            .drafts
            .iter()
            .any(|draft| draft.id == draft_id && draft.status != OfflineDraftStatus::Sending);
        if offline.working || !removable {
            return;
        }
        let mut next = offline.ledger.clone();
        next.drafts.retain(|draft| draft.id != draft_id);
        match commit(services, offline, next) {
            Ok(()) => {
                offline.review = None;
                offline.issue = None;
            }
            Err(error) => offline.issue = Some(error.to_string()),
        }
    });
    done()
}

pub(crate) fn set_show_synced(engine: &Engine, show: bool) -> Result<Value, IpcError> {
    engine.update(|state| state.controllers.offline.show_synced = show);
    done()
}

// -- Review and upload ----------------------------------------------------------------------------

/// `offline.review`: Swift `check(_:)`. Refreshes the cached activities, then reviews the draft
/// against the full history before its end and the current timer.
pub(crate) async fn review(engine: &Engine, draft_id: Uuid) -> Result<Value, IpcError> {
    let Some(clients) = engine.clients() else { return done() };
    let started = engine.update(|state| {
        let workspace = crate::session::hooks::workspace(state);
        let offline = &mut state.controllers.offline;
        let draft = offline.ledger.drafts.iter().find(|draft| draft.id == draft_id).cloned()?;
        if offline.working || !same_workspace(&draft.workspace, &workspace) {
            return None;
        }
        offline.working = true;
        offline.issue = None;
        offline.message = None;
        offline.review = None;
        Some((draft, workspace, offline.generation))
    });
    let Some((draft, workspace, token)) = started else { return done() };
    let engine = engine.clone();
    detached(async move { check(&engine, &clients, draft, workspace, token).await })
        .await
        .ok_or_else(internal)?;
    done()
}

async fn check(
    engine: &Engine,
    clients: &Arc<Clients>,
    draft: OfflineDraft,
    workspace: String,
    token: u64,
) {
    let service: &dyn OfflineDraftService = clients.seven_pace.as_ref();
    let current = |engine: &Engine| {
        still_current(engine, clients)
            && engine.read(|state| state.controllers.offline.generation == token)
    };
    let result: att_core::Result<Option<OfflineReview>> = async {
        let types = service.activity_types().await?;
        if !current(engine) {
            return Ok(None);
        }
        cache_activities(engine, &workspace, &types);
        let review = OfflineSync::review(&draft, service, engine.now(), &engine.cal()).await?;
        Ok(current(engine).then_some(review))
    }
    .await;
    engine.update(|state| {
        let offline = &mut state.controllers.offline;
        offline.working = false;
        match result {
            Ok(Some(review)) => offline.review = Some(review),
            Ok(None) => {}
            Err(error) => offline.issue = Some(error.to_string()),
        }
    });
}

/// `offline.upload`: Swift `upload()`. Refused while another 7pace write runs.
pub(crate) async fn upload(engine: &Engine) -> Result<Value, IpcError> {
    let Some(clients) = engine.clients() else { return done() };
    let Some(busy) = engine.inner.busy.try_acquire() else { return Err(IpcError::busy()) };
    let started = engine.update(|state| {
        let workspace = crate::session::hooks::workspace(state);
        let offline = &mut state.controllers.offline;
        let review = offline.review.clone()?;
        if offline.working
            || !offline.contains(&review.draft)
            || !same_workspace(&review.draft.workspace, &workspace)
        {
            return None;
        }
        offline.working = true;
        offline.issue = None;
        offline.message = None;
        Some(review)
    });
    let Some(review) = started else { return done() };
    let task_engine = engine.clone();
    let outcome = detached(async move {
        let _busy = busy;
        send(&task_engine, &clients, review).await
    })
    .await
    .ok_or_else(internal)?;
    if outcome != Upload::NotSent {
        // Swift `didSync`: statistics and day review are stale, history and progress reload.
        // An unconfirmed upload may also have reached 7pace, so the same applies.
        super::hooks::invalidate_worklogs(engine);
        crate::session::hooks::worklogs_changed(engine).await;
    }
    done()
}

#[derive(Debug, PartialEq)]
enum Upload {
    Synced,
    /// The draft stays `sending`: the create may have reached 7pace.
    Unconfirmed,
    NotSent,
}

async fn send(engine: &Engine, clients: &Arc<Clients>, review: OfflineReview) -> Upload {
    let (now, cal) = (engine.now(), engine.cal());
    let service: &dyn OfflineDraftService = clients.seven_pace.as_ref();
    // `same_workspace` was checked; the draft's own spelling satisfies the exact core check.
    let workspace = review.draft.workspace.clone();
    let result = OfflineSync::upload(&review, &workspace, service, now, &cal, |draft| {
        ready(checkpoint_draft(engine, draft))
    })
    .await;
    engine.update(|state| {
        let offline = &mut state.controllers.offline;
        offline.working = false;
        offline.review = None;
        match result {
            Ok(_) => {
                offline.message = Some("Draft confirmed by 7pace.".into());
                Upload::Synced
            }
            Err(error) => {
                let sending = offline.ledger.drafts.iter().any(|draft| {
                    draft.id == review.draft.id && draft.status == OfflineDraftStatus::Sending
                });
                offline.issue = Some(if sending {
                    format!(
                        "Upload outcome is unconfirmed. Review this draft and check 7pace before retrying. {error}"
                    )
                } else {
                    error.to_string()
                });
                if sending { Upload::Unconfirmed } else { Upload::NotSent }
            }
        }
    })
}

/// `offline.link`: Swift `link(_:)`. Marks the draft synced with an existing, identical entry.
pub(crate) async fn link(engine: &Engine, log_id: String) -> Result<Value, IpcError> {
    let Some(clients) = engine.clients() else { return done() };
    let started = engine.update(|state| {
        let offline = &mut state.controllers.offline;
        let review = offline.review.clone()?;
        if offline.working
            || !offline.contains(&review.draft)
            || !review.matches.iter().any(|log| log.id == log_id)
        {
            return None;
        }
        offline.working = true;
        Some(review)
    });
    let Some(review) = started else { return done() };
    let task_engine = engine.clone();
    let linked = detached(async move {
        let engine = &task_engine;
        let (now, cal) = (engine.now(), engine.cal());
        let result: att_core::Result<()> = async {
            let fresh = clients.seven_pace.work_log(&log_id).await?;
            if !review.draft.proposal(now, &cal)?.matches(&fresh, &cal) {
                return Err(AppError::message("This entry changed. Refresh the review."));
            }
            let mut draft = review.draft.clone();
            draft.status = OfflineDraftStatus::Synced;
            draft.remote_id = Some(fresh.id);
            checkpoint_draft(engine, draft)
        }
        .await;
        engine.update(|state| {
            let offline = &mut state.controllers.offline;
            offline.working = false;
            match &result {
                Ok(()) => {
                    offline.review = None;
                    offline.issue = None;
                    offline.message =
                        Some("Linked to the existing 7pace entry. No time was added.".into());
                }
                Err(error) => offline.issue = Some(error.to_string()),
            }
        });
        result.is_ok()
    })
    .await
    .ok_or_else(internal)?;
    if linked {
        super::hooks::invalidate_worklogs(engine);
        crate::session::hooks::worklogs_changed(engine).await;
    }
    done()
}

/// Swift `allowRetryAfterManualCheck()`: only for an unconfirmed upload with no matching entry.
pub(crate) fn allow_retry_after_manual_check(engine: &Engine) -> Result<Value, IpcError> {
    let services = engine.services();
    engine.update(|state| {
        let offline = &mut state.controllers.offline;
        let Some(review) = offline.review.clone() else { return };
        if offline.working
            || review.draft.status != OfflineDraftStatus::Sending
            || !review.matches.is_empty()
            || !offline.contains(&review.draft)
        {
            return;
        }
        let mut draft = review.draft;
        draft.status = OfflineDraftStatus::Draft;
        match checkpoint(services, offline, draft) {
            Ok(()) => {
                offline.review = None;
                offline.issue = None;
                offline.message =
                    Some("Draft unlocked after your check. Review again before uploading.".into());
            }
            Err(error) => offline.issue = Some(error.to_string()),
        }
    });
    done()
}
