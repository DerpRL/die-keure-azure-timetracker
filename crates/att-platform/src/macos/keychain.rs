//! Keychain generic passwords, attribute for attribute the same as `SecretStore` in
//! `Sources/AzureTimetracker/LocalServices.swift` (1.14.x):
//!
//! - every query is `{kSecClass: kSecClassGenericPassword, kSecAttrService: service,
//!   kSecAttrAccount: account}`, in the file-based login keychain (no
//!   `kSecUseDataProtectionKeychain`, no label, access group or synchronizable flag);
//! - reads add `kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne`;
//! - saves try `SecItemUpdate` with `{kSecValueData}` first and only on `errSecItemNotFound` add the
//!   item with `kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, so existing
//!   items are updated in place and never duplicated;
//! - deleting a missing item succeeds.
//!
//! Items written by 1.14.x are therefore read without migration and 1.14.x can read ours. The
//! Keychain ACL still ties each item to the code signature that created it; see
//! `docs/port/platform-macos.md`.
//!
//! The raw `SecItem*` calls come from `objc2-security`, so the dictionaries are built exactly
//! like the Swift ones. The `keyring` crate's Apple store and `security-framework`'s password
//! helpers were rejected: they add first and update on duplicates, and do not let the caller
//! choose `kSecAttrAccessible`.

use std::ptr;

use objc2_core_foundation::{CFBoolean, CFData, CFDictionary, CFRetained, CFString, CFType, Type};
use objc2_security::{
    SecItemAdd, SecItemCopyMatching, SecItemDelete, SecItemUpdate, errSecItemNotFound,
    errSecSuccess, kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    kSecAttrAccount, kSecAttrService, kSecClass, kSecClassGenericPassword, kSecMatchLimit,
    kSecMatchLimitOne, kSecReturnData, kSecValueData,
};

use crate::{CREDENTIAL_SERVICE, Credentials, PlatformError, Result};

/// Keychain-backed [`Credentials`] for one service name.
#[derive(Debug, Clone)]
pub struct KeychainCredentials {
    service: String,
}

impl KeychainCredentials {
    /// Credentials stored under `service`. Production code uses [`KeychainCredentials::default`]
    /// ([`CREDENTIAL_SERVICE`]); tests pass a throwaway name.
    pub fn new(service: impl Into<String>) -> Self {
        Self { service: service.into() }
    }

    pub fn service(&self) -> &str {
        &self.service
    }

    /// `{kSecClass, kSecAttrService, kSecAttrAccount}`.
    fn query(&self, account: &str) -> Attributes {
        let mut query = Attributes::default();
        // SAFETY: the `kSec*` statics are immutable CFStrings exported by Security.framework.
        unsafe {
            query.set(kSecClass, kSecClassGenericPassword);
            query.set(kSecAttrService, &CFString::from_str(&self.service));
            query.set(kSecAttrAccount, &CFString::from_str(account));
        }
        query
    }
}

impl Default for KeychainCredentials {
    fn default() -> Self {
        Self::new(CREDENTIAL_SERVICE)
    }
}

