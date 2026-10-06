//! Idle, lock and forgotten-timer awareness. Ported from WorkAwareness.swift.

use jiff::Timestamp;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::microphone::windows_executable;
use crate::model::{HostOs, TrackingState};
use crate::text::NonEmpty;
use crate::time::{Cal, add_secs, diff_secs, wire_date};

/// Time-awareness settings. Persisted as `Configuration.workAwareness`.
///
/// The default work apps depend on the OS: bundle IDs on macOS (as in 1.14.2), executable file
/// names on Windows. Decoding keeps whatever list was stored.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkAwarenessPreferences {
    pub idle_enabled: bool,
    pub lock_enabled: bool,
    /// Valid range 1–120.
    pub idle_minutes: i64,
    pub forgotten_enabled: bool,
    /// Valid range 1–120.
    pub forgotten_minutes: i64,
    #[serde(alias = "workAppIDs")]
    pub work_app_ids: Vec<String>,
}

impl Default for WorkAwarenessPreferences {
    fn default() -> Self {
        Self::default_for(HostOs::current())
    }
}

impl WorkAwarenessPreferences {
    pub const MINUTES: std::ops::RangeInclusive<i64> = 1..=120;

    pub fn default_for(os: HostOs) -> Self {
        Self {
            idle_enabled: true,
            lock_enabled: true,
            idle_minutes: 5,
            forgotten_enabled: true,
            forgotten_minutes: 10,
            work_app_ids: Self::default_work_apps(os).iter().map(|id| id.to_string()).collect(),
        }
    }

    /// Editors and terminals watched for the forgotten-timer reminder. None are known for
    /// other systems.
    pub fn default_work_apps(os: HostOs) -> &'static [&'static str] {
        match os {
            HostOs::Macos => &[
                "com.microsoft.VSCode",
                "com.apple.Terminal",
                "com.googlecode.iterm2",
                "com.todesktop.230313mzl4w4u92",
                "com.openai.codex",
                "com.apple.dt.Xcode",
            ],
            HostOs::Windows => &[
                "code.exe",
                "cursor.exe",
                "windowsterminal.exe",
                "pwsh.exe",
                "powershell.exe",
                "devenv.exe",
            ],
            HostOs::Other => &[],
        }
    }

    pub fn is_valid(&self) -> bool {
        Self::MINUTES.contains(&self.idle_minutes)
            && Self::MINUTES.contains(&self.forgotten_minutes)
    }

    /// Whether the foreground app is a work app. Bundle IDs match exactly, as in 1.14.2.
    /// Windows executables match by file name, ignoring case, so `Code.exe` or a full path
    /// matches `code.exe`.
    pub fn watches(&self, app_id: Option<&str>) -> bool {
        let Some(app_id) = app_id else { return false };
        let executable = windows_executable(app_id);
        self.work_app_ids.iter().any(|entry| {
            entry == app_id
                || executable
                    .as_ref()
                    .is_some_and(|name| windows_executable(entry).as_ref() == Some(name))
        })
    }
}

/// The confirmed running timer that idle evidence belongs to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleTrackingSession {
    pub identity: String,
    #[serde(alias = "workLogID")]
    pub work_log_id: String,
    pub title: String,
    #[serde(with = "crate::time::flex_date")]
    pub start: Timestamp,
}

impl IdleTrackingSession {
    /// A running timer with a worklog id. The start is the server's start time (offset-free
    /// values are local in `cal`), else `confirmed_at` minus the confirmed track length;
    /// nothing is extrapolated.
    pub fn from_state(
        state: Option<&TrackingState>,
        confirmed_at: Option<Timestamp>,
        cal: &Cal,
    ) -> Option<Self> {
        let state = state.filter(|state| state.running())?;
        let track = state.track.as_ref()?;
        let work_log_id = track.work_log_id.non_empty()?.to_string();
        let parsed = track
            .current_track_started_date_time
            .as_deref()
            .and_then(|text| wire_date::parse(text, Some(cal.tz())));
        let start = match (parsed, confirmed_at, track.current_track_length) {
            (Some(start), _, _) => start,
            (None, Some(confirmed), Some(seconds))
                if seconds.is_finite() && seconds >= 0.0 && seconds <= i32::MAX as f64 =>
            {
                add_secs(confirmed, -seconds)
            }
            _ => return None,
        };
        Some(Self { identity: state.identity(), work_log_id, title: track.title(), start })
    }
}

