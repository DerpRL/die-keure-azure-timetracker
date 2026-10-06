# Releasing Azure timetracker 2.x

`att-release` (`tools/release`) replaces the 1.x release scripts (`scripts/build-installer.sh`,
`build-dmg.sh`, `sign-app.sh`, `build-update.py`, `verify-release.py`, `stage-release.py`). Run it
from the repository root on the release Mac (and once per release on a Windows machine):

```sh
cargo run -p att-release -- --help
```

Every subcommand prints what it does and each external command before it runs it. Progress goes to
stderr; stdout carries only results (the app path, the public key, the legacy signing command), so
`APP="$(cargo run -q -p att-release -- build-macos)"` works. The tool never pushes, never opens the
legacy Ed25519 key and never changes the Keychain.

## Decisions

Taken with the rewrite plan (§11, §14, §15). Items marked *tool* were decided while building it.

| Topic | Decision |
|---|---|
| Apple trust | No Developer Program, no notarization. Apps are signed with the persistent **Azure timetracker Local Signing** certificate that signed 1.14.x, with Hardened Runtime, the calendar entitlement and `--timestamp=none`. The designated requirement therefore stays `identifier "be.yarne.azure-timetracker" and certificate leaf = H"462d332ac6e7fa9bf8854efae82c5c4c6478766a"` (read from the published 1.14.2 app). Gatekeeper asks once on first install. |
| Windows trust | No Authenticode certificate. SmartScreen asks once on first install. In-app updates are downloaded by the app (no Mark of the Web) and install per user without admin rights. |
| Hosting | No GitHub Releases. Installers, update assets and both feeds are committed and served from `raw.githubusercontent.com`. |
| Updates | Tauri updater plugin with a new minisign key pair (v2). Feed: `updates/v2/latest.json`. Every signature binds the release version (`version:<v>` in the trusted comment, as `tauri build` / `tauri signer sign --app-version` write it). |
| 1.x users | One bridge release (2.0.0) through the legacy feed `updates/latest.json`, signed by the existing Swift `AzureTimetrackerRelease` with the existing Ed25519 key. Only `stage --bridge` writes the legacy feed; afterwards it stays frozen. |
| Formats *tool* | `minisign` 0.9 and `minisign-verify` 0.2, the versions inside the Tauri CLI 2.12 and `tauri-plugin-updater` 2.13. Interoperability with `tauri signer` is tested in both directions (`tests/tauri_interop.rs`). Key files hold base64 of the minisign boxes, exactly like `tauri signer generate`. |
| PKG *tool* | Not built for 2.x: one DMG per release (the 1.14.2 PKG moves to `releases/archive/1.14.2/`). |
| Signing kind *tool* | `AZURE_TIME_SIGN_KIND` defaults to `local` (1.x defaulted to `developer-id`). `developer-id` adds a secure timestamp and the Developer ID checks, should a certificate ever exist. |
| Windows signing *tool* | `sign-update` lets the Windows installer be signed on the release Mac, so the v2 key never leaves it. |
| Bridge naming *tool* | The signed legacy manifest is `legacy-latest.json` in the artifact folder; `latest.json` there is the v2 feed. |
| Helper stub *tool* | Compiled with `rustc` per architecture (it has no dependencies) and joined with `lipo`; about 0.6 MB universal. It prints that it only exists for 1.x updates and exits 1. |
| Bundle rules *tool* | No symbolic links, ASCII file names, at most 4096 files (1.x validator limits). The same rules apply to the Tauri archive, so the app bytes in the DMG, the `.app.tar.gz` and the bridge ZIP are identical and checked to be. |
| Exit test *tool* | `bridge-dry-run` replays the 1.x helper with the unmodified 1.14.x client code, because 1.x apps can only read the production feed. |

## Files

Artifact folder (outside the repository, for example `~/Releases/2.0.0`):

