//! Microphone in use: the consent store says which apps, WASAPI capture sessions confirm them.
//!
//! The consent store (`HKCU\…\CapabilityAccessManager\ConsentStore\microphone`) is what drives
//! the taskbar microphone indicator. Its packaged-app subkeys are package family names; the
//! `NonPackaged` subkeys are executable paths with `#` for `\`. WASAPI is only queried when the
//! store lists at least one app in use, so the common silent case is a handful of registry reads.
//! The merge rule is [`crate::windows_parse::merge_microphone_use`]. Metadata only: no audio
//! stream is opened.

use std::collections::BTreeSet;

use windows::Win32::Foundation::S_OK;
use windows::Win32::Media::Audio::{
    AudioSessionStateActive, DEVICE_STATE_ACTIVE, IAudioSessionControl2, IAudioSessionEnumerator,
    IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, eCapture,
};
use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance};
use windows::Win32::System::Registry::HKEY_CURRENT_USER;
use windows::core::Interface;

use super::apps::{self, ProcessHandle};
use super::com::ComScope;
use super::registry::RegKey;
use super::system::os_version;
use crate::unsupported::MICROPHONE_DETECTION;
use crate::windows_parse::{
    CaptureSession, ConsentApp, ConsentUse, MICROPHONE_CONSENT_KEY, NON_PACKAGED_KEY, SessionView,
    consent_in_use, error_code_label, input_owners, merge_microphone_use, microphone_supported,
};
use crate::{InputOwner, MicrophoneProbe, PlatformError, Result};

/// Microphone users from the consent store, confirmed by WASAPI.
#[derive(Debug, Default)]
pub struct WindowsMicrophone {
    _private: (),
}

/// Everything one sample saw, for the probe example and support diagnostics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicrophoneDiagnosis {
    /// Consent-store rows that say "in use".
    pub candidates: Vec<ConsentUse>,
    /// Active WASAPI capture sessions.
    pub sessions: SessionView,
    /// The merged result, as [`MicrophoneProbe::sample`] returns it.
    pub owners: Vec<InputOwner>,
}

impl WindowsMicrophone {
    pub fn new() -> Self {
        Self::default()
    }

    /// Like `sample`, but always queries WASAPI and returns the intermediate data.
    pub fn diagnose(&self) -> Result<MicrophoneDiagnosis> {
        self.read(true)
    }

    fn read(&self, always_query_sessions: bool) -> Result<MicrophoneDiagnosis> {
        if !self.supported() {
            return Err(PlatformError::Unsupported(MICROPHONE_DETECTION));
        }
        let candidates = consent_candidates().map_err(|error| {
            PlatformError::Failed(format!(
                "Windows microphone status is temporarily unavailable ({}). Retrying automatically.",
                error_code_label(error.to_hresult().0)
            ))
        })?;
        let sessions = if candidates.is_empty() && !always_query_sessions {
            SessionView::Complete(Vec::new())
        } else {
            capture_sessions()
        };
        let owners =
            input_owners(merge_microphone_use(candidates.clone(), &sessions), apps::describe);
        Ok(MicrophoneDiagnosis { candidates, sessions, owners })
    }
}

impl MicrophoneProbe for WindowsMicrophone {
    /// Windows 10 1903 (build 18362) and later record per-app microphone use.
    fn supported(&self) -> bool {
        os_version().is_some_and(|version| microphone_supported(version.major, version.build))
    }

    fn sample(&self) -> Result<Vec<InputOwner>> {
        self.read(false).map(|diagnosis| diagnosis.owners)
    }
}

/// Consent-store rows with `LastUsedTimeStart != 0` and `LastUsedTimeStop == 0`. A missing store
/// (no app ever asked for the microphone) is an empty list.
fn consent_candidates()
-> std::result::Result<Vec<ConsentUse>, windows::Win32::Foundation::WIN32_ERROR> {
    let Some(store) = RegKey::open(HKEY_CURRENT_USER, MICROPHONE_CONSENT_KEY)? else {
        return Ok(Vec::new());
    };
    let mut candidates = Vec::new();
    for name in store.subkey_names()? {
        if name.eq_ignore_ascii_case(NON_PACKAGED_KEY) {
            let Some(desktop) = store.subkey(&name)? else { continue };
            for key in desktop.subkey_names()? {
                if let Some(started) = in_use_since(&desktop, &key) {
                    candidates.push(ConsentUse { app: ConsentApp::NonPackaged { key }, started });
                }
            }
        } else if let Some(started) = in_use_since(&store, &name) {
            candidates.push(ConsentUse { app: ConsentApp::Packaged { family: name }, started });
        }
    }
    Ok(candidates)
}

