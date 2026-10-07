# Azure timetracker 2.0 — cross-platform rewrite plan

Date: 5 October 2026. Baseline: version 1.14.2 (build 24), Swift 6 / SwiftUI, macOS 14+.

## 1. Summary

- Keep every feature that ships in 1.14.2 and rebuild the app once for macOS and Windows.
- Stack, decided on 5 October 2026: **Tauri 2** with a **Rust core** and a **TypeScript (React) UI** rendered in the OS web view (WKWebView on macOS, WebView2 on Windows). All decisions are listed in §15.
- The existing Swift `AzureTimetrackerCore` module is pure Foundation code with injected clocks and 297 tests. It ports 1:1 to Rust crates, test by test, so the tracking rules, journals and statistics keep their exact behaviour.
- The macOS-only plumbing (menu bar, Keychain, EventKit, Core Audio, idle and lock signals, Accessibility reader, hotkey, updater) moves behind platform traits with a macOS and a Windows implementation each.
- The UI is rebuilt around accessible primitives, a design-token system, a single push-based state stream and a feature registry so that every module is user-switchable.
- Rough effort: 18–20 engineer-weeks for one engineer, or 10–12 calendar weeks with a Rust engineer and a UI engineer in parallel. These are estimates, not commitments.

## 2. What exists today

| Part | Size | Nature | Portability |
|---|---|---|---|
| `Sources/AzureTimetrackerCore` | 32 files, ~3,500 lines | Models, 7pace/Azure clients, tracking transaction, worklog edit/split/merge/undo journal, time corrections, offline drafts, targets/holidays, statistics explorer, day review, meeting/microphone/Figma/idle/completion engines, update trust | Foundation only (+CryptoKit for Ed25519/SHA-256). State machines take `now:` and `calendar:` as inputs. Direct Rust port. |
| `Sources/AzureTimetracker` | 45 files, ~7,800 lines | SwiftUI + AppKit: menu-bar popover, main window with 11 pages, Statistics with Swift Charts, Time editor, sheets, services | Replaced entirely. The UI surface map in §6 is the parity contract. |
| `Tests/AzureTimetrackerCoreTests` | 24 files, 297 tests | Wire contracts via `URLProtocol` mocks, in-memory fakes, temp folders, fixed `Europe/Brussels` calendar | Ported as the Rust regression suite. |
| `scripts/`, `Sources/AzureTimetrackerUpdater`, `Sources/AzureTimetrackerRelease` | shell + python + 2 helper executables | macOS-only build, self-signed local certificate, no notarization, no CI, binaries committed to git | Replaced by Tauri CLI, CI and a release tool. The legacy Ed25519 feed and its Swift signer stay alive for one bridge release (§11). |

**Dead code that will not be ported:** Slack huddle detection (`SlackHuddles.swift`, no UI references), `DetailedStatistics`, the `WorkLogEditing` path (the app uses `WorkLogOperations`), `ContextInsightsView`, `TimerAnimationPreview`, and the already removed Compare periods. The `slackHuddles` and `slackReminders` keys are read by the importer and dropped.

## 3. Target stack and why

