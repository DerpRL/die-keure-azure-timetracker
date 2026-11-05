---
name: github-release
description: Publish a new release of Azure timetracker on GitHub Releases for macOS and Windows - raise the version, write the release notes, build, sign, notarize, verify and publish, so installed apps update to it. Use whenever the user asks to release, ship, publish or "make a new version" of the app, cut a release, bump to 2.x.y and put it on GitHub, or push an update to users, even if they don't say "GitHub". Not for test builds to try locally; that's the dev-build skill.
---

# GitHub release (macOS and Windows)

Publishes Azure timetracker as a GitHub Release of `DerpRL/die-keure-azure-timetracker`, following
the "Normal release" section of `docs/release.md` (read it if anything here is unclear or fails).
Every installed 2.x app reads the feed of the latest release, so publishing is what ships the update
to users.

**A published release is permanent.** Its assets are fixed download URLs and its feed is what
installed apps read; a mistake can only be fixed by releasing a higher version. That's why the
version and the notes are agreed with the user before anything is committed, and why the build is
verified before it is published.

## 1. Decide the version and notes with the user

1. Find what changed since the last release:
   ```bash
   gh release list --limit 3
   git log --oneline "$(git describe --tags --abbrev=0)"..origin/main
   ```
   If nothing changed, say so and stop.
2. Propose a version (plain `major.minor.patch`, higher than the latest release): a **minor** bump
   for new features or visible UI changes, a **patch** bump for fixes only. Never a pre-release
   suffix: 1.x clients and the release tool accept only plain versions.
3. Draft `releases/notes/<version>.md` in the style of the earlier notes (read the last one in
   `releases/notes/`): a `# Azure timetracker <version>` heading, one bullet per user-visible
   change in plain language (what the user can now do or no longer runs into, not code names),
   most important first, and the closing line the previous notes use about update checks and
   tracked time, if it is still true. Leave out internal work (tests, refactors, tooling).
4. Show the version and the notes to the user (AskUserQuestion with the notes in the option's
   preview works well) and wait for their choice. Don't commit before they agree.

## 2. Raise the version, commit and push

Release builds must come from a commit that GitHub has; `publish` tags exactly that commit.

1. Uncommitted changes to tracked files block `publish`. If the user has some (for example
   `.claude/launch.json`), ask before committing them; otherwise stash them for the release
   (`git stash push -m "set aside for release <v>" -- <files>`) and pop them afterwards. Untracked
   files such as `.claude/skills/` are fine.
2. Be on `main`, up to date with `origin/main`.
3. Raise the version everywhere the tool checks it (Cargo.toml, Cargo.lock, package.json,
   package-lock.json, tauri.conf.json's `version` and `bundle.macOS.bundleVersion` + 1):
   ```bash
   .claude/skills/github-release/bump-version.sh <version>
   ```
   Check that the diff touches only those version fields.
4. Write the agreed notes to `releases/notes/<version>.md`.
5. Commit only those files, in the repository's style (look at `git log --grep "^Release"`):
   subject `Release <version> with <the headline change>`, and a body listing the version, the
   build number and the notes' points in a few words. Then push: `git push origin main`.

## 3. Build, sign, notarize and verify (about 15–25 minutes)

`npm ci` reinstalls `apps/desktop/node_modules`, so stop any Vite dev server or Vitest watcher
first (the script refuses to start while one runs). Do that as its own command: list them with
`pgrep -fl "node_modules/.bin/vite"`, then kill those PIDs. Don't put a `pgrep -f`/`pkill -f`
pattern into the same command line that starts the build, because the pattern matches that command
line itself and kills it. Then start the script with Bash
`run_in_background: true` and `dangerouslyDisableSandbox: true` (codesign needs the keychain,
notarytool and gh the network, actool Xcode's helper services), writing to a log in the session's
scratchpad. Wait for the completion notice instead of polling:

```bash
.claude/skills/github-release/build.sh <version> > "$SCRATCH/release-<version>.log" 2>&1; echo "exit $?"
```

It checks the prerequisites (clean tree, HEAD equal to `origin/main`, the notes, the Developer ID
certificate, the notary key, the updater key and the Windows cross-build tools) and stops with a
one-line reason if one is missing. Tell the user which; never create or fetch keys yourself. It then
runs `build-macos` → `sign-macos` → `package-macos` → `build-windows` → `feed` → `verify` into
`~/Releases/<version>` and ends with `==> READY` and the publish command.

If it fails, quote the failing step's error from the log:
- "failed to run actool" or "Bad file descriptor": the script already restarts Xcode's `ibtoold` and
  retries once. If it still fails, `killall ibtoold` and run the script again.
- A notarization rejection prints Apple's log; give the user its key lines. Running the script again
  with the same folder skips the app submission when the app already has a ticket.
- Never "fix" a failure by publishing anyway, by passing `--allow-unnotarized` or `--no-notarize`,
  or by dropping the Windows build: `publish` refuses a feed without every platform, because update
  checks on a missing platform fail.

## 4. Publish

When the log ends with `==> READY` and `verify` reported "All checks passed", publish. If the log
is gone or unclear but `~/Releases/<version>` holds the nine assets, run
`cargo run -q -p att-release -- verify "$HOME/Releases/<version>"` and go on only when it ends with
"All checks passed". Then publish (foreground,
`dangerouslyDisableSandbox: true`, timeout 10 minutes):

```bash
cargo run -q -p att-release -- publish <version> --from "$HOME/Releases/<version>" --notes releases/notes/<version>.md
```

It verifies again, creates a draft release `v<version>`, uploads the nine assets and checks their
sizes, publishes it as the latest release and waits until the public feed offers the new version.
If the user asked for a review first, add `--draft` and run it again without `--draft` once they
approve.

Afterwards, pop anything you stashed in step 2.

## 5. Report

- The release link `https://github.com/DerpRL/die-keure-azure-timetracker/releases/tag/v<version>`,
  the version and build number, the release commit, and that the feed offers it.
- That the Windows installer has no Authenticode signature (decided), so SmartScreen asks once on
  first install.
- Offer to install the new DMG's app in `/Applications`, but don't do it unasked: installing quits
  the running app, which is the user's working copy. Installed copies also update themselves within
  about a minute.
