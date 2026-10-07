//! Credential Manager (generic credentials).
//!
//! Each account is one `CRED_TYPE_GENERIC` credential with TargetName `<service>:<account>`,
//! UserName `<account>`, the secret as UTF-8 bytes and `CRED_PERSIST_LOCAL_MACHINE` (kept across
//! logons on this PC, never roamed). A secret longer than one blob (2,560 bytes) continues in
//! `<service>:<account>#part2`, `#part3`, … (see [`crate::windows_parse::credential_parts`]).

use std::ffi::c_void;
use std::sync::{Mutex, MutexGuard};

use windows::Win32::Foundation::ERROR_NOT_FOUND;
use windows::Win32::Security::Credentials::{
    CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredDeleteW, CredFree, CredReadW,
    CredWriteW,
};
use windows::core::{HSTRING, PWSTR};

use super::system::{failure, wide};
use crate::windows_parse::{
    CREDENTIAL_BLOB_LIMIT, CREDENTIAL_MAX_PARTS, credential_part_target, credential_parts,
    credential_target, decode_secret,
};
use crate::{Credentials, PlatformError, Result};

/// Serialises Credential Manager calls in this process, across stores: a multi-part secret is
/// several calls, and parallel callers (the tests, each with its own store) once read back
/// nothing right after a successful write on the Windows CI runner.
static LOCK: Mutex<()> = Mutex::new(());

/// Secrets in Windows Credential Manager under one service name.
#[derive(Debug)]
pub struct WindowsCredentials {
    service: String,
}

impl WindowsCredentials {
    /// `service` is [`crate::CREDENTIAL_SERVICE`] in the app; tests use a throwaway name.
    pub fn new(service: impl Into<String>) -> Self {
        Self { service: service.into() }
    }

    pub fn service(&self) -> &str {
        &self.service
    }

    fn guard(&self) -> MutexGuard<'static, ()> {
        LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn part_target(&self, account: &str, part: usize) -> String {
        if part <= 1 {
            credential_target(&self.service, account)
        } else {
            credential_part_target(&self.service, account, part)
        }
    }

    /// Deletes continuation parts from `first` on, stopping at the first missing one.
    fn delete_parts_from(&self, account: &str, first: usize) -> windows::core::Result<()> {
        for part in first.max(2)..=CREDENTIAL_MAX_PARTS {
            if !delete_blob(&self.part_target(account, part))? {
                break;
            }
        }
        Ok(())
    }
}

impl Credentials for WindowsCredentials {
    fn get(&self, account: &str) -> Result<Option<String>> {
        let _guard = self.guard();
        let read = |part: usize| {
            read_blob(&self.part_target(account, part)).map_err(|error| {
                failure("Credential Manager could not read the saved credential", &error)
            })
        };
        let Some(mut secret) = read(1)? else { return Ok(None) };
        let mut last = secret.len();
        let mut part = 2;
        while last == CREDENTIAL_BLOB_LIMIT && part <= CREDENTIAL_MAX_PARTS {
            let Some(next) = read(part)? else { break };
            last = next.len();
            secret.extend_from_slice(&next);
            part += 1;
        }
        decode_secret(&secret).map(Some).ok_or_else(|| {
            PlatformError::Failed(
                "The saved credential could not be read. Save it again in Settings.".to_string(),
            )
        })
    }

    fn set(&self, account: &str, secret: &str) -> Result<()> {
        let _guard = self.guard();
        let parts = credential_parts(secret.as_bytes());
        let Some((first, rest)) = parts.as_deref().and_then(<[&[u8]]>::split_first) else {
            return Err(PlatformError::Failed(
                "This credential is too long to save in Credential Manager.".to_string(),
            ));
        };
        let save = |part: usize, blob: &[u8]| {
            write_blob(&self.part_target(account, part), account, blob).map_err(|error| {
                failure("Credential Manager could not save the credential", &error)
            })
        };
        // Continuation parts first and the credential itself last, so a reader in between still
        // finds a complete older secret in most cases.
        for (index, blob) in rest.iter().enumerate() {
            save(index + 2, blob)?;
        }
        save(1, first)?;
        if let Err(error) = self.delete_parts_from(account, rest.len() + 2) {
            tracing::warn!(%error, "could not remove stale credential parts");
        }
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<()> {
        let _guard = self.guard();
        let context = "Credential Manager could not remove this credential";
        delete_blob(&self.part_target(account, 1)).map_err(|error| failure(context, &error))?;
        self.delete_parts_from(account, 2).map_err(|error| failure(context, &error))
    }
}

fn is_not_found(error: &windows::core::Error) -> bool {
    error.code() == ERROR_NOT_FOUND.to_hresult()
}

/// The blob of a generic credential, `None` when it does not exist.
fn read_blob(target: &str) -> windows::core::Result<Option<Vec<u8>>> {
    let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
    // SAFETY: `credential` is a valid out-pointer; the buffer is released with `CredFree`.
    match unsafe { CredReadW(&HSTRING::from(target), CRED_TYPE_GENERIC, None, &mut credential) } {
        Ok(()) => {}
        Err(error) if is_not_found(&error) => return Ok(None),
        Err(error) => return Err(error),
    }
    if credential.is_null() {
        return Ok(Some(Vec::new()));
    }
    // SAFETY: `CredReadW` succeeded, so `credential` points to a CREDENTIALW whose blob holds
    // `CredentialBlobSize` bytes until `CredFree`.
    let blob = unsafe {
        let record = &*credential;
        let blob = if record.CredentialBlob.is_null() || record.CredentialBlobSize == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(record.CredentialBlob, record.CredentialBlobSize as usize)
                .to_vec()
        };
        CredFree(credential.cast::<c_void>());
        blob
    };
    Ok(Some(blob))
}