| Layer | Choice | Reason |
|---|---|---|
| Shell | Tauri 2 | Tray icon with macOS title text, tray-anchored windows (positioner plugin), global shortcut, notification, autostart, dialog, opener, clipboard, single-instance, window-state and **updater** plugins. The updater uses Ed25519 (minisign) signatures over a JSON feed, which matches the current design. Small binaries, low memory, system web view. |
| Core | Rust (crates below) | Direct target for the pure Swift core; `Sendable` value types and actors map to owned structs and `tokio` tasks. Strong testing story (`wiremock`, property tests). One build for both OSes. |
| UI | React 19 + TypeScript + Vite, React Aria Components, CSS tokens (light/dark/contrast), visx for charts | React Aria gives keyboard and screen-reader behaviour for combobox, dialog, popover, grid, date and time fields out of the box. Web accessibility tooling (axe, jsx-a11y, Playwright) is the most mature available. Charts with zoom, drag and heatmaps are easier in SVG/canvas than in Swift Charts. |
| IPC | `tauri-specta` typed commands and events | Rust types generate the TypeScript types, so the UI cannot drift from the core. |
| Storage | SQLite (`rusqlite`, WAL) | Row-level writes instead of rewriting a 5,000-entry JSON document on every tick. Indexed audit, history and worklog cache. |
| Credentials | `keyring` crate | macOS Keychain and Windows Credential Manager behind one API. |
| Time | `jiff` | Zone-aware civil time with explicit DST ambiguity handling, which the edit validation and day/week clipping rules depend on. |
| Regex | `fancy-regex` for user patterns and the meeting marker | The default branch pattern and the meeting-title marker use ICU features (lookbehind). Guarded with a size and time limit. |
| HTTP | `reqwest` + `rustls`, redirects disabled | Same transport rules as today: HTTPS only, pinned hosts, 20 s / 30 s timeouts, no cookies or cache, 429 `Retry-After` host block. |

**Alternative considered:** Avalonia with C#/.NET 8 is the right choice only if the team is .NET-first and does not want to learn Rust. It has a tray icon, native interop and Velopack updates, but weaker accessibility, charting and web-view-free UI tooling. Electron was rejected on memory and startup cost. Swift on Windows was rejected because there is no SwiftUI there. Flutter was rejected because tray-first apps and desktop accessibility are weak fits.

## 4. Architecture

```
apps/desktop/            Tauri app: src-tauri (commands, tray, windows, plugin wiring, capabilities) + src (React UI)
crates/att-core/         Pure domain. No I/O. Port of AzureTimetrackerCore with its tests.
crates/att-net/          7pace, Azure DevOps, 7pace OAuth/PIN, update feed. Trait-based; wiremock contract tests.
crates/att-platform/     Traits + macos/ + windows/ implementations (see §5). Shared Git HEAD reader.
crates/att-store/        SQLite schema, migrations, worklog cache, journals, importer for 1.14.x data.
crates/att-engine/       Orchestration: scheduler, AppState, intent handlers, event bus, feature registry.
packages/ui/             Design tokens and accessible components.
packages/charts/         Time explorer, heatmaps, timeline, progress, donut, with data-table twins.
packages/ipc/            Generated TypeScript bindings.
tools/xtask/             Release automation: build, sign, feed, verify, bridge ZIP builder (the legacy Swift signer is reused).
legacy/swift/            The 1.14.x source, kept until the bridge release has shipped.
```

**Data flow.** The engine owns one `AppState`. Platform probes and network pollers run on a `tokio` runtime off the UI thread. Each tick produces a typed delta; the engine emits an event only when a slice actually changed. The UI keeps a mirrored store and renders from it. User actions are intents (`tracking.switch`, `worklog.apply_plan`, `draft.upload`, …) that the engine validates against the remote state exactly as `TrackingTransaction` and `WorkLogOperations` do today: read current, compare identity, write once, confirm, never replay.

**Scheduler.** One scheduler with named cadences, all user-adjustable within bounds:

| Cadence | Default | Today |
|---|---|---|
| Git HEAD | file-system watcher with a 2 s polling fallback, two identical reads confirm | 2 s poll |
| Presence (idle, lock, foreground app) | 2 s | 2 s |
| Microphone owners | 2 s | 2 s |
| Figma window | 2 s while enabled and Figma is frontmost | 2 s |
| 7pace current timer | 60 s (30–300) | 60 s |
| Azure ticket state while tracking | 60 s | 60 s |
| Calendar | 30 s | 30 s |
| Progress and history | 300 s or after a tracking change | 300 s |
| Update feed | 60 s (60 s to 24 h) | 60 s |

**Feature registry.** Every module declares a manifest: id, title, one-line summary, privacy line (what it reads, what leaves the machine), default state, requirements (OS, permission, credential), cadence bounds and a settings schema. Disabled modules are not scheduled and never request a permission. Settings → Features is generated from the manifests.

