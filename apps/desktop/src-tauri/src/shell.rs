//! The shell's IPC surface: the commands the React windows (and later the engine) call and the
//! events the shell emits. Engine commands are added next to these and registered in `lib.rs`
//! and `build.rs`.
//!
//! Arguments are camelCase on the JavaScript side (Tauri's default for `#[tauri::command]`).
//! Failures reject the `invoke` promise with a readable English message.

use std::fmt;
use std::sync::{Mutex, MutexGuard, PoisonError, mpsc};

use serde::Serialize;
use tauri::AppHandle;

use crate::shortcut::{self, ShortcutStatus};
use crate::surfaces;
use crate::tray::{self, TrayState};

/// Emitted to the main window when it is asked to show a page. Payload: the page id (string).
pub const NAVIGATE_EVENT: &str = "shell://navigate";
/// Emitted to every window after the quick-switch shortcut showed and focused the panel.
/// Payload: `null`.
pub const QUICK_SWITCH_EVENT: &str = "shortcut://quick-switch";
/// Emitted to every window when the panel becomes visible. Payload: [`PanelShown`].
pub const PANEL_SHOWN_EVENT: &str = "shell://panel-shown";
/// Emitted to every window when the panel is hidden. Payload: [`PanelHidden`].
pub const PANEL_HIDDEN_EVENT: &str = "shell://panel-hidden";
/// Emitted to every window when the user closed the mini timer window themselves (Alt+F4, ⌘W),
/// so the setting can follow. Payload: `null`.
pub const MINI_CLOSED_EVENT: &str = "shell://mini-closed";

/// The page id the tray menu's and the app menu's Settings items navigate to.
pub const SETTINGS_PAGE: &str = "settings";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelShown {
    /// Whether the panel took keyboard focus (tray click, shortcut, `focus: true`).
    pub focused: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HideReason {
    /// The panel lost focus.
    Blur,
    /// A command, a tray click or opening the main window hid it.
    Request,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelHidden {
    pub reason: HideReason,
}

/// Shows the tray panel, anchored to the tray icon. `focus: false` shows it without activating
/// the app or taking keyboard focus from the frontmost app; the engine decides per prompt.
#[tauri::command]
pub fn shell_show_panel(app: AppHandle, focus: bool) -> Result<(), String> {
    surfaces::show_panel(&app, focus).map_err(message)
}

#[tauri::command]
pub fn shell_hide_panel(app: AppHandle) -> Result<(), String> {
    surfaces::hide_panel(&app).map_err(message)
}

/// Hides a visible panel, otherwise shows it with focus.
#[tauri::command]
pub fn shell_toggle_panel(app: AppHandle) -> Result<(), String> {
    surfaces::toggle_panel(&app).map_err(message)
}

/// Shows and focuses the main window (hiding the panel) and, when `page` is given, emits
/// [`NAVIGATE_EVENT`] with it to the main window. Page ids belong to the UI: 1–64 characters of
/// `A–Z a–z 0–9 - _ /`.
#[tauri::command]
pub fn shell_show_main(app: AppHandle, page: Option<String>) -> Result<(), String> {
    let page = page.map(|page| surfaces::validate_page(&page)).transpose().map_err(message)?;
    surfaces::show_main(&app, page.as_deref()).map_err(message)
}

/// Updates the tray. `title` is the menu-bar text on macOS (for example `" 01:23:45"`; `None`
/// shows the clock only) and is ignored on Windows, which cannot show text in the tray. `tooltip`
/// is also the accessibility label on macOS. `state` picks the coloured icon on Windows; macOS
/// keeps the monochrome template clock, as 1.x did.
#[tauri::command]
pub fn shell_set_tray(
    app: AppHandle,
    title: Option<String>,
    tooltip: String,
    state: TrayState,
) -> Result<(), String> {
    tray::set(&app, title, tooltip, state).map_err(message)
}

/// Creates and shows (without focus) or destroys the small always-on-top elapsed-time window
/// labelled `mini`. Async because creating a web view from a synchronous command deadlocks on
/// Windows.
#[tauri::command]
pub async fn shell_set_mini_timer(app: AppHandle, enabled: bool) -> Result<(), String> {
    surfaces::set_mini_timer(&app, enabled).map_err(message)
}

/// Registers `accelerator` (for example `"Control+Alt+T"`) as the quick-switch shortcut, or turns
/// the shortcut off with `None`. A shortcut that is invalid, would capture plain typing, or is
/// taken by another app returns an error and the previous shortcut stays active.
#[tauri::command]
pub fn shell_set_shortcut(app: AppHandle, accelerator: Option<String>) -> Result<(), String> {
    shortcut::set(&app, accelerator.as_deref())
}

/// The registered quick-switch shortcut, its default and the last registration problem (for
/// example when the default was taken by another app at launch).
#[tauri::command]
pub fn shell_get_shortcut(app: AppHandle) -> ShortcutStatus {
    shortcut::status(&app)
}

/// Quits the app. The 7pace timer is not touched, as in 1.x.
#[tauri::command]
pub fn shell_quit(app: AppHandle) {
    app.exit(0);
}

/// Errors of the shell functions behind the commands.
#[derive(Debug)]
pub enum ShellError {
    Tauri(tauri::Error),
    MissingWindow(&'static str),
    MissingTray,
    Invalid(String),
    /// The main thread dropped a task before running it (the app is shutting down).
    Interrupted,
}

impl fmt::Display for ShellError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Tauri(error) => write!(f, "{error}"),
            Self::MissingWindow(label) => write!(f, "The {label} window does not exist."),
            Self::MissingTray => f.write_str("The tray icon does not exist."),
            Self::Invalid(text) => f.write_str(text),
            Self::Interrupted => f.write_str("The app stopped before the change was applied."),
        }
    }
}

impl std::error::Error for ShellError {}

impl From<tauri::Error> for ShellError {
    fn from(error: tauri::Error) -> Self {
        Self::Tauri(error)
    }
}

fn message(error: ShellError) -> String {
    error.to_string()
}

/// Locks a mutex whose data stays consistent even if a holder panicked (flags and caches only).
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Runs `task` on the main thread and waits for its result; inline when already there.
///
/// Tray, window and hotkey calls each make their own round trip to the main thread. Running a
/// whole multi-step change there serialises concurrent callers (sync commands run on the main
/// thread, engine tasks will not) without holding a lock across those round trips, which could
/// deadlock against the main thread.
pub(crate) fn on_main_thread<T: Send + 'static>(
    app: &AppHandle,
    task: impl FnOnce() -> T + Send + 'static,
) -> Result<T, ShellError> {
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(task());
    })?;
    receiver.recv().map_err(|_| ShellError::Interrupted)
}
