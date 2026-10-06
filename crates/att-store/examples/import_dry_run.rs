//! Dry run of the 1.14.x import against a copy of a real data folder.
//!
//! `cargo run -p att-store --example import_dry_run -- "<legacy dir>"`
//!
//! Copies the JSON files to a temporary folder, imports them into an in-memory database and
//! prints only document names, sizes and counts — never contents. The source folder is untouched.

use att_store::{Store, legacy};

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
    Ok(())
}