## 5. Platform capability map

| Capability | macOS implementation | Windows implementation | Note |
|---|---|---|---|
| Tray / menu bar | Tray icon + live title ` HH:MM:SS` (Tauri supports a tray title on macOS) + tooltip + accessible label | Tray icon with state colour, tooltip with elapsed time, optional floating mini-timer window (user setting) | Windows tray icons cannot show text. |
| Popover | Frameless, always-on-top window anchored with the positioner plugin, closes on blur | Same, anchored to the tray corner | One web view, preloaded and hidden for instant open. |
| No Dock / taskbar entry | `ActivationPolicy::Accessory` | `skip_taskbar`, no main window at launch | Same lifecycle as today. |
| Credentials | Keychain via `keyring`, same service `be.yarne.azure-timetracker` and account names | Credential Manager via `keyring` | Same local certificate and bundle ID as 1.14.x, so the Keychain ACL matches and nothing prompts. |
| Calendar | EventKit (`objc2-event-kit`): full-access prompt, calendar colours, declined/free/cancelled filters | **Not available at launch.** The module is macOS-only in the registry: no Agenda page, no meeting prompts and no permission request on Windows. | The Windows local calendar store needs package identity and is tied to the retiring Mail & Calendar app. Microsoft Graph stays the future option for Windows and for Macs without Apple Calendar; it would need an Entra app registration. |
| Microphone in use | Core Audio process list (`kAudioHardwarePropertyProcessObjectList`, `kAudioProcessPropertyIsRunningInput`), 14.2+ | Registry `CapabilityAccessManager\ConsentStore\microphone` incl. `NonPackaged` subkeys, `LastUsedTimeStop == 0` means in use; cross-checked with WASAPI capture sessions (`IAudioSessionControl2::GetProcessId`, state Active) | App identity becomes a per-OS list: bundle IDs on macOS, executable names on Windows (`slack.exe`, `ms-teams.exe`, `Zoom.exe`, browsers, `CiscoCollabHost.exe`, `Discord.exe`). |
| Idle time | `CGEventSourceSecondsSinceLastEventType` | `GetLastInputInfo` | Same 5 min default. |
| Foreground app | `NSWorkspace.frontmostApplication` | `GetForegroundWindow` → PID → executable path | Work-app list stored per OS. |
| Screen lock | Distributed `com.apple.screenIsLocked` + `CGSessionCopyCurrentDictionary` poll | `WTSRegisterSessionNotification` (lock/unlock) | |
| Sleep / wake | `NSWorkspace` will-sleep / did-wake | `WM_POWERBROADCAST` suspend / resume | |
| Figma observer | Accessibility API via `accessibility-sys`, same 200-node, 120 ms, 1.8 s limits | UI Automation on the Figma window: title first, document URL from the root Document value pattern (best effort) | Windows ships title-first at launch, marked experimental; URL reading is a phase 0 spike. |
| Global hotkey | global-shortcut plugin, default ⌃⌥T preserved | Same plugin, default **Ctrl+Alt+Shift+T** | Ctrl+Alt is AltGr on Belgian AZERTY. User-configurable on both. |
| Notifications with actions | `UNUserNotificationCenter` via `objc2-user-notifications` (needs a bundled, signed app; the local certificate suffices) | WinRT toasts with buttons | Plain banners go through the Tauri plugin; actionable ones through a small native layer. |
| Launch at login | `SMAppService` via `objc2-service-management` | Registry Run key (autostart plugin) | Keeps the System Settings → Login Items integration. |
| Open URLs / apps | opener plugin (`figma://`, `https`, Calendar app) | opener plugin | |
| File dialogs, clipboard | dialog + clipboard plugins | same | CSV and Markdown export, repository folder picker. |
| Reduced motion, contrast, scale | `prefers-reduced-motion`, `prefers-contrast`, root font-size | Same media queries plus `forced-colors` for High Contrast themes | WebView2 honours the Windows animation and contrast settings. |
| Data directory | `~/Library/Application Support/be.yarne.azure-timetracker/` | `%APPDATA%\be.yarne.azure-timetracker\` | Importer reads the old `Azure timetracker/` folder. |
| Git HEAD | Shared: read `.git/HEAD` or follow `gitdir:` pointers, 8 KB limit, no hooks executed | Same, with Windows drive-letter absolute paths | Fixes the `/`-only absolute path check. |
| Repository scan | Shared read-only walk, symlinks skipped | Same; `.app` bundle skipping is macOS-only | |

## 6. Feature parity matrix

Every row is an acceptance item. "Core" means ported logic with tests; "UI" means a rebuilt screen.

| Feature (1.14.2) | Core | UI | Platform |
|---|---|---|---|
| Accounts: organisation, project, 7pace URL validation, Azure PAT, API token or Mobile PIN pairing, token refresh single-flight, Keychain binding per account | `att-net` 7pace/Azure/OAuth clients | Settings → Accounts, PIN pairing panel (2 s poll, 60 s limit) | Credentials trait |
| Branch watching: HEAD reads, worktrees, debounce, ticket extraction with user regex and live tester, `develop`/`long-feature` break policy, baseline on startup, audit log capped at 2,000 | `att-core::git` | Branch change card (window + panel), Repositories page, Add from folder scan | Shared |
| Tracking: start/switch/stop/pause/resume, activity chooser, ticket search, ticket-free Meeting/Stand-up/Other, session identity checks, no replayed writes, server time-limit and activity-check prompts, connection health and staleness | `att-core::tracking`, `att-net` | Overview timer card, menu panel, Ticket and Activity pickers, attention prompt | — |
| Quick switch with recents and favourites | `att-core::quick_tickets` | Panel in tracking mode, autofocused search | Hotkey trait |
| Menu-bar timer with rolling digits, status icon states, progress ring, reduced motion | — | Tray + panel timer component | Tray |
| History: 7pace worklogs by range, pagination, totals, filter, CSV export (formula-safe); App activity audit | `att-store` worklog cache | History page | Dialog |
| Time editor: table, edit across midnight, split, merge, undo, overlap advisory checks, external-change checks, recovery journal with needs-review state | `att-core::worklog_ops` | Time editor page, edit sheet, Recent edits | — |
| Gaps & overlaps corrections with before/after preview; idle Pause & review | `att-core::corrections` | Correction sheets | — |
| Weekly report Markdown drafts, copy, export | `att-core::insights` | Weekly report page | Clipboard, dialog |
| Statistics: Day/Week/Month/Year, Time explorer with zoom/drag/keyboard, resolutions, heatmaps, timeline, progress, donut, Tasks ranking, Work patterns, filters and search, clipping at midnight, billable proration | `att-core::explorer`, `explorer_visuals` | Statistics page, `packages/charts` with table twins | — |
| Targets: per-weekday hours, 38 h preset, Belgian holidays (computus), exceptions, half days | `att-core::targets` | Settings → Tracking, Holiday settings | — |
| Day review: schedule, snooze, mark reviewed, gaps, long entries, running timer | `att-core::day_review` | Day review page and prompt | Notifications |
| Calendar meetings: suggestions once per occurrence, 5 min grace, ticket from `#id`/`AB#id`/work-item URL, activity guess, meeting return after end | `att-core::meetings` | Agenda page, meeting prompt, return prompt | Calendar trait |
| Microphone meetings: 4 s start, 60 s end, app categories, meeting-end prompt, diagnostics | `att-core::microphone` | Prompts, Settings → Meetings | Microphone trait |
| Time awareness: idle, lock, forgotten-timer reminders with work apps | `att-core::awareness` | Prompts, Settings → Tracking | Presence trait |
| Ticket completion reminders via Azure state categories | `att-core::completion` | Prompt | — |
| Figma context: file register, dwell activation, links, suggestions, history retention, Design activity | `att-core::figma` | Figma page, link sheet, prompt | App observer trait |
| Offline drafts and local timer: one running draft, review, upload with checkpoints, link existing, past time entry | `att-core::offline` | Offline drafts page, local timer view | — |
| Ticket context panel with plain-text HTML rendering and links | `att-core::ticket_context` | Context sheet | Opener |
| Appearance: Light/Dark/System, 90–150 % scale, contrast; onboarding | `att-core::interface_prefs` | Settings → Appearance, onboarding | Media queries |
| Updates: signed feed, release notes, download, verify, install and restart, automatic checks toggle | Tauri updater + `att-net` | Update banner and details | Updater |
| Launch at login, notifications toggle, keyboard help | — | Settings → App | Autostart, notifications |
| Preview / isolated UI mode | — | Storybook-style mock IPC with the existing preview scenarios | — |

