//! Processes, windows and executable identities.

use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::{Mutex, OnceLock};

use windows::Win32::Foundation::{
    CloseHandle, ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, FALSE, HANDLE, HWND, LPARAM, TRUE,
};
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows::Win32::Storage::Packaging::Appx::GetPackageFamilyName;
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId,
};
use windows::core::{BOOL, HSTRING, PWSTR};

use crate::AppIdentity;
use crate::windows_parse::{
    clean_description, exe_name, file_stem, utf16_until_nul, version_string_query,
    version_translations,
};

/// A process opened with `PROCESS_QUERY_LIMITED_INFORMATION`, which Windows grants for elevated
/// and protected processes too. Closed on drop.
pub(crate) struct ProcessHandle(HANDLE);

impl ProcessHandle {
    pub(crate) fn open(pid: u32) -> Option<Self> {
        // SAFETY: plain handle request; the handle is closed in `Drop`.
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok().map(Self)
    }

    /// Full Win32 path of the executable, e.g. `C:\Program Files\Zoom\bin\Zoom.exe`.
    pub(crate) fn image_path(&self) -> Option<String> {
        let mut buffer = vec![0_u16; 1024];
        loop {
            let mut size = buffer.len() as u32;
            // SAFETY: `buffer` holds `size` UTF-16 units.
            let result = unsafe {
                QueryFullProcessImageNameW(
                    self.0,
                    PROCESS_NAME_WIN32,
                    PWSTR(buffer.as_mut_ptr()),
                    &mut size,
                )
            };
            match result {
                Ok(()) => {
                    let length = (size as usize).min(buffer.len());
                    return Some(String::from_utf16_lossy(&buffer[..length]));
                }
                Err(error)
                    if error.code() == ERROR_INSUFFICIENT_BUFFER.to_hresult()
                        && buffer.len() < 32_768 =>
                {
                    buffer.resize(32_768, 0);
                }
                Err(_) => return None,
            }
        }
    }

    /// Package family name for packaged (MSIX/Store) processes, e.g. `MSTeams_8wekyb3d8bbwe`.
    pub(crate) fn package_family(&self) -> Option<String> {
        let mut buffer = [0_u16; 256];
        let mut length = buffer.len() as u32;
        // SAFETY: `buffer` holds `length` UTF-16 units. Unpackaged processes return
        // APPMODEL_ERROR_NO_PACKAGE.
        let status =
            unsafe { GetPackageFamilyName(self.0, &mut length, Some(PWSTR(buffer.as_mut_ptr()))) };
        if status != ERROR_SUCCESS {
            return None;
        }
        let family = utf16_until_nul(&buffer[..(length as usize).min(buffer.len())]);
        (!family.is_empty()).then_some(family)
    }
}

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        // SAFETY: the handle came from `OpenProcess` and is closed once.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

pub(crate) fn process_path(pid: u32) -> Option<String> {
    ProcessHandle::open(pid)?.image_path()
}

pub(crate) fn foreground_window() -> Option<HWND> {
    // SAFETY: no preconditions.
    let window = unsafe { GetForegroundWindow() };
    (!window.is_invalid()).then_some(window)
}

pub(crate) fn window_process_id(window: HWND) -> Option<u32> {
    let mut pid = 0_u32;
    // SAFETY: `pid` is a valid out-pointer; an invalid window yields 0.
    unsafe { GetWindowThreadProcessId(window, Some(&mut pid)) };
    (pid != 0).then_some(pid)
}

/// Executable path of the foreground app. UWP apps are framed by `ApplicationFrameHost.exe`;
/// their own process owns a child window of the frame, which is reported instead.
pub(crate) fn foreground_process_path() -> Option<String> {
    let window = foreground_window()?;
    let pid = window_process_id(window)?;
    let path = process_path(pid)?;
    if exe_name(&path).as_deref() == Some("applicationframehost.exe")
        && let Some(hosted) = hosted_process(window, pid).and_then(process_path)
    {
        return Some(hosted);
    }
    Some(path)
}

struct HostSearch {
    host: u32,
    found: Option<u32>,
}

