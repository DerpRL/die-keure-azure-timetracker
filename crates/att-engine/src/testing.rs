//! Test harness shared by the engine's unit and integration tests: an engine on an in-memory
//! store with a recording shell, a manual clock, in-memory platform fakes and injectable clients.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use jiff::Timestamp;
use jiff::tz::TimeZone;

use att_core::model::HostOs;
use att_core::{AppError, Cal, Configuration, Result};
use att_platform::{
    CalendarAccess, CalendarEvent, CalendarInfo, CalendarSource, Credentials, FigmaObserver,
    InputOwner, MicrophoneProbe, Platform, PlatformError, PresenceProbe, PresenceSample,
    SystemEventSink, WindowObservation,
};
use att_store::Store;

use crate::Engine;
use crate::clients::{ClientFactory, Clients, PairingClient};
use crate::clock::ManualClock;
use crate::services::Services;
use crate::shell::RecordingShell;

/// In-memory credentials.
#[derive(Default)]
pub struct MemoryCredentials(pub Mutex<BTreeMap<String, String>>);

impl Credentials for MemoryCredentials {
    fn get(&self, account: &str) -> Result<Option<String>, PlatformError> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), PlatformError> {
        self.0.lock().unwrap().insert(account.into(), secret.into());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), PlatformError> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

/// A calendar whose access and events tests set directly.
pub struct FakeCalendar {
    pub access: Mutex<CalendarAccess>,
    pub calendars: Mutex<Vec<CalendarInfo>>,
    pub events: Mutex<Vec<CalendarEvent>>,
}

impl Default for FakeCalendar {
    fn default() -> Self {
        Self {
            access: Mutex::new(CalendarAccess::Authorized),
            calendars: Mutex::new(Vec::new()),
            events: Mutex::new(Vec::new()),
        }
    }
}

#[async_trait::async_trait]
impl CalendarSource for FakeCalendar {
    fn access(&self) -> CalendarAccess {
        *self.access.lock().unwrap()
    }
    async fn request_access(&self) -> Result<CalendarAccess, PlatformError> {
        Ok(self.access())
    }
    fn calendars(&self) -> Result<Vec<CalendarInfo>, PlatformError> {
        Ok(self.calendars.lock().unwrap().clone())
    }
    fn events(
        &self,
        from: Timestamp,
        to: Timestamp,
        calendar_ids: &[String],
    ) -> Result<Vec<CalendarEvent>, PlatformError> {
        Ok(self
            .events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e.end > from && e.start < to)
            .filter(|e| calendar_ids.is_empty() || calendar_ids.contains(&e.calendar_id))
            .cloned()
            .collect())
    }
    fn open_calendar_app(&self) -> Result<(), PlatformError> {
        Ok(())
    }
}

/// Microphone owners set directly; `None` simulates a failed read.
pub struct FakeMicrophone(pub Mutex<Option<Vec<InputOwner>>>);

impl Default for FakeMicrophone {
    fn default() -> Self {
        Self(Mutex::new(Some(Vec::new())))
    }
}

impl MicrophoneProbe for FakeMicrophone {
    fn supported(&self) -> bool {
        true
    }
    fn sample(&self) -> Result<Vec<InputOwner>, PlatformError> {
        self.0.lock().unwrap().clone().ok_or_else(|| PlatformError::Failed("fake failure".into()))
    }
}

/// A presence sample set directly.
pub struct FakePresence(pub Mutex<PresenceSample>);

impl Default for FakePresence {
    fn default() -> Self {
        Self(Mutex::new(PresenceSample {
            idle_seconds: 0.0,
            locked: Some(false),
            foreground: None,
        }))
    }
}

impl PresenceProbe for FakePresence {
    fn sample(&self) -> PresenceSample {
        self.0.lock().unwrap().clone()
    }
    fn subscribe(&self, _sink: SystemEventSink) -> Result<(), PlatformError> {
        Ok(())
    }
    fn app_identity(
        &self,
        path: &std::path::Path,
    ) -> Result<att_platform::AppIdentity, PlatformError> {
        let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        Ok(att_platform::AppIdentity { id: name.to_lowercase(), name, path: None })
    }
    /// `missing.*` ids are not installed and `unknown.*` ids cannot be looked up; any other id is
    /// installed, named after its last dot-separated part (`com.example.Editor` → `Editor`).
    fn find_app(&self, id: &str) -> att_platform::AppLookup {
        if id.starts_with("missing.") {
            return att_platform::AppLookup::NotInstalled;
        }
        if id.starts_with("unknown.") {
            return att_platform::AppLookup::Unknown;
        }
        let stem = id.strip_suffix(".exe").unwrap_or(id);
        let name = stem.rsplit('.').next().unwrap_or(stem).to_string();
        att_platform::AppLookup::Found(att_platform::AppIdentity {
            id: id.to_string(),
            name,
            path: None,
        })
    }
}