## 7. Performance plan

Problems found in the current app and the fix for each:

| Problem today | Fix |
|---|---|
| One `AppModel` with 64 published properties fires on every assignment; the whole UI re-renders about every 2 s | Engine emits per-slice events only on change; UI store updates are granular. |
| `persist()` rewrites the full pretty-printed `state.json` (up to 2,000 audit and 5,000 Figma rows) on the main thread from per-tick paths | SQLite row writes on a background task; retention caps enforced by the schema. |
| EventKit query, lock-state read, Git probe and Figma AX walk run synchronously on the main thread | All probes run on the runtime's blocking pool with deadlines; the UI thread never does I/O. |
| Target progress recomputed over the week's logs once per second in two views | Compute the base on data change; the 1 Hz ticker adds elapsed seconds only. |
| History, progress, statistics, day review, weekly report and time editor each fetch overlapping worklog ranges; 2–3 fetches per tracking change | One `WorklogRepository` with a SQLite cache and range coverage; fetches coalesce; writes still re-read before they act. |
| Ticket titles loaded one at a time, each triggering a full statistics re-analysis | Azure `workitemsbatch` (200 ids per call) and a title cache; analysis runs once per dataset change. |
| Update download appends one byte at a time | Streamed 64 KiB chunks to disk with progress. |
| Overlap scan has no lower bound | Keep the unbounded scan (it is a documented feature), but run it in the background with a cancel control and page through the cache first. |
| Update feed checked every 60 s | Kept at 60 s by default and made configurable. `raw.githubusercontent.com` caches for about five minutes, so detection latency is bounded by the CDN rather than the poll. |

