# Releasing Azure timetracker 2.x

`att-release` (`tools/release`) builds, signs, notarizes, packages, verifies and publishes every
release from the release Mac, including the Windows installer, which it cross-compiles. It replaces
the 1.x release scripts (`scripts/build-installer.sh`, `build-dmg.sh`, `sign-app.sh`,
`build-update.py`, `verify-release.py`, `stage-release.py`).

```sh
cargo run -p att-release -- --help
```

Every subcommand prints what it does and each external command before it runs it. Progress goes to
stderr; stdout carries only results (the app path, the public key, the legacy signing command), so
`APP="$(cargo run -q -p att-release -- build-macos)"` works. The tool never pushes Git commits,
never opens the legacy Ed25519 key and never changes the Keychain. Only `publish` talks to GitHub.

## Decisions

Originally taken with the rewrite plan (§11, §14, §15); signing, hosting and the Windows build were
changed on 2026-11-04. Items marked *tool* were decided while building it.

| Topic | Decision |
|---|---|
| Apple trust | Signed with the **Developer ID Application** certificate of team `4M2RD85AL6` (Hardened Runtime, secure timestamp, calendar entitlement) and **notarized** with the App Store Connect API key `4U3DC628X5` (issuer `c2b73d0c-5160-413a-b4c8-9d679881bc11`). App and DMG are stapled. The designated requirement changes from the 1.14.x local certificate to `identifier "be.yarne.azure-timetracker" and anchor apple generic and … certificate leaf[subject.OU] = "4M2RD85AL6"`, so users coming from 1.14.x may approve Keychain access and Calendar/Accessibility once. |
| Windows trust | No Authenticode certificate. SmartScreen asks once on first install. In-app updates are downloaded by the app (no Mark of the Web) and install per user without admin rights. |
| Windows build | Cross-compiled on the release Mac: `tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis`, with Homebrew's LLVM (clang-cl), LLD (lld-link) and NSIS (makensis). No Windows machine is needed. |
| Hosting | **GitHub Releases** of the public repository: tag `v<version>`, with the DMG, the updater archive, the NSIS installer, their `.sha256`/`.sig` files and `latest.json` as assets. Only the 1.x bridge (ZIP and legacy feed) stays committed, because 1.x clients can only read `raw.githubusercontent.com`. |
| Updates | Tauri updater plugin with the v2 minisign key pair. Feed: `https://github.com/DerpRL/die-keure-azure-timetracker/releases/latest/download/latest.json`, which follows the newest published (non-draft, non-prerelease) release. Every signature binds the release version (`version:<v>` in the trusted comment, as `tauri build` / `tauri signer sign --app-version` write it). |
| Publishing | `publish` creates a draft, uploads and checks every asset, then publishes it as latest in one step, so installed apps never see a feed whose assets are missing. Published assets are permanent: a new build means a new version. |
| 1.x users | One bridge release (2.0.0) through the legacy feed `updates/latest.json`, signed by the existing Swift `AzureTimetrackerRelease` with the existing Ed25519 key. Only `stage --bridge` writes the legacy feed; afterwards it stays frozen. |
| Formats *tool* | `minisign` 0.9 and `minisign-verify` 0.2, the versions inside the Tauri CLI 2.12 and `tauri-plugin-updater` 2.13. Interoperability with `tauri signer` is tested in both directions (`tests/tauri_interop.rs`). Key files hold base64 of the minisign boxes, exactly like `tauri signer generate`. |
| PKG *tool* | Not built for 2.x: one DMG per release (the 1.14.2 PKG moves to `releases/archive/1.14.2/`). |
| Signing identity *tool* | `sign-macos` and the DMG use, in order: `--identity`, `AZURE_TIME_SIGN_IDENTITY`, the Developer ID Application certificate of team 4M2RD85AL6 found with `security find-identity`, the 1.x local certificate (development only, with a warning), ad-hoc. The kind (`developer-id` or `local`) follows the certificate; `AZURE_TIME_SIGN_KIND` overrides it. |
| Bridge naming *tool* | The signed legacy manifest is `legacy-latest.json` in the artifact folder; `latest.json` there is the v2 feed. |
| Helper stub *tool* | Compiled with `rustc` per architecture (it has no dependencies) and joined with `lipo`; about 0.6 MB universal. It prints that it only exists for 1.x updates and exits 1. |
| Bundle rules *tool* | No symbolic links, ASCII file names, at most 4096 files (1.x validator limits). The same rules apply to the Tauri archive, so the app bytes in the DMG, the `.app.tar.gz` and the bridge ZIP are identical and checked to be. |
| Exit test *tool* | `bridge-dry-run` replays the 1.x helper with the unmodified 1.14.x client code, because 1.x apps can only read the production feed. |