/// A Figma observation set directly.
pub struct FakeFigma {
    pub access: Mutex<bool>,
    pub observation: Mutex<WindowObservation>,
}

impl Default for FakeFigma {
    fn default() -> Self {
        Self { access: Mutex::new(true), observation: Mutex::new(WindowObservation::NotForeground) }
    }
}

impl FigmaObserver for FakeFigma {
    fn has_access(&self) -> bool {
        *self.access.lock().unwrap()
    }
    fn request_access(&self) -> bool {
        self.has_access()
    }
    fn observe(&self) -> WindowObservation {
        self.observation.lock().unwrap().clone()
    }
    fn figma_installed(&self) -> bool {
        true
    }
}

/// Hands out whatever clients a test installs.
#[derive(Default)]
pub struct FakeClientFactory {
    pub clients: Mutex<Option<Clients>>,
    pub pairing: Mutex<Option<Arc<dyn PairingClient>>>,
    /// Returned by `connect` instead of clients, when set.
    pub error: Mutex<Option<AppError>>,
}

impl ClientFactory for FakeClientFactory {
    fn connect(
        &self,
        _config: &Configuration,
        _credentials: Arc<dyn Credentials>,
        _cal: &Cal,
        generation: u64,
    ) -> Result<Option<Clients>> {
        if let Some(error) = self.error.lock().unwrap().clone() {
            return Err(error);
        }
        Ok(self.clients.lock().unwrap().clone().map(|mut clients| {
            clients.generation = generation;
            clients
        }))
    }

    fn pairing(&self, _workspace_url: &str) -> Result<Arc<dyn PairingClient>> {
        self.pairing
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| AppError::message("No pairing client in this test."))
    }
}

/// An engine wired to fakes, plus handles to every fake.
pub struct TestEngine {
    pub engine: Engine,
    pub shell: Arc<RecordingShell>,
    pub clock: Arc<ManualClock>,
    pub store: Arc<Store>,
    pub credentials: Arc<MemoryCredentials>,
    pub calendar: Arc<FakeCalendar>,
    pub microphone: Arc<FakeMicrophone>,
    pub presence: Arc<FakePresence>,
    pub figma: Arc<FakeFigma>,
    pub clients: Arc<FakeClientFactory>,
}

impl TestEngine {
    /// Brussels time, 2026-10-06 10:00 local, empty store.
    pub fn new() -> Self {
        Self::with_store(Arc::new(Store::open_in_memory().expect("in-memory store")))
    }

    pub fn with_store(store: Arc<Store>) -> Self {
        Self::with_legacy(store, None)
    }

    /// Like [`with_store`](Self::with_store), importing 1.14.x data from `legacy_dir` (a
    /// temporary folder in tests; never the real one).
    pub fn with_legacy(store: Arc<Store>, legacy_dir: Option<std::path::PathBuf>) -> Self {
        Self::build(store, legacy_dir, false)
    }

    /// Like [`with_store`](Self::with_store), also watching repositories' HEAD files (real file
    /// events, as in the app).
    pub fn with_file_events(store: Arc<Store>) -> Self {
        Self::build(store, None, true)
    }

    fn build(store: Arc<Store>, legacy_dir: Option<std::path::PathBuf>, file_events: bool) -> Self {
        let now: Timestamp = "2026-10-06T08:00:00Z".parse().expect("timestamp");
        let tz = TimeZone::get("Europe/Brussels").expect("tzdb");
        let clock = Arc::new(ManualClock::new(now, tz));
        let shell = Arc::new(RecordingShell::default());
        let credentials = Arc::new(MemoryCredentials::default());
        let calendar = Arc::new(FakeCalendar::default());
        let microphone = Arc::new(FakeMicrophone::default());
        let presence = Arc::new(FakePresence::default());
        let figma = Arc::new(FakeFigma::default());
        let clients = Arc::new(FakeClientFactory::default());
        let services = Services {
            platform: Platform {
                credentials: credentials.clone(),
                calendar: calendar.clone(),
                microphone: microphone.clone(),
                presence: presence.clone(),
                figma: figma.clone(),
            },
            store: store.clone(),
            shell: shell.clone(),
            clock: clock.clone(),
            clients: clients.clone(),
            preview: false,
            os: HostOs::Macos,
            // Never the developer's real 1.14.x folder.
            legacy_dir,
            file_events,
        };
        let engine = Engine::new(services).expect("engine");
        Self {
            engine,
            shell,
            clock,
            store,
            credentials,
            calendar,
            microphone,
            presence,
            figma,
            clients,
        }
    }
}

impl Default for TestEngine {
    fn default() -> Self {
        Self::new()
    }
}
