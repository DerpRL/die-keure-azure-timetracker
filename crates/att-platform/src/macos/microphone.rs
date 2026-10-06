//! Microphone owners from Core Audio HAL process objects, ported from `MicrophoneReader` in
//! `Sources/AzureTimetracker/MicrophoneService.swift` (1.14.x).
//!
//! Reads HAL metadata only (`kAudioHardwarePropertyProcessObjectList`, then per process
//! `kAudioProcessPropertyIsRunningInput`, `kAudioProcessPropertyPID` and
//! `kAudioProcessPropertyBundleID`). It never creates an audio stream, tap or recording and never
//! triggers the microphone permission prompt. Process objects exist on macOS 14.2+ only.
//!
//! Owner resolution, unchanged from Swift: the process path (`proc_pidpath`, else the running
//! application's bundle path) is walked up to its outermost `.app`; when that bundle has an
//! identifier it names the owner. Otherwise the running application's identifier (or the HAL
//! bundle ID) is used, WebKit helpers get the label "WebKit (browser or web view)", and processes
//! without any identifier become `process:<pid>` / "Unidentified audio app".
//!
//! [`MicrophoneProbe::sample`] returns one owner per process with running input, in HAL order.
//! The engine de-duplicates by `id` and sorts by name, as `MicrophoneService.checkNow` did.

use std::ffi::c_void;
use std::ptr::{self, NonNull};
use std::sync::OnceLock;

use objc2::rc::autoreleasepool;
use objc2_app_kit::NSRunningApplication;
use objc2_core_audio::{
    AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize, AudioObjectID,
    AudioObjectPropertyAddress, AudioObjectPropertySelector,
    kAudioHardwarePropertyProcessObjectList, kAudioObjectPropertyElementMain,
    kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject, kAudioProcessPropertyBundleID,
    kAudioProcessPropertyIsRunningInput, kAudioProcessPropertyPID,
};
use objc2_core_foundation::{CFRetained, CFString};

use super::bundle::{BundleInfo, enclosing_app, read_bundle};
use crate::{InputOwner, MicrophoneProbe, PlatformError, Result};

/// `MicrophoneReader.Process`: a HAL process object with input running.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AudioProcess {
    pub pid: i32,
    /// `kAudioProcessPropertyBundleID`, empty when unavailable.
    pub bundle_id: String,
}

/// What the system knows about a process, gathered before the pure owner resolution.
#[derive(Debug, Clone, Default)]
pub(crate) struct ProcessFacts {
    pub pid: i32,
    pub hal_bundle_id: String,
    /// `proc_pidpath`, else `NSRunningApplication.bundleURL.path`, else empty.
    pub path: String,
    pub running_bundle_id: Option<String>,
    pub running_name: Option<String>,
}

/// Core Audio-backed [`MicrophoneProbe`].
#[derive(Debug, Default, Clone, Copy)]
pub struct CoreAudioMicrophone;

impl CoreAudioMicrophone {
    pub fn new() -> Self {
        Self
    }
}

impl MicrophoneProbe for CoreAudioMicrophone {
    fn supported(&self) -> bool {
        // Process objects (`kAudioHardwarePropertyProcessObjectList`) arrived in macOS 14.2.
        static SUPPORTED: OnceLock<bool> = OnceLock::new();
        *SUPPORTED.get_or_init(|| super::os_at_least(14, 2))
    }

    fn sample(&self) -> Result<Vec<InputOwner>> {
        if !self.supported() {
            return Err(PlatformError::Failed(
                "Microphone app detection requires macOS 14.2 or later.".into(),
            ));
        }
        super::guarded("Microphone detection", || {
            autoreleasepool(|_| {
                let processes = read_processes()?;
                Ok(processes
                    .iter()
                    .map(|process| resolve_owner(&facts(process), read_bundle))
                    .collect())
            })
        })
    }
}

fn address(selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    }
}

fn check(status: i32) -> Result<()> {
    if status == 0 {
        Ok(())
    } else {
        Err(PlatformError::Failed(format!(
            "macOS microphone status is temporarily unavailable ({status}). Retrying automatically."
        )))
    }
}

