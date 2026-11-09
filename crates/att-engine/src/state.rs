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
    /// Other pages the visible view shows part of (never `visible_page` itself, empty while the
    /// window is closed). They load and refresh like `visible_page`.
    pub visible_also: Vec<String>,
    /// App activity, newest first, capped at `att_core::git::AUDIT_LIMIT`.
    pub audit: Vec<AuditEntry>,
    pub session: SessionState,
    pub controllers: ControllerState,
    /// The system language a window reported (`app.setSystemLanguage`), for the `system`
    /// interface language. English until a window reports.
    pub system_language: att_core::i18n::Language,
}

impl AppState {
    /// Builds text in the language the saved preference and the system language choose.
    pub(crate) fn apply_language(&self) {
        att_core::i18n::set_language(self.config.interface.language.resolve(self.system_language));
    }

    /// Every page whose content is on screen: `visible_page` first, then `visible_also`.
    pub fn visible_pages(&self) -> Vec<String> {
        self.visible_page.iter().chain(self.visible_also.iter()).cloned().collect()
    }

    /// The engine opens `page` in the main window itself (a prompt's "Review…", onboarding):
    /// it is the only visible page until the UI reports its view.
    pub(crate) fn show_page(&mut self, page: &str) {
        self.visible_page = Some(page.to_string());
        self.visible_also.clear();
    }
}