impl Credentials for KeychainCredentials {
    fn get(&self, account: &str) -> Result<Option<String>> {
        let mut query = self.query(account);
        // SAFETY: immutable Security.framework constants.
        unsafe {
            query.set(kSecReturnData, CFBoolean::new(true));
            query.set(kSecMatchLimit, kSecMatchLimitOne);
        }
        let mut item: *const CFType = ptr::null();
        // SAFETY: `query` is a valid dictionary and `item` a valid out-pointer; on success the
        // result is returned at +1 and adopted below.
        let status = unsafe { SecItemCopyMatching(&query.build(), &mut item) };
        let item =
            ptr::NonNull::new(item.cast_mut()).map(|item| unsafe { CFRetained::from_raw(item) });
        if status == errSecItemNotFound {
            return Ok(None);
        }
        let data = item.and_then(|item| item.downcast::<CFData>().ok());
        match data {
            // Swift `String(data:encoding: .utf8)`: bytes that are not UTF-8 read as no secret.
            Some(data) if status == errSecSuccess => Ok(String::from_utf8(data.to_vec()).ok()),
            _ => Err(PlatformError::Failed(format!(
                "Keychain could not read the saved credential ({status})."
            ))),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<()> {
        let query = self.query(account);
        let value = CFData::from_bytes(secret.as_bytes());
        let mut attributes = Attributes::default();
        // SAFETY: immutable Security.framework constant.
        unsafe { attributes.set(kSecValueData, &value) };
        // SAFETY: both dictionaries are valid CFDictionaries of CFString keys.
        let mut status = unsafe { SecItemUpdate(&query.build(), &attributes.build()) };
        if status == errSecItemNotFound {
            let mut add = query;
            // SAFETY: immutable Security.framework constants.
            unsafe {
                add.set(kSecValueData, &value);
                add.set(kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly);
            }
            // SAFETY: valid dictionary; no result is requested.
            status = unsafe { SecItemAdd(&add.build(), ptr::null_mut()) };
        }
        if status == errSecSuccess {
            Ok(())
        } else {
            Err(PlatformError::Failed(format!(
                "Keychain could not save the credential ({status})."
            )))
        }
    }

    fn delete(&self, account: &str) -> Result<()> {
        // SAFETY: valid dictionary.
        let status = unsafe { SecItemDelete(&self.query(account).build()) };
        if status == errSecSuccess || status == errSecItemNotFound {
            Ok(())
        } else {
            Err(PlatformError::Failed(format!(
                "Keychain could not remove this credential ({status})."
            )))
        }
    }
}

/// An ordered list of Keychain attributes, turned into a `CFDictionary` per call.
#[derive(Default)]
struct Attributes {
    keys: Vec<CFRetained<CFString>>,
    values: Vec<CFRetained<CFType>>,
}

impl Attributes {
    fn set(&mut self, key: &CFString, value: &impl AsRef<CFType>) {
        let value: &CFType = value.as_ref();
        if let Some(index) = self.keys.iter().position(|existing| **existing == *key) {
            self.values[index] = value.retain();
        } else {
            self.keys.push(key.retain());
            self.values.push(value.retain());
        }
    }

    fn build(&self) -> CFRetained<CFDictionary> {
        let keys: Vec<&CFString> = self.keys.iter().map(|key| &**key).collect();
        let values: Vec<&CFType> = self.values.iter().map(|value| &**value).collect();
        let dictionary = CFDictionary::<CFString, CFType>::from_slices(&keys, &values);
        // SAFETY: a typed dictionary is layout-identical to the untyped one Security expects.
        unsafe { CFRetained::cast_unchecked(dictionary) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::macos::test_support::random_suffix;
    use objc2_security::{kSecMatchLimitAll, kSecReturnAttributes};

    /// Removes every item of the throwaway service, even when an assertion fails.
    struct Cleanup<'a>(&'a KeychainCredentials, &'a [&'a str]);

    impl Drop for Cleanup<'_> {
        fn drop(&mut self) {
            for account in self.1 {
                let _ = self.0.delete(account);
            }
        }
    }

    /// The attribute names and string values of every item for `account` (`kSecMatchLimitAll`).
    fn items(store: &KeychainCredentials, account: &str) -> Vec<Vec<(String, String)>> {
        use objc2_core_foundation::CFArray;
        let mut query = store.query(account);
        unsafe {
            query.set(kSecReturnAttributes, CFBoolean::new(true));
            query.set(kSecMatchLimit, kSecMatchLimitAll);
        }
        let mut item: *const CFType = ptr::null();
        let status = unsafe { SecItemCopyMatching(&query.build(), &mut item) };
        if status == errSecItemNotFound {
            return Vec::new();
        }
        assert_eq!(status, errSecSuccess, "attribute query");
        let item =
            unsafe { CFRetained::from_raw(ptr::NonNull::new(item.cast_mut()).expect("result")) };
        let array = item.downcast::<CFArray>().expect("kSecMatchLimitAll returns an array");
        let array: CFRetained<CFArray<CFDictionary<CFString, CFType>>> =
            unsafe { CFRetained::cast_unchecked(array) };
        array
            .to_vec()
            .iter()
            .map(|attributes| {
                let (keys, values) = attributes.to_vecs();
                let mut pairs: Vec<(String, String)> = keys
                    .iter()
                    .zip(values.iter())
                    .map(|(key, value)| {
                        let text = value
                            .downcast_ref::<CFString>()
                            .map(|text| text.to_string())
                            .unwrap_or_else(|| "<non-string>".into());
                        (key.to_string(), text)
                    })
                    .collect();
                pairs.sort();
                pairs
            })
            .collect()
    }

    #[test]
    fn items_carry_exactly_the_attributes_1_14_writes() {
        let service = format!("{CREDENTIAL_SERVICE}.tests.{}", random_suffix());
        let store = KeychainCredentials::new(service.clone());
        let account = "azure:example-org";
        let _cleanup = Cleanup(&store, &[account]);

        store.set(account, "secret").expect("add");
        store.set(account, "updated").expect("update");
        // Printed for an item written by the 1.14.x `SecretStore` code (Swift 6.4, macOS 27):
        // class genp, label = service, plus service, account and the two dates. The file-based
        // keychain does not store `kSecAttrAccessible`.
        let items = items(&store, account);
        assert_eq!(items.len(), 1, "one item, updated in place");
        let names: Vec<&str> = items[0].iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, ["acct", "cdat", "class", "labl", "mdat", "svce"]);
        let value = |name: &str| {
            items[0].iter().find(|(key, _)| key == name).map(|(_, value)| value.clone())
        };
        assert_eq!(value("class").as_deref(), Some("genp"));
        assert_eq!(value("labl").as_deref(), Some(service.as_str()));
        assert_eq!(value("svce").as_deref(), Some(service.as_str()));
        assert_eq!(value("acct").as_deref(), Some(account));
    }

