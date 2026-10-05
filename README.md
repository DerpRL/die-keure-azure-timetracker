# Azure timetracker

Download the current macOS installer from [releases/latest](releases/latest). Older versions are in [releases/archive](releases/archive). See [release instructions](releases/README.md).

A native SwiftUI menu bar app for macOS. It watches your local Git branches and helps you keep your 7pace timer on the right Azure DevOps ticket.

## First run

1. Open **Azure timetracker.app** and choose your appearance in the first-run setup. Then connect your accounts in Settings. On later launches, open Settings from the menu-bar clock. The app runs without a Dock icon or an entry in Command-Tab; existing setups start in the menu bar. You can move it to Applications before enabling launch at login.
2. In **Settings**, enter your Azure organization name, optional project, and your 7pace workspace URL (`https://your-organization.timehub.7pace.com`).
3. Add your **Azure DevOps PAT**, with **Work Items → Read** permission. It is used to verify ticket details.
4. Under **7pace sign-in**, choose **Mobile PIN pairing** and **Generate pairing PIN**. Enter the displayed PIN within one minute on **7pace → Apps → Pair Mobile App** in Azure DevOps, then save your settings. The app stores the resulting access and refresh credentials in Keychain and renews access automatically. Alternatively, choose **API token** and use a token from **7pace → Settings → Reporting & API**. An Azure PAT cannot authenticate the 7pace tracking API. If you omit the Azure PAT, the app can also look up tickets through 7pace.
5. Choose **Save changes**. Allow macOS notifications when asked. The connection check only reads account data; it does not start or stop a timer.
6. Check **Repositories**. On first launch, the app discovers immediate Git repositories in `~/Documents/repositories`. Use **Add from folder…** to scan a parent folder and select nested repositories or worktrees, and disable anything you do not want watched.
7. In **Agenda**, choose **Allow calendar access**. Your mail account must be connected to Apple Calendar through macOS Internet Accounts with Calendars enabled. The app only reads events.

Tokens are entered only into the app, saved in macOS Keychain, and bound to their account/workspace. Blank token fields preserve the saved token for that same account. To rotate a token, paste its replacement and save.

## Daily use

- The app checks Git HEAD every two seconds. Two matching reads confirm a change, so a suggestion usually appears within 2–4 seconds. A new suggestion automatically opens the menu-bar popover, including when the main window is closed or hidden. Restored suggestions and the startup baseline do not open it again.
- A branch such as `feature/33624-improve-loading` or `featute/33624-improve-loading` suggests ticket **33624**. The prefix is not hard-coded. Configure and test the extraction pattern in Settings.
- A branch notification offers **Keep tracking** or **Review & switch**. The overview contains **Track #33624** and **Choose another ticket**. Choosing a ticket verifies its existence, then opens an activity chooser. Select a 7pace activity and press **Start tracking** to stop the old timer and start the new session. Cancel leaves tracking unchanged. Your saved default is preselected when it is available; the session choice does not change that default.
- Optionally enable **Automatically open the activity chooser when no timer is running** to go straight to activity selection inside the popover. This only applies to subsequent branch changes. Every start still requires activity selection and confirmation; no branch change silently starts a timer.
- Startup and settings changes establish a branch baseline without starting timers or generating a burst of prompts. Use **Track a ticket** to choose work on a branch that was already checked out. History replay and branch suggestions use the same activity confirmation step. Choosing a different activity for the same running ticket starts a new session; the same ticket and activity keep the existing session.
- Branches without a unique ticket number offer manual ticket selection. Detached HEAD does not change tracking. Switching between repositories without changing a branch is not detected as a branch change.
- `develop` and `long-feature/*` branches instead suggest **Pause**, **Stop**, or **Keep current**. Ticket numbers in those branches are ignored, including with a custom extraction pattern. With no active timer, the suggestion can simply be dismissed. These suggestions never change tracking automatically.
- **Pause** stops the remote 7pace timer and remembers its ticket and activity on this Mac. **Resume** restores that selection for confirmation and starts a new session; the paused interval is not logged. The paused selection survives app restarts and is cleared if another timer starts or you change workspaces. **Clear pause** forgets that selection without changing recorded time.
- The menu-bar timer icon shows the current timer, full Azure ticket title, and ticket number without thousands separators. **Start tracking…** (or **Switch ticket…** while running) opens ticket search and activity selection within the popover. **Start** confirms the selected ticket and activity; **Stop** ends the current timer. A suggestion offers **Keep current** or **Choose activity…**. Closing the window leaves the watcher running. **Quit leaves the server timer running**; press Stop before quitting if you want to end the session.
- Use **Open overview** or **Settings** in the popover to open the full window. Closing it returns to menu-bar-only operation; the app stays out of the Dock and Command-Tab even while that window is open.
- History loads your own 7pace worklogs for a chosen date range, with pagination, totals, filtering and CSV export. The default range is the last seven days. “App activity” is a local audit of branch changes and decisions, capped at 2,000 entries.
- Agenda reads selected Apple Calendar calendars; all calendars are shown when none are selected individually. Events are never uploaded to Azure or 7pace.

## Server time limits and activity checks