| File | Made by | Published to |
|---|---|---|
| `Azure-timetracker-<v>-universal-local-signed.dmg` + `.sha256` | `package-macos` | `releases/latest/` |
| `Azure-timetracker-<v>-universal.app.tar.gz` + `.sha256` + `.sig` | `package-macos` | `releases/updates/<v>/` |
| `Azure-timetracker-<v>-x64-setup.exe` + `.sha256` + `.sig` | `build-windows`, `sign-update` | `releases/latest/` and `releases/updates/<v>/` (Git stores the bytes once) |
| `latest.json` | `feed` | `updates/v2/latest.json` |
| `Azure-timetracker-<v>-universal-update.zip` + `.sha256` (bridge) | `bridge` | `releases/updates/<v>/` |
| `legacy-latest.json` (bridge) | `AzureTimetrackerRelease`, run by the release owner | `updates/latest.json` |

`stage` moves older installers from `releases/latest/` to `releases/archive/<version>/`. Files in
`releases/updates/<version>/` are permanent URLs and are never overwritten with different bytes.
Every published URL is `https://raw.githubusercontent.com/DerpRL/die-keure-azure-timetracker/main/releases/updates/<v>/<file>`.

Release secrets stay outside Git in `~/Library/Application Support/Azure timetracker Releases/`
(folder 700, files 600). Back them up together:

- `local-signing/`: the local certificate backup and `identity.txt` (its public SHA-1 selector).
- `update-signing.ed25519`: the legacy key. Only the Swift signer opens it; `att-release` prints its path.
- `updater-v2.key` and `updater-v2.key.pub`: the v2 updater key pair. Without the private key, installed
  2.x apps cannot be updated any more and everyone has to reinstall manually.

## Shell configuration

`apps/desktop/src-tauri/tauri.conf.json` must contain at least the following. `build-macos` and
`build-windows` check it and refuse to build when something marked required is wrong.

```json
{
  "productName": "Azure timetracker",
  "mainBinaryName": "AzureTimetracker",
  "version": "2.0.0",
  "identifier": "be.yarne.azure-timetracker",
  "bundle": {
    "active": true,
    "targets": ["app", "dmg", "nsis"],
    "createUpdaterArtifacts": false,
    "macOS": {
      "bundleVersion": "25",
      "minimumSystemVersion": "14.0",
      "signingIdentity": null,
      "frameworks": []
    },
    "windows": { "nsis": { "installMode": "currentUser" } }
  },
  "plugins": {
    "updater": {
      "endpoints": ["https://raw.githubusercontent.com/DerpRL/die-keure-azure-timetracker/main/updates/v2/latest.json"],
      "pubkey": "<the line printed by keygen-v2>",
      "requireSignedVersion": true,
      "windows": { "installMode": "passive" }
    }
  }
}
```

Required:

- `productName`, `mainBinaryName`, `identifier`: the bundle must be `Azure timetracker.app` with
  executable `AzureTimetracker` and bundle ID `be.yarne.azure-timetracker`, or the 1.x validator
  refuses the bridge and Keychain items and permissions no longer match.
- `version`: plain `major.minor.patch` (the 1.x validator accepts nothing else).
- `bundle.macOS.bundleVersion`: an integer build number, raised with every release (1.14.2 was 24,
  so 2.0.0 is 25). It becomes `CFBundleVersion`; without it Tauri writes `2.0.0`, which 1.x clients
  reject.
- `bundle.macOS.signingIdentity: null` and `bundle.createUpdaterArtifacts: false`: Tauri neither
  signs nor archives. `sign-macos` adds the helper stub and signs; `package-macos` archives and signs
  the final bytes. `build-macos` also passes `--no-sign` (Tauri CLI 2.5+) and removes `APPLE_*` and
  `TAURI_SIGNING_*` from the build environment.
- `plugins.updater.endpoints` and `pubkey`: exactly the v2 feed URL, and the public key from
  `keygen-v2`. `package-macos`, `sign-update` and `build-windows` refuse to sign with any other key.

Recommended (warnings):

- `bundle.macOS.minimumSystemVersion: "14.0"`, as 1.14.x. A higher value strands 1.14.x users on
  older macOS during the bridge.
- `plugins.updater.requireSignedVersion: true` (plugin 2.13+): rejects an update whose signature
  names another version than the feed, which blocks replaying an older signed archive.
