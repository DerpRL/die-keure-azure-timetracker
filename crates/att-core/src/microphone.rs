//! Microphone meeting detection. Ported from MicrophoneMeetings.swift.
//!
//! Owner ids are macOS bundle IDs, or on Windows executable file names (`ms-teams.exe`, see
//! `att_platform::InputOwner`). Classification keeps the Swift bundle-ID rules unchanged and adds
//! the Windows executable names.

use std::collections::{BTreeMap, BTreeSet};

use jiff::Timestamp;
use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

use crate::time::diff_secs;

/// App categories the user can watch. Persisted by display name (`"Microsoft Teams"`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum MicrophoneApp {
    #[serde(rename = "Slack")]
    Slack,
    #[serde(rename = "Microsoft Teams")]
    Teams,
    #[serde(rename = "Zoom")]
    Zoom,
    #[serde(rename = "Web browsers")]
    Browsers,
    #[serde(rename = "Webex")]
    Webex,
    #[serde(rename = "Discord")]
    Discord,
    #[serde(rename = "FaceTime")]
    FaceTime,
    #[serde(rename = "Other apps")]
    Other,
}

impl MicrophoneApp {
    /// Every case in settings order (Swift `allCases`).
    pub const ALL: [Self; 8] = [
        Self::Slack,
        Self::Teams,
        Self::Zoom,
        Self::Browsers,
        Self::Webex,
        Self::Discord,
        Self::FaceTime,
        Self::Other,
    ];

    /// The persisted raw value.
    pub fn raw(self) -> &'static str {
        match self {
            Self::Slack => "Slack",
            Self::Teams => "Microsoft Teams",
            Self::Zoom => "Zoom",
            Self::Browsers => "Web browsers",
            Self::Webex => "Webex",
            Self::Discord => "Discord",
            Self::FaceTime => "FaceTime",
            Self::Other => "Other apps",
        }
    }

    pub fn from_raw(raw: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|app| app.raw() == raw)
    }

    pub fn label(self) -> &'static str {
        if self == Self::Browsers { "Google Meet / web browsers" } else { self.raw() }
    }

    /// The category of an owner id. macOS bundle IDs match a known ID or one of its children
    /// (`com.google.Chrome.helper`), ignoring case. Windows executables match by file name,
    /// ignoring case; a full path is accepted too.
    pub fn classify(owner_id: &str) -> Self {
        let id = owner_id.to_lowercase();
        let matches = |prefix: &str| {
            id == prefix || id.strip_prefix(prefix).is_some_and(|rest| rest.starts_with('.'))
        };
        if matches("com.tinyspeck.slackmacgap") {
            return Self::Slack;
        }
        if matches("com.microsoft.teams") || matches("com.microsoft.teams2") {
            return Self::Teams;
        }
        if matches("us.zoom.xos") {
            return Self::Zoom;
        }
        if [
            "com.apple.safari",
            "com.google.chrome",
            "com.microsoft.edgemac",
            "org.mozilla.firefox",
            "com.brave.browser",
            "company.thebrowser.browser",
            "com.operasoftware.opera",
        ]
        .into_iter()
        .any(matches)
        {
            return Self::Browsers;
        }
        if matches("com.cisco.webexmeetingsapp") || matches("com.cisco.webexteams") {
            return Self::Webex;
        }
        if matches("com.hnc.discord") {
            return Self::Discord;
        }
        if matches("com.apple.webkit") {
            return Self::Browsers;
        }
        if matches("com.apple.facetime") {
            return Self::FaceTime;
        }
        windows_executable(&id).map_or(Self::Other, |name| Self::classify_executable(&name))
    }

    fn classify_executable(name: &str) -> Self {
        match name {
            "slack.exe" => Self::Slack,
            "ms-teams.exe" | "teams.exe" | "msteams.exe" => Self::Teams,
            "zoom.exe" => Self::Zoom,
            "chrome.exe" | "msedge.exe" | "firefox.exe" | "brave.exe" | "opera.exe"
            | "vivaldi.exe" | "arc.exe" => Self::Browsers,
            // The shared WebView2 runtime hosts calls for many apps, like WebKit on macOS.
            WEBVIEW2_EXECUTABLE => Self::Browsers,
            "webex.exe" | "ciscocollabhost.exe" | "atmgr.exe" => Self::Webex,
            "discord.exe" => Self::Discord,
            _ => Self::Other,
        }
    }
}

