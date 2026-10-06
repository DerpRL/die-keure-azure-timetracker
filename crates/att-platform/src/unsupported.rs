//! Fallback implementations for capabilities an OS does not offer.
//!
//! Each type reports the capability as missing without touching the OS and never prompts. The
//! Windows bundle uses [`crate::unsupported::UnsupportedCalendar`] (no calendar integration on
//! Windows at launch); other OSes get everything from [`crate::unsupported::platform`]. The
//! feature registry should hide modules whose capability is unsupported rather than surface
//! these errors.

use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use jiff::Timestamp;

use crate::{
    AppIdentity, CalendarAccess, CalendarEvent, CalendarInfo, CalendarSource, Credentials,
    FigmaObserver, InputOwner, MicrophoneProbe, Platform, PlatformError, PresenceProbe,
    PresenceSample, Result, SystemEventSink, WindowObservation,
};

/// Names used in [`PlatformError::Unsupported`] ("… is not available on this system.").
pub const CALENDAR: &str = "Calendar";
pub const CREDENTIAL_STORAGE: &str = "Secure credential storage";
pub const MICROPHONE_DETECTION: &str = "Microphone app detection";
pub const APP_DETAILS: &str = "Reading application details";

/// No secret store: reads and writes fail, deleting succeeds because nothing can be stored.
#[derive(Debug, Default, Clone, Copy)]
pub struct UnsupportedCredentials;

impl Credentials for UnsupportedCredentials {
    fn get(&self, _account: &str) -> Result<Option<String>> {
        Err(PlatformError::Unsupported(CREDENTIAL_STORAGE))
    }

    fn set(&self, _account: &str, _secret: &str) -> Result<()> {
        Err(PlatformError::Unsupported(CREDENTIAL_STORAGE))
    }

    fn delete(&self, _account: &str) -> Result<()> {
        Ok(())
    }
}

/// No calendar integration: access is [`CalendarAccess::Unsupported`] and requesting it never
/// shows a prompt.
#[derive(Debug, Default, Clone, Copy)]
pub struct UnsupportedCalendar;

#[async_trait]
impl CalendarSource for UnsupportedCalendar {
    fn access(&self) -> CalendarAccess {
        CalendarAccess::Unsupported
    }

    async fn request_access(&self) -> Result<CalendarAccess> {
        Ok(CalendarAccess::Unsupported)
    }

    fn calendars(&self) -> Result<Vec<CalendarInfo>> {
        Err(PlatformError::Unsupported(CALENDAR))
    }

    fn events(
        &self,
        _from: Timestamp,
        _to: Timestamp,
        _calendar_ids: &[String],
    ) -> Result<Vec<CalendarEvent>> {
        Err(PlatformError::Unsupported(CALENDAR))
    }

    fn open_calendar_app(&self) -> Result<()> {
        Err(PlatformError::Unsupported(CALENDAR))
    }
}

/// No microphone detection: `supported()` is false and sampling is an error ("unknown"), never
/// an empty list ("silent").
#[derive(Debug, Default, Clone, Copy)]
pub struct UnsupportedMicrophone;

impl MicrophoneProbe for UnsupportedMicrophone {
    fn supported(&self) -> bool {
        false
    }

    fn sample(&self) -> Result<Vec<InputOwner>> {
        Err(PlatformError::Unsupported(MICROPHONE_DETECTION))
    }
}

/// No presence signals: zero idle time, unknown lock state, no foreground app, no events.
#[derive(Debug, Default, Clone, Copy)]
pub struct UnsupportedPresence;

impl PresenceProbe for UnsupportedPresence {
    fn sample(&self) -> PresenceSample {
        PresenceSample { idle_seconds: 0.0, locked: None, foreground: None }
    }

    /// Delivers nothing, which the contract allows.
    fn subscribe(&self, _sink: SystemEventSink) -> Result<()> {
        Ok(())
    }

    fn app_identity(&self, _path: &Path) -> Result<AppIdentity> {
        Err(PlatformError::Unsupported(APP_DETAILS))
    }
}

/// No Figma window reading: Figma never counts as the foreground app and is never installed.
#[derive(Debug, Default, Clone, Copy)]
pub struct UnsupportedFigma;

impl FigmaObserver for UnsupportedFigma {
    fn has_access(&self) -> bool {
        false
    }

    fn request_access(&self) -> bool {
        false
    }

    fn observe(&self) -> WindowObservation {
        WindowObservation::NotForeground
    }

    fn figma_installed(&self) -> bool {
        false
    }
}

/// The bundle for an OS without an implementation (Linux and others).
pub fn platform() -> Platform {
    Platform {
        credentials: Arc::new(UnsupportedCredentials),
        calendar: Arc::new(UnsupportedCalendar),
        microphone: Arc::new(UnsupportedMicrophone),
        presence: Arc::new(UnsupportedPresence),
        figma: Arc::new(UnsupportedFigma),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SystemEvent;

    #[tokio::test]
    async fn calendar_reports_unsupported_without_prompting() {
        let calendar = platform().calendar;
        assert_eq!(calendar.access(), CalendarAccess::Unsupported);
        assert_eq!(calendar.request_access().await, Ok(CalendarAccess::Unsupported));
        assert_eq!(calendar.calendars(), Err(PlatformError::Unsupported(CALENDAR)));
        let now = Timestamp::UNIX_EPOCH;
        assert_eq!(calendar.events(now, now, &[]), Err(PlatformError::Unsupported(CALENDAR)));
        assert_eq!(calendar.open_calendar_app(), Err(PlatformError::Unsupported(CALENDAR)));
        assert_eq!(
            PlatformError::Unsupported(CALENDAR).to_string(),
            "Calendar is not available on this system."
        );
    }

    #[test]
    fn credentials_cannot_be_stored() {
        let credentials = platform().credentials;
        assert_eq!(
            credentials.get("azure:contoso"),
            Err(PlatformError::Unsupported(CREDENTIAL_STORAGE))
        );
        assert_eq!(
            credentials.set("azure:contoso", "pat"),
            Err(PlatformError::Unsupported(CREDENTIAL_STORAGE))
        );
        assert_eq!(credentials.delete("azure:contoso"), Ok(()));
    }

    #[test]
    fn microphone_is_unknown_not_silent() {
        let microphone = platform().microphone;
        assert!(!microphone.supported());
        assert_eq!(microphone.sample(), Err(PlatformError::Unsupported(MICROPHONE_DETECTION)));
    }

    #[test]
    fn presence_and_figma_are_inert() {
        let platform = platform();
        let sample = platform.presence.sample();
        assert_eq!(sample, PresenceSample { idle_seconds: 0.0, locked: None, foreground: None });
        let sink: SystemEventSink = Arc::new(|_: SystemEvent| panic!("no events expected"));
        assert_eq!(platform.presence.subscribe(sink), Ok(()));
        assert_eq!(
            platform.presence.app_identity(Path::new("/usr/bin/true")),
            Err(PlatformError::Unsupported(APP_DETAILS))
        );
        assert!(!platform.figma.has_access());
        assert!(!platform.figma.request_access());
        assert_eq!(platform.figma.observe(), WindowObservation::NotForeground);
        assert!(!platform.figma.figma_installed());
    }
}