    /// Number of items for `account`, to prove updates never duplicate.
    fn count(store: &KeychainCredentials, account: &str) -> usize {
        items(store, account).len()
    }

    #[test]
    fn keychain_round_trip_with_throwaway_service() {
        let service = format!("{CREDENTIAL_SERVICE}.tests.{}", random_suffix());
        assert_ne!(service, CREDENTIAL_SERVICE);
        let store = KeychainCredentials::new(service);
        let accounts = ["7pace:example.timehub.7pace.com", "azure:example-org", "7pace-oauth:x"];
        let _cleanup = Cleanup(&store, &accounts);

        assert_eq!(
            store.get(accounts[0]).expect("read missing"),
            None,
            "missing item reads as None"
        );
        store.delete(accounts[0]).expect("deleting a missing item is not an error");

        store.set(accounts[0], "first-secret").expect("add");
        assert_eq!(store.get(accounts[0]).expect("read").as_deref(), Some("first-secret"));

        store.set(accounts[0], "second secret · ✓").expect("update");
        assert_eq!(
            store.get(accounts[0]).expect("read updated").as_deref(),
            Some("second secret · ✓")
        );
        assert_eq!(count(&store, accounts[0]), 1, "update must not add a duplicate item");

        store.set(accounts[1], "{\"token\":\"json\"}").expect("second account");
        assert_eq!(
            store.get(accounts[1]).expect("read second").as_deref(),
            Some("{\"token\":\"json\"}")
        );
        assert_eq!(
            store.get(accounts[0]).expect("first unchanged").as_deref(),
            Some("second secret · ✓")
        );
        assert_eq!(store.get(accounts[2]).expect("other account"), None);

        store.delete(accounts[0]).expect("delete");
        assert_eq!(store.get(accounts[0]).expect("read deleted"), None);
        assert_eq!(count(&store, accounts[0]), 0);
        store.delete(accounts[0]).expect("second delete is not an error");
        store.delete(accounts[1]).expect("delete second");
        assert_eq!(store.get(accounts[1]).expect("read second deleted"), None);
    }

    #[test]
    fn production_service_is_the_1_14_service() {
        assert_eq!(KeychainCredentials::default().service(), "be.yarne.azure-timetracker");
    }
}