When 7pace reports a maximum-session-length stop (for example your two-hour limit), the app opens its menu-bar prompt and sends a macOS notification if notifications are enabled. Choose **Continue…** to review the original activity and start a new session, or **Keep stopped** to dismiss it. Stopped time is not filled in automatically. The server’s actual stop reason is used; elapsed time alone never restarts or stops a timer. Manual stops and stops by another client do not trigger this prompt.

Active 7pace activity checks offer **Continue tracking** or **Stop tracking**. Continuing first verifies the current server state and acknowledges the check; if the check has already timed out, the app refreshes and offers the stopped-session prompt instead. Each prompt is announced once across polling and restarts; a new stopped session can announce again. Detection follows your configured 7pace refresh interval. No response leaves 7pace’s own behavior in control.

## Edit recorded time

Open **Insights → Time editor**. Choose a date, optionally filter by ticket number or comment, and click **Edit time** on an entry. Adjust its start and end, including across midnight. The app preserves its ticket, activity and comment. Explicit billable seconds are retained; implicit billable time follows the edited duration. All times use your Mac’s time zone. A running entry must be stopped or paused first; 7pace’s editability/approval permissions are checked before saving.

The native table fills the available page width and height, and lists each task, start, end, duration, activity and comment, with an **Edit** button per row. Editing opens a separate sheet with its action buttons always visible. Adjust the selected entry’s times and choose **Save time changes** directly. Overlaps with loaded entries appear while editing; **Check overlaps** is an optional full-history check. Warnings show the conflicting task/comment, start/end and overlapping duration. Adjacent entries that only touch are not overlaps. Overlaps never require extra confirmation or disable Save.

Immediately before saving, the app checks worklogs for overlaps, checks the original entry for external changes and rechecks current tracking. Newly appearing overlaps remain informational; they do not interrupt the save. The overlap scan has no lower date bound so older, long entries are included; it is paginated and can take longer for large histories. A failed or incomplete overlap scan is also a warning, while permissions, original-entry changes, invalid times and active-entry restrictions still prevent unsafe edits. After saving, the confirmation and any overlap warnings remain visible. Time edits preserve ticket, activity and comment while updating time and retaining explicit billable seconds (or the new duration when billable time was implicit). Saved values must be confirmed by 7pace before history, progress, statistics and day review are refreshed. An uncertain write is never automatically retried; reload the entry before another attempt.

The documented API has no atomic overlap check or conditional update. Another client can still change entries between the final reads and the save. Overlap warnings do not bypass 7pace’s permissions or validation. Split, merge and undo also use the documented creation/deletion endpoints, as described below.

## Microphone meeting suggestions

Enable **Settings → Meetings → Meeting detection** and select Slack, Teams, Zoom, browsers or other supported apps. The app polls public Core Audio process-input metadata every two seconds on macOS 14.2+. Four seconds of sustained input use opens a suggestion. Choose **Meeting** and an activity, or **Daily standup** (Standup activity, exact comment `daily standup`). Both are ticket-free and need comment-only tracking support in 7pace. You confirm before a timer changes.

Microphone use cannot identify a meeting, Slack channel, or browser tab. Google Meet appears under its browser. Shared WebKit helpers are labeled “WebKit (browser or web view)”; their host app is not guessed. Calls that do not open an input stream while muted may only be detected when unmuted. Dictation/recording can trigger suggestions too. Select only the applications you want to watch; Other apps is off by default. No audio is captured, and no Slack tokens, IDs, Accessibility permissions or audio recording permissions are requested. The old Slack network service is no longer used. Existing enabled Slack detection migrates to local microphone detection; stored credentials remain untouched.

Brief interruptions do not re-prompt. After 60 seconds of confirmed absence, the app can offer to resume the previous ticket; it never treats this as proof the meeting ended or changes tracking automatically. Errors and sleep reset the absence window. Settings shows the observed microphone owners and diagnostics. Existing calendar suggestions continue independently.


## Ticket context

Click a ticket in **Time editor**, a ticket number in **History**, or **Ticket context** on the current timer to open a native panel with its Azure title, state, type, assignee, project, iteration, tags, description, acceptance criteria and related links. This requires the Azure PAT already configured in Settings. Missing fields show as unavailable; a lookup failure has its own Retry action and does not change tracking. Descriptions are rendered as plain text without executing HTML or loading remote images. Links only open when clicked. The panel can open the ticket in Azure.

## Split, merge and undo

**Time editor → Edit → Split entry** divides a completed entry at a chosen time. The first part keeps its ticket, activity and comment; the second part can use another ticket, activity and comment. Recorded seconds remain unchanged, and billable seconds are distributed proportionally with the rounding remainder preserved. Preview both results before selecting **Split entry**.

Select rows with the checkboxes or Command-click, then **Merge selected**. Merging requires adjacent entries with the same ticket, activity, comment and owner; it never fills a gap or removes overlapping time. The earliest entry is extended and redundant entries are deleted after checking permissions and confirming the replacement. Recorded and billable totals are preserved. Other overlapping worklogs still produce informational warnings, not another save confirmation.

