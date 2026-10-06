//! OS integration for Azure timetracker 2.0.
//!
//! Every capability is a trait with a macOS and a Windows implementation, selected by
//! [`Platform::native`]. Implementations must never block for long: the engine calls probes from
//! a blocking thread pool with its own deadline, but each call should still return in well under
//! a second. Probes never capture audio, keystrokes, pointer positions, window contents or
//! screenshots; they only read the metadata named in each trait.
//!
//! Tray icon, windows, global shortcut, notifications, autostart, dialogs, clipboard and opening
//! URLs are handled by Tauri plugins in the app crate, not here.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use jiff::Timestamp;
use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

/// Shown when a capability is not available on this OS.
pub mod unsupported;

/// Pure parsing helpers for the Windows implementation. Compiled on every OS so their unit tests
/// run on macOS CI too (registry key names, FILETIME values, executable names).
pub mod windows_parse;

pub mod paths;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PlatformError {
    #[error("{0} is not available on this system.")]
    Unsupported(&'static str),
    #[error("Access to {0} was denied. Allow it in system settings.")]
    Denied(&'static str),
    #[error("{0}")]
    Failed(String),
}

pub type Result<T, E = PlatformError> = std::result::Result<T, E>;

// ---------------------------------------------------------------------------------------------
// Credentials

/// Secret storage: macOS Keychain (generic passwords) and Windows Credential Manager.
///
/// Service name is [`CREDENTIAL_SERVICE`]. Account names are kept from 1.14.x so existing Keychain
/// items are read without migration: `7pace:<host>`, `azure:<org lowercased>`,
/// `7pace-oauth:<host>` (OAuth token JSON).
///
/// Secrets may be up to 20 KiB. Windows Credential Manager limits one entry to 2,560 bytes, so
/// longer secrets continue in `<target>#part2`, `#part3`, … transparently.
pub trait Credentials: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>>;
    fn set(&self, account: &str, secret: &str) -> Result<()>;
    /// Deleting a missing item is not an error.
    fn delete(&self, account: &str) -> Result<()>;
}

pub const CREDENTIAL_SERVICE: &str = "be.yarne.azure-timetracker";

// ---------------------------------------------------------------------------------------------
// Calendar (macOS only at launch; Windows reports `Unsupported`)

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CalendarAccess {
    NotDetermined,
    Denied,
    Restricted,
    Authorized,
    /// The OS integration does not exist (Windows).
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarInfo {
    pub id: String,
    pub title: String,
    /// `#rrggbb`.
    pub color: Option<String>,
    /// Account or source name, e.g. "iCloud" or an Exchange account.
    pub source: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EventStatus {
    None,
    Confirmed,
    Tentative,
    Canceled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    /// Unique per occurrence: the event identifier plus the occurrence start.
    pub occurrence_id: String,
    pub calendar_id: String,
    pub title: String,
    pub start: Timestamp,
    pub end: Timestamp,
    pub all_day: bool,
    pub status: EventStatus,
    /// The current user is an attendee and declined.
    pub declined: bool,
    /// Availability is "free".
    pub free: bool,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub url: Option<String>,
    pub calendar_color: Option<String>,
}

#[async_trait]
pub trait CalendarSource: Send + Sync {
    fn access(&self) -> CalendarAccess;
    /// Shows the OS prompt when access is not yet determined.
    async fn request_access(&self) -> Result<CalendarAccess>;
    fn calendars(&self) -> Result<Vec<CalendarInfo>>;
    /// Events overlapping `[from, to)`. Empty `calendar_ids` means all calendars.
    fn events(
        &self,
        from: Timestamp,
        to: Timestamp,
        calendar_ids: &[String],
    ) -> Result<Vec<CalendarEvent>>;
    /// Opens the system calendar app, when there is one.
    fn open_calendar_app(&self) -> Result<()>;
}

// ---------------------------------------------------------------------------------------------
// Microphone in use

/// A process that currently has an active microphone input stream.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputOwner {
    /// macOS: the owning app's bundle ID (WebKit helpers keep `com.apple.WebKit…`).
    /// Windows: the executable file name in lower case, e.g. `ms-teams.exe`. Packaged (Store)
    /// apps without a known mapping arrive as their package family name, `Name_PublisherId`.
    pub id: String,
    /// Display name, e.g. "Microsoft Teams".
    pub name: String,
    pub pid: Option<u32>,
    pub path: Option<String>,
}

pub trait MicrophoneProbe: Send + Sync {
    /// False on macOS before 14.2 or when the OS API is missing.
    fn supported(&self) -> bool;
    /// Every process with input running right now. An error means "unknown", never "silent".
    fn sample(&self) -> Result<Vec<InputOwner>>;
}

// ---------------------------------------------------------------------------------------------
// Presence: idle time, screen lock, foreground app, sleep/wake

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIdentity {
    /// macOS bundle ID, or Windows executable file name in lower case.
    pub id: String,
    pub name: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceSample {
    /// Seconds since the last keyboard, pointer or touch input in this session.
    pub idle_seconds: f64,
    /// `None` when the lock state cannot be read.
    pub locked: Option<bool>,
    pub foreground: Option<AppIdentity>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SystemEvent {
    WillSleep,
    DidWake,
    ScreenLocked,
    ScreenUnlocked,
    SessionResigned,
    SessionActivated,
    DisplaysSlept,
    DisplaysWoke,
}

pub type SystemEventSink = Arc<dyn Fn(SystemEvent) + Send + Sync>;

pub trait PresenceProbe: Send + Sync {
    fn sample(&self) -> PresenceSample;
    /// Starts delivering OS notifications to `sink`. Must be called on the main thread on macOS.
    /// Implementations may deliver nothing; the engine also infers sleep from sample gaps.
    fn subscribe(&self, sink: SystemEventSink) -> Result<()>;
    /// Reads the identity of an application chosen in a file dialog (`.app` bundle or `.exe`).
    fn app_identity(&self, path: &Path) -> Result<AppIdentity>;
}

// ---------------------------------------------------------------------------------------------
// Figma Desktop window observer

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum WindowObservation {
    /// Accessibility (macOS) permission is missing.
    MissingAccess,
    /// Figma is not the foreground app.
    NotForeground,
    /// Figma is in front but its window could not be read yet.
    Waiting,
    Window {
        title: Option<String>,
        /// The document URL when the OS exposes it (`AXURL`/`AXDocument`, UI Automation).
        url: Option<String>,
    },
}

pub trait FigmaObserver: Send + Sync {
    /// macOS: Accessibility permission. Windows needs no permission and always returns true.
    fn has_access(&self) -> bool;
    /// Shows the OS permission prompt where one exists. Returns the access state afterwards.
    fn request_access(&self) -> bool;
    /// Reads the foreground Figma Desktop window. Bounded: at most 200 accessibility nodes,
    /// 120 ms per call and about 1.8 s overall.
    fn observe(&self) -> WindowObservation;
    /// Whether Figma Desktop is installed, to offer "Open in Figma".
    fn figma_installed(&self) -> bool;
}

// ---------------------------------------------------------------------------------------------
// Bundle

/// All platform capabilities for the running OS.
#[derive(Clone)]
pub struct Platform {
    pub credentials: Arc<dyn Credentials>,
    pub calendar: Arc<dyn CalendarSource>,
    pub microphone: Arc<dyn MicrophoneProbe>,
    pub presence: Arc<dyn PresenceProbe>,
    pub figma: Arc<dyn FigmaObserver>,
}

impl Platform {
    #[cfg(target_os = "macos")]
    pub fn native() -> Self {
        macos::platform()
    }

    #[cfg(target_os = "windows")]
    pub fn native() -> Self {
        windows::platform()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub fn native() -> Self {
        unsupported::platform()
    }
}

/// Which OS the app runs on, for per-OS defaults (work apps, microphone apps, shortcuts).
pub use att_core::model::HostOs as Os;

pub const fn current_os() -> Os {
    Os::current()
}

/// Re-exported so implementors do not need their own path helpers.
pub fn data_dir() -> PathBuf {
    paths::data_dir()
}
