//! Read-only registry access.

use std::ffi::c_void;

use windows::Win32::Foundation::{
    ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS, ERROR_PATH_NOT_FOUND,
    ERROR_SUCCESS, WIN32_ERROR,
};
use windows::Win32::System::Registry::{
    HKEY, KEY_READ, RRF_RT_REG_QWORD, RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW,
};
use windows::core::{HSTRING, PWSTR};

/// An open registry key, closed on drop.
pub(crate) struct RegKey(HKEY);

impl RegKey {
    /// Opens `parent\path` for reading. `Ok(None)` when the key does not exist.
    pub(crate) fn open(parent: HKEY, path: &str) -> Result<Option<Self>, WIN32_ERROR> {
        let mut key = HKEY::default();
        // SAFETY: `key` is a valid out-pointer; the handle is closed in `Drop`.
        let status =
            unsafe { RegOpenKeyExW(parent, &HSTRING::from(path), None, KEY_READ, &mut key) };
        match status {
            ERROR_SUCCESS => Ok(Some(Self(key))),
            ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => Ok(None),
            error => Err(error),
        }
    }

    pub(crate) fn subkey(&self, path: &str) -> Result<Option<Self>, WIN32_ERROR> {
        Self::open(self.0, path)
    }

    /// Names of the direct subkeys. Names longer than the registry limit (255) are skipped.
    pub(crate) fn subkey_names(&self) -> Result<Vec<String>, WIN32_ERROR> {
        let mut names = Vec::new();
        let mut buffer = [0_u16; 512];
        for index in 0.. {
            let mut length = buffer.len() as u32;
            // SAFETY: `buffer` holds `length` UTF-16 units; the optional out-params are null.
            let status = unsafe {
                RegEnumKeyExW(
                    self.0,
                    index,
                    Some(PWSTR(buffer.as_mut_ptr())),
                    &mut length,
                    None,
                    None,
                    None,
                    None,
                )
            };
            match status {
                ERROR_SUCCESS => {
                    let length = (length as usize).min(buffer.len());
                    names.push(String::from_utf16_lossy(&buffer[..length]));
                }
                ERROR_MORE_DATA => {}
                ERROR_NO_MORE_ITEMS => break,
                error => return Err(error),
            }
        }
        Ok(names)
    }

    /// A `REG_QWORD` value of a subkey, `None` when it is missing or has another type.
    pub(crate) fn qword(&self, subkey: &str, value: &str) -> Option<u64> {
        let mut data = 0_u64;
        let mut size = size_of::<u64>() as u32;
        // SAFETY: `data` is 8 writable bytes, as `size` says.
        let status = unsafe {
            RegGetValueW(
                self.0,
                &HSTRING::from(subkey),
                &HSTRING::from(value),
                RRF_RT_REG_QWORD,
                None,
                Some((&raw mut data).cast::<c_void>()),
                Some(&mut size),
            )
        };
        (status == ERROR_SUCCESS && size as usize == size_of::<u64>()).then_some(data)
    }
}

impl Drop for RegKey {
    fn drop(&mut self) {
        // SAFETY: the key was opened by `RegOpenKeyExW` and is closed once.
        let _ = unsafe { RegCloseKey(self.0) };
    }
}

/// Whether `parent\path` exists and can be read.
pub(crate) fn key_exists(parent: HKEY, path: &str) -> bool {
    matches!(RegKey::open(parent, path), Ok(Some(_)))
}
