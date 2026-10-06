//! All engine state, behind one lock (see the concurrency notes in `lib.rs`).
//!
//! Top-level fields are shared by the session and the page controllers. Each half owns its own
//! sub-state struct and the files that define it.

use att_core::Configuration;
use att_core::git::AuditEntry;

use crate::controllers::ControllerState;
use crate::session::SessionState;

/// Sidebar pages, in sidebar order. Their ids are the strings the UI uses.
pub const PAGES: [&str; 11] = [
    "overview",
    "dayReview",
    "agenda",
    "offlineDrafts",
    "statistics",
    "weeklyReport",
    "history",
    "timeEditor",
    "repositories",
    "figma",
    "settings",
];

#[derive(Default)]
pub struct AppState {
    pub config: Configuration,
    /// Whether settings were found at startup (onboarding rule).
    pub has_saved_settings: bool,
    /// False when saved settings could not be read: nothing is written so the original data
    /// survives (Swift `canPersist`).
    pub can_persist: bool,
    /// Why saved data could not be read or written, shown in the UI.
    pub storage_issue: Option<String>,
    /// The page the main window shows, or `None` when it is closed. Pages load data only
    /// while visible, as in 1.14.x.
    pub visible_page: Option<String>,
    /// App activity, newest first, capped at `att_core::git::AUDIT_LIMIT`.
    pub audit: Vec<AuditEntry>,
    pub session: SessionState,
    pub controllers: ControllerState,
}
