# Engine and UI contract

This document defines how the Rust engine (`crates/att-engine`) replaces the Swift `AppModel`
and its sub-models, and the contract between the engine and the React UI. It is the reference for
the engine and UI page work.

## 1. Shape

```
Tauri app (apps/desktop/src-tauri)
 ├─ implements att_engine::shell::Shell  (tray, panel, windows, notifications, open URL)
 ├─ #[tauri::command] engine_dispatch(intent: Intent) -> Result<Value, IpcError>
 ├─ #[tauri::command] engine_resync() (re-sends every slice through the event)
 ├─ forwards Publisher batches as the Tauri event "engine://slices"
 └─ owns the Tauri updater and file dialogs

att-engine
 ├─ Engine            public handle: new(services) / start() / dispatch(intent) / snapshot()
 ├─ session           port of AppModel + FigmaModel + PinPairingModel: connection, tracking
 │                    flows, branches, prompts, health, progress, history, settings, repositories
 ├─ controllers       ports of StatisticsModel, TimeEditorModel, DayReviewModel,
 │                    WeeklyReportModel, OfflineDraftModel, TicketContextModel
 ├─ probes            calendar, microphone, presence, Figma sampling on the blocking pool
 ├─ persist           slices ↔ att-store documents (skips unchanged writes)
 └─ publish           view slices → changed-only batches
```

Concurrency follows the Swift `@MainActor` model (see `crates/att-engine/src/lib.rs`): one state
lock never held across `.await`, generation tokens for stale results, the busy guard for writes.

## 2. Behaviour rules carried over from 1.14.2

These rules are not negotiable; the engine tests must cover them.

1. The 7pace server state is authoritative. Read `current` immediately before every write and
   pass the displayed identity as `expectedIdentity`.
2. Never replay a failed or timed-out write. After any tracking error, reconcile with one read
   (`current`) and show the error; a later attempt needs a fresh confirmation.
3. Nothing starts, stops or pauses a timer without an explicit user confirmation. Suggestions
   (branch, meeting, microphone, Figma, idle, forgotten timer, completion, meeting return) only
   prepare a draft; `tracking.start` is the only path that starts.
4. A draft is bound to the state identity it was created from and to its source (branch
   snapshot, calendar occurrence, microphone session, Figma suggestion, paused session, attention
   prompt, meeting return). Sources are revalidated before the write and inside
   `validateContext`.
5. Generation tokens: switching accounts, saving settings, or starting a new search drops every
   in-flight result from before.
6. Persist before risky steps where Swift did (idle review is saved before stopping; journal
   checkpoints before each worklog write; offline `.sending` checkpoint before upload).
7. Metadata lookups (ticket titles, completion status) never mark a healthy 7pace connection as
   disconnected; Azure credential problems are reported separately (`azureIssue`).

Swift line references: `Sources/AzureTimetracker/AppModel.swift` (`start` loop L264–311,
`connect` L348–412, `apply` L424–450, `chooseActivity` L709–752, `startTracking` L754–822,
`stopTracking`/`pauseTracking` L824–863, attention L896–938, awareness L939–1023, meetings
L1114–1174, progress L1185–1210, meeting return L1212–1240, microphone L1255–1323, day review
L1325–1378), `FigmaModel.swift`, `PinPairingModel.swift`.

## 3. Main loop

The engine runs one loop task. Each tick (2 s by default) does, in this order, what the Swift
loop did: scan branches; refresh 7pace `current` when the poll interval elapsed and not busy;
refresh the calendar every 30 s; update connection health; announce tracking attention; meeting
suggestions; microphone sync; meeting return; ticket completion check (≥ 60 s apart) and
announcement; day review check; deferred quick switch; progress reload (≥ 300 s, or ≥ 30 s after
the ISO week changed); statistics/day-review page loads only while that page is visible.

Probes (Git HEAD, presence, microphone, Figma) run on the blocking pool with deadlines. The
microphone and Figma samplers also run on their own 2 s cadence, as in Swift.

Every tick ends with `persist()` (writes only changed documents) and `publish()` (emits only
changed slices).

## 4. Interruptions