**Budgets (CI-checked where possible):** cold start to tray under 1 s; popover open under 100 ms; idle CPU under 0.3 % averaged over a minute with all probes on; resident memory under 100 MB with both windows open; no UI-thread task over 16 ms during polling; installer under 15 MB.

## 8. UI and accessibility plan

**Keep:** the sidebar groups (Today / Insights / Setup), the panel structure (prompts, current tracking, actions, local timer, progress, health, updates, section grid), every prompt type and button label, the status icon vocabulary, the appearance preferences.

**Improve:**

- Design tokens for colour, spacing, type and motion with light, dark, increased-contrast and forced-colours variants. No hard-coded colours (the gradient timer card, mint/yellow digits, orange banners and heatmap text today ignore the contrast setting).
- Scale by root font-size so pages reflow instead of being scaled with `scaleEffect`.
- Fix the ⌘-number map (today Offline drafts and Overview both get ⌘1, Figma gets ⌘0, and the help text is wrong). Shortcuts follow the sidebar order and are listed in a `?` cheat sheet.
- Command palette (⌘K / Ctrl+K) for pages and tracking actions.
- Prompt behaviour is a setting per prompt type: notify only, open panel without focus, open and focus, off. Today every suggestion steals focus.
- Panel prioritises one "next action" area; secondary sections collapse.
- Windows gets a floating mini-timer window to replace the menu-bar text.
- Empty, loading and error states for every page; lists are virtualised.

**Accessibility targets (WCAG 2.2 AA):**

