---
name: dev-build
description: Build a dev version of Azure timetracker for macOS that is signed with the Developer ID certificate and notarized, so it can be installed and tested like a release. Use when asked for a dev build, test build, local build, signed or notarized build, or "a build I can test". Never publishes anything.
---

# Dev build (macOS, Developer ID, notarized)

Builds the checked-out code, including uncommitted changes, into a universal
`Azure timetracker.app` and a DMG. Both are signed with the Developer ID certificate of team
4M2RD85AL6, notarized and stapled. The script drives the release tool in `tools/release` (see
`docs/release.md`): `build-macos` → `sign-macos` → `package-macos`. It never runs `feed`,
`verify` or `publish`, so nothing reaches GitHub or the update feed.

## Run it

Run from anywhere in the repository. It takes about 5–15 minutes: the Rust build for two
architectures plus two notarization submissions. Start it with Bash `run_in_background: true` and
wait for the completion notice; don't poll. Run it outside the command sandbox
(`dangerouslyDisableSandbox: true`), because codesign needs the keychain, notarytool needs the
network and actool needs Xcode's helper services. Write the output to a log file rather than piping
it: a pipe such as `| tail` hides the script's exit code.

```bash
.claude/skills/dev-build/build.sh > "$SCRATCH/dev-build.log" 2>&1; echo "exit $?"
```

(`$SCRATCH` stands for the session's scratchpad directory; use its real path.)

Optional argument: the artifact folder. The default is
`~/Releases/dev/<version>-<commit>[-dirty]-<yyyymmdd-hhmm>`. The folder must be outside the
repository.

The last lines print `APP=…` and `DMG=…`. The folder also holds the updater archive and checksums,
which are leftovers from `package-macos` and are not needed for testing.

## Before running

- `build-macos` runs `npm ci` in `apps/desktop`, which reinstalls `node_modules`. Don't run it while
  a Vite dev server or test watcher is using them.
- The script needs the Developer ID certificate in the keychain, the notary key at
  `~/.appstoreconnect/private_keys/AuthKey_4U3DC628X5.p8`, and the updater key at
  `~/Library/Application Support/Azure timetracker Releases/updater-v2.key`. It stops with a
  one-line reason if any of them is missing. Tell the user which one; never try to create or fetch
  keys yourself.

## After it finishes

- Report the app and DMG paths, the version and commit, and whether the tree was dirty.
- If it failed, quote the failing step's error.
- "failed to run actool" or "Bad file descriptor": Xcode's `ibtoold` helper got stuck, or actool
  ran with stdin closed. The script handles both. Its `actool` wrapper restarts the helper and
  retries once, and children get `/dev/null` as stdin; keep both if you edit the script. If it
  still fails, run `killall ibtoold` and start the script again. Any other actool failure means
  `xcode-select -p` doesn't point at Xcode 26 or later; the script checks that before building.
- A notarization rejection prints Apple's log; give
  the user its key lines. Running the script again with the same `OUT` folder skips the app
  submission when the app already has a ticket.
- Offer to install it, but don't do it unasked. Installing means quitting the running Azure
  timetracker and replacing `/Applications/Azure timetracker.app`, which is the user's working
  app.

## Things to know

- The version is the one in `apps/desktop/src-tauri/tauri.conf.json`, the same as the last
  release unless it was raised. A dev build therefore uses the installed app's settings and
  keychain items (same bundle identifier). The updater won't offer the same version again; it
  replaces the dev build as soon as a newer release is published.
- Don't change the version to a pre-release such as `2.1.0-dev`. The updater compares semver,
  sees the release `2.1.0` as newer and would replace the dev build at once.
- Never pass the result to `att-release verify` / `publish` or upload it. Releases follow
  `docs/release.md`.