**Recent edits → Undo** restores values from edits, splits and merges made by this version on this Mac. The history is scoped to the 7pace workspace and survives restarting the app. Every affected entry is checked for external changes, permissions and running status before writes. Undo of a merge recreates deleted entries with new IDs; original server audit timestamps and flags cannot be restored. Older edits made before this release are not reconstructed. Ordinary time edits only update timestamp, duration and explicit billable duration; ticket, activity and comment stay intact.

The 7pace API provides separate CRUD calls, not an atomic multi-entry transaction. A recovery record is saved locally before sending requests and after each returned result. Replacements are created/updated before redundant entries are removed. If a request times out or a later step fails, the operation may be partially applied: the app stops, never retries a write automatically, and flags **Recent edits** for review. Compare the affected IDs and entries in 7pace before acknowledging that review; acknowledgment neither retries nor reverses anything. A lost create response can leave an entry whose ID the app never received, so check the proposed time/ticket as well as the listed IDs. Concurrent changes can still race between the last read and a write because the API has no conditional update.

## Weekly report drafts

**Insights → Weekly report** loads a Monday–Sunday week and generates an editable Markdown draft with recorded time, the current weekly target, work by ticket, recorded comments, activities and work-pattern metrics. Outcomes, blockers and next-week priorities are placeholders for you to complete: recorded time is not treated as proof of delivery. Ticket titles are included when available. Regenerating an existing draft asks before replacing your local text.

Drafts are saved locally while typing, separately by workspace and week. **Copy** places the draft on your clipboard; **Export Markdown** lets you choose a file. No report is sent automatically and no external AI service is used. Totals use the reported-date grouping as History, deduplicate worklogs and omit invalid data. Refreshing time does not overwrite edited text. Draft files contain the text you generate and edit, including any worklog comments.

## Context-switch insights

**Statistics → Work patterns** shows recorded context switches, continuous work blocks and overlapping time. A context changes when a different Azure ticket follows within 15 minutes, or when ticket-free activity/comment changes. Adjacent entries on the same task form a single block. A longer break resets the switch sequence; blocks split at local midnight. Overlapping segments are excluded from switch/block calculations. Filters can hide intervening tasks, so clear them for the complete sequence. These metrics describe worklogs, not concentration or productivity.

## Statistics (1.8)

Choose **Day**, **Week**, **Month** or **Year**, navigate periods, or jump to a date. The page loads paginated 7pace worklogs independently of History and refreshes every five minutes while selected. **Refresh** retries immediately. Failed refreshes preserve the current downloaded data. Switching accounts clears it; stale download/analysis responses cannot overwrite another period or connection.

- **Time explorer:** activity-stacked bars adapt from months to days, hours, 15-minute and 5-minute buckets as you zoom. Click a bar to inspect its entries, drag either direction to zoom, or use the keyboard-accessible interval picker, Zoom in/out, pan, Back, Reset and exact-range controls. The minimum window is 15 minutes. Each selection lists dates, ticket titles, activities, comments and clipped durations, with actions for ticket context or the original entry’s day in Time editor.
- **Restored chart views (1.8.1):** Time explorer has visible **Activity chart / Heatmaps / Timeline / Progress** controls. Calendar heatmaps include empty and future days, use a compact full-year layout or larger day cells for shorter periods, and open the selected day's timeline. Day/week windows also show an hourly heatmap; selecting a cell zooms to that hour. DST hours remain separate, with local-time tooltips. The daily task timeline shows one colored bar per entry, preserves overlaps, allows day selection, bar/keyboard inspection and zoom to an entry, and paginates after 12 rows. The cumulative progress chart follows recorded buckets and compares the full unfiltered period with the current scheduled target; no target comparison is shown for partial windows/filters. Current-bucket recorded time is retained and future tracked time is not projected. The activity doughnut supports slice selection and labeled filter buttons. All restored visuals use the same filtered, clipped entries as the explorer totals.
- **Tasks:** a complete, paginated ranking with time, percentage share, entry count, tracked days and average entry length. Sort by time, entries or recency; select a task to open its filtered timeline. Ticket-free work is grouped by activity and comment instead of one large miscellaneous total.
- **Work patterns:** weekday and original-entry-length breakdowns act as filters. A time-of-day chart, recorded context switches, longest continuous block, overlapping time, covered clock time and billable availability explain the sequence behind the totals.
- Search ticket number, resolved Azure title, comment or activity; combine activity, task, weekday and duration-band filters. Every visible total/chart/list uses the same selection. Filters and zoom are labeled and independently resettable. Period targets appear only for the complete unfiltered period, avoiding comparisons between one task and an entire schedule.

Explorer totals clip each worklog interval to the selected window and split it at local midnight. This intentionally differs from History and Weekly report, which attribute full durations to the reported start date. One preceding day is downloaded to catch ordinary overnight entries; entries starting earlier are not included. The live timer is never extrapolated. Duplicates are counted once; invalid dates/durations are omitted with a notice and zero-duration entries do not contribute. Period ends are exclusive, weeks start Monday, and DST follows the Mac’s calendar. Overlapping entries still add to recorded totals; overlap equals recorded duration minus the union of covered intervals. Billable seconds are allocated proportionally when clipping, with unknown values kept distinct from zero. Median and entry averages use each original worklog’s selected portion; duration-band filters always use original length. Targets use the current per-day schedule; holidays and leave are not inferred.