- React Aria primitives for combobox (ticket search), dialog, popover, grid/table with selection, date and time fields, tabs, menus, switches.
- Landmarks and headings on every page; the tray and panel expose status text, not just icons.
- `aria-live="polite"` for prompt arrival and tracking state changes; the timer is not announced every second.
- Every chart has a data-table twin and keyboard navigation of bars and cells; colour is never the only signal (patterns and labels).
- Reduced motion honoured everywhere, not only in the timer.
- Focus is trapped in sheets and returned on close; the popover is reachable by keyboard from the tray.
- English only at launch. Strings are still externalised so a later language is cheap.
- Test matrix: VoiceOver on macOS, NVDA and Narrator on Windows, axe-core in unit and Playwright tests, `eslint-plugin-jsx-a11y`.

## 9. User-controlled features

Settings gains a **Features** page generated from the registry (§4). Each row shows the toggle, the privacy line and the permission it needs. Modules:

Git branch watching · Calendar meetings · Microphone meetings · Meeting-end reminders · Time awareness (idle, lock) · Forgotten-timer reminders · Ticket completion reminders · Figma context · Day review · Targets and holidays · Offline drafts and local timer · Weekly report · Statistics · Time editor · Quick switch · Updates · Launch at login · Notifications.

Also user-controlled: every polling cadence within bounds, per-prompt interruption level, quiet hours, Windows mini-timer, hotkey binding, and the work-app and microphone-app lists per OS.

## 10. Data, credentials and migration from 1.14.x

- **Importer** (macOS only, runs once on first launch of 2.0): reads `state.json`, `offline-drafts.json`, `time-edit-history.json` and `weekly-report-drafts.json` from `~/Library/Application Support/Azure timetracker/`, converts and writes SQLite, then leaves the originals in place with a `.imported` marker.
  - Swift `Date` values are seconds since 2001-01-01, not 1970.
  - Enums stored as display strings (`"Local draft"`, `"Full-day leave"`, `"Microsoft Teams"`) map to stable identifiers.
  - Day-review keys are `workspace|y-m-d` without zero padding.
  - Keychain items are read by service `be.yarne.azure-timetracker` and accounts `7pace:<host>`, `azure:<org>`, `7pace-oauth:<host>`. Because 2.0 is signed with the same local certificate and bundle ID, the Keychain ACL matches and the Calendar and Accessibility grants carry over without prompts.
  - `slackHuddles`, `slackReminders` and unknown keys are dropped.
- **Schema versioning:** SQLite `user_version` with forward migrations, something the JSON files never had.
- **Privacy guarantees preserved:** data stays local; calendar titles, meeting notes and Figma window titles are never persisted beyond what 1.14.2 persists; only chosen tickets, activities and comments go to 7pace.

## 11. Build, signing, distribution and updates

- **Build:** Tauri CLI; macOS `universal-apple-darwin` `.app` in a `.dmg` (plus the `.pkg` the installation guide documents, if still wanted); Windows NSIS per-user installer, so updates never need admin rights. No MSI unless IT asks for one.
- **Signing (decided: no Apple Developer Program, no Windows certificate):**
  - macOS builds are signed with the existing "Azure timetracker Local Signing" certificate and the same bundle ID. That keeps the designated requirement stable across updates, so Keychain items and the Calendar and Accessibility grants survive, exactly the reason 1.14.0 introduced the certificate. The release tool runs `codesign` itself, mirroring `scripts/sign-app.sh` (hardened runtime, calendar entitlement, `--timestamp=none`), because Tauri's bundler assumes a Developer ID flow. There is no notarization: Gatekeeper shows the "unidentified developer" warning on first install and the installation guide keeps documenting the approval steps.
  - Windows builds are unsigned. SmartScreen shows "Unknown publisher" on the first install; the guide documents "More info → Run anyway". Later updates are downloaded by the app itself, carry no Mark of the Web and install silently per user. Published SHA-256 checksums remain the integrity check for manual installs.
  - Revisit both when a certificate becomes available; nothing else in the pipeline changes.
