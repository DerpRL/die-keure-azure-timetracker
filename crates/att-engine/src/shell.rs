//! What the engine asks of the desktop shell. The Tauri app implements this trait; tests use
//! [`RecordingShell`].

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// The status icon vocabulary from 1.14.x (`TrackingIndicator`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrayState {
    Running,
    Paused,
    Stopped,
    Disconnected,
    Connecting,
    Attention,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayStatus {
    /// Menu-bar text on macOS (` HH:MM:SS`), `None` to show only the icon.
    pub title: Option<String>,
    pub tooltip: String,
    pub state: TrayState,
}

/// How strongly a new prompt may interrupt (user-controlled per prompt kind).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Interruption {
    /// No panel, no banner.
    Off,
    /// OS notification only.
    NotifyOnly,
    /// Open the tray panel without taking focus (default).
    #[default]
    OpenPanel,
    /// Open the tray panel and focus it (1.14.x behaviour).
    OpenAndFocus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    /// Replaces an earlier notification with the same id.
    pub id: String,
    pub title: String,
    pub body: String,
}

pub trait Shell: Send + Sync {
    /// Shows the tray panel; `focus` decides whether it takes keyboard focus.
    fn show_panel(&self, focus: bool);
    fn hide_panel(&self);
    /// Shows and focuses the main window, optionally on a page.
    fn show_main(&self, page: Option<&str>);
    fn set_tray(&self, status: &TrayStatus);
    fn notify(&self, notification: &Notification);
    fn remove_notification(&self, id: &str);
    fn open_url(&self, url: &str);
}

/// Records every call, for tests.
#[derive(Debug, Default)]
pub struct RecordingShell {
    pub calls: Mutex<Vec<String>>,
}

impl RecordingShell {
    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.calls.lock().unwrap_or_else(|e| e.into_inner()))
    }

    fn push(&self, call: String) {
        self.calls.lock().unwrap_or_else(|e| e.into_inner()).push(call);
    }
}

impl Shell for RecordingShell {
    fn show_panel(&self, focus: bool) {
        self.push(format!("show_panel(focus={focus})"));
    }
    fn hide_panel(&self) {
        self.push("hide_panel".into());
    }
    fn show_main(&self, page: Option<&str>) {
        self.push(format!("show_main({})", page.unwrap_or("")));
    }
    fn set_tray(&self, status: &TrayStatus) {
        self.push(format!(
            "set_tray({:?},{})",
            status.state,
            status.title.as_deref().unwrap_or("")
        ));
    }
    fn notify(&self, notification: &Notification) {
        self.push(format!("notify({})", notification.id));
    }
    fn remove_notification(&self, id: &str) {
        self.push(format!("remove_notification({id})"));
    }
    fn open_url(&self, url: &str) {
        self.push(format!("open_url({url})"));
    }
}
