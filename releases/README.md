# Releases

[Latest installers](latest) contain the current version for macOS and Windows, each with a SHA-256 file. In GitHub, select the file and use **Download raw file**.

## macOS

`Azure-timetracker-<version>-universal-local-signed.dmg` runs on Apple Silicon and Intel, macOS 14 or later. Open it and drag Azure timetracker to Applications. A personal `~/Applications` folder also works, and lets updates install without an administrator password.

The app is signed with a **persistent local signing certificate** and is **not notarized**, so macOS cannot verify the developer the first time you open it:

- macOS 15 or later: choose Done, open System Settings > Privacy & Security, choose Open Anyway for Azure timetracker, authenticate and confirm.
- macOS 14: Control-click the app, choose Open, then Open.

This is needed once. Managed Macs may forbid it. Do not disable Gatekeeper or remove quarantine.

**From 1.13–1.14.x:** accept the update in the app; no manual install is needed. On first launch, 2.0 imports settings, history, offline drafts and edit history; the 1.14 files stay in place.

## Windows

`Azure-timetracker-<version>-x64-setup.exe` is for 64-bit Windows. SmartScreen shows "Windows protected your PC" with an unknown publisher, because the installer has no code-signing certificate: choose More info, then Run anyway. It installs for the current user without administrator rights. Later updates install from inside the app without this prompt.

## Checksums

On macOS run `shasum -a 256 -c <file>.sha256`. On Windows run `Get-FileHash -Algorithm SHA256 <file>` and compare it with the `.sha256` file. A checksum detects a damaged download; it does not prove who published the file.

## In-app updates

2.x apps check [updates/v2/latest.json](../updates/v2/latest.json) at startup and every minute, with a manual check in Settings > App > App updates. Checking never downloads or installs anything: you choose Download update, then Install and restart. Every update is verified with the release key pinned in the app, including its version. Restarting leaves the 7pace timer running.

On macOS the updater replaces the app in place. If you cannot write to its folder (for example a standard user with the app in `/Applications`), macOS asks for an administrator password; `~/Applications` avoids this.

1.13–1.14.x apps read [updates/latest.json](../updates/latest.json), which offers 2.0.0 once (the bridge release) and then stays frozen.

## Folders

- [Older installers](archive) are grouped by version.
- [Update archives](updates) have permanent versioned URLs used by the apps. Never remove or overwrite a published file.
- [Release notes](notes) describe each version.

## Publishing

Follow [docs/release.md](../docs/release.md). Release secrets (the local signing certificate backup, the 1.x update key and the 2.x updater key) stay outside Git in `~/Library/Application Support/Azure timetracker Releases/`; back them up together.