Swift called `revealSuggestion()` (open the popover and steal focus) from 19 places. The engine
calls `announce(kind)` instead, which looks up the user's interruption level for that prompt kind
(`Off`, `NotifyOnly`, `OpenPanel` default, `OpenAndFocus` = 1.14.x behaviour) and quiet hours,
then calls `Shell::show_panel(focus)` and/or `Shell::notify`. Prompt kinds: `branch`,
`meeting`, `microphone`, `microphoneEnd`, `meetingReturn`, `figma`, `idle`, `forgottenTimer`,
`ticketCompletion`, `trackingAttention`, `dayReview`, `update`.

## 5. Intents (UI → engine)

`engine_dispatch` takes `{ "type": "<namespace>.<name>", ...args }` (serde internally tagged,
camelCase fields). It returns the intent's result (often `null`) or an `IpcError`
(`{ kind, message }`). State changes arrive as slices, not as return values, except where a
result is listed.

| Namespace | Intents |
|---|---|
| `app` | `snapshot` → all slices; `setVisiblePage {page}`; `finishOnboarding`; `setInterface {preferences}`; `prepareForRestart` (refuses while busy; persists) |
| `connection` | `retry`; `refresh` |
| `settings` | `save {configuration, azurePat, sevenPaceToken}`; `enableCalendar`; `setPromptInterruption {kind, level}`; `setQuietHours {…}` |
| `pairing` | `generatePin`; `cancel` |
| `repositories` | `scan {path}` → discovered list (cancellable via `cancelScan`); `add {paths}`; `setEnabled {id, enabled}`; `remove {id}`; `toggleWatching` |
| `branch` | `keep {id}`; `track {id}` (chooseActivity with the suggested ticket); `chooseAnother {id}`; `pause {id}`; `stop {id}` |
| `tracking` | `beginPanel {branchId?}`; `cancelPanel`; `openPicker`; `closePicker`; `search {query}`; `chooseTicket {ticketId}`; `chooseManual {kind}`; `chooseDifferentWork`; `chooseSuggestionTicket {draftId}`; `continueWithoutTicket`; `start {draftId, activityId, comment, includeTicket}`; `stop`; `pause`; `resume`; `discardPause`; `confirmActivity` |
| `attention` | `keepStopped`; `continue` |
| `quick` | `switch` (hotkey); `toggleFavorite {ticketId}` |
| `completion` | `keep`; `stop`; `switch` |
| `meeting` | `begin {id, useSuggestedTicket}`; `dismiss {id}`; `returnResume`; `returnDismiss` |
| `microphone` | `choose {sessionId, standup}`; `dismiss {sessionId}`; `endKeep`; `endPause`; `endStop` |
| `awareness` | `keepIdle`; `reviewIdle {promptId}`; `openCorrection`; `discardCorrection`; `deferForgotten {untilTomorrow}`; `chooseForgottenTicket {ticketId?}` |
| `dayReview` | `open`; `setDay {day}`; `refresh`; `markReviewed {day}`; `snooze` |
| `history` | `setRange {from, to}`; `load`; `exportCsv {path}` |
| `ticket` | `showContext {ticketId}`; `closeContext`; `openInAzure {ticketId}` |
| `figma` | `setPreferences {preferences}`; `requestAccess`; `keep {suggestionId}`; `track {suggestionId, useLinkedTicket}`; `link {fileKey, ticketId?}`; `unlink {fileKey}`; `open {fileKey, desktop}`; `clearHistory`; `setSearch {query}` |
| `statistics` | `setPeriod {period}`; `move {amount}`; `current`; `jumpTo {date}`; `setFilter {filter}`; `clearFilters`; `zoomTo {start, end}`; `scale {factor}`; `pan {direction}`; `back`; `resetZoom`; `setSection {section}`; `refresh`; `entries {offset, limit}` → page of entries |
| `timeEditor` | `setDay {day}`; `setFilter {text}`; `load`; `select {logId}`; `cancel`; `setMode {mode}`; `setTimes {start, end}`; `setSplit {at, ticket, comment, activityId}`; `setSelection {ids}`; `beginMerge`; `beginUndo {changeId}`; `checkOverlaps`; `save`; `acknowledge {changeId}`; `loadCorrections`; `prepareCorrection {issueId, option}`; `setSeparateIdle {separate}` |
| `weekly` | `move {amount}`; `jumpTo {date}`; `refresh`; `generate {replace}`; `setText {text}`; `exportMarkdown {path}` |
| `offline` | `startLocal {ticketId?, comment, activityId?}`; `stopLocal`; `save {draft}`; `remove {draftId}`; `review {draftId}`; `upload`; `link {logId}`; `allowRetryAfterManualCheck`; `setShowSynced {show}` |