## End-of-day review

**Day review** checks your day's entries, daily target, long entries, possible gaps and a timer still running. Open it from the Today navigation group, the menu-bar panel, or **Command + Shift + D**. The default reminder is **17:00, Monday–Friday**, with a 09:00 workday start, a three-hour long-entry threshold and a 20-minute minimum gap. Configure times, days and thresholds under **Settings → Day review**. Those times do not automatically start, stop, or edit tracking.

The reminder opens the menu-bar panel once per local day while the app is running. Launching later that evening still catches the review; missed days do not produce a backlog. A macOS banner is also sent if notifications are enabled and already authorized. **Snooze 30 min** and **Mark day reviewed** are persisted per workspace and local date. Snooze is available on enabled review days with at least 30 minutes before midnight, including a manually opened review earlier in the day. Marking reviewed stores a local acknowledgment; it does not submit a timesheet, correct a worklog, or stop a timer. Use the explicitly labeled Pause or Stop action to change a running timer.

Review loads its own worklogs, including the previous day to catch overnight entries. It merges covered intervals for gap detection, counts duplicate IDs once, and excludes future time. It clips overnight entries to the selected day, so overnight totals can differ from History and Weekly report, which group by reported dates. Long-entry flags use the full entry duration. The current timer replaces its reported worklog only when its ID and duration are confirmed, and contributes no speculative time beyond that confirmation. Gaps are suggestions: lunch, breaks, manual totals and time off can explain them. Midnight entries, malformed data, an unidentified running timer, or unconfirmed current timer status suppress gap claims. Invalid entries are reported, not silently counted as zero.

## Timer motion

The popup and overview timer use fixed-width, rolling digits while confirmed tracking is running. A stationary text template fixes the timer’s dimensions and baseline; the digits animate in an overlay so transitions cannot shift the timer or resize the popup. A new session resets the digit transition; paused or unconfirmed time stays still. The clock responds once to a state change, using teal while running and amber with a pause symbol when paused. The ring around it shows progress toward the existing daily target, capped at one full circle. Missing totals and days without a target have an empty ring with an explanation; stale totals are labeled as last known.

macOS Reduce Motion disables digit rolling, clock scaling/fading, and ring/color interpolation. State labels and symbols remain visible. The menu-bar status item stays static between status/metadata changes, and tracking requests and confirmations are unchanged.

## Navigation and accessibility

The sidebar groups **Overview, Day review and Agenda** under Today, **Statistics, Weekly report, History and Time editor** under Insights, and **Repositories, Figma and Settings** under Setup. Full-width native buttons provide a visible selected state, readable labels and system keyboard focus. The available Command-number shortcuts follow the app’s navigation order. The menu-bar panel has larger tracking controls and a grid of labeled section buttons. It remains menu-bar-only in normal operation.

Settings are split into **Accounts, Tracking, Meetings, Day review, Appearance and App**, with a persistent **Save changes** button and **Command + S** shortcut. Edits are retained while switching Settings categories. Calendar authorization and launch-at-login changes take effect immediately; other options apply when saved. Primary actions use consistent filled buttons; icon controls have accessible labels and larger hit areas. Solid backgrounds, stronger text colors and section headings make the layout easier to scan. Enable macOS Keyboard navigation to reach all controls with Tab; VoiceOver can identify headings, selected navigation, and labeled buttons.

## Meeting suggestions and tracking status

With Calendar access enabled, **Settings → Meeting suggestions** can prompt when a timed event starts in your selected calendars. This is enabled by default. All-day, canceled, declined, and free events are excluded. Each occurrence prompts once, including across app restarts. A five-minute grace catches recently started meetings after waking your Mac; older meetings are not announced. Calendar data refreshes every 30 seconds, and start times are checked every two seconds independently of the date being browsed in Agenda.

The top-bar popover shows the meeting title and time, with **Keep current / Dismiss** and **Choose ticket / Choose activity**. A ticket can be linked using `#33984` or `AB#33984` in the meeting title, or an Azure work-item URL in its title, URL field, or notes. Work-item URLs must belong to your configured Azure organization. Ambiguous matches require ticket selection (or use your explicit default meeting ticket). You can set a fallback meeting ticket and meeting activity in Settings. Without a fixed activity, Stand-up is suggested for stand-ups and Overleg/Meeting for other events when those activity types exist. Both ticket and activity remain editable; nothing starts until **Start** is pressed. Ended or canceled suggestions cannot start a new timer.

Meeting titles and notes stay local. Only the chosen Azure ticket and activity are sent to 7pace; calendar text is never used as a tracking remark. A short-lived ledger of hashed occurrence identifiers prevents repeat prompts without saving meeting titles or notes.

The top bar keeps a clock icon beside a status indicator:

- **Green play circle:** tracking is running.
- **Amber pause circle:** paused, with a saved ticket ready to resume.
- **Stop circle:** connected, with no timer running.
- **Orange warning triangle:** disconnected or unable to confirm timer status.
- **Refresh arrows:** connecting.
- **Orange question circle:** 7pace needs an activity confirmation.

The tooltip includes the status and current ticket; the popover includes the same status in text. Icons change only when state changes, with no timer-driven redraw loop.