/// Detected time away from the running timer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdlePeriod {
    #[serde(default = "uuid::Uuid::new_v4")]
    pub id: Uuid,
    pub session: IdleTrackingSession,
    #[serde(with = "crate::time::flex_date")]
    pub start: Timestamp,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "crate::time::flex_date::option"
    )]
    pub end: Option<Timestamp>,
    pub reason: String,
}

impl IdlePeriod {
    pub fn new(session: IdleTrackingSession, start: Timestamp, reason: impl Into<String>) -> Self {
        Self { id: Uuid::new_v4(), session, start, end: None, reason: reason.into() }
    }

    /// Length in seconds; 0 while open.
    pub fn seconds(&self) -> f64 {
        diff_secs(self.end.unwrap_or(self.start), self.start).max(0.0)
    }
}

/// One presence sample as seen by [`IdleMonitor::observe`].
#[derive(Clone, Copy, Debug)]
pub struct IdleObservation<'a> {
    pub now: Timestamp,
    /// Seconds since the last keyboard or pointer input.
    pub idle_seconds: f64,
    /// When the screen locked or the Mac slept, while it still is.
    pub unavailable_since: Option<Timestamp>,
    /// Why the session is unavailable ("Screen locked", "Sleep").
    pub reason: &'a str,
    pub session: Option<&'a IdleTrackingSession>,
    pub preferences: &'a WorkAwarenessPreferences,
    /// Microphone or calendar meeting in progress.
    pub meeting: bool,
}

/// Consumes only elapsed idle time and lock/sleep state. It never changes a remote timer.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct IdleMonitor {
    #[serde(skip_serializing_if = "Option::is_none")]
    away: Option<IdlePeriod>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pending: Option<IdlePeriod>,
}

impl IdleMonitor {
    /// Below this idle time the user counts as back.
    pub const RETURN_IDLE_SECONDS: f64 = 30.0;

    pub fn new() -> Self {
        Self::default()
    }

    /// The open absence, not yet ended.
    pub fn away(&self) -> Option<&IdlePeriod> {
        self.away.as_ref()
    }

    /// An ended absence waiting for review.
    pub fn pending(&self) -> Option<&IdlePeriod> {
        self.pending.as_ref()
    }

    /// Evidence for another timer is discarded.
    pub fn reconcile(&mut self, session: Option<&IdleTrackingSession>) {
        let identity = session.map(|session| session.identity.as_str());
        if self.away.as_ref().map(|period| period.session.identity.as_str()) != identity {
            self.away = None;
        }
        if self.pending.as_ref().map(|period| period.session.identity.as_str()) != identity {
            self.pending = None;
        }
    }

    pub fn observe(&mut self, observation: &IdleObservation<'_>) {
        let o = observation;
        self.reconcile(o.session);
        let preferences = o.preferences;
        let Some(session) = o.session.filter(|_| {
            preferences.is_valid() && (preferences.idle_enabled || preferences.lock_enabled)
        }) else {
            self.away = None;
            self.pending = None;
            return;
        };
        if !o.idle_seconds.is_finite() || o.idle_seconds < 0.0 {
            return;
        }
        // Keep an already detected absence intact; microphone use only suppresses passive idle
        // detection, never a lock.
        let locked = preferences.lock_enabled && o.unavailable_since.is_some();
        let inactive = preferences.idle_enabled
            && o.idle_seconds >= (preferences.idle_minutes * 60) as f64
            && !o.meeting;
        if locked || inactive {
            if self.pending.is_some() || self.away.is_some() {
                return;
            }
            let (boundary, reason) = match o.unavailable_since {
                Some(since) if locked => (since, o.reason),
                _ => (add_secs(o.now, -o.idle_seconds), "No keyboard or mouse activity"),
            };
            // The absence cannot start before the timer did.
            self.away = Some(IdlePeriod::new(session.clone(), session.start.max(boundary), reason));
        } else if o.unavailable_since.is_none()
            && o.idle_seconds < Self::RETURN_IDLE_SECONDS
            && let Some(mut period) = self.away.take()
        {
            // Last input marks the return; do not count the delay until the next sample as idle.
            period.end = Some(period.start.max(add_secs(o.now, -o.idle_seconds)));
            if period.seconds() >= 1.0 {
                self.pending = Some(period);
            }
        }
    }