- `bundle.windows.nsis.installMode: "currentUser"` (Tauri's default) and the updater's
  `"passive"` mode: per-user installs update without admin rights and show only a progress bar.
- `src-tauri/Info.plist`, merged by Tauri: `LSUIElement` = true (menu-bar app),
  `NSCalendarsFullAccessUsageDescription` and `NSCalendarsUsageDescription` (copy the 1.14.x texts
  from `Resources/Info.plist`). `verify` warns when they are missing.
- Bundle contents: no frameworks or other symbolic links (refused by the 1.x validator; bundled
  dylibs would also fail library validation under Hardened Runtime without a Team ID), ASCII file
  names, and nothing configured at `Contents/Helpers/AzureTimetrackerUpdater`.
- `bundle.macOS.entitlements` is not used for releases: `sign-macos` applies
  `tools/release/assets/App.entitlements` (calendar only, as 1.14.x). Pass `--entitlements` if the
  shell ever needs more.

## One-time setup on the release Mac

1. Keep the 1.14.x local signing certificate in the login Keychain (`bash scripts/setup-local-signing.sh`
   is idempotent; on a new Mac restore the backup folder first). Never create a new certificate for a
   release: a new certificate changes the designated requirement.
2. Install Rust (rustup), Node/npm and the Swift command line tools (Xcode is not needed).
   `build-macos` and `sign-macos` add the `aarch64-apple-darwin` and `x86_64-apple-darwin` targets.
3. Create the v2 updater key once:

   ```sh
   cargo run -p att-release -- keygen-v2
   ```

   It writes `updater-v2.key` (mode 600) and `.pub`, refuses paths inside a Git work tree, and prints
   only the public key. Put that line in `plugins.updater.pubkey` and commit it. Back up both files.
   Running it again prints the same key; it never overwrites. The key has no password unless
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is set, for `keygen-v2` and for every signing step.

## Normal release (macOS and Windows)

Before: raise `version` and `bundle.macOS.bundleVersion` (and the versions the shell keeps in
`Cargo.toml`/`package.json`), and write `releases/notes/<v>.md`.

On the release Mac:

```sh
V=2.0.1
OUT="$HOME/Releases/$V"
KEY="$HOME/Library/Application Support/Azure timetracker Releases/updater-v2.key"
APP="$(cargo run -q -p att-release -- build-macos)"
cargo run -p att-release -- sign-macos "$APP"
cargo run -p att-release -- package-macos "$APP" "$OUT" --key "$KEY"
```

On a Windows machine, same commit:

```powershell
cargo run -p att-release -- build-windows --out C:\Releases\2.0.1
```

Without a key it stops after the installer and its `.sha256` and prints the `sign-update` command.
Copy `Azure-timetracker-<v>-x64-setup.exe` and its `.sha256` into `$OUT` on the Mac, then:

```sh
cargo run -p att-release -- sign-update "$OUT/Azure-timetracker-$V-x64-setup.exe" --version $V --key "$KEY"
cargo run -p att-release -- feed --version $V --notes releases/notes/$V.md \
    --mac-archive "$OUT/Azure-timetracker-$V-universal.app.tar.gz" \
    --windows-installer "$OUT/Azure-timetracker-$V-x64-setup.exe"
cargo run -p att-release -- verify "$OUT"
cargo run -p att-release -- stage $V --from "$OUT"
```

Review `releases/latest`, `releases/archive/<previous>`, `releases/updates/<v>` and
`updates/v2/latest.json`, scan for secrets, commit everything in one commit and push. Then fetch the
raw feed and one asset URL. `raw.githubusercontent.com` caches for about five minutes. Always
publish both platforms in one feed: a feed without `windows-x86_64` makes update checks on Windows
fail with "target not found".

`stage` is idempotent for identical bytes and refuses different bytes for a version it already
staged. To redo a staging that was not pushed yet, discard it with Git first
(`git restore releases updates && git clean -fd releases updates`, which removes only the untracked
files `stage` added), then stage again. `feed` writes a new `pub_date` on every run; pass
`--pub-date` to reproduce a feed.

## Bridge release (2.0.0 only)

Run the normal macOS steps up to `package-macos`, then:

```sh
cargo run -p att-release -- bridge "$APP" "$OUT" --notes releases/notes/2.0.0.md
```

`bridge` checks the signed app, writes `Azure-timetracker-2.0.0-universal-update.zip` the way
`build-update.py` did (entries under `Azure timetracker.app/`, sorted, mode 755/644, deflate level
9, fixed 2026-01-01 timestamps, but without the five-file allowlist), and runs the Rust port of the
client checks from `AppUpdates.swift` and `UpdateInstallation.swift`: ZIP structure and limits,
required entries, `ditto` extraction, no symbolic links, `Info.plist` identity, executable and
helper, integer build, minimum macOS, `codesign --verify --deep --strict`, byte-identical to the
app, manifest field rules, and newer than the published 1.14.2 (build 24). It builds
`AzureTimetrackerRelease` with SwiftPM and prints the signing command. Run that command yourself; it
reads the legacy key:

```sh
.build-att-release/swift/package/release/AzureTimetrackerRelease "$APP" \
    "$OUT/Azure-timetracker-2.0.0-universal-update.zip" \
    "$HOME/Library/Application Support/Azure timetracker Releases/update-signing.ed25519" \
    releases/notes/2.0.0.md "$OUT/legacy-latest.json"
```

The Swift tool refuses a key that does not match the public key pinned in 1.13–1.14.x, extracts and
verifies the ZIP and the app with the client code, then signs. Keep the notes to plain text: control
characters other than tab and newline are refused, because signer and clients must encode the notes
identically.

Exit test, on a test Mac or a copy of an installed 1.14.2:

```sh
cargo run -p att-release -- bridge-dry-run "$OUT/Azure-timetracker-2.0.0-universal-update.zip" "$APP" \
    --installed "/Applications/Azure timetracker.app"
```

It compiles the unmodified `Sources/AzureTimetrackerCore` with a small driver and does what the 1.x
helper does: validate the release, check it is newer and supported, verify the archive, extract,
verify the bundle and signature, and replace the installed app, keeping
`.AzureTimetracker-previous-*.app`. Only the manifest signature (checked by `verify` and the Swift
tool) and the relaunch are skipped. Then open the app and confirm that saved credentials load
without a Keychain prompt and that Calendar and Accessibility (Figma) still work.

Then, with the Windows installer signed and `feed` written:

```sh
cargo run -p att-release -- verify "$OUT" \
    --reference releases/updates/1.14.2/Azure-timetracker-1.14.2-universal-update.zip
cargo run -p att-release -- stage 2.0.0 --from "$OUT" --bridge
```

`stage --bridge` also runs `AzureTimetrackerRelease verify`, requires the designated requirement of
the published 1.14.2 app, and writes `updates/latest.json`. Push the assets and both feeds in one
commit. 1.x clients check every minute and show the update; users choose Download update and
Install and restart, the 1.x helper swaps the app in place and opens 2.0. Later releases never pass
`--bridge`; it is only needed to replace the bridge for 1.x users who have not updated yet, and the
replacement must be newer.

## What `verify` checks

- `.sha256` of every installer and archive; `.sig` of both update assets against the v2 public key
  (from `tauri.conf.json` unless `--pubkey`), including the signed version.
- The feed: shape (`version`, `notes`, `pub_date`, `platforms`), RFC 3339 date, `darwin-aarch64`
  and `darwin-x86_64` pointing at the same universal archive, `windows-x86_64` at the installer,
  URLs, version, and each signature equal to its `.sig` and valid for the file.
- The updater archive unpacked as the Tauri plugin does (one top-level app folder, files and folders
  only); the DMG verified with `hdiutil verify` and mounted read-only (app, `Applications` link,
  installation note). For each app: `Info.plist` identity, version and integer build, universal
  executable and helper, `codesign --verify --deep --strict`, Hardened Runtime, a certificate-based
  designated requirement (ad-hoc is refused unless `--allow-adhoc`), the calendar entitlement and the
  helper's identifier. A warning appears if the public key is not found in the binary.
- Identical app bytes and executable bits in the DMG, the updater archive and the legacy ZIP.
- The legacy ZIP preflight and, when present, the legacy manifest: Ed25519 signature with the pinned
  1.x public key, client rules, size, digest and bundle match, plus `AzureTimetrackerRelease verify`
  when the Swift tool is built.
- With `--reference`: the same designated requirement as that app or 1.x update ZIP.
- The Windows installer starts with an `MZ` header. Authenticode is not checked (there is none).

## What users see

For `Resources/Installation guide.md` and `releases/README.md`, which still describe 1.14.x and are
outside this change:

- **macOS, first install**: open the DMG, drag the app to Applications, open it. macOS cannot
  verify the developer because the build is not notarized. macOS 15 or later: choose Done, open
  System Settings > Privacy & Security, choose Open Anyway for Azure timetracker, authenticate and
  confirm. macOS 14: Control-click the app, choose Open, then Open. Needed once. Managed Macs may
  forbid it. Do not disable Gatekeeper or remove quarantine. The DMG contains the same text.
- **macOS, from 1.13–1.14.x**: accept the update in the app; no manual install is needed.
- **Windows, first install**: run `Azure-timetracker-<v>-x64-setup.exe`. SmartScreen shows
  "Windows protected your PC" with an unknown publisher: choose More info, then Run anyway. It
  installs for the current user without admin rights. Later updates install from inside the app
  without this prompt.
- **Checksums**: `shasum -a 256 -c <file>.sha256` on macOS;
  `Get-FileHash -Algorithm SHA256 <file>` on Windows, compared with the `.sha256` file. A checksum
  detects corruption; it does not prove who published the file.

## Risks

- **Permissions across the bridge are not yet proven.** 1.14.0 validation states that cross-version
  Keychain, Calendar and Accessibility retention with the local certificate "remain to be validated".
  The bridge keeps the bundle ID and designated requirement (`verify --reference` and `stage --bridge`
  enforce it), which is what TCC and Keychain ACLs compare, but Keychain items can also carry a
  partition list that macOS manages for apps without a Team ID. Run `bridge-dry-run` on a test Mac
  with real saved credentials, a Calendar grant and an Accessibility grant, and check for prompts
  before publishing. Expect at most one approval per item if macOS asks.
- **Gatekeeper on first install.** Locally signed apps are "unidentified developer" on every other
  Mac; macOS 15+ removed the Control-click bypass, so users need Privacy & Security > Open Anyway.
  Managed Macs may block it. In-app updates carry no quarantine attribute and are not re-assessed.
- **Admin prompts during 2.x updates.** The Tauri updater renames the app in place; if the user
  cannot write to its folder (for example a standard user with the app in `/Applications`), it asks
  for an administrator password. 1.x refused instead. `~/Applications` avoids this.
- **First update after the bridge.** 2.0 is the first version that uses the v2 feed; a wrong pubkey
  in the shipped app cannot be fixed by an update. `package-macos` refuses keys that differ from
  `tauri.conf.json`, and `verify` warns if the key is not in the binary. Test one update 2.0.0 → 2.0.1
  on a test machine before relying on it.
- **Lost secrets.** A lost local certificate means new Keychain and permission prompts for everyone;
  a lost v2 key means no further in-app updates. Rotating the v2 key needs a release signed with the
  old key that ships the new public key.
- **SmartScreen and Defender.** Unsigned installers start without reputation and can be flagged;
  the checksums and reproducible builds are the mitigation until a certificate exists.
- **Tooling drift.** `hdiutil create/attach/detach` print deprecation warnings on macOS 26 and later
  (they work); `swift build --build-system native` is deprecated in Swift 6.4 (the tool falls back to
  the default build system). GitHub refuses files over 100 MB; keep every artifact well below.

## Tests

`cargo test -p att-release` runs everything with throwaway keys in temporary folders and ad-hoc
signatures; the real keys, the local certificate and the repository's `releases/` and `updates/`
are never written. macOS-only tests (codesign, hdiutil, ditto, lipo, swift) cover inside-out
signing, the DMG, an end-to-end package → bridge → feed → verify run, the published 1.14.2 update
against the ported client checks and the Swift `verify` mode, `bridge-dry-run` over a copy of the
1.14.2 app, and the universal stub. Golden vectors: all five published legacy manifests (1.13.0 to
1.14.2) verify with the pinned key, which pins the Rust rebuild of Swift's signing bytes.
`cargo test -p att-release --test tauri_interop -- --ignored` checks key and signature
compatibility with `npx @tauri-apps/cli@2 signer` in both directions.
