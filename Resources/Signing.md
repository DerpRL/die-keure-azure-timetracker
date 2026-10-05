# Signing and stable permissions

Releases before 1.14.0 used ad-hoc signatures. Version 1.14.0 uses a persistent local code-signing certificate. With ad-hoc signing the identity changes when the executable changes, so macOS can ask again for Keychain and Calendar access. Keeping only the app name and bundle ID unchanged is insufficient.

For distributed releases, use a **Developer ID Application** certificate and private key from the same Apple Developer team on every build. Keep the bundle ID `be.yarne.azure-timetracker`, the Keychain service `be.yarne.azure-timetracker`, and the installation location `/Applications/Azure timetracker.app` stable. Let codesign generate the normal designated requirement; do not replace it with an identifier-only requirement or loosen Keychain access controls. Do not reset TCC permissions as part of an update.

A switch from the current ad-hoc build to Developer ID can still require one approval/migration. Stable signing is the basis for recognizing later versions as the same application; permission persistence remains subject to macOS policy and user/administrator changes. Notarization addresses distribution trust, not automatic consent to Calendar access.

## Persistent local signing (current release)

The release Mac has a dedicated **Azure timetracker Local Signing** identity in its login Keychain. The normal generated designated requirement binds the bundle identifier to this certificate. The app and updater helper are signed with Hardened Runtime, with no Apple timestamp. The PKG remains an unsigned installer containing a locally signed app. This provides a persistent identity without an Apple Developer subscription; it does **not** provide Developer ID trust or notarization, and it does not guarantee that macOS will preserve every permission.

Use the same certificate and key for subsequent releases. Migrating from the old ad-hoc signature may require approving Keychain, Calendar and Accessibility once for the new identity. Never reset TCC, remove quarantine or loosen Keychain ACLs as part of a build or update.

For an initial setup on a release Mac, run:

```sh
bash scripts/setup-local-signing.sh
```

The script is idempotent. It creates a 10-year certificate with codeSigning usage, imports its key with access limited to `/usr/bin/codesign`, and adds user trust for the **codeSign policy only**. macOS may ask you to authorize Keychain operations. Private backup material and the public identity selector are stored in `~/Library/Application Support/Azure timetracker Releases/local-signing` (folder 700, files 600), outside Git. **Back up that folder securely; do not generate a replacement certificate for an ordinary update.** The shared build configuration automatically selects this identity when the selector exists; a missing imported key makes signing fail.

To use an already imported local identity explicitly, set `AZURE_TIME_SIGN_IDENTITY` and `AZURE_TIME_SIGN_KIND=local`. On another Mac, restore/import the same certificate and key through Keychain before release builds; do not commit or distribute that key with the app. The separate Ed25519 update-feed key must also be preserved. Without an explicit identity or the external local selector, builds fall back to ad-hoc development signing.

## Prepare this Mac

An account holder/admin for the Apple Developer Program can arrange a Developer ID Application identity; an Installer identity is additionally needed to sign a PKG. Import the identity and its private key into Keychain using your organization's normal process. Never send private keys, certificate passwords, Apple passwords or tokens in chat or commit them to Git.

Check available identities:

```sh
security find-identity -v -p codesigning
```

## Build

Set the identity to the certificate name or SHA-1 identifier from that command. This identifier is public; the private key remains in Keychain. Use the same identity/team for subsequent releases.

```sh
export AZURE_TIME_SIGN_IDENTITY='Developer ID Application: YOUR ORGANIZATION (TEAMID)'
# Optional for a signed PKG; omit for an unsigned PKG containing a signed app.
export AZURE_TIME_INSTALLER_IDENTITY='Developer ID Installer: YOUR ORGANIZATION (TEAMID)'
bash scripts/build-installer.sh /path/to/releases
```

The installer builds arm64 and x86_64. `scripts/sign-app.sh` preserves the bundle ID, enables Hardened Runtime, adds Calendar resource access and a secure timestamp, and fails if the requested identity is missing. Explicit Developer ID mode requires a Developer ID Application certificate; local mode requires a persistent certificate signature. Ad-hoc signing is used only when neither an explicit identity nor the local identity selector is present. `scripts/build-app.sh` uses the same signing helper for a native-architecture local app.

After extracting the universal app from the PKG (or using your universal app build output), package it with:

```sh
bash scripts/build-dmg.sh '/path/to/Azure timetracker.app' /path/to/releases
```

The DMG script preserves the app signature, accurately labels its signing status and signs the disk image when `AZURE_TIME_SIGN_IDENTITY` is set. It does not claim notarization.

## Notarize and validate

Use your organization's preconfigured `notarytool` Keychain profile. Submit only a completed Developer ID release to Apple:

```sh
xcrun notarytool submit /path/to/release.dmg --keychain-profile YOUR_PROFILE --wait
# Continue only if the submission status is Accepted.
xcrun stapler staple /path/to/release.dmg
xcrun stapler validate /path/to/release.dmg
spctl --assess --type open --context context:primary-signature --verbose /path/to/release.dmg
```

For PKG distribution, submit and staple the signed PKG instead. Regenerate SHA-256 checksums and any archive that includes the deliverable after stapling changes it. Test the first migration and then an upgrade between two builds from the same Developer ID team, verifying access to the existing Keychain entries and selected calendars. Do not promise that an ad-hoc build will preserve approvals.

Sources: [Apple code signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements), [code signing policies and Keychain](https://developer.apple.com/library/archive/technotes/tn2206/), [Calendar entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.personal-information.calendars), [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

## Update-feed signing (version 1.13.0+)

The in-app updater uses a separate Ed25519 key to authenticate the release JSON and its ZIP hash. This works with an ad-hoc-signed application but does not grant Apple Developer ID trust or promise stable Keychain/Calendar approvals. It does not remove quarantine, reset TCC or weaken Keychain access controls. Keep the private update-signing key outside Git and back it up securely; only the public verification key is compiled into the app. See [release instructions](../releases/README.md).
