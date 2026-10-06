//! Idle time, screen lock, foreground app and sleep/wake notifications, ported from
//! `Sources/AzureTimetracker/WorkPresenceService.swift` (1.14.x).
//!
//! - Idle: `CGEventSourceSecondsSinceLastEventType(.combinedSessionState, kCGAnyInputEventType)`.
//! - Lock: `CGSessionCopyCurrentDictionary()["CGSSessionScreenIsLocked"]`. macOS only includes the
//!   key while the screen is locked, and Swift only changed its state when the key was present,
//!   so a missing key (or a missing session dictionary) is reported as `None` ("unknown") rather
//!   than `Some(false)`.
//! - Foreground: `NSWorkspace.frontmostApplication` (bundle ID, localized name, bundle path). An
//!   app without a bundle identifier is reported as `None`; 1.14.x never matched such an app
//!   (`watches(nil) == false`). A missing localized name is an empty string.
//! - [`PresenceProbe::subscribe`] observes the NSWorkspace sleep, display and session
//!   notifications and the distributed `com.apple.screenIsLocked` / `com.apple.screenIsUnlocked`
//!   notifications. Registration happens on the main thread and delivery needs the main run loop,
//!   which the Tauri app runs; a process without one (a CLI) receives nothing.
//! - [`PresenceProbe::app_identity`] reads `CFBundleIdentifier` and the display name
//!   (`CFBundleDisplayName`, then `CFBundleName`, then the file name) through `NSBundle`.
//!
//! Only elapsed input inactivity and the foreground app's identity are read: never keystrokes,
//! pointer positions, window titles, documents or screenshots.

use std::path::Path;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::MainThreadMarker;
use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::{AnyObject, NSObjectProtocol, ProtocolObject};
use objc2_app_kit::{
    NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceScreensDidSleepNotification,
    NSWorkspaceScreensDidWakeNotification, NSWorkspaceSessionDidBecomeActiveNotification,
    NSWorkspaceSessionDidResignActiveNotification, NSWorkspaceWillSleepNotification,
};
use objc2_core_foundation::{CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType};
use objc2_core_graphics::{
    CGEventSource, CGEventSourceStateID, CGEventType, CGSessionCopyCurrentDictionary,
};
use objc2_foundation::{
    NSDistributedNotificationCenter, NSNotification, NSNotificationCenter, NSString,
};

use super::bundle::read_bundle;
use crate::{
    AppIdentity, PlatformError, PresenceProbe, PresenceSample, Result, SystemEvent, SystemEventSink,
};

/// `kCGAnyInputEventType` (`~0`).
const ANY_INPUT_EVENT: CGEventType = CGEventType(u32::MAX);
const SCREEN_LOCKED_KEY: &str = "CGSSessionScreenIsLocked";
const SCREEN_LOCKED: &str = "com.apple.screenIsLocked";
const SCREEN_UNLOCKED: &str = "com.apple.screenIsUnlocked";

/// macOS [`PresenceProbe`].
pub struct MacPresence {
    sinks: Arc<Mutex<Vec<SystemEventSink>>>,
    registered: AtomicBool,
    observers: Arc<Mutex<Vec<Observer>>>,
}