## Files

Artifact folder (outside the repository, for example `~/Releases/2.0.0`):

| File | Made by | Published to |
|---|---|---|
| `azure-timetracker-<v>.dmg` + `.sha256` | `package-macos` | GitHub Release `v<v>` |
| `Azure-timetracker-<v>-universal.app.tar.gz` + `.sha256` + `.sig` | `package-macos` | GitHub Release `v<v>` |
| `azure-timetracker-<v>-x64.exe` + `.sha256` + `.sig` | `build-windows` | GitHub Release `v<v>` |
| `latest.json` | `feed` | GitHub Release `v<v>` |
| `Azure-timetracker-<v>-universal-update.zip` + `.sha256` (bridge) | `bridge` | `releases/updates/<v>/` in the repository |
| `legacy-latest.json` (bridge) | `AzureTimetrackerRelease`, run by the release owner | `updates/latest.json` in the repository |

Every 2.x asset URL is `https://github.com/DerpRL/die-keure-azure-timetracker/releases/download/v<v>/<file>`;
GitHub redirects it to its download host, and the Tauri updater follows the redirect. The 1.x
installers and update ZIPs stay in `releases/archive/` and `releases/updates/<version>/`, which
are permanent URLs and are never overwritten with different bytes.

Release secrets stay outside Git (folders 700, files 600). Back them up together:

- The **Developer ID Application** certificate and its private key in the login Keychain (export a
  `.p12` with a password for the backup). It signs every release.
- `~/.appstoreconnect/private_keys/AuthKey_4U3DC628X5.p8`: the App Store Connect API key for
  notarization. Apple lets you download it once; if it is lost, revoke it and create a new key, then
  change `NOTARY_KEY_ID` in `tools/release/src/consts.rs` (or set `APPLE_API_KEY`).
- `~/Library/Application Support/Azure timetracker Releases/`:
  - `updater-v2.key` and `updater-v2.key.pub`: the v2 updater key pair. Without the private key,
    installed 2.x apps cannot be updated any more and everyone has to reinstall manually.
  - `update-signing.ed25519`: the legacy key for the bridge. Only the Swift signer opens it;
    `att-release` prints its path.
  - `local-signing/`: the 1.x local certificate backup, now only for development builds.

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
      "endpoints": ["https://github.com/DerpRL/die-keure-azure-timetracker/releases/latest/download/latest.json"],
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
  signs, notarizes nor archives. `sign-macos` adds the helper stub and signs; `package-macos`
  notarizes, archives and signs the final bytes. The builds pass `--no-sign` (Tauri CLI 2.5+) and
  remove `APPLE_*` and `TAURI_SIGNING_*` from the build environment.
- `plugins.updater.endpoints` and `pubkey`: exactly the GitHub Releases feed URL, and the public key
  from `keygen-v2`. `package-macos`, `sign-update` and `build-windows` refuse to sign with any other
  key.

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
- Bundle contents: no frameworks or other symbolic links (refused by the 1.x validator), ASCII file
  names, and nothing configured at `Contents/Helpers/AzureTimetrackerUpdater`.
- `bundle.macOS.entitlements` is not used for releases: `sign-macos` applies
  `tools/release/assets/App.entitlements` (calendar only, as 1.14.x). Pass `--entitlements` if the
  shell ever needs more.

## One-time setup on the release Mac

1. **Developer ID certificate.** Keep the Developer ID Application certificate of team
   `4M2RD85AL6` with its private key in the login Keychain (`security find-identity -v -p
   codesigning` lists it). The first signing may ask whether `codesign` may use the key; choose
   Always Allow.