- **Bundle identity:** keep `be.yarne.azure-timetracker` and the binary name `AzureTimetracker` (`mainBinaryName`), so the bridge release passes the legacy validator and Keychain names match.
- **Distribution (decided: no GitHub Releases):** keep today's repository layout. Installers in `releases/latest/`, older ones in `releases/archive/<version>/`, update assets in `releases/updates/<version>/`. The 2.0 feed lives at `updates/v2/latest.json` and is fetched from `raw.githubusercontent.com`, like the legacy feed; the legacy `updates/latest.json` keeps its path. Assets per version: `Azure-timetracker-<v>-universal.app.tar.gz` with its `.sig`, and `Azure-timetracker-<v>-x64-setup.exe` with its `.sig`.
- **Updates:** Tauri updater with a new minisign key pair stored outside git beside the legacy key. The feed carries per-platform entries; the signature, size and version are verified before install. Checks run every 60 s by default and are configurable. The Windows installer runs in passive mode; on macOS the bundle is replaced in place and relaunched, and the 7pace timer keeps running as today.
- **Bridge release for existing macOS users (decided: yes):** 2.0.0 is published once through the legacy feed, so every 1.13+ Mac upgrades in place and then follows the new feed. Chosen because the same certificate and bundle ID make the upgrade seamless and the Swift signer already exists. Requirements from the old client validator: ZIP root `Azure timetracker.app/`, methods store/deflate only, no symlinks, `Contents/Info.plist` with the same bundle ID, `CFBundleExecutable` `AzureTimetracker`, version and build equal to the manifest, a signed stub at `Contents/Helpers/AzureTimetrackerUpdater`, and `codesign --verify --deep --strict` passing. The manifest is signed with the existing Swift `AzureTimetrackerRelease` tool and the existing Ed25519 key on the release Mac, so Swift's canonical JSON needs no reimplementation. The release tool builds the ZIP with the legacy constraints instead of `build-update.py`'s five-file allowlist. A dry run against a 1.14.2 install is the exit test. After the bridge the legacy feed is frozen.
- **CI:** GitHub Actions matrix (`macos-14`, `windows-2022`) for fmt, clippy, Rust and UI tests, axe and unsigned test bundles. Release artifacts come from the release tool: macOS on the release Mac that holds the local certificate and both signing keys, Windows on any Windows machine or runner. The tool verifies both installers and the feed before `git push`, as `verify-release.py` and `stage-release.py` do today.

## 12. Testing and quality gates

- Port all 297 core tests with a traceability table (Swift test name → Rust test name).
- `wiremock` contract tests reproducing the `MockURLProtocol` suite: headers, omitted nil fields, paging, 429 host block, redirect refusal, PIN/OAuth bodies, worklog CRUD shapes.
- Golden vectors: legacy manifest signing bytes, importer fixtures from an anonymised real `state.json`, DST cases in `Europe/Brussels`.
- Platform probe tests gated by `cfg(target_os)` on the CI runners; the manual checklist from `VALIDATION.md` becomes a per-release markdown template with both OS columns.
- UI: Vitest + Testing Library + axe; Playwright against the web UI with mocked IPC covering every prompt and sheet; screenshot diffs for light/dark/contrast/150 %.
- Perf budgets from §7 measured in CI on both runners.
- Release gate: no live 7pace writes in tests, no fixtures in production binaries, both installers verified by the release tool.

## 13. Phases