const WEBVIEW2_EXECUTABLE: &str = "msedgewebview2.exe";

/// The lower-cased file name when `id` names a Windows executable (a bare name or a path).
pub(crate) fn windows_executable(id: &str) -> Option<String> {
    let name = id.rsplit(['\\', '/']).next().unwrap_or(id).to_lowercase();
    name.ends_with(".exe").then_some(name)
}

/// Microphone suggestion settings. Persisted as `Configuration.microphoneMeetings`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MicrophonePreferences {
    pub enabled: bool,
    /// Stored as raw display names. Unknown names are skipped instead of failing the settings.
    #[serde(deserialize_with = "known_apps")]
    pub apps: BTreeSet<MicrophoneApp>,
}

impl Default for MicrophonePreferences {
    fn default() -> Self {
        Self::new(true)
    }
}

impl MicrophonePreferences {
    /// The requested meeting apps (Slack, Teams, Zoom and browsers) are watched by default.
    pub fn new(enabled: bool) -> Self {
        use MicrophoneApp::{Browsers, Slack, Teams, Zoom};
        Self { enabled, apps: [Slack, Teams, Zoom, Browsers].into_iter().collect() }
    }
}

fn known_apps<'de, D: Deserializer<'de>>(d: D) -> Result<BTreeSet<MicrophoneApp>, D::Error> {
    let names = Vec::<String>::deserialize(d)?;
    Ok(names.iter().filter_map(|name| MicrophoneApp::from_raw(name)).collect())
}

/// An app using microphone input.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneOwner {
    /// Bundle ID (macOS) or executable file name (Windows).
    pub id: String,
    pub name: String,
}

impl MicrophoneOwner {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self { id: id.into(), name: name.into() }
    }

    pub fn category(&self) -> MicrophoneApp {
        MicrophoneApp::classify(&self.id)
    }

    /// The display name for a shared web-view process that cannot name the app or tab behind
    /// it: WebKit helpers on macOS (as `MicrophoneReader.owner` in 1.14.2) and the WebView2
    /// runtime on Windows. Probes use it instead of the process name.
    pub fn web_view_name(id: &str) -> Option<&'static str> {
        if id.to_lowercase().starts_with("com.apple.webkit.") {
            return Some("WebKit (browser or web view)");
        }
        (windows_executable(id).as_deref() == Some(WEBVIEW2_EXECUTABLE))
            .then_some("WebView2 (browser or web view)")
    }
}

/// One continuous episode of input use by one app.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneSession {
    pub id: String,
    pub owner: MicrophoneOwner,
    #[serde(with = "crate::time::flex_date")]
    pub started: Timestamp,
}

impl MicrophoneSession {
    pub fn new(id: impl Into<String>, owner: MicrophoneOwner, started: Timestamp) -> Self {
        Self { id: id.into(), owner, started }
    }
}

/// Input use is a suggestion signal, never proof of a meeting or a reason to stop a timer
/// automatically. Requires consecutive successful samples; errors and sleep cannot establish an
/// ending.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MicrophoneMeetingEngine {
    /// Owner id → latched session.
    sessions: BTreeMap<String, MicrophoneSession>,
    ended: BTreeSet<String>,
    candidates: BTreeMap<String, Timestamp>,
    absent_since: BTreeMap<String, Timestamp>,
    announced: BTreeSet<String>,
    last_sample: Option<Timestamp>,
}