2. **Notarization key.** In App Store Connect > Users and Access > Integrations > App Store Connect
   API, download `AuthKey_4U3DC628X5.p8` (Developer role or higher) and store it:

   ```sh
   mkdir -p ~/.appstoreconnect/private_keys
   mv ~/Downloads/AuthKey_4U3DC628X5.p8 ~/.appstoreconnect/private_keys/
   chmod 600 ~/.appstoreconnect/private_keys/AuthKey_4U3DC628X5.p8
   ```

   Another location works with `APPLE_API_KEY_PATH`; `APPLE_API_KEY` and `APPLE_API_ISSUER` override
   the key ID and issuer. Notarization needs Xcode's `notarytool` (`xcrun notarytool --version`).
3. **Toolchains.** Rust (rustup), Node/npm and the Swift tools (for the bridge). `build-macos` adds
   the `aarch64-apple-darwin` and `x86_64-apple-darwin` targets, `build-windows` adds
   `x86_64-pc-windows-msvc`. For the Windows cross-build:

   ```sh
   brew install llvm lld nsis
   cargo install --locked cargo-xwin
   ```

   `cargo-xwin` downloads the Microsoft CRT and Windows SDK on its first build.
4. **GitHub CLI.** `brew install gh`, then `gh auth login` with an account that can create releases
   in `DerpRL/die-keure-azure-timetracker`.
5. **Updater key.** Created once (already done for 2.0.0):

   ```sh
   cargo run -p att-release -- keygen-v2
   ```

   It writes `updater-v2.key` (mode 600) and `.pub`, refuses paths inside a Git work tree, and prints
   only the public key. Put that line in `plugins.updater.pubkey` and commit it. Back up both files.
   Running it again prints the same key; it never overwrites. The key has no password unless
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is set, for `keygen-v2` and for every signing step.

## Normal release (macOS and Windows)

Before: raise `version` and `bundle.macOS.bundleVersion` (and the versions the shell keeps in
`Cargo.toml`/`package.json`), write `releases/notes/<v>.md`, commit and push. `publish` tags the
checked-out commit and refuses uncommitted changes or a commit GitHub does not have.

```sh
V=2.0.1
OUT="$HOME/Releases/$V"
KEY="$HOME/Library/Application Support/Azure timetracker Releases/updater-v2.key"
APP="$(cargo run -q -p att-release -- build-macos)"
cargo run -p att-release -- sign-macos "$APP"
cargo run -p att-release -- package-macos "$APP" "$OUT" --key "$KEY"
cargo run -p att-release -- build-windows --out "$OUT" --key "$KEY"
cargo run -p att-release -- feed --version $V --notes releases/notes/$V.md \
    --mac-archive "$OUT/Azure-timetracker-$V-universal.app.tar.gz" \
    --windows-installer "$OUT/azure-timetracker-$V-x64.exe"
cargo run -p att-release -- verify "$OUT"
cargo run -p att-release -- publish $V --from "$OUT" --notes releases/notes/$V.md
```

`package-macos` notarizes and staples the app, builds and signs the DMG, notarizes and staples it,
then writes the updater archive from the stapled app. Each submission usually takes a few minutes;
a rejection prints Apple's log. Running it again skips the app submission when the app already has
a ticket. `--no-notarize` exists for test builds only: `verify` and `publish` refuse un-notarized
Developer ID artifacts (`verify --allow-unnotarized` checks the rest).

`publish` verifies the folder again, creates the draft release `v<v>` (title
`Azure timetracker <v>`, body from the notes), uploads the nine assets, compares their names and
sizes on GitHub, publishes the draft as the latest release and then fetches the public feed until it
offers the new version. `--draft` stops before publishing, for a review on the GitHub releases page;
run it again without `--draft` to publish that draft. Always publish both platforms in one release:
`publish` refuses a feed without `windows-x86_64` or the macOS targets, because a feed without a
target makes update checks there fail with "target not found".

A published release is final: its assets are permanent download URLs and its feed is what installed
apps read. To fix a mistake, release a new version. `feed` writes a new `pub_date` on every run;
pass `--pub-date` to reproduce a feed.

## Bridge release (once, shipped with 2.0.1)

The bridge went out with 2.0.1 on 2026-11-04, with the 1.x-facing notes in
`releases/notes/2.0.1-from-1.x.md` (the 2.0 changes; the 2.0.1 notes only cover installer names).
The steps are kept for a replacement bridge, which must be newer.

Run the normal macOS steps up to `package-macos` (the app is then notarized and stapled, so the
bridge ZIP carries the ticket too), then:

```sh
cargo run -p att-release -- bridge "$APP" "$OUT" --notes releases/notes/2.0.1-from-1.x.md
```