| Phase | Weeks | Deliverables | Exit criteria |
|---|---|---|---|
| 0. Discovery and spikes | 1 | Spikes for the Windows Figma URL reader and the Windows microphone registry; parity matrix signed off; 7pace and Azure response fixtures captured from the current app | Fixtures committed; CI skeleton green |
| 1. Foundations | 3 | Monorepo; `att-core` port with all tests; `att-net` with contract tests; SQLite + importer; Tauri shell with tray, panel, main window, settings store; design tokens and primitives | 297 tests green in Rust; app launches to tray on both OSes with onboarding and Settings |
| 2. Tracking parity | 3 | Git watching, branch cards, ticket/activity pickers, tracking transactions, pause/resume, health, server prompts, quick switch, credentials and PIN pairing, notifications, autostart | Daily use possible on macOS and Windows with a real 7pace workspace |
| 3. Insights parity | 4 | History, Time editor with journal, corrections, Day review, Weekly report, Statistics with all chart views, targets and holidays, offline drafts and local timer, ticket context | Every §6 row in Insights passes on both OSes |
| 4. Awareness modules | 3–4 | Calendar (EventKit, macOS only), microphone, time awareness, forgotten timer, ticket completion, Figma (macOS full, Windows title-first) | Prompts behave as documented; Features page complete |
| 5. Distribution and migration | 2 | Local-certificate signing, installers, in-repo updater feed, bridge release tooling, importer validation on real data | Builds install and self-update on clean machines despite the Gatekeeper and SmartScreen warnings; a 1.14.2 Mac upgrades in place through the legacy feed |
| 6. Hardening and launch | 2–3 | Accessibility audit with VoiceOver/NVDA, perf profiling against budgets, validation checklist on both OSes, team beta, 2.0.0 | Budgets met; no P1 defects; release notes and installation guide updated |

Phases 1–3 can run with the Rust and UI work in parallel; phase 4 depends on phase 2.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Undocumented 7pace behaviour (numeric enum variants, `responseState` errors inside 200s, `$includeEditable`) | Capture real responses in phase 0; keep the tolerant decoders from `Models.swift`. |
| Unsigned Windows installer: SmartScreen warning and possible Defender false positives | Documented approval steps, published checksums, reproducible builds; revisit signing when a certificate exists. |
| Figma URL reading on Windows is unproven | Spike in phase 0; title-only fallback already covers file identity by name. |
| Actionable notifications differ per OS | Native layer behind one trait; plain banners always work. |
| The local certificate or its keychain is lost on the release Mac | Keep the external backup described in `Resources/Signing.md`; a lost certificate means Keychain and permission prompts after the next update. |
| The bridge release fails the 1.14.x validator | Reuse the Swift signer and key; dry run against a 1.14.2 install before publishing. |
| Rust learning curve | Core is pure and well-tested, which is the easiest Rust to write; UI stays TypeScript. |
| Scope creep in the UI phase | Parity first; improvements from §8 are tracked separately and cut if needed. |
| WebView2 missing on older Windows 10 | Tauri's bootstrapper installs the evergreen runtime; Windows 11 ships it. |

## 15. Decisions taken (5 October 2026)

1. **Stack:** Tauri 2, Rust core, TypeScript (React) UI.
2. **Windows calendar:** none at launch. No Agenda page, no meeting prompts and no permission requests on Windows. Microsoft Graph stays a later option.
3. **Signing:** no Apple Developer Program membership and no Windows certificate. Users see the OS warnings on first install and the installation guide documents them. macOS keeps the existing local certificate so permissions and Keychain items survive updates.
4. **Distribution:** no GitHub Releases. GitHub hosts only the repository, the installers and the update feed, as today.
5. **Existing macOS users:** bridge release through the legacy feed. Chosen because the same certificate and bundle ID make the upgrade seamless and the Swift signer already exists.
6. **Localisation:** English only.
7. **Figma on Windows:** title-first at launch, marked experimental; URL reading follows the phase 0 spike.
8. **Update checks:** the 60 s default stays and becomes configurable.
9. **Behaviour changes:** the list in §16 was signed off on 7 October 2026.

## 16. Behaviour changes (signed off 7 October 2026)

- Suggestions no longer steal focus by default; the per-prompt setting restores today's behaviour.
- Git changes are detected by file events on the repository's HEAD, confirmed by a second reading 400 ms later (about half a second in total). The scan on the probe interval stays as the fallback.
- The ⌘-number shortcuts follow the sidebar order.
- Azure titles load in batches, so statistics and reports show titles sooner.
- Storage moves from JSON files to SQLite; the files are imported, not shared.
- Windows shows the elapsed time in a tooltip and an optional mini-timer instead of beside the tray icon.
- Slack huddle detection, unused since 1.7, is not ported.