Exports: the UI asks the dialog plugin for a path, then sends it; the engine writes the file.
Clipboard copies (weekly report) stay in the UI.

## 6. View slices (engine → UI)

The Tauri event `engine://slices` carries `[{ name, value }]` with only the slices whose JSON
changed. A window that loads subscribes to the event first and then calls `engine_resync`, which
resets the publisher and sends every slice through the same event. Every value therefore arrives
in order with the regular updates: nothing is missed between subscribing and the first batch,
and an older snapshot can never overwrite a newer update. (`app.snapshot` and `engine_snapshot`
still return every slice, for diagnostics and tests.) The UI keeps one store keyed by slice name
(`apps/desktop/src/state/store.ts`) and subscribes components per slice (`useSlice`).

| Slice | Contents (camelCase JSON) | Swift source |
|---|---|---|
| `app` | `preview`, `os` (`macos`/`windows`), `onboarding`, `visiblePage`, `notice`, `error`, `busy`, `features` (enabled module ids + availability per OS) | `AppModel` flags |
| `interface` | `InterfacePreferences` | `configuration.interface` |
| `connection` | `health` (unconfigured/connecting/confirmed/stale/disconnected/authentication/accessDenied), `indicator` (tray state), `workspace`, `lastSync`, `connectionIssue`, `azureIssue`, `progressIssue`, `hasAzurePat`, `hasSevenPaceToken`, `connected`, `connecting` | `ConnectionHealth`, `TrackingIndicator` |
| `tracking` | `state` (`TrackingState`), `ticketTitle`, `elapsedBase` + `confirmedAt` + `extrapolate` (UI adds `now − confirmedAt` while running and confirmed), `paused` (`PausedSession` + title), `localTimer` (active offline draft + `primary`), `attention` (`TrackingAttention` + heading/detail) | `state`, `elapsed`, `pausedSession`, `showsLocalTimer` |
| `flow` | the activity chooser and pickers: `surface` (`none`/`panel`/`picker`), `draft` (`id`, `title`, `item`, `allowsNoTicket`, `isFigma`, `standup`, `manual`, `resume`, `preferredActivityId`, `defaultComment`, source summary), `selectedSuggestion`, `search` (`query`, `results`, `searching`, `error`), `activityTypes` + `activitiesLoaded` + `activityError`, `canStart` per activity, `quickTickets` (ordered ids with titles and favourite flags) | `trackingDraft`, `menuTracking`, `showTicketPicker`, `searchResults`, `quickTickets` |
| `prompts` | `branches` (pending `BranchChange` + titles), `meetings` (pending meetings), `microphone` (pending sessions), `microphoneEnd`, `meetingReturn` (+ ready), `figma` (fresh suggestions), `idle` (pending `IdlePeriod`), `idleCorrection`, `forgottenTimer` (+ `forgottenTickets`), `ticketCompletion`, `dayReview` (`promptDay`, `canSnooze`) | prompt properties |
| `progress` | `TargetProgress` computed at `computedAt` (+ `extrapolate`), today/week targets, `loading`, `issue` | `targetProgress` |
| `history` | `from`, `to`, `logs`, `todayLogs`, `loading`, `loaded`, totals; `audit` (newest 2,000) | `logs`, `todayLogs`, `audit` |
| `repositories` | repositories with `snapshot` (branch/detached/error), `watching`, scan state (`scanning`, `results`, `unreadable`) | `branches`, `repositoryErrors` |
| `agenda` | `access`, `calendars`, `selectedIds`, `day`, `events` (`CalendarEvent` + `isNow`), `supported` | `CalendarService` |
| `settings` | `configuration` (the persisted `Configuration`), `hasAzurePat`, `hasSevenPaceToken`, `pairing` (`pin`, `expiresAt`, `status`, `pairedHost`, `busy`), `notificationsAuthorized`, `microphone` diagnostics (supported, observed owners), `figmaAccess`, `promptInterruptions`, `quietHours` | Settings pages |
| `figma` | preferences, access, `status` (last observation), files (filtered by search), links with ticket titles, suggestions, `lastWorked`, history (latest 200), `storageIssue` | `FigmaModel`, `FigmaViews` |
| `statistics` | `period`, `range`, `window`, `isZoomed`, `zoomHistoryDepth`, `filter`, `loading`, `analyzing`, `issue`, `syncedAt`, `omitted`, `availableActivities`, `analysis` (totals, buckets, tasks page, patterns, activities; entries are paged through `statistics.entries`), `visuals` (calendar days, heat hours, progress points), `section` | `StatisticsModel` |
| `timeEditor` | `day`, `filter`, `logs`, `selection`, `selected`, `mode`, form fields, `plan` preview (before/after), `validationIssue`, `review` (conflicts, overlap notice), `working`, `loading`, `issue`, `message`, `savedConflicts`, `changes` (journal, newest first), `requiresReview`, `corrections` (`issues`, `loading`, `issue`), `guidedPlan`, `idleInterval`, `separateIdle` | `TimeEditorModel` |
| `dayReview` | `selectedDay`, `summary` (`DayReviewSummary`), `record`, `loading`, `issue`, `syncedAt` | `DayReviewModel` |
| `weekly` | `range`, `text`, `hasData`, `loading`, `issue`, `storageIssue`, `message`, `syncedAt` | `WeeklyReportModel` |
| `offline` | `drafts` (workspace, newest first), `showSynced`, `active`, `readyCount`, `activities`, `review`, `working`, `issue`, `message`, `canCreate` | `OfflineDraftModel` |
| `ticketContext` | `request` (ticket id), `details` (`TicketContext`), `loading`, `issue` | `TicketContextModel` |
| `updates` | `phase` (idle/checking/available/downloading/ready/installing/failed), `version`, `notes`, `progress`, `error`, `automatic` | Tauri updater |