impl MicrophoneMeetingEngine {
    /// Continuous use before a session starts.
    pub const START_SECONDS: f64 = 4.0;
    /// Continuous absence before a session ends.
    pub const END_SECONDS: f64 = 60.0;
    /// A longer gap between samples (sleep, stalled polling) restarts both debounces.
    pub const MAX_SAMPLE_GAP_SECONDS: f64 = 10.0;

    pub fn new() -> Self {
        Self::default()
    }

    /// Owner id → session currently latched.
    pub fn sessions(&self) -> &BTreeMap<String, MicrophoneSession> {
        &self.sessions
    }

    /// Ids of sessions that ended after a confirmed absence (at most 200 kept).
    pub fn ended(&self) -> &BTreeSet<String> {
        &self.ended
    }

    /// Re-latches a session from before a restart without suggesting it again.
    pub fn restore(&mut self, session: MicrophoneSession) {
        self.announced.insert(session.id.clone());
        self.sessions.insert(session.owner.id.clone(), session);
    }

    /// One poll. `None` means the sample failed: it resets both debounces and can never end a
    /// session.
    pub fn sample(&mut self, owners: Option<&[MicrophoneOwner]>, now: Timestamp) {
        let Some(owners) = owners else {
            self.candidates.clear();
            self.absent_since.clear();
            self.last_sample = None;
            return;
        };
        if self
            .last_sample
            .is_some_and(|last| diff_secs(now, last) > Self::MAX_SAMPLE_GAP_SECONDS || now < last)
        {
            self.candidates.clear();
            self.absent_since.clear();
        }
        self.last_sample = Some(now);
        let active: BTreeSet<&str> = owners.iter().map(|owner| owner.id.as_str()).collect();
        self.candidates.retain(|id, _| active.contains(id.as_str()));
        for owner in owners {
            self.absent_since.remove(&owner.id);
            if self.sessions.contains_key(&owner.id) {
                continue;
            }
            let start = *self.candidates.entry(owner.id.clone()).or_insert(now);
            if diff_secs(now, start) >= Self::START_SECONDS {
                let session = MicrophoneSession::new(new_session_id(), owner.clone(), start);
                self.sessions.insert(owner.id.clone(), session);
                self.candidates.remove(&owner.id);
            }
        }
        let absent: Vec<String> =
            self.sessions.keys().filter(|app| !active.contains(app.as_str())).cloned().collect();
        for app in absent {
            let start = *self.absent_since.entry(app.clone()).or_insert(now);
            if diff_secs(now, start) >= Self::END_SECONDS {
                if let Some(session) = self.sessions.remove(&app) {
                    self.ended.insert(session.id);
                }
                self.absent_since.remove(&app);
            }
        }
        if self.ended.len() > 200 {
            // Swift keeps `ended.sorted().suffix(100)`: the 100 greatest ids in string order.
            let skip = self.ended.len() - 100;
            self.ended = std::mem::take(&mut self.ended).into_iter().skip(skip).collect();
        }
        let live: BTreeSet<&str> = self.sessions.values().map(|s| s.id.as_str()).collect();
        self.announced.retain(|id| live.contains(id.as_str()));
    }

    /// Sessions not suggested before, oldest first. Each session is returned once.
    pub fn suggestions(&mut self) -> Vec<MicrophoneSession> {
        let mut sessions: Vec<&MicrophoneSession> = self.sessions.values().collect();
        sessions.sort_by_key(|session| session.started);
        sessions
            .into_iter()
            .filter(|session| self.announced.insert(session.id.clone()))
            .cloned()
            .collect()
    }

    pub fn is_active(&self, session: &MicrophoneSession) -> bool {
        self.sessions.get(&session.owner.id).is_some_and(|current| current.id == session.id)
    }
}

/// Swift `UUID().uuidString`: upper-case and hyphenated.
fn new_session_id() -> String {
    Uuid::new_v4().hyphenated().to_string().to_uppercase()
}