unsafe extern "system" fn find_hosted_process(child: HWND, context: LPARAM) -> BOOL {
    // SAFETY: `context` is the `HostSearch` that `hosted_process` keeps alive during the call.
    let search = unsafe { &mut *(context.0 as *mut HostSearch) };
    match window_process_id(child) {
        Some(pid) if pid != search.host => {
            search.found = Some(pid);
            FALSE
        }
        _ => TRUE,
    }
}

fn hosted_process(frame: HWND, host: u32) -> Option<u32> {
    let mut search = HostSearch { host, found: None };
    // SAFETY: the callback only touches `search`, which outlives the synchronous enumeration.
    unsafe {
        let _ = EnumChildWindows(
            Some(frame),
            Some(find_hosted_process),
            LPARAM((&raw mut search) as isize),
        );
    }
    search.found
}

/// Window title text (`GetWindowTextW` does not block on a hung window of another process).
pub(crate) fn window_text(window: HWND) -> Option<String> {
    // SAFETY: no preconditions.
    let length = unsafe { GetWindowTextLengthW(window) };
    if length <= 0 {
        return None;
    }
    let mut buffer = vec![0_u16; length as usize + 1];
    // SAFETY: the slice length bounds the copy.
    let copied = unsafe { GetWindowTextW(window, &mut buffer) };
    (copied > 0).then(|| String::from_utf16_lossy(&buffer[..(copied as usize).min(buffer.len())]))
}

/// `FileDescription` from the version resources of an executable.
fn file_description(path: &str) -> Option<String> {
    let path = HSTRING::from(path);
    // SAFETY: plain size query.
    let size = unsafe { GetFileVersionInfoSizeW(&path, None) };
    if size == 0 {
        return None;
    }
    // `u32` storage keeps the block 4-byte aligned for the UTF-16 views below.
    let mut block = vec![0_u32; (size as usize).div_ceil(4)];
    // SAFETY: `block` has at least `size` writable bytes.
    unsafe { GetFileVersionInfoW(&path, None, size, block.as_mut_ptr().cast()) }.ok()?;
    let block = block.as_ptr().cast::<c_void>();
    let translations = query_units(block, "\\VarFileInfo\\Translation", true).unwrap_or_default();
    version_translations(&translations).into_iter().find_map(|(language, codepage)| {
        let query = version_string_query(language, codepage, "FileDescription");
        query_units(block, &query, false)
            .and_then(|units| clean_description(&utf16_until_nul(&units)))
    })
}

/// A `VerQueryValueW` result as UTF-16 units. The length is in bytes for binary values
/// (`length_in_bytes`) and in characters for strings.
fn query_units(block: *const c_void, query: &str, length_in_bytes: bool) -> Option<Vec<u16>> {
    let mut pointer: *mut c_void = std::ptr::null_mut();
    let mut length = 0_u32;
    // SAFETY: `block` is a version-info block from `GetFileVersionInfoW`; the returned pointer
    // points into it and is read before the block is freed.
    let found = unsafe { VerQueryValueW(block, &HSTRING::from(query), &mut pointer, &mut length) };
    if !found.as_bool() || pointer.is_null() || length == 0 {
        return None;
    }
    let units = if length_in_bytes { length as usize / 2 } else { length as usize };
    // SAFETY: Windows guarantees `units` readable, 2-byte aligned UTF-16 units at `pointer`.
    Some(unsafe { std::slice::from_raw_parts(pointer.cast::<u16>(), units) }.to_vec())
}

/// Cached FileDescription per executable path (lower case). Version resources are read from disk,
/// so the 2 s presence and microphone samples reuse earlier results.
pub(crate) fn describe(path: &str) -> Option<String> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    let key = path.to_lowercase();
    if let Some(hit) = cache.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).get(&key) {
        return hit.clone();
    }
    let description = file_description(path);
    let mut entries = cache.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if entries.len() >= 256 {
        entries.clear();
    }
    entries.insert(key, description.clone());
    description
}

/// Identity of an executable: lower-case file name, FileDescription (else the file stem).
pub(crate) fn identity_for_path(path: &str) -> AppIdentity {
    let id = exe_name(path).unwrap_or_else(|| path.to_lowercase());
    let name = describe(path).or_else(|| file_stem(path)).unwrap_or_else(|| id.clone());
    AppIdentity { id, name, path: Some(path.to_string()) }
}