Text and warning colors adapt to light and dark appearances. Primary buttons use a dark teal fill with white text, and the popover uses a solid background for clearer contrast.

## Return after meetings, quick switch, and targets

When you start a timer through a meeting suggestion, the app remembers the previously running ticket and activity. At the scheduled meeting end, the popover offers **Resume previous…** or **Keep current**. Resume opens the activity chooser; only confirmation changes the timer. Consecutive meetings retain the original work ticket, including when both meetings use the same ticket and activity. Return details survive a restart, without persisting calendar titles. Manually pausing, stopping, changing timers, or changing workspaces invalidates the return. Old returns expire after 24 hours. A meeting started while no timer was running has no previous work to restore.

**Control + Option + T (⌃⌥T)** opens quick switch from another app. Ticket search receives keyboard focus. Your recent tickets and starred favorites are shown before searching; choosing one still requires activity confirmation. Recent/favorite IDs are stored locally for the workspace. Settings can disable the shortcut, and a registration conflict is shown with a menu-bar fallback. Registering the shortcut does not monitor your typing or require Accessibility permission.

The overview and menu popover show **Today** and **This week** progress. Defaults are **38 hours per week** and **7 hours 36 minutes per weekday**. In **Settings → Tracking**, set separate hours for Monday through Sunday (0 for days off). The **Mon–Thu 8h, Friday 6h** preset totals 38 hours. Weekly totals are calculated from the seven daily values; the same schedule feeds progress rings, day review, and weekly/monthly charts, including optional weekend targets. Existing settings are preserved until edited. Weeks run Monday–Sunday in your Mac’s time zone. Week totals load independently of the History date range. A running worklog with a known ID is counted once, and unconfirmed live time stops advancing when tracking health is stale or disconnected. If its ID is unavailable, totals use reported worklogs only. Completed logs are assigned to their reported dates; current tracking is clipped to the local day/week boundary. Totals refresh every five minutes and after tracking changes; unavailable or failed totals are labelled instead of showing a misleading zero. Reaching a target never stops your timer automatically.

**Connection health** shows the last confirmed 7pace timer time and worklog sync time. It distinguishes a confirmed timer, stale status, connection loss, rejected credentials, and denied access. Timer status becomes stale after two polling intervals plus 15 seconds (at least 90 seconds). Rejected tokens are described as potentially expired or revoked; the app cannot infer an expiry date from a rejection. Azure ticket-lookup credential problems and worklog failures appear separately, so they do not mislabel a successfully confirmed timer. **Retry** reads the current state; it never replays a failed tracking change.

## Reliability and privacy

The remote 7pace state is authoritative. The app checks it immediately before a write and refuses to proceed when the session differs from the one displayed. It serializes tracking actions, rejects stale branch suggestions, and verifies stop and start responses. A failed or timed-out write is **not automatically replayed**; a read reconciles what actually happened. If stopping succeeds but starting fails, the old timer remains stopped and the app shows the failure.

The tracking API does not expose a conditional atomic switch. Another client can still change a timer between the last state check and the write. Avoid simultaneously controlling the same timer in multiple apps. The app does not backdate sessions, queue offline tracking, or bypass 7pace idle checks. An active server activity check is shown for you to acknowledge.

Only HTTPS is accepted. Tracking tokens go to the configured `*.timehub.7pace.com` host; Azure PATs go to `dev.azure.com`. Redirects are rejected. HTTP 429 `Retry-After` is respected; increase the refresh interval for restricted API plans. Normal state polling defaults to once a minute, with history refreshed at most every five minutes or after a tracking change. No telemetry or third-party packages.

Non-secret settings, pending decisions, and the activity journal are stored at `~/Library/Application Support/Azure timetracker/state.json`. Calendar events and normal worklog lists are held in memory. The undo/recovery journal is stored separately in `time-edit-history.json` and contains affected worklog snapshots; `weekly-report-drafts.json` contains locally saved report text. These files use the same private Application Support directory and file permissions as settings. Keychain service: `be.yarne.azure-timetracker`. Repositories are read without executing hooks or changing files.

## Build and test

Requires macOS and Apple Command Line Tools with Swift 6. The app targets macOS 14 or later. The universal installer contains Apple Silicon and Intel binaries; runtime checks have been performed on Apple Silicon macOS 27.0.1. Intel and older macOS runtime behavior still needs verification. No Xcode project or third-party dependencies are needed; open `Package.swift` in Xcode if desired.

```bash
./scripts/build-app.sh
./scripts/test.sh
./scripts/build-installer.sh
```

The build script creates an app beside the source directory. It uses the persistent local certificate configured outside Git on the release Mac, or an explicit `AZURE_TIME_SIGN_IDENTITY`. With neither configured, it falls back to ad-hoc development signing. See [Signing and stable permissions](Resources/Signing.md) before distributing updates. Use `AZURE_TIME_BUILD_DIR` to choose the scratch directory. The test script explicitly supplies the Swift Testing macro plugin where the command-line toolchain requires it. `ViewState` aliases SwiftUI’s existing property wrapper because this macOS 27 Command Line Tools installation does not include the newer SwiftUI macro plugin.