fn write_blob(target: &str, account: &str, blob: &[u8]) -> windows::core::Result<()> {
    let mut target = wide(target);
    let mut user = wide(account);
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_mut_ptr()),
        CredentialBlobSize: blob.len() as u32,
        // CredWriteW only reads the blob.
        CredentialBlob: if blob.is_empty() {
            std::ptr::null_mut()
        } else {
            blob.as_ptr().cast_mut()
        },
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: PWSTR(user.as_mut_ptr()),
        ..Default::default()
    };
    // SAFETY: every pointer in `credential` outlives the call.
    unsafe { CredWriteW(&credential, 0) }
}

/// Deletes a generic credential. `Ok(false)` when it did not exist.
fn delete_blob(target: &str) -> windows::core::Result<bool> {
    // SAFETY: plain call with a NUL-terminated target name.
    match unsafe { CredDeleteW(&HSTRING::from(target), CRED_TYPE_GENERIC, None) } {
        Ok(()) => Ok(true),
        Err(error) if is_not_found(&error) => Ok(false),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    //! Run on Windows: `cargo test -p att-platform`. Each test uses its own throwaway service.

    use super::*;

    fn store(test: &str) -> WindowsCredentials {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        WindowsCredentials::new(format!("be.yarne.azure-timetracker.test.{test}.{unique}"))
    }

    #[test]
    fn round_trip_get_set_delete() {
        let credentials = store("round-trip");
        let account = "azure:contoso";
        assert_eq!(credentials.get(account), Ok(None));
        credentials.set(account, "first-pat").unwrap();
        assert_eq!(credentials.get(account), Ok(Some("first-pat".to_string())));
        credentials.set(account, "second-pat").unwrap();
        assert_eq!(credentials.get(account), Ok(Some("second-pat".to_string())));
        credentials.delete(account).unwrap();
        assert_eq!(credentials.get(account), Ok(None));
        assert_eq!(credentials.delete(account), Ok(()), "deleting a missing item is fine");
    }

    #[test]
    fn long_secrets_use_continuation_parts() {
        let credentials = store("long");
        let account = "7pace-oauth:contoso.timehub.7pace.com";
        let long: String = (0..6_000).map(|index| char::from(b'a' + (index % 26) as u8)).collect();
        credentials.set(account, &long).unwrap();
        assert_eq!(credentials.get(account), Ok(Some(long)));
        // Exactly one full blob, then shorter: stale parts must not be appended.
        let full = "x".repeat(CREDENTIAL_BLOB_LIMIT);
        credentials.set(account, &full).unwrap();
        assert_eq!(credentials.get(account), Ok(Some(full)));
        let part2 = {
            let _lock = credentials.guard();
            read_blob(&credentials.part_target(account, 2))
        };
        assert_eq!(part2, Ok(None));
        credentials.set(account, "short").unwrap();
        assert_eq!(credentials.get(account), Ok(Some("short".to_string())));
        credentials.delete(account).unwrap();
        assert_eq!(credentials.get(account), Ok(None));
        let too_long = "x".repeat(CREDENTIAL_BLOB_LIMIT * CREDENTIAL_MAX_PARTS + 1);
        assert!(credentials.set(account, &too_long).is_err());
    }

    #[test]
    fn reads_credentials_typed_into_credential_manager() {
        let credentials = store("utf16");
        let account = "azure:fabrikam";
        let utf16: Vec<u8> = "typed-pat".encode_utf16().flat_map(u16::to_le_bytes).collect();
        {
            let _lock = credentials.guard();
            write_blob(&credentials.part_target(account, 1), account, &utf16).unwrap();
        }
        assert_eq!(credentials.get(account), Ok(Some("typed-pat".to_string())));
        credentials.delete(account).unwrap();
    }

    #[test]
    fn target_name_and_user_name_follow_the_contract() {
        let credentials = WindowsCredentials::new(crate::CREDENTIAL_SERVICE);
        assert_eq!(
            credentials.part_target("azure:contoso", 1),
            "be.yarne.azure-timetracker:azure:contoso"
        );
        assert_eq!(
            credentials.part_target("azure:contoso", 2),
            "be.yarne.azure-timetracker:azure:contoso#part2"
        );
    }
}
