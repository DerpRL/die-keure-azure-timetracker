//! Controller documents: `offlineLedger`, `timeEditJournal`, and the weekly drafts table.
//!
//! The ledger and the journal are written when they change (before the change is applied in
//! memory, as Swift's `commit` and `checkpoint` did), so the per-tick [`save`] only writes what
//! changed without such a write: the journal after the load-time `applying` rule, and a weekly
//! draft whose delayed write is pending. Unchanged documents are never serialized per tick.

use std::sync::atomic::Ordering;

use att_core::offline::OfflineLedger;
use att_core::worklog::ops::{WorkLogChange, WorkLogChangeStatus};
use att_store::{StoreError, keys};

use super::time_editor::INTERRUPTED_DETAIL;
use super::weekly;
use crate::ipc::IpcError;
use crate::services::Services;
use crate::state::AppState;

pub(crate) fn load(services: &Services, state: &mut AppState) {
    let controllers = &mut state.controllers;
    // Swift created each model with `Date()`: the pages open on today.
    let today = services.clock.cal().date(services.clock.now());
    controllers.statistics.anchor = today;
    controllers.time_editor.day = today;
    controllers.day_review.selected_day = today;
    controllers.weekly.anchor = today;

    // Swift's `--preview` simulation never read or wrote the drafts file.
    if !services.preview {
        match services.store.get::<OfflineLedger>(keys::OFFLINE_LEDGER) {
            Ok(Some(ledger)) => controllers.offline.ledger = ledger,
            Ok(None) => {}
            Err(error) => {
                controllers.offline.unreadable = true;
                controllers.offline.issue = Some(format!(
                    "Local drafts could not be read. The file has been preserved: {error}"
                ));
            }
        }
    }

    let editor = &mut controllers.time_editor;
    match services.store.get::<Vec<WorkLogChange>>(keys::TIME_EDIT_JOURNAL) {
        Ok(Some(mut changes)) => {
            // Swift `TimeEditorModel.init`: a change the app did not see finish needs review.
            let mut interrupted = false;
            for change in changes.iter_mut().filter(|c| c.status == WorkLogChangeStatus::Applying) {
                change.status = WorkLogChangeStatus::NeedsReview;
                change.detail = INTERRUPTED_DETAIL.into();
                interrupted = true;
            }
            editor.changes = changes;
            editor.journal_dirty.store(interrupted, Ordering::SeqCst);
        }
        Ok(None) => {}
        Err(error) => {
            editor.journal_unreadable = true;
            editor.journal_issue = Some(format!("Edit history could not be read. {error}"));
        }
    }
}

pub(crate) fn save(services: &Services, state: &AppState) -> Result<(), IpcError> {
    let editor = &state.controllers.time_editor;
    if !editor.journal_unreadable && editor.journal_dirty.load(Ordering::SeqCst) {
        write_journal(services, &editor.changes)?;
        editor.journal_dirty.store(false, Ordering::SeqCst);
    }
    weekly::persist_pending(services, &state.controllers.weekly)
}

pub(crate) fn write_ledger(services: &Services, ledger: &OfflineLedger) -> Result<(), StoreError> {
    services.store.put(keys::OFFLINE_LEDGER, ledger).map(drop)
}

pub(crate) fn write_journal(
    services: &Services,
    changes: &[WorkLogChange],
) -> Result<(), StoreError> {
    services.store.put(keys::TIME_EDIT_JOURNAL, changes).map(drop)
}

/// The draft saved under `key`. Drafts imported from 1.14.x may use the workspace URL without
/// its trailing slash (Swift kept the URL as typed), so that spelling is tried next.
pub(crate) fn read_weekly_draft(
    services: &Services,
    key: &str,
) -> Result<Option<String>, StoreError> {
    if let Some(text) = services.store.weekly_draft(key)? {
        return Ok(Some(text));
    }
    match alternate_key(key) {
        Some(other) => services.store.weekly_draft(&other),
        None => Ok(None),
    }
}

pub(crate) fn write_weekly_draft(
    services: &Services,
    key: &str,
    text: &str,
) -> Result<(), StoreError> {
    services.store.set_weekly_draft(key, text)
}

/// `"<workspace>|<week>"` with the workspace's trailing slash toggled.
fn alternate_key(key: &str) -> Option<String> {
    let (workspace, week) = key.rsplit_once('|')?;
    let other = match workspace.strip_suffix('/') {
        Some(bare) => bare.to_string(),
        None => format!("{workspace}/"),
    };
    Some(format!("{other}|{week}"))
}

#[cfg(test)]
mod tests {
    use super::alternate_key;

    #[test]
    fn weekly_keys_toggle_the_workspace_slash() {
        assert_eq!(
            alternate_key("https://acme.timehub.7pace.com/|2026-10-05T00:00:00").as_deref(),
            Some("https://acme.timehub.7pace.com|2026-10-05T00:00:00")
        );
        assert_eq!(
            alternate_key("https://acme.timehub.7pace.com|2026-10-05T00:00:00").as_deref(),
            Some("https://acme.timehub.7pace.com/|2026-10-05T00:00:00")
        );
        assert_eq!(alternate_key("no separator"), None);
    }
}
