# macOS releases

[Latest installers](latest) contain the current universal DMG and PKG, each with a SHA-256 file. Both support Apple Silicon and Intel, macOS 14 or later. Use either installer; you do not need both. In GitHub, select the file and use **Download raw file**.

- DMG: open it and drag Azure timetracker to Applications. A personal `~/Applications` folder is also supported for updates without administrator access.
- PKG: open it and follow the installation steps.
- [Older installers](archive) are grouped by version. macOS Installer may reject downgrades.
- [Update archives](updates) have permanent versioned URLs used by the app. Never remove or overwrite a published update archive.
- [Release notes](notes) describe each update.

Quit the app from its menu bar before a manual upgrade. Settings and Keychain data are outside the app and are preserved. Current installers are **unsigned for distribution and not notarized** (the app has an ad-hoc development signature); macOS permission approvals are still possible. See the [installation guide](../Resources/Installation%20guide.md) and [Developer ID signing](../Resources/Signing.md).

## In-app updates

Manually install **1.13.0 or later** once. The app then checks [updates/latest.json](../updates/latest.json) at startup and every six hours, with a manual check in Settings → App. The update banner offers release notes, Download update and Install and restart. Checking never downloads or installs a release automatically. Restarting leaves the 7pace timer running.

The feed is signed with a separate Ed25519 release key. The app pins its public key and verifies signed release metadata, the ZIP's SHA-256 and size, archive paths, bundle identity/version and code signature. It accepts only a newer version/build, a compatible macOS version and this repository's versioned HTTPS download URLs. A separate bundled helper waits for the app to exit, re-verifies the archive, stages beside the installed app and swaps it with a recoverable backup. Failed replacement or a launch error restores the previous app where possible. This is not a watchdog for crashes after a successful launch.

A protected app directory, disk image, App Translocation or macOS launch restriction can prevent in-app installation. Use the linked DMG/PKG in that case. The updater never asks for root privileges, changes Keychain access rules, resets Calendar permissions or removes quarantine. Successful updates leave a hidden `.AzureTimetracker-previous-….app` beside the current app for manual recovery; after confirming the new version works, that backup and the app's `~/Library/Caches/be.yarne.azure-timetracker/Updates` download cache can be removed manually.

## Publishing the next release

Use the same release-signing key for every version. Its private file belongs **outside this repository**, normally at `~/Library/Application Support/Azure timetracker Releases/update-signing.ed25519`, with mode `600` and parent folder mode `700`. Back it up securely. Losing the key requires a manual-install migration to a new trust key. Only the public verification key in `UpdateTrust.swift` belongs in Git. GitHub SSH deployment keys are separate; neither their public nor private files belong in this repository.

1. Increase version **and** build in `Resources/Info.plist`. Add `releases/notes/<version>.md`, and update installation notes and validation. Never reuse a published version with changed bytes.
2. Run `bash scripts/test.sh`, then `bash scripts/build-installer.sh /path/to/artifacts`. It builds both architectures and the embedded updater. The `AzureTimetrackerRelease` manifest tool is produced alongside the arm64 and x86_64 SwiftPM release executables; use the one matching the build Mac.
3. Expand the PKG with `pkgutil --expand-full /path/to/artifacts/<installer>.pkg /path/to/new-expanded-folder`. Its `AzureTimetracker-component.pkg/Payload/Applications/Azure timetracker.app` is the canonical universal app. Build the DMG using `bash scripts/build-dmg.sh '/path/to/expanded/app' /path/to/artifacts`. Complete Developer ID signing/notarization first if available, then regenerate checksums after stapling.
4. Run `python3 scripts/build-update.py '/path/to/expanded/app' /path/to/artifacts releases/notes/<version>.md /path/to/AzureTimetrackerRelease`. `AZURE_TIME_UPDATE_KEY` can override the external private-key path. It creates a ZIP with only the approved application payload, signs the JSON and writes its checksum. It refuses private keys stored inside the source repository.
5. Run `python3 scripts/verify-release.py /path/to/artifacts /path/to/AzureTimetrackerRelease` to verify the final app/helper, signatures, architectures, payload and matching app bytes in DMG/PKG/ZIP without launching the app. Then run `python3 scripts/stage-release.py /path/to/artifacts /path/to/AzureTimetrackerRelease`. This authenticates the feed/archive, verifies installer checksums, archives the previous latest installers, saves the immutable update ZIP under `releases/updates/<version>/`, and updates `updates/latest.json`.
6. Review the source, notes, installers, update archive and JSON together. Scan for secrets. Commit them together, then `git push origin main` to GitHub. Never publish only the JSON or only the ZIP. Verify the public raw JSON and download after pushing.

The repository includes `scripts/create-update-key.swift` for a **new** trust setup only. Do not rotate the verification key during a normal update. Publishing needs Git write access; no Apple Developer account or GitHub API token is needed for this delivery system. Apple-trusted signing and notarization remain separate.