/// Reads a fixed-size property; any failure fails the whole sample, as in Swift.
fn read_value<T: Copy + Default>(
    object: AudioObjectID,
    selector: AudioObjectPropertySelector,
) -> Result<T> {
    let mut value = T::default();
    let mut size = size_of::<T>() as u32;
    let mut property = address(selector);
    // SAFETY: `value` is a writable buffer of `size` bytes for a property of that size.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&mut property),
            0,
            ptr::null(),
            NonNull::from(&mut size),
            NonNull::from(&mut value).cast::<c_void>(),
        )
    };
    check(status)?;
    Ok(value)
}

/// `MicrophoneReader.read()`.
pub(crate) fn read_processes() -> Result<Vec<AudioProcess>> {
    let system = kAudioObjectSystemObject as AudioObjectID;
    let mut list = address(kAudioHardwarePropertyProcessObjectList);
    let mut size: u32 = 0;
    // SAFETY: valid address and out-pointer; no qualifier.
    check(unsafe {
        AudioObjectGetPropertyDataSize(
            system,
            NonNull::from(&mut list),
            0,
            ptr::null(),
            NonNull::from(&mut size),
        )
    })?;
    let mut objects: Vec<AudioObjectID> = vec![0; size as usize / size_of::<AudioObjectID>()];
    if let Some(buffer) = NonNull::new(objects.as_mut_ptr().cast::<c_void>())
        && !objects.is_empty()
    {
        size = (objects.len() * size_of::<AudioObjectID>()) as u32;
        // SAFETY: `buffer` holds `size` bytes; the HAL writes at most that and updates `size`.
        check(unsafe {
            AudioObjectGetPropertyData(
                system,
                NonNull::from(&mut list),
                0,
                ptr::null(),
                NonNull::from(&mut size),
                buffer,
            )
        })?;
    }
    objects.truncate(size as usize / size_of::<AudioObjectID>());
    let mut result = Vec::new();
    for object in objects {
        let running: u32 = read_value(object, kAudioProcessPropertyIsRunningInput)?;
        if running == 0 {
            continue;
        }
        let pid: i32 = read_value(object, kAudioProcessPropertyPID)?;
        result.push(AudioProcess { pid, bundle_id: bundle_id(object) });
    }
    Ok(result)
}

/// `kAudioProcessPropertyBundleID` (a +1 CFString), or empty when the HAL has none.
fn bundle_id(object: AudioObjectID) -> String {
    let mut value: *const CFString = ptr::null();
    let mut size = size_of::<*const CFString>() as u32;
    let mut property = address(kAudioProcessPropertyBundleID);
    // SAFETY: the property is a CFStringRef returned at +1; the buffer holds one pointer.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&mut property),
            0,
            ptr::null(),
            NonNull::from(&mut size),
            NonNull::from(&mut value).cast::<c_void>(),
        )
    };
    match NonNull::new(value.cast_mut()) {
        // SAFETY: the HAL hands over ownership of the string (Swift `takeRetainedValue`).
        Some(text) => {
            let text = unsafe { CFRetained::from_raw(text) };
            if status == 0 { text.to_string() } else { String::new() }
        }
        None => String::new(),
    }
}

/// `proc_pidpath` into a `4 * MAXPATHLEN` buffer, decoded up to the first NUL.
fn process_path(pid: i32) -> Option<String> {
    let mut buffer = vec![0u8; 4 * libc::MAXPATHLEN as usize];
    // SAFETY: `buffer` is writable for its full length.
    let count = unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
    if count <= 0 {
        return None;
    }
    let end = buffer.iter().position(|byte| *byte == 0).unwrap_or(buffer.len());
    Some(String::from_utf8_lossy(&buffer[..end]).into_owned())
}