fn in_use_since(parent: &RegKey, subkey: &str) -> Option<u64> {
    let started = parent.qword(subkey, "LastUsedTimeStart")?;
    consent_in_use(started, parent.qword(subkey, "LastUsedTimeStop")).then_some(started)
}

/// Processes with an active session on any active capture endpoint.
fn capture_sessions() -> SessionView {
    let _com = match ComScope::enter() {
        Ok(scope) => scope,
        Err(error) => {
            tracing::debug!(%error, "COM unavailable for WASAPI");
            return SessionView::Unavailable;
        }
    };
    match active_capture_pids() {
        Ok((pids, complete)) => {
            let sessions: Vec<CaptureSession> = pids
                .into_iter()
                .map(|pid| {
                    let process = ProcessHandle::open(pid);
                    CaptureSession {
                        pid,
                        path: process.as_ref().and_then(ProcessHandle::image_path),
                        family: process.as_ref().and_then(ProcessHandle::package_family),
                    }
                })
                .collect();
            if complete { SessionView::Complete(sessions) } else { SessionView::Partial(sessions) }
        }
        Err(error) => {
            tracing::debug!(%error, "WASAPI session enumeration failed");
            SessionView::Unavailable
        }
    }
}

/// PIDs of active capture sessions, and whether every endpoint and session could be read.
fn active_capture_pids() -> windows::core::Result<(BTreeSet<u32>, bool)> {
    // SAFETY: COM is initialised on this thread by the caller's `ComScope`, and every interface
    // created here is released before this function returns.
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let devices = enumerator.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)?;
        let mut pids = BTreeSet::new();
        let mut complete = true;
        for index in 0..devices.GetCount()? {
            match devices.Item(index).and_then(|device| device_capture_pids(&device, &mut pids)) {
                Ok(device_complete) => complete &= device_complete,
                Err(error) => {
                    tracing::debug!(%error, index, "capture endpoint could not be read");
                    complete = false;
                }
            }
        }
        Ok((pids, complete))
    }
}

/// # Safety
/// COM must be initialised on this thread.
unsafe fn device_capture_pids(
    device: &IMMDevice,
    pids: &mut BTreeSet<u32>,
) -> windows::core::Result<bool> {
    // SAFETY: COM is initialised (caller contract).
    unsafe {
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let sessions = manager.GetSessionEnumerator()?;
        let mut complete = true;
        for index in 0..sessions.GetCount()? {
            match active_session_pid(&sessions, index) {
                Ok(Some(pid)) => {
                    pids.insert(pid);
                }
                Ok(None) => {}
                Err(_) => complete = false,
            }
        }
        Ok(complete)
    }
}

/// # Safety
/// COM must be initialised on this thread.
unsafe fn active_session_pid(
    sessions: &IAudioSessionEnumerator,
    index: i32,
) -> windows::core::Result<Option<u32>> {
    // SAFETY: COM is initialised (caller contract).
    unsafe {
        let control = sessions.GetSession(index)?;
        if control.GetState()? != AudioSessionStateActive {
            return Ok(None);
        }
        let control: IAudioSessionControl2 = control.cast()?;
        if control.IsSystemSoundsSession() == S_OK {
            return Ok(None);
        }
        // A session shared by several processes reports its creator (AUDCLNT_S_NO_SINGLE_PROCESS).
        let pid = control.GetProcessId()?;
        Ok((pid != 0).then_some(pid))
    }
}

#[cfg(test)]
mod tests {
    //! Run on Windows: `cargo test -p att-platform`.

    use super::*;

    #[test]
    fn supported_on_windows_10_1903_and_later() {
        let version = os_version().expect("RtlGetVersion");
        assert_eq!(
            WindowsMicrophone::new().supported(),
            microphone_supported(version.major, version.build)
        );
    }

    #[test]
    fn sample_reads_without_error() {
        let microphone = WindowsMicrophone::new();
        let diagnosis = microphone.diagnose().expect("consent store readable");
        assert!(diagnosis.owners.len() <= diagnosis.candidates.len());
        for owner in &diagnosis.owners {
            assert!(!owner.id.is_empty());
            assert!(!owner.name.is_empty());
        }
        assert!(microphone.sample().is_ok());
    }

    #[test]
    fn sessions_can_be_enumerated_from_any_thread() {
        // CI runners may have no audio service, so this only checks that the calls are sound
        // from fresh threads (COM entered and left per call). `probe_windows mic` checks results.
        for _ in 0..3 {
            let view = std::thread::spawn(capture_sessions).join().expect("thread");
            println!("{view:?}");
        }
        println!("{:?}", capture_sessions());
    }
}