Live values: the engine does not publish every second. The UI computes running clocks from
`elapsedBase + (now − confirmedAt)` when `extrapolate` is true, and progress the same way from
`computedAt`. The tray title is the only per-second update and goes through `Shell::set_tray`.

## 7. Contract verification

- Every Rust type the UI receives or sends (slices, intents, intent results, `IpcError`, and the
  att-core / att-platform types inside them) derives `ts_rs::TS` behind the `ts` feature of
  att-core, att-platform and att-engine:
  `#[cfg_attr(feature = "ts", derive(ts_rs::TS))]` above the serde derive. A field with a serde
  adapter (`with`, `serialize_with`) also gets `ts(as = "<wire type>")`, and a field that serde
  skips when empty without a field-level `default` gets `ts(optional = nullable)`.
- `crates/att-engine/tests/contract_ts.rs` collects the root types and their dependencies and
  writes `apps/desktop/src/ipc/generated.ts` (one pretty-printed file) and
  `apps/desktop/src/ipc/fixtures/defaults.json` (`Configuration::default()`). CI runs
  `cargo test -p att-engine --features ts --test contract_ts`, which fails when either file is out
  of date. Regenerate with `npm run contract` in `apps/desktop`
  (`UPDATE_CONTRACT=1 cargo test -p att-engine --features ts --test contract_ts`).
- `apps/desktop/src/ipc/contract.ts` is the only hand-written part: the slice name → type map
  (`SliceMap`), the intent union and the intents that return a value (`IntentResults`). Add a
  slice or an intent result there together with the Rust change.
- Large integers (`i64`) are `number` in TypeScript (work item ids and seconds stay far below
  2^53).
- The mock engine (`apps/desktop/src/ipc/mockEngine.ts`) and the sample slices
  (`apps/desktop/src/ipc/fixtures/slices/*.ts`, type-checked against the generated types) serve the
  browser preview, the gallery and the UI tests.
