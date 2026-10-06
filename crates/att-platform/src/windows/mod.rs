//! Windows implementations, for Windows 10 1903+ and Windows 11.
//!
//! | Capability | Implementation |
//! |---|---|
//! | Credentials | Credential Manager generic credentials ([`WindowsCredentials`]) |
//! | Calendar | none at launch ([`crate::unsupported::UnsupportedCalendar`], never prompts) |
//! | Microphone | consent store usage times, confirmed by WASAPI capture sessions ([`WindowsMicrophone`]) |
//! | Presence | `GetLastInputInfo`, WTS session flags, foreground window, message-only window for events ([`WindowsPresence`]) |
//! | Figma | UI Automation on the foreground Figma window ([`WindowsFigma`]) |
//!
//! Every decision (merge rules, name mapping, arithmetic, URL detection) lives in
//! [`crate::windows_parse`], which is compiled and tested on every OS. These modules only make the
//! Win32 and COM calls. COM is entered per call on the calling thread (`com::ComScope`) because
//! the engine calls probes from a thread pool. See `docs/port/platform-windows.md`.

mod apps;
mod com;
mod credentials;
mod events;
mod figma;
mod microphone;
mod presence;
mod registry;
mod system;

use std::sync::Arc;

pub use credentials::WindowsCredentials;
pub use figma::WindowsFigma;
pub use microphone::{MicrophoneDiagnosis, WindowsMicrophone};
pub use presence::WindowsPresence;

use crate::{CREDENTIAL_SERVICE, Platform, unsupported::UnsupportedCalendar};

/// All capabilities for Windows.
pub fn platform() -> Platform {
    Platform {
        credentials: Arc::new(WindowsCredentials::new(CREDENTIAL_SERVICE)),
        calendar: Arc::new(UnsupportedCalendar),
        microphone: Arc::new(WindowsMicrophone::new()),
        presence: Arc::new(WindowsPresence::new()),
        figma: Arc::new(WindowsFigma::new()),
    }
}
