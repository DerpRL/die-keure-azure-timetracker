//! OS version and error helpers.

use std::sync::OnceLock;

use windows::Wdk::System::SystemServices::RtlGetVersion;
use windows::Win32::System::SystemInformation::OSVERSIONINFOW;

use crate::PlatformError;
use crate::windows_parse::error_code_label;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OsVersion {
    pub major: u32,
    pub minor: u32,
    pub build: u32,
}

/// The real OS version. `RtlGetVersion` is not subject to the manifest-based version lie of
/// `GetVersionExW`, so unmanifested test binaries and examples see the same version as the app.
pub(crate) fn os_version() -> Option<OsVersion> {
    static VERSION: OnceLock<Option<OsVersion>> = OnceLock::new();
    *VERSION.get_or_init(|| {
        let mut info = OSVERSIONINFOW {
            dwOSVersionInfoSize: size_of::<OSVERSIONINFOW>() as u32,
            ..Default::default()
        };
        // SAFETY: `info` is a valid OSVERSIONINFOW with its size field set.
        let status = unsafe { RtlGetVersion(&mut info) };
        status.is_ok().then_some(OsVersion {
            major: info.dwMajorVersion,
            minor: info.dwMinorVersion,
            build: info.dwBuildNumber,
        })
    })
}

/// `PlatformError::Failed("<context> (error 5).")`.
pub(crate) fn failure(context: &str, error: &windows::core::Error) -> PlatformError {
    PlatformError::Failed(format!("{context} ({}).", error_code_label(error.code().0)))
}

/// NUL-terminated UTF-16 for APIs that take mutable string pointers.
pub(crate) fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}
