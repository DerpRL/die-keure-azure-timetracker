# Releases

Azure timetracker 2.x is published on [GitHub Releases](https://github.com/DerpRL/die-keure-azure-timetracker/releases/latest). Each release has the installers for macOS and Windows, each with a SHA-256 file, plus the files the app uses to update itself.

## macOS

`azure-timetracker-<version>.dmg` runs on Apple Silicon and Intel, macOS 14 or later. Open it and drag Azure timetracker to Applications. A personal `~/Applications` folder also works, and lets updates install without an administrator password.

The app is signed with an Apple Developer ID and notarized by Apple. The first time you open it, macOS asks whether to open an app downloaded from the internet: choose Open.

**From 1.13–1.14.x:** accept the update in the app; no manual install is needed. On first launch, 2.0 imports settings, history, offline drafts and edit history; the 1.14 files stay in place. Because 1.14 was signed with a local certificate and 2.0 with a Developer ID, macOS may ask once to allow Keychain access for your saved credentials (choose Always Allow), and Calendar and Accessibility (Figma) access may need to be granted again in System Settings > Privacy & Security.

## Windows

`azure-timetracker-<version>-x64.exe` is for 64-bit Windows. SmartScreen shows "Windows protected your PC" with an unknown publisher, because the installer has no code-signing certificate: choose More info, then Run anyway. It installs for the current user without administrator rights. Later updates install from inside the app without this prompt.

## Checksums

On macOS run `shasum -a 256 -c <file>.sha256` in the folder with both files. On Windows run `Get-FileHash -Algorithm SHA256 <file>` and compare it with the `.sha256` file. A checksum detects a damaged download; the Developer ID signature (macOS) and the update signature checked by the app prove who published it.

## In-app updates

2.x apps check the `latest.json` of the newest GitHub Release at startup and every minute, with a manual check in Settings > App > App updates. Checking never downloads or installs anything: you choose Download update, then Install and restart. Every update is verified with the release key pinned in the app, including its version. Restarting leaves the 7pace timer running.

On macOS the updater replaces the app in place. If you cannot write to its folder (for example a standard user with the app in `/Applications`), macOS asks for an administrator password; `~/Applications` avoids this.

1.13–1.14.x apps read [updates/latest.json](../updates/latest.json), which offers 2.0.0 once (the bridge release) and then stays frozen.

## Folders

- [Older installers](archive) (1.x) are grouped by version.
- [Update archives](updates) hold the 1.x update ZIPs and the 2.0.0 bridge, with permanent URLs used by 1.x apps. Never remove or overwrite a published file.
- [Release notes](notes) describe each version; the GitHub Release shows the same text.

## Publishing

Follow [docs/release.md](../docs/release.md). Release secrets (the Developer ID certificate, the App Store Connect API key, the 2.x updater key and the 1.x update key) stay outside Git; back them up together.