The installer script cross-compiles both architectures and creates a `.pkg`, checksum, installation guide beside the source folder (or in its first argument). It installs only the app in `/Applications`, preserving per-user settings and Keychain credentials. The default installer is unsigned and not notarized; see [the installation guide](Resources/Installation%20guide.md) for macOS approval details. To produce a signed build, set both `AZURE_TIME_SIGN_IDENTITY` to a Developer ID Application identity and `AZURE_TIME_INSTALLER_IDENTITY` to a Developer ID Installer identity. Notarization remains a separate release step; signing alone is not notarization.

For drag-and-drop distribution, `bash scripts/build-dmg.sh /path/to/Azure\ timetracker.app /path/to/output` packages an existing verified universal app into a compressed, read-only `.dmg` with an Applications shortcut and installation instructions. It also writes a SHA-256 checksum. The script does not rebuild or install the app; both architecture slices must already be present. `AZURE_TIME_BUILD_DIR` controls its staging directory. The DMG script detects Developer ID app signatures, signs the image when a signing identity is provided, and labels its status accurately. It does not add notarization.

Architecture:

- `Sources/AzureTimetrackerCore`: API contracts, transport, ticket parsing, Git reads, debounce, tracking transaction logic.
- `Sources/AzureTimetracker`: native UI, application state, notifications, Keychain, calendar access and local persistence.
- `Tests/AzureTimetrackerCoreTests`: isolated Git/worktree tests, tracking failure tests, and URLProtocol-backed API contract tests. No real account mutations.

For isolated UI checks, launch the app with `--preview --data-dir /absolute/path/to/scratch`. Preview mode disables API calls, credential writes and calendar access. It still reads watched repository HEAD files. Use a scratch configuration to test branch notifications inside the overview.

A developer-only `-Xswiftc -DUI_PREVIEW` build opens the Time editor with isolated sample data and a server-stop prompt, disables account access and repository discovery, and reads only an adjacent `interface-preview-state.json` if present. `InterfacePreview.swift` and that startup behavior are compiled out of normal distribution builds. Use a distinct preview bundle identifier when running beside the installed app.

## API references