`bridge` checks the signed app, writes `Azure-timetracker-2.0.1-universal-update.zip` the way
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
    "$OUT/Azure-timetracker-2.0.1-universal-update.zip" \
    "$HOME/Library/Application Support/Azure timetracker Releases/update-signing.ed25519" \
    releases/notes/2.0.1-from-1.x.md "$OUT/legacy-latest.json"
```

The Swift tool refuses a key that does not match the public key pinned in 1.13–1.14.x, extracts and
verifies the ZIP and the app with the client code, then signs. Keep the notes to plain text: control
characters other than tab and newline are refused, because signer and clients must encode the notes
identically.

Exit test, on a test Mac or a copy of an installed 1.14.2:

```sh
cargo run -p att-release -- bridge-dry-run "$OUT/Azure-timetracker-2.0.1-universal-update.zip" "$APP" \
    --installed "/Applications/Azure timetracker.app"
```

It compiles the unmodified `Sources/AzureTimetrackerCore` with a small driver and does what the 1.x
helper does: validate the release, check it is newer and supported, verify the archive, extract,
verify the bundle and signature, and replace the installed app, keeping
`.AzureTimetracker-previous-*.app`. Only the manifest signature (checked by `verify` and the Swift
tool) and the relaunch are skipped. Then open the app and note what macOS asks: because 2.0 is
Developer ID signed and 1.14.x used the local certificate, expect at most one Keychain prompt per
saved item (Always Allow) and new Calendar and Accessibility (Figma) approvals. Check that saved
credentials load after that.

Then, with the Windows installer built and `feed` written, verify against the published 1.14.2
identity, publish the GitHub Release **first**, and only then stage the bridge:

```sh
cargo run -p att-release -- verify "$OUT" \
    --reference releases/updates/1.14.2/Azure-timetracker-1.14.2-universal-update.zip
cargo run -p att-release -- publish 2.0.1 --from "$OUT" --notes releases/notes/2.0.1.md
cargo run -p att-release -- stage 2.0.1 --from "$OUT" --bridge
```

`--reference` accepts either the same designated requirement or the Developer ID requirement of
team 4M2RD85AL6 for `be.yarne.azure-timetracker`, and prints a warning about the identity change.
`stage --bridge` also runs `AzureTimetrackerRelease verify`, moves the 1.14.2 installers from
`releases/latest/` to `releases/archive/1.14.2/`, copies the ZIP to `releases/updates/2.0.1/` and
writes `updates/latest.json`. Commit and push that in one commit, after the GitHub Release is live:
a 1.x user who updates must find the v2 feed of the 2.0 app already published. 1.x clients check
every minute and show the update; users choose Download update and Install and restart, the 1.x
helper swaps the app in place and opens 2.0. Later releases never pass `--bridge`; it is only
needed to replace the bridge for 1.x users who have not updated yet, and the replacement must be
newer.

## What `verify` checks

- `.sha256` of every installer and archive; `.sig` of both update assets against the v2 public key
  (from `tauri.conf.json` unless `--pubkey`), including the signed version.
- The feed: shape (`version`, `notes`, `pub_date`, `platforms`), RFC 3339 date, `darwin-aarch64`
  and `darwin-x86_64` pointing at the same universal archive, `windows-x86_64` at the installer,
  GitHub Releases URLs of tag `v<version>`, and each signature equal to its `.sig` and valid for
  the file.
- The updater archive unpacked as the Tauri plugin does (one top-level app folder, files and folders
  only); the DMG verified with `hdiutil verify` and mounted read-only (app, `Applications` link,
  installation note). For each app: `Info.plist` identity, version and integer build, universal
  executable and helper, `codesign --verify --deep --strict`, Hardened Runtime, the calendar
  entitlement and the helper's identifier, and a Developer ID signature of team 4M2RD85AL6 with a
  stapled ticket that Gatekeeper accepts (`stapler validate`, `spctl` reports "Notarized Developer
  ID"). Other signatures are refused unless `--allow-adhoc`. A warning appears if the public key is
  not found in the binary.
- The DMG itself: Developer ID signed, notarized and stapled (`spctl -t open`).
- Identical app bytes and executable bits in the DMG, the updater archive and the legacy ZIP.
- The legacy ZIP preflight and, when present, the legacy manifest: Ed25519 signature with the pinned
  1.x public key, client rules, size, digest and bundle match, plus `AzureTimetrackerRelease verify`
  when the Swift tool is built.
- With `--reference`: the same designated requirement as that app or 1.x update ZIP, or the
  Developer ID requirement of team 4M2RD85AL6 (with a warning about the identity change).
- The Windows installer starts with an `MZ` header. Authenticode is not checked (there is none).

## What users see

- **Downloads**: the GitHub releases page,
  `https://github.com/DerpRL/die-keure-azure-timetracker/releases/latest`. The app's download link
  opens it.