fn facts(process: &AudioProcess) -> ProcessFacts {
    let running = NSRunningApplication::runningApplicationWithProcessIdentifier(process.pid);
    let path = process_path(process.pid)
        .or_else(|| {
            running
                .as_ref()
                .and_then(|app| app.bundleURL())
                .and_then(|url| url.path())
                .map(|path| path.to_string())
        })
        .unwrap_or_default();
    ProcessFacts {
        pid: process.pid,
        hal_bundle_id: process.bundle_id.clone(),
        path,
        running_bundle_id: running
            .as_ref()
            .and_then(|app| app.bundleIdentifier())
            .map(|id| id.to_string()),
        running_name: running
            .as_ref()
            .and_then(|app| app.localizedName())
            .map(|name| name.to_string()),
    }
}

/// `MicrophoneReader.owner(_:)`, with the bundle lookup injected for tests.
pub(crate) fn resolve_owner(
    facts: &ProcessFacts,
    read_bundle: impl Fn(&str) -> Option<BundleInfo>,
) -> InputOwner {
    let pid = u32::try_from(facts.pid).ok();
    // Audio services often live in a helper inside the application's bundle. Resolve its
    // containing app without inspecting windows or browser tabs.
    if let Some(app) = enclosing_app(&facts.path)
        && let Some(bundle) = read_bundle(&app)
        && let Some(id) = bundle.id
    {
        return InputOwner { id, name: bundle.name, pid, path: Some(bundle.path) };
    }
    let path = (!facts.path.is_empty()).then(|| facts.path.clone());
    let id = facts.running_bundle_id.clone().unwrap_or_else(|| facts.hal_bundle_id.clone());
    if id.to_lowercase().starts_with("com.apple.webkit.") {
        return InputOwner { id, name: "WebKit (browser or web view)".into(), pid, path };
    }
    let name = facts.running_name.clone().unwrap_or_else(|| {
        if id.is_empty() { "Unidentified audio app".into() } else { id.clone() }
    });
    let id = if id.is_empty() { format!("process:{}", facts.pid) } else { id };
    InputOwner { id, name, pid, path }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::macos::test_support::{TempDir, standardized};

    fn bundles(path: &str) -> Option<BundleInfo> {
        match path {
            "/Applications/Microsoft Teams.app" => Some(BundleInfo {
                id: Some("com.microsoft.teams2".into()),
                name: "Microsoft Teams".into(),
                path: path.into(),
            }),
            "/Applications/Broken.app" => {
                Some(BundleInfo { id: None, name: "Broken".into(), path: path.into() })
            }
            _ => None,
        }
    }

    #[test]
    fn helper_processes_resolve_to_the_enclosing_app() {
        let facts = ProcessFacts {
            pid: 501,
            hal_bundle_id: "com.microsoft.teams2.helper".into(),
            path: "/Applications/Microsoft Teams.app/Contents/Helpers/Microsoft Teams WebView.app/Contents/MacOS/Microsoft Teams WebView".into(),
            running_bundle_id: Some("com.microsoft.teams2.helper".into()),
            running_name: Some("Microsoft Teams WebView".into()),
        };
        let owner = resolve_owner(&facts, bundles);
        assert_eq!(owner.id, "com.microsoft.teams2");
        assert_eq!(owner.name, "Microsoft Teams");
        assert_eq!(owner.pid, Some(501));
        assert_eq!(owner.path.as_deref(), Some("/Applications/Microsoft Teams.app"));
    }

    #[test]
    fn webkit_helpers_get_the_webkit_label() {
        let gpu = ProcessFacts {
            pid: 77,
            hal_bundle_id: "com.apple.WebKit.GPU".into(),
            path: "/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.GPU.xpc/Contents/MacOS/com.apple.WebKit.GPU".into(),
            running_bundle_id: None,
            running_name: None,
        };
        let owner = resolve_owner(&gpu, bundles);
        assert_eq!(owner.id, "com.apple.WebKit.GPU", "the WebKit bundle ID is kept");
        assert_eq!(owner.name, "WebKit (browser or web view)");

        // The prefix test is case-insensitive and the running app's identifier wins.
        let content = ProcessFacts {
            pid: 78,
            hal_bundle_id: String::new(),
            running_bundle_id: Some("COM.APPLE.WEBKIT.WebContent".into()),
            running_name: Some("Safari Web Content".into()),
            ..ProcessFacts::default()
        };
        assert_eq!(resolve_owner(&content, bundles).name, "WebKit (browser or web view)");

        // `com.apple.WebKit` alone (no trailing dot) is not a helper.
        let plain = ProcessFacts {
            pid: 79,
            hal_bundle_id: "com.apple.WebKit".into(),
            ..ProcessFacts::default()
        };
        assert_eq!(resolve_owner(&plain, bundles).name, "com.apple.WebKit");
    }

    #[test]
    fn falls_back_to_running_app_then_hal_then_pid() {
        let running = ProcessFacts {
            pid: 10,
            hal_bundle_id: "us.zoom.xos.hal".into(),
            path: "/opt/zoom/bin/zoom".into(),
            running_bundle_id: Some("us.zoom.xos".into()),
            running_name: Some("zoom.us".into()),
        };
        let owner = resolve_owner(&running, bundles);
        assert_eq!((owner.id.as_str(), owner.name.as_str()), ("us.zoom.xos", "zoom.us"));
        assert_eq!(owner.path.as_deref(), Some("/opt/zoom/bin/zoom"));

        let hal_only = ProcessFacts {
            pid: 11,
            hal_bundle_id: "com.example.daemon".into(),
            ..ProcessFacts::default()
        };
        let owner = resolve_owner(&hal_only, bundles);
        assert_eq!(
            (owner.id.as_str(), owner.name.as_str()),
            ("com.example.daemon", "com.example.daemon")
        );
        assert_eq!(owner.path, None);

        let anonymous = ProcessFacts {
            pid: 12,
            path: "/usr/libexec/something".into(),
            ..ProcessFacts::default()
        };
        let owner = resolve_owner(&anonymous, bundles);
        assert_eq!(
            (owner.id.as_str(), owner.name.as_str()),
            ("process:12", "Unidentified audio app")
        );

        let named = ProcessFacts {
            pid: 13,
            running_name: Some("Helper".into()),
            ..ProcessFacts::default()
        };
        let owner = resolve_owner(&named, bundles);
        assert_eq!((owner.id.as_str(), owner.name.as_str()), ("process:13", "Helper"));
    }

    #[test]
    fn bundles_without_identifier_fall_through() {
        let facts = ProcessFacts {
            pid: 20,
            hal_bundle_id: "com.example.broken".into(),
            path: "/Applications/Broken.app/Contents/MacOS/Broken".into(),
            running_bundle_id: None,
            running_name: Some("Broken Helper".into()),
        };
        let owner = resolve_owner(&facts, bundles);
        assert_eq!(
            (owner.id.as_str(), owner.name.as_str()),
            ("com.example.broken", "Broken Helper")
        );
    }

    #[test]
    fn resolves_a_real_bundle_on_disk() {
        let dir = TempDir::new("microphone");
        let app = dir.fake_app(
            "Meeting App.app",
            &[("CFBundleIdentifier", "be.example.meeting"), ("CFBundleName", "Meeting")],
        );
        let facts = ProcessFacts {
            pid: 30,
            path: format!(
                "{app}/Contents/Frameworks/Meeting Helper.app/Contents/MacOS/Meeting Helper"
            ),
            ..ProcessFacts::default()
        };
        let owner = resolve_owner(&facts, read_bundle);
        assert_eq!((owner.id.as_str(), owner.name.as_str()), ("be.example.meeting", "Meeting"));
        assert_eq!(owner.path, Some(standardized(&app)));
    }

    #[test]
    fn hal_sample_reads_metadata_only() {
        // Reads process metadata from the HAL; never opens an input stream.
        let probe = CoreAudioMicrophone::new();
        if !probe.supported() {
            assert!(probe.sample().is_err());
            return;
        }
        // The HAL can be briefly unavailable; an error means "unknown", never a panic.
        if let Ok(owners) = probe.sample() {
            assert!(owners.iter().all(|owner| !owner.id.is_empty() && !owner.name.is_empty()));
        }
    }
}
