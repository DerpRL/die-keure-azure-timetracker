# macOS installers

[Latest installers](latest) contain the current universal DMG and PKG, each with a SHA-256 file. Both support Apple Silicon and Intel, macOS 14 or later. Use either installer; you do not need both.

- DMG: open it and drag Azure timetracker to Applications.
- PKG: open it and follow the installation steps.
- [Older releases](archive) are grouped by version for reference. macOS Installer may reject downgrades.

Quit the app from its menu bar before upgrading. Settings and Keychain data are stored outside the app and are preserved. Current installers are **unsigned for distribution and not notarized** (the app has an ad-hoc development signature); repeated macOS permission approvals are still possible. See [installation guide](../Resources/Installation%20guide.md) and [Developer ID signing](../Resources/Signing.md).

## Publishing the next release

1. Update the app version/build in Resources/Info.plist and About, and update the release notes and validation.
2. Build the universal PKG with scripts/build-installer.sh and the DMG with scripts/build-dmg.sh. Complete signing/notarization first if available; regenerate checksums after stapling.
3. Run `python3 scripts/stage-release.py /path/to/installers`. It verifies checksums, moves the previous latest installers into archive/<version>, then stages the new DMG/PKG in latest. It rejects changed binaries for an already published version.
4. Review and commit the source and releases folder, then push main to Azure Repos.

Download the binary file from Azure Repos rather than copying its preview. Verify with `shasum -a 256 -c <filename>.sha256` from the download folder.