impl MacPresence {
    pub fn new() -> Self {
        Self {
            sinks: Arc::new(Mutex::new(Vec::new())),
            registered: AtomicBool::new(false),
            observers: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl Default for MacPresence {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for MacPresence {
    fn drop(&mut self) {
        let observers =
            std::mem::take(&mut *self.observers.lock().unwrap_or_else(|p| p.into_inner()));
        for observer in observers {
            // SAFETY: the token was returned by this centre's `addObserverForName:…`;
            // `removeObserver:` is thread-safe.
            let token: &AnyObject = observer.token.as_ref();
            unsafe { observer.center.removeObserver(token) };
        }
    }
}

/// A block-based observer registration. The centre keeps the block alive until removal.
struct Observer {
    center: Retained<NSNotificationCenter>,
    token: Retained<ProtocolObject<dyn NSObjectProtocol>>,
}

// SAFETY: the token is an opaque registration handle and the notification centres are
// thread-safe; neither is used except to remove the registration.
unsafe impl Send for Observer {}

impl PresenceProbe for MacPresence {
    fn sample(&self) -> PresenceSample {
        autoreleasepool(|_| PresenceSample {
            idle_seconds: CGEventSource::seconds_since_last_event_type(
                CGEventSourceStateID::CombinedSessionState,
                ANY_INPUT_EVENT,
            ),
            locked: screen_locked(),
            foreground: foreground_app(),
        })
    }

    fn subscribe(&self, sink: SystemEventSink) -> Result<()> {
        self.sinks.lock().unwrap_or_else(|p| p.into_inner()).push(sink);
        if self.registered.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        let sinks = Arc::clone(&self.sinks);
        let observers = Arc::clone(&self.observers);
        let register = move || {
            let added = autoreleasepool(|_| register_observers(&sinks));
            observers.lock().unwrap_or_else(|p| p.into_inner()).extend(added);
        };
        if MainThreadMarker::new().is_some() {
            register();
        } else {
            // Never wait for the main thread: queue the registration and return.
            DispatchQueue::main().exec_async(register);
        }
        Ok(())
    }

    fn app_identity(&self, path: &Path) -> Result<AppIdentity> {
        let missing = || PlatformError::Failed("An application has no bundle identifier.".into());
        let path = path.to_str().ok_or_else(missing)?;
        let bundle = read_bundle(path).ok_or_else(missing)?;
        let id = bundle.id.ok_or_else(missing)?;
        Ok(AppIdentity { id, name: bundle.name, path: Some(bundle.path) })
    }
}

/// `CGSSessionScreenIsLocked` from the current session dictionary.
fn screen_locked() -> Option<bool> {
    let session = CGSessionCopyCurrentDictionary()?;
    // SAFETY: the session dictionary has CFString keys and CFType values.
    let session: CFRetained<CFDictionary<CFString, CFType>> =
        unsafe { CFRetained::cast_unchecked(session) };
    let key = CFString::from_static_str(SCREEN_LOCKED_KEY);
    lock_value(session.get(&key).as_deref())
}

/// Swift `session["CGSSessionScreenIsLocked"] as? Bool`: a CFBoolean, or a CFNumber that is
/// exactly 0 or 1. Anything else, or no value, is unknown.
pub(crate) fn lock_value(value: Option<&CFType>) -> Option<bool> {
    let value = value?;
    if let Some(flag) = value.downcast_ref::<CFBoolean>() {
        return Some(flag.as_bool());
    }
    match value.downcast_ref::<CFNumber>()?.as_i64()? {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    }
}

fn foreground_app() -> Option<AppIdentity> {
    let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    let id = app.bundleIdentifier()?.to_string();
    Some(AppIdentity {
        id,
        name: app.localizedName().map(|name| name.to_string()).unwrap_or_default(),
        path: app.bundleURL().and_then(|url| url.path()).map(|path| path.to_string()),
    })
}

fn deliver(sinks: &Mutex<Vec<SystemEventSink>>, event: SystemEvent) {
    let sinks: Vec<SystemEventSink> = sinks.lock().unwrap_or_else(|p| p.into_inner()).clone();
    for sink in sinks {
        // A panicking sink must not unwind into the notification centre.
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| sink(event))).is_err() {
            tracing::error!(target: "att_platform::presence", ?event, "system event sink panicked");
        }
    }
}

/// The notification → event table from `WorkPresenceService.start()`.
fn register_observers(sinks: &Arc<Mutex<Vec<SystemEventSink>>>) -> Vec<Observer> {
    let workspace_center = NSWorkspace::sharedWorkspace().notificationCenter();
    // SAFETY: AppKit's notification name constants are immutable NSStrings.
    let workspace: [(&NSString, SystemEvent); 6] = unsafe {
        [
            (NSWorkspaceWillSleepNotification, SystemEvent::WillSleep),
            (NSWorkspaceScreensDidSleepNotification, SystemEvent::DisplaysSlept),
            (NSWorkspaceSessionDidResignActiveNotification, SystemEvent::SessionResigned),
            (NSWorkspaceDidWakeNotification, SystemEvent::DidWake),
            (NSWorkspaceScreensDidWakeNotification, SystemEvent::DisplaysWoke),
            (NSWorkspaceSessionDidBecomeActiveNotification, SystemEvent::SessionActivated),
        ]
    };
    let mut observers = Vec::new();
    for (name, event) in workspace {
        observers.push(observe(&workspace_center, name, event, sinks));
    }
    // macOS distributes lock events separately from user-session switching.
    let distributed: Retained<NSNotificationCenter> =
        Retained::into_super(NSDistributedNotificationCenter::defaultCenter());
    for (name, event) in
        [(SCREEN_LOCKED, SystemEvent::ScreenLocked), (SCREEN_UNLOCKED, SystemEvent::ScreenUnlocked)]
    {
        observers.push(observe(&distributed, &NSString::from_str(name), event, sinks));
    }
    observers
}

fn observe(
    center: &Retained<NSNotificationCenter>,
    name: &NSString,
    event: SystemEvent,
    sinks: &Arc<Mutex<Vec<SystemEventSink>>>,
) -> Observer {
    let sinks = Arc::clone(sinks);
    let block = RcBlock::new(move |_note: NonNull<NSNotification>| deliver(&sinks, event));
    // SAFETY: valid name and block; no sender filter; a nil queue delivers on the posting thread
    // (the main thread for these notifications). The centre copies the block.
    let token = unsafe {
        center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block)
    };
    Observer { center: Retained::clone(center), token }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::macos::test_support::{TempDir, standardized};

    #[test]
    fn lock_value_mirrors_swift_bool_bridging() {
        assert_eq!(lock_value(None), None, "missing key is unknown");
        assert_eq!(lock_value(Some(CFBoolean::new(true).as_ref())), Some(true));
        assert_eq!(lock_value(Some(CFBoolean::new(false).as_ref())), Some(false));
        assert_eq!(lock_value(Some(CFNumber::new_i32(1).as_ref())), Some(true));
        assert_eq!(lock_value(Some(CFNumber::new_i32(0).as_ref())), Some(false));
        assert_eq!(lock_value(Some(CFNumber::new_i32(2).as_ref())), None);
        assert_eq!(lock_value(Some(CFString::from_static_str("1").as_ref())), None);
    }

    #[test]
    fn app_identity_reads_the_bundle() {
        let dir = TempDir::new("identity");
        let app = dir.fake_app(
            "Editor.app",
            &[("CFBundleIdentifier", "be.example.editor"), ("CFBundleDisplayName", "Editor Pro")],
        );
        let identity = MacPresence::new().app_identity(Path::new(&app)).expect("identity");
        assert_eq!(
            identity,
            AppIdentity {
                id: "be.example.editor".into(),
                name: "Editor Pro".into(),
                path: Some(standardized(&app)),
            }
        );

        let anonymous = dir.fake_app("Anonymous.app", &[("CFBundleName", "Anonymous")]);
        let error =
            MacPresence::new().app_identity(Path::new(&anonymous)).expect_err("no identifier");
        assert_eq!(error.to_string(), "An application has no bundle identifier.");

        let missing = format!("{}/Missing.app", dir.path());
        assert!(MacPresence::new().app_identity(Path::new(&missing)).is_err());
    }

    #[test]
    fn sample_reads_without_prompting() {
        let sample = MacPresence::new().sample();
        assert!(sample.idle_seconds.is_finite() && sample.idle_seconds >= 0.0);
    }

    #[test]
    fn subscribe_registers_once_from_any_thread() {
        let presence = MacPresence::new();
        let sink: SystemEventSink = Arc::new(|_| {});
        // Off the main thread the registration is queued on the main queue, which the test
        // harness never drains; the call must still return immediately.
        std::thread::scope(|scope| {
            scope.spawn(|| presence.subscribe(Arc::clone(&sink)).expect("subscribe"));
        });
        presence.subscribe(sink).expect("second subscribe only adds the sink");
        assert_eq!(presence.sinks.lock().expect("sinks").len(), 2);
    }

    #[test]
    fn workspace_notifications_map_to_system_events() {
        // NSWorkspace's notification centre is local to this process, so posting to it reaches
        // only the observers registered here. The distributed lock notifications are system-wide
        // and are deliberately not posted.
        let received = Arc::new(Mutex::new(Vec::new()));
        let store = Arc::clone(&received);
        let sinks: Arc<Mutex<Vec<SystemEventSink>>> =
            Arc::new(Mutex::new(vec![Arc::new(move |event| {
                store.lock().expect("events").push(event)
            })]));
        let observers = autoreleasepool(|_| register_observers(&sinks));
        assert_eq!(observers.len(), 8, "six workspace and two distributed observers");
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        let posted = unsafe {
            [
                NSWorkspaceWillSleepNotification,
                NSWorkspaceDidWakeNotification,
                NSWorkspaceScreensDidSleepNotification,
                NSWorkspaceScreensDidWakeNotification,
                NSWorkspaceSessionDidResignActiveNotification,
                NSWorkspaceSessionDidBecomeActiveNotification,
            ]
        };
        for name in posted {
            // SAFETY: a process-local notification without sender or user info.
            unsafe { center.postNotificationName_object(name, None) };
        }
        for observer in observers {
            let token: &AnyObject = observer.token.as_ref();
            unsafe { observer.center.removeObserver(token) };
        }
        assert_eq!(
            *received.lock().expect("events"),
            [
                SystemEvent::WillSleep,
                SystemEvent::DidWake,
                SystemEvent::DisplaysSlept,
                SystemEvent::DisplaysWoke,
                SystemEvent::SessionResigned,
                SystemEvent::SessionActivated,
            ]
        );
    }
}