- **macOS, first install**: open the DMG, drag the app to Applications, open it. macOS asks once
  whether to open an app downloaded from the internet; choose Open. No Privacy & Security detour.
- **macOS, from 1.13–1.14.x**: accept the update in the app; no manual install is needed. Because
  the signature changes, macOS may ask once per saved credential to allow Keychain access (Always
  Allow), and Calendar and Accessibility (Figma) may need to be granted again.
- **Windows, first install**: run `azure-timetracker-<v>-x64.exe`. SmartScreen shows
  "Windows protected your PC" with an unknown publisher: choose More info, then Run anyway. It
  installs for the current user without admin rights. Later updates install from inside the app
  without this prompt.
- **Checksums**: `shasum -a 256 -c <file>.sha256` on macOS;
  `Get-FileHash -Algorithm SHA256 <file>` on Windows, compared with the `.sha256` file.

## Risks

- **One-time prompts across the bridge.** TCC and Keychain ACLs compare the designated requirement,
  which changes from the local certificate to Developer ID. Expect a Keychain approval per saved
  item and new Calendar and Accessibility approvals for users coming from 1.14.x. Run
  `bridge-dry-run` on a test Mac with real saved credentials and grants to see exactly what macOS
  asks before publishing. 2.x → 2.x updates keep the Developer ID requirement and do not prompt.
- **Admin prompts during 2.x updates.** The Tauri updater renames the app in place; if the user
  cannot write to its folder (for example a standard user with the app in `/Applications`), it asks
  for an administrator password. `~/Applications` avoids this.
- **First update after the bridge.** 2.0 is the first version that uses the GitHub Releases feed; a
  wrong pubkey or endpoint in the shipped app cannot be fixed by an update. `package-macos` refuses
  keys that differ from `tauri.conf.json`, and `verify` warns if the key is not in the binary. Test
  one update 2.0.0 → 2.0.1 on a test machine before relying on it.
- **"Latest" moves with every published release.** The feed always follows GitHub's latest release:
  never publish a test build as a normal release, and do not remove the Windows or macOS assets
  from a published release.
- **Lost secrets.** A lost Developer ID key needs a new certificate (same team, so the designated
  requirement stays valid); a lost `.p8` needs a new API key; a lost v2 key means no further in-app
  updates. Rotating the v2 key needs a release signed with the old key that ships the new public
  key.
- **SmartScreen and Defender.** Unsigned installers start without reputation and can be flagged;
  the checksums are the mitigation until a certificate exists. The installer is cross-compiled
  (Tauri marks this experimental), so try each new release on a real Windows machine once.
- **Tooling drift.** `hdiutil create/attach/detach` print deprecation warnings on macOS 26 and later
  (they work); `swift build --build-system native` is deprecated in Swift 6.4 (the tool falls back to
  the default build system). The 1.x bridge ZIP in the repository must stay below GitHub's 100 MB
  file limit.

## Tests

`cargo test -p att-release` runs everything with throwaway keys in temporary folders and ad-hoc
signatures; the real keys, the Developer ID certificate, Apple's notary service, GitHub and the
repository's `releases/` and `updates/` are never touched. macOS-only tests (codesign, hdiutil,
ditto, lipo, swift) cover inside-out signing, the DMG, an end-to-end package → bridge → feed →
verify run, the published 1.14.2 update against the ported client checks and the Swift `verify`
mode, `bridge-dry-run` over a copy of the 1.14.2 app, and the universal stub. Golden vectors: all
five published legacy manifests (1.13.0 to 1.14.2) verify with the pinned key, which pins the Rust
rebuild of Swift's signing bytes. `cargo test -p att-release --test tauri_interop -- --ignored`
checks key and signature compatibility with `npx @tauri-apps/cli@2 signer` in both directions.