- [7pace authentication](https://appfire.atlassian.net/wiki/spaces/7TFA/pages/1253539983/7pace%2BTimetracker%2BAPI%2BImportant%2BInformation)
- [7pace worklog CRUD API](https://appfire.atlassian.net/wiki/spaces/7TFA/pages/1253540003)
- [7pace tracking API](https://appfire.atlassian.net/wiki/spaces/7TFA/pages/1253540758/7pace%2BTimetracker%2BClient%2BTracking%2BAPI)
- [7pace v3.2 OpenAPI schema](https://timehub.7pace.com/Content/api-reference/api-reference-v3.2.json)
- [Azure work item API](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1)
- [Apple EventKit access](https://developer.apple.com/documentation/eventkit/accessing-the-event-store)
- [Apple Core Audio process input status](https://developer.apple.com/documentation/coreaudio/kaudioprocesspropertyisrunninginput)

PIN pairing and refresh follow the documented 7pace OAuth flow. Refreshes are shared across clients and persisted before use; failed timer writes are never replayed. Pairing immediately saves credentials for that workspace, while **Save changes** activates the selected sign-in method. The API-token fallback preserves existing setups.

## Menu-bar timer

The menu bar shows the clock and current elapsed time. Tracking state remains available in its accessible description, tooltip and popover. Version 1.8 uses an inset vector clock on a fixed 16-point template canvas with proportional downscaling, preventing oversized symbol bounds from clipping the clock.

## Icon refresh (1.7.1)

A white clock on a flat charcoal tile replaces the coloured stopwatch app icon. The menu bar uses a monochrome clock template beside elapsed time, appearing white on dark menu bars and adapting to light backgrounds for contrast.


## Version 1.9.0 — comparisons, calendar exceptions and offline drafts

Period comparisons reuse explorer filters across two day/week/month/year periods. Previous period is the default; a custom date selects another same-sized calendar period. Matching elapsed days/time clips an unfinished current period and its baseline using local calendar components. Grouped charts align by ordinal hour/day/month and expose exact dates when selected. Unequal month lengths have absent buckets instead of invented data; percentage changes from zero are labeled new. Activity and task tables include items appearing on either side. Comparisons ignore explorer zoom and exclude local drafts; they load paginated worklogs without a lower start bound so older entries crossing a boundary are included.

Belgian public holidays use Gregorian computus for Easter Monday, Ascension and Whit Monday plus seven fixed dates. The ten holidays are enabled by default, including for migrated settings; disable in Settings → Tracking if needed. Rules source: https://employment.belgium.be/en/themes/international/posting/working-conditions-be-respected-case-posting-belgium/public-holidays. Employer replacement days must be entered explicitly: the app cannot know agreed replacements. Date exceptions override holidays and weekday targets; half-days use half of the scheduled weekday. Bulk date ranges, removal and custom hours are supported. Progress, statistics and day reviews share these targets; zero-target days suppress automatic day-review reminders. Historical targets reflect the current schedule and date exceptions, not a versioned employment calendar.

Offline drafts are separate from the remote timer and are stored in `offline-drafts.json` beside `state.json` (directory 0700, file 0600). Activity choices are cached per normalized workspace URL. There can be one local timer across workspaces; it survives sleep/restart and can be stopped even after changing workspace. Draft uploads belong to the currently authenticated 7pace user. A review reads all potentially overlapping worklogs and current tracking status; warnings do not forbid upload. An explicit upload rechecks overlaps, exact duplicates, workspace and live activity choices. Changed warnings require a refreshed review. The sending checkpoint is durable before POST; a lost response, unexpected confirmation or failed final checkpoint leaves the draft flagged for reconciliation. Such a draft cannot be replayed or edited until linked to an existing matching entry or manually cleared after checking 7pace. Successful creates retain the returned ID. No automatic upload, retry, remote timer stop, or inclusion in confirmed totals occurs. Preview builds use synthetic data and never persist drafts or access accounts. Unit tests simulate remote writes; live production writes are not used for validation.

Automatic updates were explicitly deferred for this release. No updater framework or release feed was added.


## Version 1.10.0 — microphone ending suggestions and release signing

After 60 seconds of confirmed absence in all selected microphone apps, a separate suggestion offers Keep tracking, Pause and Stop. It also works for a ticket-free standup started while idle, or an existing ticket kept running during a call. It binds the actual microphone session to a confirmed 7pace timer; a stale reminder cannot change a different timer. Brief muting, HAL read failures and gaps caused by sleep do not establish an ending. New microphone input dismisses an outdated prompt, and overlapping app use defers it until all watched input sessions end. Keep dismisses that occurrence without repeating it. Pause stops the remote timer and retains a local resume choice; neither action is automatic. Previous-ticket return remains available when there is a previous ticket. The session associations and prompt acknowledgment survive restart.

New configurations enable Slack, Microsoft Teams, Zoom and Google Meet / web browsers. Existing explicit enabled/app choices are preserved. Google Meet is detected through the browser's microphone owner; the app cannot identify an individual tab or distinguish Meet from another browser call or recording.

Both app and installer builds use the shared signing helper with Calendar resource access. A Developer ID certificate enables Hardened Runtime, secure timestamps and stable designated requirements; the bundle ID and Keychain service are unchanged. There is no valid Developer ID identity on the development Mac at validation time, so the supplied 1.10.0 artifacts remain ad-hoc and not notarized. Signing/notarization steps are documented in Resources/Signing.md; no private keys, TCC resets or permissive Keychain ACL changes are included.

Choose **Repositories → Add from folder…** to scan a parent folder recursively, filter results and select which Git checkouts/worktrees to watch. Existing repositories are marked and never added twice. Cancel closes the dialog and stops the scan.

## New in 1.11.0

- **Ticket completion reminders:** enabled by default in Settings → Tracking. With an Azure PAT (Work Items read access), the active ticket is checked about once per minute using its project’s workflow categories. A completed ticket opens the menu panel with Keep tracking, Stop and Switch ticket. Keep applies to the current session; reopening and completing again permits another reminder. Stop rechecks Azure and the 7pace session before changing tracking. Ticket-free meetings are excluded, and Azure lookup problems do not mark a healthy 7pace connection offline.
- **Simpler connection status:** one “7pace connected” indicator during normal use. Details contains timestamps and diagnostics; reconnection/setup actions appear when needed. The menu panel keeps unsent offline drafts visible.
- **Prominent branch changes:** a shared amber card at the top of Overview and the menu panel shows repository, previous/new branch and suggested ticket. An Overview badge counts pending changes. Existing activity confirmation and develop/long-feature Pause/Stop behavior are preserved.

Workflow detection uses the [Azure Work Item Type States API](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-type-states/list?view=azure-devops-rest-7.1) and its Completed category; names such as Done, Closed or custom state names are not guessed without the category mapping.

## New in 1.12.0 — time awareness and guided corrections

**Settings → Tracking → Time awareness** controls passive inactivity (default 5 minutes), screen lock/sleep/session detection, and forgotten-timer reminders (default 10 active minutes). The app reads Core Graphics elapsed input inactivity plus the foreground application identity. It never captures keys, mouse coordinates, window/document contents or screenshots, and does not request Input Monitoring or Accessibility access. Lock events use distributed macOS screen-lock notifications and an optional session-state check, supplemented by workspace sleep/display/session notifications. The lock signals are best-effort OS integration, not a documented Apple guarantee across macOS releases.

Idle detection captures the last-input or lock boundary, clamped to the confirmed current session, and prompts on return. Detected microphone/calendar meetings suppress passive inactivity but not explicit screen lock. **Keep time** leaves 7pace untouched. **Pause & review** first saves the interval locally and stops the same confirmed remote session, then opens a before/after preview. Remove only the idle interval (retaining work on both sides), or split it into a separate ticket/activity/comment. Applying and undoing use the existing persisted worklog operation journal, with permission/concurrent-change checks and no automatic write retries. Cancel leaves recorded time intact and the timer paused; the saved review remains accessible from Overview/menu until applied or dismissed. Timer changes invalidate old pending idle prompts. Detection never silently pauses, resumes or edits time.

Forgotten-timer reminders require a confirmed stopped remote timer, recent input in selected work apps, configured work hours from Day review, and a positive target for that day. They are suppressed by an explicit pause, an offline timer or a detected meeting. Long sampling interruptions never count as active work. Choose from watched branch tickets (without guessing the foreground repository), choose another ticket, snooze 15 minutes or ignore the local day. Snooze/ignore persist by workspace. Start uses the normal activity chooser and current time; it never backfills earlier work. Default apps are VS Code, Terminal, iTerm2, Cursor, Codex and Xcode; add/remove app bundles in Settings. Reminders open the menu panel and use already-authorized macOS banners when enabled.

**Time editor → Gaps & overlaps** and the Day review link inspect the elapsed configured workday using the union of recorded intervals, including overnight entries. The gap threshold follows Day review. A running timer crossing the review window must be paused/stopped first. Gaps can be extended from a neighboring task; overlaps can be removed from either entry while retaining both remaining sides, or resolved with a shared boundary between staggered entries. A before/after chart previews every affected interval before **Apply correction**. Corrections do not silently remove whole entries, automatically fill breaks or change the existing advisory-only overlap policy. A day without entries has no neighboring task to extend; use Offline drafts → Add past time for a new entry. Explicit billable time is apportioned when removing/splitting intervals. Confirmed corrections are undoable from Recent edits.

That release did not include automatic update checks. Version 1.13.0 adds the update system described below.


## New in 1.13.0 — updates from GitHub

Install 1.13.0 manually once. From version 1.13.1, the app checks a signed JSON feed at startup and every minute, with a manual **Check for updates** action in **Settings → App**. New releases appear in the overview and menu-bar panel. Read the release notes, choose **Download update**, then **Install and restart**. Downloads are verified before the app is replaced; the previous app is kept for recovery. The remote 7pace timer keeps running during restart.

Automatic checks can be disabled in Settings. Installation always requires your choice. Protected installation folders may require the DMG/PKG instead; a personal Applications folder supports updates without administrator access. The updater does not remove quarantine or modify macOS permissions. Ad-hoc builds can still prompt for Keychain/Calendar access. See [release and update instructions](releases/README.md) for publishing, signature verification and recovery details.

## Appearance, ticket-free tracking and local timer display (1.14.0)

**Settings → Appearance** provides Light / Dark / System, 90–150% scale, and System / Standard / Increased contrast. Defaults preserve the existing System appearance at 100% scale. Preferences save immediately; enlarged pages and dialogs scroll when needed. Fresh installations are asked during onboarding; existing settings do not trigger onboarding again. The menu-bar icon stays its standard size.

**Switch ticket** now offers **Meeting**, **Stand-up** and **Other activity** in both the window and menu panel. No ID or title is required. Choose the activity and optionally provide a comment before pressing Start. Stand-up requires the Standup activity and uses `daily standup` when the comment is blank. Other entries use the meeting/activity name as their default comment. These use the normal guarded 7pace transaction; nothing is written while choosing.

A local/offline timer is visible in the overview and menu panel, with a live elapsed clock and **Stop local timer**. It supplies the menu-bar time when no confirmed remote timer is running. If both run, the local timer is still visible separately. Local time remains excluded from confirmed totals until reviewed and uploaded.

## Figma Desktop context (1.14.0)

Open **Setup → Figma** and enable **Observe Figma files** (off by default). Grant Accessibility to the installed, persistently signed app. Only `com.figma.Desktop` is observed, every two seconds while work observation is enabled. The reader requests Electron accessibility once per process, starts at the focused window and reads only the title, AXURL and AXDocument while traversing at most 200 nodes. Each AX call has a 120 ms timeout and the scan has an overall deadline, off the main thread. A fresh process gets a new tree request. No Figma API, plugin or account is used.

Exact HTTPS Figma `design`, `file`, `board` and `slides` URLs identify files. Two consecutive observations spanning two seconds activate a file once. A file switch can suggest again; the same file can reactivate after 15 minutes away. The status preserves the last result seen in foreground Figma when you return to this app.

File names and activation timestamps are kept locally, with separate ticket links scoped to your Azure organization and 7pace workspace. Search by file, key, ticket number or cached ticket title; link, relink, unlink, open in Desktop/browser, and see the most recently worked linked ticket and its files. Linking never changes hours. Suggestions use **Design** (case-insensitive activity lookup), revalidate before remote writes and save the file link after a confirmed start. A missing Design activity prevents starting. The active linked ticket suppresses a suggestion. Keep tracking suppresses that exact suggestion for 15 minutes (configurable 0–120); switching files clears other-file suppressions. Proposals expire after 24 hours, with at most 12 retained. Last-focused linked context can prefill ticket and Design in quick switch; **Choose different work** gives access to all choices, including explicit no-ticket work.

The local context history retains activations for 30 days by default (configurable, maximum 5,000 records). Clear history keeps files, links and hours. **Review day** opens existing day review; observations themselves are not worklogs and do not automatically reconstruct or backdate time. Disable Figma or pause watching to stop observation while preserving the file register. Diagnostics log only Accessibility error codes, never window titles.

The public 1.14.0 app uses a persistent local certificate. It is not Developer ID signed or notarized. See [Signing and stable permissions](Resources/Signing.md) for the external key backup, migration and build process.
