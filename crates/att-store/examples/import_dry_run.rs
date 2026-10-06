//! Dry run of the 1.14.x import against a copy of a real data folder.
//!
//! `cargo run -p att-store --example import_dry_run -- "<legacy dir>"`
//!
//! Copies the JSON files to a temporary folder, imports them into an in-memory database and
//! prints only document names, sizes and counts — never contents. The source folder is untouched.

use std::collections::BTreeMap;

use att_core::Configuration;
use att_core::awareness::WorkAwarenessLedger;
use att_core::completion::TicketCompletionMonitor;
use att_core::figma::FigmaStore;
use att_core::git::{AuditEntry, BranchChange};
use att_core::indicator::PausedSession;
use att_core::meetings::MeetingSuggestionEngine;
use att_core::microphone_end::MicrophoneTrackingMonitor;
use att_core::offline::OfflineLedger;
use att_core::worklog::ops::WorkLogChange;
use att_store::{Store, keys, legacy};
use jiff::Timestamp;
use serde::de::DeserializeOwned;

/// Decodes a document into its Rust type and prints only whether that worked.
fn check<T: DeserializeOwned>(store: &Store, key: &str) {
    match store.get_raw(key) {
        Ok(None) => println!("typed {key}: absent"),
        Ok(Some(text)) => match serde_json::from_str::<T>(&text) {
            Ok(_) => println!("typed {key}: ok"),
            Err(error) => println!(
                "typed {key}: FAILED at line {} column {}: {}",
                error.line(),
                error.column(),
                error.classify() as u8
            ),
        },
        Err(error) => println!("typed {key}: unreadable ({error})"),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let source = std::env::args().nth(1).ok_or("pass the legacy data folder")?;
    let copy = tempfile::tempdir()?;
    for name in
        [legacy::STATE_FILE, legacy::OFFLINE_FILE, legacy::JOURNAL_FILE, legacy::WEEKLY_FILE]
    {
        let from = std::path::Path::new(&source).join(name);
        if from.exists() {
            std::fs::copy(&from, copy.path().join(name))?;
        }
    }
    let store = Store::open_in_memory()?;
    let report = store.import_legacy(copy.path())?;
    println!("imported: {}", report.imported);
    println!("audit entries: {}", report.audit_entries);
    println!("weekly drafts: {}", report.weekly_drafts);
    for key in &report.documents {
        let size = store.get_raw(key)?.map_or(0, |t| t.len());
        println!("document {key}: {size} bytes");
    }
    for skipped in &report.skipped {
        println!("skipped: {skipped}");
    }
    check::<Configuration>(&store, keys::CONFIGURATION);
    check::<Vec<BranchChange>>(&store, keys::PENDING_BRANCHES);
    check::<MeetingSuggestionEngine>(&store, keys::MEETING_REMINDERS);
    check::<PausedSession>(&store, keys::PAUSED_SESSION);
    check::<WorkAwarenessLedger>(&store, keys::WORK_AWARENESS);
    check::<TicketCompletionMonitor>(&store, keys::TICKET_COMPLETION);
    check::<MicrophoneTrackingMonitor>(&store, keys::MICROPHONE_TRACKING);
    check::<FigmaStore>(&store, keys::FIGMA_STORE);
    check::<OfflineLedger>(&store, keys::OFFLINE_LEDGER);
    check::<Vec<WorkLogChange>>(&store, keys::TIME_EDIT_JOURNAL);
    for key in [keys::ATTENTION_NOTIFIED, keys::ATTENTION_DISMISSED] {
        match store.get_raw(key)? {
            Some(text) => {
                #[derive(serde::Deserialize)]
                struct Map(
                    #[serde(with = "att_core::time::flex_date::map")] BTreeMap<String, Timestamp>,
                );
                let ok = serde_json::from_str::<Map>(&text).map(|map| map.0.len()).is_ok();
                println!("typed {key}: {}", if ok { "ok" } else { "FAILED" });
            }
            None => println!("typed {key}: absent"),
        }
    }
    let audit: Vec<serde_json::Value> = store.audit(10_000)?;
    let typed =
        audit.iter().filter(|v| serde_json::from_value::<AuditEntry>((*v).clone()).is_ok()).count();
    println!("typed audit: {typed} of {} entries decode", audit.len());
    Ok(())
}