    pub fn dismiss(&mut self) {
        self.pending = None;
        self.away = None;
    }
}

/// "Working without a timer?"
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgottenReminder {
    pub id: Uuid,
    #[serde(with = "crate::time::flex_date")]
    pub since: Timestamp,
    pub app_name: String,
}

/// Snooze and "ignore today" for the forgotten-timer reminder.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ForgottenDeferral {
    #[serde(skip_serializing_if = "Option::is_none", with = "crate::time::flex_date::option")]
    pub until: Option<Timestamp>,
    #[serde(skip_serializing_if = "Option::is_none", with = "crate::time::flex_date::option")]
    pub ignored_day: Option<Timestamp>,
}

impl ForgottenDeferral {
    /// Snoozed until later, or ignored for the local day of `now`.
    pub fn suppresses(&self, now: Timestamp, cal: &Cal) -> bool {
        self.until.is_some_and(|until| now < until)
            || self.ignored_day.is_some_and(|day| cal.date(day) == cal.date(now))
    }
}

/// Reminds after continuous eligible work in a work app without a running timer.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ForgottenTimerMonitor {
    pending: Option<ForgottenReminder>,
    since: Option<Timestamp>,
    last_sample: Option<Timestamp>,
}

impl ForgottenTimerMonitor {
    /// A longer gap between samples (sleep, stalled sampling) restarts the count.
    pub const MAX_SAMPLE_GAP_SECONDS: f64 = 15.0;

    pub fn new() -> Self {
        Self::default()
    }

    pub fn pending(&self) -> Option<&ForgottenReminder> {
        self.pending.as_ref()
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// `eligible` must be continuous for `minutes` (1–120) without deferral.
    pub fn observe(
        &mut self,
        now: Timestamp,
        eligible: bool,
        app_name: &str,
        minutes: i64,
        deferral: &ForgottenDeferral,
        cal: &Cal,
    ) {
        if !eligible
            || !WorkAwarenessPreferences::MINUTES.contains(&minutes)
            || deferral.suppresses(now, cal)
        {
            self.reset();
            return;
        }
        // Sleep, stalled sampling or a clock change cannot count as active work.
        if self
            .last_sample
            .is_some_and(|last| diff_secs(now, last) > Self::MAX_SAMPLE_GAP_SECONDS || now < last)
        {
            self.reset();
        }
        let since = *self.since.get_or_insert(now);
        self.last_sample = Some(now);
        if self.pending.is_none() && diff_secs(now, since) >= (minutes * 60) as f64 {
            self.pending = Some(ForgottenReminder {
                id: Uuid::new_v4(),
                since,
                app_name: app_name.to_string(),
            });
        }
    }
}

/// Persisted awareness state of one workspace. Persisted as `workAwareness`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkAwarenessLedger {
    pub workspace: String,
    pub idle: IdleMonitor,
    /// An idle period being corrected in the time editor.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correction: Option<IdlePeriod>,
    pub deferral: ForgottenDeferral,
}

impl WorkAwarenessLedger {
    /// Starts over when the workspace changes.
    pub fn scope(&mut self, workspace: &str) {
        if self.workspace != workspace {
            *self = Self { workspace: workspace.to_string(), ..Self::default() };
        }
    }
}
