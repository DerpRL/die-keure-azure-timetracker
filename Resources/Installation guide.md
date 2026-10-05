# Install Azure timetracker

Use the `Azure-timetracker-1.12.0-universal-unsigned.pkg` installer. It installs **Azure timetracker.app** in **/Applications** and supports both Apple Silicon and Intel, with a macOS 14 minimum deployment target. Direct runtime checks have been performed on Apple Silicon macOS 27.0.1; Intel and older macOS versions still need testing.

For drag-and-drop installation, open `Azure-timetracker-1.12.0-universal-unsigned.dmg`, drag the app onto Applications, eject the disk image, then launch the installed app. Quit the old app before replacing it. The same signing limitations apply.

## Install and open

1. Quit any existing Azure timetracker instance from its menu-bar menu. Quitting does not stop an active remote 7pace timer.
2. Double-click the `.pkg` and follow macOS Installer. Administrator authorization is needed for /Applications. The installer asks for the app to close if it is already running.
3. Open **Applications → Azure timetracker**. Look for its clock icon in the menu bar; there is no Dock or Command-Tab entry and no automatic overview window.
4. Click the clock and open **Settings**. Enter your Azure organization/project, 7pace workspace URL, and your own credentials. Use an Azure PAT with Work Items (Read) for ticket names and 7pace Mobile PIN pairing (or an API token) for tracking. Never share tokens.
5. Choose **Save changes**. Review repositories; first launch discovers immediate Git repositories in your own `~/Documents/repositories`. Add other folders as needed. Enable Calendar, notifications, microphone meeting suggestions and launch at login only if wanted.

Default targets are 38 hours per week and 7h 36m per weekday. Settings → Tracking supports separate daily targets and an 8h Monday–Thursday / 6h Friday preset. Settings → Accounts offers Mobile PIN pairing; enter the generated PIN on 7pace’s Apps page, then save changes. Control + Option + T opens quick switch. Settings → Meetings can suggest tracking when selected apps use the microphone (macOS 14.2+). No Slack IDs or tokens are needed. Browser calls appear under the browser name. Choose Meeting or Daily standup, then confirm the activity. Input use does not prove that a meeting is taking place; muting may trigger a return reminder after 60 seconds. No audio is recorded.

Version 1.6 adds ticket context, split/merge, recent-edit undo, weekly status drafts and context-switch insights. Undo history starts with changes made on this Mac in this version. The app also prompts when 7pace stops a session at its configured time limit. Use **Insights → Time editor** to correct recorded start/end times in a table, with informational overlap warnings that never block a valid save.

## This release is unsigned and not notarized

No Developer ID signing identity is available on the build Mac. The app uses an ad-hoc signature for integrity, and the installer has no Developer ID Installer signature. macOS can warn or block the first opening; this package will not pass normal Gatekeeper assessment as a notarized release.

If you trust the sender and have reviewed the package, attempt to open it normally, then use **System Settings → Privacy & Security → Open Anyway** if macOS offers that option. You may need to approve the app separately after installation. Follow [Apple's instructions for software from an unidentified developer](https://support.apple.com/102445). Managed Macs may prohibit overrides; in that case ask your administrator for a signed, notarized build. Do not disable Gatekeeper or remove quarantine as a workaround.

## Verify and update

The accompanying `.sha256` file contains the installer checksum. From the download directory, run `shasum -a 256 -c Azure-timetracker-1.12.0-universal-unsigned.pkg.sha256`. A matching checksum detects file changes; it does not authenticate the sender.

The installer replaces only the app bundle in /Applications. Your per-user settings and Keychain credentials are preserved. It does not install launch daemons, change Git repositories, alter system security settings, start timers or launch the app as root. The payload contains no developer account settings, worklogs, calendar data or credentials.

To remove the app, disable launch at login in its Settings, quit it, and move the app from Applications to Trash. Personal settings remain in `~/Library/Application Support/Azure timetracker`; credentials remain in Keychain. Delete those separately only if you intend to reset the app.

## New in 1.9.0

- Statistics → Compare periods: compare days, weeks, months or years, use shared filters, select bars for dates, and inspect task changes. The current period defaults to matching elapsed days/time; full-period mode includes future target hours.
- Settings → Tracking → Holidays & leave: the ten Belgian statutory public holidays are enabled by default. Enter employer-specific replacement dates and leave, half-days, or custom target hours. Save changes to apply. Holidays and leave adjust targets, not recorded time. Historical targets use the currently saved weekday schedule and exceptions.
- Offline drafts (⌘0): start/stop a separate local timer or add past time. Drafts and cached activities survive restarts in a private local file. Review after reconnecting, then upload explicitly. Overlaps are advisory. A lost response requires reconciliation; it is never retried automatically. A running 7pace timer can continue independently while offline.
- Automatic app updates are deferred. Install later releases manually.

## New in 1.10.0

- When selected apps stop using the microphone for one minute, the menu-bar panel offers Keep tracking, Pause or Stop, including for meetings started without a previous ticket. Muting can also trigger this suggestion; your timer changes only after your choice.
- New installations enable Slack, Google Meet / web browsers, Microsoft Teams and Zoom by default. Saved preferences are respected.
- Stable Developer ID signing is prepared. This package is still ad-hoc and not notarized because no signing identity is installed on the build Mac. Permissions can be requested again on an ad-hoc update. A properly signed release requires the organization's Developer ID Application certificate; see Signing.md in the source repository.

### Add multiple repositories

Open Repositories → Add from folder…, choose a parent folder and wait for the scan. Search the results and check the repositories to watch, then select Add selected. The scan includes nested Git checkouts and worktrees, skips Git metadata, application packages and linked folders, and reports unreadable folders. Existing watched/paused repositories are preserved.

## New in 1.11.0: ticket completion reminders and clearer suggestions

Ticket completion reminders are enabled in Settings → Tracking and require your Azure PAT with Work Items read access. While a ticket is tracked, the app checks its Azure workflow state about once a minute. A completed ticket offers Keep tracking, Stop or Switch ticket. Stopping and switching require your choice; a state change alone never modifies tracking.

Branch changes now appear in an amber card above the timer, including the previous/new branch and ticket. The normal 7pace status is compact; open Details for check times and connection errors. Offline draft reminders remain visible in the menu panel.

## New in 1.12.0

- Settings → Tracking → Time awareness: review idle time after 5 minutes (configurable), or after screen lock/sleep. When you return, keep recorded time or choose Pause & review to preview removing the interval or separating it into another entry. Time before and after the interval is retained. The pause happens when you choose it; recorded time changes only after Apply correction.
- Forgotten-timer reminders: after 10 active minutes in selected work apps during configured work hours, choose a branch ticket or another ticket, snooze 15 minutes, or ignore today. Paused tracking, detected meetings and a running local draft suppress reminders. No earlier time is backfilled automatically.
- Time editor → Gaps & overlaps: inspect possible gaps, extend a neighboring task, trim overlaps or set a shared boundary. Review the before/after timeline, explicitly apply the correction and undo from Recent edits. Overlap warnings still do not block ordinary saves.

These settings default on and can be disabled separately. Reading without input can appear idle; this is a suggestion, not proof of absence. No keystrokes, window contents or audio are collected. Screen-lock notifications are supplemented by macOS sleep/session notifications; actual lock/wake behavior should be checked on your Mac.
