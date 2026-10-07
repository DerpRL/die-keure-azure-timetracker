//! Presence: idle time, session lock, foreground app, and session/power events.

use std::path::Path;

use windows::Win32::System::RemoteDesktop::{
    WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION, WTSFreeMemory, WTSINFOEXW,
    WTSQuerySessionInformationW, WTSSessionInfoEx,
};
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::core::PWSTR;

use super::apps;
use super::events;
use super::system::os_version;
use crate::windows_parse::{idle_millis, is_exe_path, lock_flags_inverted, session_locked};
use crate::{
    AppIdentity, AppLookup, PlatformError, PresenceProbe, PresenceSample, Result, SystemEventSink,
};

/// Presence signals for the current Windows session.
#[derive(Debug, Default)]
pub struct WindowsPresence {
    _private: (),
}

impl WindowsPresence {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PresenceProbe for WindowsPresence {
    fn sample(&self) -> PresenceSample {
        PresenceSample {
            idle_seconds: idle_seconds(),
            locked: locked(),
            foreground: apps::foreground_process_path().map(|path| apps::identity_for_path(&path)),
        }
    }

    /// Starts a dedicated thread with a message-only window that receives
    /// `WM_WTSSESSION_CHANGE` and `WM_POWERBROADCAST`. Each call starts its own listener.
    fn subscribe(&self, sink: SystemEventSink) -> Result<()> {
        events::start(sink)
    }

    fn app_identity(&self, path: &Path) -> Result<AppIdentity> {
        let Some(text) = path.to_str() else {
            return Err(PlatformError::Failed(
                "The selected program could not be read.".to_string(),
            ));
        };
        if !is_exe_path(text) {
            return Err(PlatformError::Failed("Choose a program file (.exe).".to_string()));
        }
        if !path.is_file() {
            return Err(PlatformError::Failed(
                "The selected program could not be found.".to_string(),
            ));
        }
        Ok(apps::identity_for_path(text))
    }

    /// Only apps registered under `App Paths` can be found; a miss is not proof of absence.
    fn find_app(&self, id: &str) -> AppLookup {
        match apps::registered_path(id) {
            Some(path) => AppLookup::Found(AppIdentity {
                id: id.to_string(),
                ..apps::identity_for_path(&path)
            }),
            None => AppLookup::Unknown,
        }
    }
}

/// Seconds since the last keyboard, mouse or touch input in this session; 0 when unknown.
fn idle_seconds() -> f64 {
    let mut info = LASTINPUTINFO { cbSize: size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: `info` is a valid LASTINPUTINFO with its size set.
    if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        return 0.0;
    }
    // Read the clock after the last-input tick so a new input cannot look like the future.
    // SAFETY: no preconditions.
    let now = unsafe { GetTickCount64() };
    idle_millis(now, info.dwTime) as f64 / 1000.0
}

/// Lock state from `WTSINFOEX_LEVEL1_W::SessionFlags`; `None` when Windows cannot tell.
fn locked() -> Option<bool> {
    let mut buffer = PWSTR::null();
    let mut bytes = 0_u32;
    // SAFETY: valid out-pointers; the buffer is freed with `WTSFreeMemory` below.
    unsafe {
        WTSQuerySessionInformationW(
            Some(WTS_CURRENT_SERVER_HANDLE),
            WTS_CURRENT_SESSION,
            WTSSessionInfoEx,
            &mut buffer,
            &mut bytes,
        )
    }
    .ok()?;
    if buffer.is_null() {
        return None;
    }
    let flags = (bytes as usize >= size_of::<WTSINFOEXW>())
        .then(|| {
            // SAFETY: Windows returned at least one WTSINFOEXW; level 1 is the only level and
            // selects the union member read here.
            let info = unsafe { &*(buffer.0 as *const WTSINFOEXW) };
            (info.Level == 1).then_some(unsafe { info.Data.WTSInfoExLevel1.SessionFlags })
        })
        .flatten();
    // SAFETY: the buffer came from WTSQuerySessionInformationW and is freed once.
    unsafe { WTSFreeMemory(buffer.0.cast()) };
    let inverted =
        os_version().is_some_and(|version| lock_flags_inverted(version.major, version.minor));
    session_locked(flags?, inverted)
}

#[cfg(test)]
mod tests {
    //! Run on Windows: `cargo test -p att-platform`.

    use super::*;

    #[test]
    fn sample_has_plausible_values() {
        let sample = WindowsPresence::new().sample();
        assert!(sample.idle_seconds >= 0.0 && sample.idle_seconds < 60.0 * 60.0 * 24.0 * 50.0);
        if let Some(app) = sample.foreground {
            // The lower-case file name; usually `….exe`, but the GitHub runner's agent has none.
            assert_eq!(app.id, app.id.to_lowercase());
            assert!(!app.id.is_empty() && !app.id.contains(['\\', '/']), "{app:?}");
        }
    }

    #[test]
    fn subscribe_starts_an_event_thread() {
        let presence = WindowsPresence::new();
        let sink: SystemEventSink = std::sync::Arc::new(|event| println!("{event:?}"));
        assert_eq!(presence.subscribe(sink.clone()), Ok(()));
        assert_eq!(presence.subscribe(sink), Ok(()), "a second listener reuses the window class");
    }

    #[test]
    fn identity_of_a_system_program() {
        let presence = WindowsPresence::new();
        let windows = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());
        let notepad = Path::new(&windows).join("System32").join("notepad.exe");
        let identity = presence.app_identity(&notepad).expect("notepad exists");
        assert_eq!(identity.id, "notepad.exe");
        assert!(!identity.name.is_empty());
        assert!(presence.app_identity(Path::new(r"C:\Windows\win.ini")).is_err());
        assert!(presence.app_identity(Path::new(r"C:\does-not-exist\tool.exe")).is_err());
    }
}
