//! macOS implementations (macOS 14+), ported from the 1.14.2 Swift services:
//!
//! | Trait | Type | Swift source |
//! |---|---|---|
//! | [`Credentials`](crate::Credentials) | [`KeychainCredentials`] | `SecretStore` in `LocalServices.swift` |
//! | [`CalendarSource`](crate::CalendarSource) | [`EventKitCalendar`] | `CalendarService` in `LocalServices.swift` |
//! | [`MicrophoneProbe`](crate::MicrophoneProbe) | [`CoreAudioMicrophone`] | `MicrophoneReader` in `MicrophoneService.swift` |
//! | [`PresenceProbe`](crate::PresenceProbe) | [`MacPresence`] | `WorkPresenceService.swift` |
//! | [`FigmaObserver`](crate::FigmaObserver) | [`AxFigmaObserver`] | `FigmaReader`/`FigmaService` in `FigmaService.swift` |
//!
//! Threading: every method may be called from any thread. Calls that touch Objective-C objects
//! run inside their own autorelease pool, because the engine's blocking-pool threads have none.
//! EventKit lives on one dedicated thread ([`EventKitCalendar`]). Only
//! [`PresenceProbe::subscribe`](crate::PresenceProbe::subscribe) needs the main thread: it
//! registers there (directly, or asynchronously when called elsewhere) and its notifications
//! arrive through the main run loop, which the Tauri app runs. No method waits for the main
//! thread, so nothing can deadlock when the caller already is the main thread.
//!
//! Nothing here shows a permission prompt except [`CalendarSource::request_access`] and
//! [`FigmaObserver::request_access`](crate::FigmaObserver::request_access).
//!
//! [`CalendarSource::request_access`]: crate::CalendarSource::request_access

use std::sync::Arc;

use objc2_foundation::{NSOperatingSystemVersion, NSProcessInfo};

mod bundle;
mod calendar;
mod figma;
mod keychain;
mod microphone;
mod presence;
mod serial;
mod swift;

pub use calendar::EventKitCalendar;
pub use figma::AxFigmaObserver;
pub use keychain::KeychainCredentials;
pub use microphone::CoreAudioMicrophone;
pub use presence::MacPresence;

/// All macOS capabilities, with the production Keychain service.
pub fn platform() -> crate::Platform {
    crate::Platform {
        credentials: Arc::new(KeychainCredentials::default()),
        calendar: Arc::new(EventKitCalendar::new()),
        microphone: Arc::new(CoreAudioMicrophone::new()),
        presence: Arc::new(MacPresence::new()),
        figma: Arc::new(AxFigmaObserver::new()),
    }
}

/// Swift `#available(macOS major.minor, *)` evaluated at run time.
pub(crate) fn os_at_least(major: isize, minor: isize) -> bool {
    objc2::rc::autoreleasepool(|_| {
        NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(NSOperatingSystemVersion {
            majorVersion: major,
            minorVersion: minor,
            patchVersion: 0,
        })
    })
}

/// Runs `f` and turns a panic into an error, so a bug never unwinds into Objective-C frames or
/// kills a long-lived worker thread.
pub(crate) fn guarded<T>(what: &str, f: impl FnOnce() -> crate::Result<T>) -> crate::Result<T> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or_else(|_| {
        tracing::error!(target: "att_platform::macos", "{what} panicked");
        Err(crate::PlatformError::Failed(format!("{what} failed unexpectedly.")))
    })
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// A random hexadecimal suffix without extra dependencies.
    pub(crate) fn random_suffix() -> String {
        let mut hasher = RandomState::new().build_hasher();
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        hasher.write_u128(nanos);
        hasher.write_u32(std::process::id());
        format!("{:016x}", hasher.finish())
    }

    /// Foundation's `standardizingPath` (drops `/private` from `/private/var/…`), which
    /// `NSBundle.bundlePath` applies.
    pub(crate) fn standardized(path: &str) -> String {
        objc2_foundation::NSString::from_str(path).stringByStandardizingPath().to_string()
    }

    /// A temporary directory removed on drop.
    pub(crate) struct TempDir(PathBuf);

    impl TempDir {
        pub(crate) fn new(label: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("att-platform-{label}-{}", random_suffix()));
            std::fs::create_dir_all(&dir).expect("create temp dir");
            Self(dir)
        }

        pub(crate) fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }

        /// Writes `<dir>/<name>/Contents/Info.plist` with the given string keys and returns the
        /// bundle path.
        pub(crate) fn fake_app(&self, name: &str, keys: &[(&str, &str)]) -> String {
            let contents = self.0.join(name).join("Contents");
            std::fs::create_dir_all(contents.join("MacOS")).expect("create bundle");
            let mut plist = String::from(concat!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
                "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" ",
                "\"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n",
                "<plist version=\"1.0\">\n<dict>\n",
                "\t<key>CFBundlePackageType</key>\n\t<string>APPL</string>\n",
            ));
            for (key, value) in keys {
                plist.push_str(&format!("\t<key>{key}</key>\n\t<string>{value}</string>\n"));
            }
            plist.push_str("</dict>\n</plist>\n");
            std::fs::write(contents.join("Info.plist"), plist).expect("write Info.plist");
            self.0.join(name).to_string_lossy().into_owned()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
