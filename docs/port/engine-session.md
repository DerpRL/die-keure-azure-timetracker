# Engine session port

Scope: `crates/att-engine/src/session/**`, the Rust port of `AppModel.swift`, `FigmaModel.swift`,
`PinPairingModel.swift`, the app halves of `MicrophoneService`, `WorkPresenceService`,
`FigmaService`, the `CalendarService`/`NotificationService` parts of `LocalServices.swift`,
`MenuBarController` (tray text) and the engine side of `QuickSwitchShortcut` (`quick.switch`).
Tests: `crates/att-engine/tests/session_*.rs` with fakes in `tests/support/mod.rs`, plus
in-module tests for the tray, discovery and the persisted date maps.

## Modules

| Module | Contents |
|---|---|
| `mod.rs` | `SessionState`, `SessionIntent` and the router, `start`, `tick`, samplers, `Effects` |
| `connection.rs` | connect, refresh, apply, fail, retry, health, activities, lookups, title cache |
| `tracking.rs` | `TrackingDraft`, panel/picker flows, search, choose/start/stop/pause/resume, quick switch |
| `branches.rs` | HEAD reads, debouncer baselines, pending changes, revalidation, forgotten tickets |
| `announce.rs` | interruption levels, quiet hours, notification ids and texts |
| `attention.rs`, `completion.rs` | 7pace activity checks and stops; completed tickets |
| `meetings.rs`, `meeting_return.rs` | calendar refresh, agenda, meeting suggestions; returning after a meeting |
| `microphone.rs`, `awareness.rs` | microphone sessions and the end prompt; idle, lock, forgotten timer |
| `day_review_prompt.rs`, `progress.rs`, `history.rs` | day review prompt; target progress; history and CSV |
| `settings.rs`, `pairing.rs`, `repositories.rs`, `figma.rs` | settings and onboarding; PIN pairing; repositories; Figma |
| `persist.rs`, `view.rs`, `tray.rs`, `hooks.rs` | documents; slices; tray status; calls from the controllers |

## Traceability (Swift → Rust)

| Swift (`AppModel` unless noted) | Rust |
|---|---|
| `init()` load rules (L182–255) | `persist::load` |
| `discoverRepositories()` | `repositories::discover`, `spawn_first_run_discovery` |
| `start()` and its loop (L264–311) | `session::start`, `session::tick`, `spawn_samplers` |
| `persist()` | `persist::save` via `Engine::persist` (after every intent and tick) |
| `setInterfacePreferences`, `finishAppearanceOnboarding`, `installUpdate` guards | `settings::set_interface`, `finish_onboarding`, `prepare_for_restart` |
| `record` | `Engine::record` (through `Effects::record`) |
| `connect`, `refresh`, `apply`, `fail`, `retryConnection`, `updateConnectionHealth` | `connection::connect`, `refresh`, `apply`, `fail`, `retry`, `health` |
| `refreshActivities`, `lookup`, `loadTicketTitle` | `connection::refresh_activities`, `lookup`, `request_titles` (batched) |
| `completionScope`, `ticketCompletionPrompt`, `checkTicketCompletion`, `showTicketCompletionIfReady`, `keepCompletedTicket`, `validateTicketCompletion` | `completion::scope`, `prompt`, `check`, `show_if_ready`, `keep`, `validate` |
| `saveSettings` | `settings::save` |
| `loadHistory`, `exportHistory`, `todaySeconds` | `history::load`, `export_csv`/`csv`, `today_seconds` |
| `scanBranches`, `keep`, `dismiss`, `validate`, `clearSuggestions`, `forgottenTickets` | `branches::scan`, `keep`, `dismiss_change`, `validate`, `clear_suggestions`, `forgotten_tickets` |
| `beginMenuTracking`, `cancelMenuTracking` | `tracking::begin_menu_tracking`, `cancel_menu_tracking` |
| `chooseManualActivity`, `chooseDifferentWork`, `chooseSuggestionTicket`, `chooseSuggestionWithoutTicket` | `tracking::choose_manual`, `choose_different_work`, `choose_suggestion_ticket`, `continue_without_ticket` |
| `canStart`, `preferredActivityID` | `tracking::can_start`, `preferred_activity_id` |
| `chooseActivity` | `tracking::choose_activity` / `prepare_draft` |
| `startTracking` | `tracking::start` / `run_start` / `finish_start` (+ `revalidate` as `validate_context`) |
| `stopTracking`, `pauseTracking`, `resumeTracking`, `discardPause`, `confirmActivity` | `tracking::stop`, `pause`, `resume`, `discard_pause`, `confirm_activity` |
| `attentionKey`, `updateTrackingAttention`, `showTrackingAttentionIfReady`, `keepAttentionStopped`, `continueTrackingAttention` | `attention::update`, `show_if_ready`, `keep_stopped`, `continue_tracking` |
| `checkWorkAwareness`, `keepIdleTime`, `deferForgottenTimer`, `reviewIdleTime`, `openIdleCorrection`, `discardIdleCorrection` | `awareness::check`, `keep_idle_time`, `defer_forgotten`, `review_idle_time`, `open_correction`, `discard_correction` |
| `saveTimeEdit` (session half) | `hooks::idle_correction_applied`, `hooks::worklogs_changed` |
| `search` | `tracking::search` |
| `addRepositories`, `setRepository`, `removeRepository`, `toggleWatching`; `RepositoryImportView` scan | `repositories::add`, `set_enabled`, `remove`, `toggle_watching`, `scan`, `cancel_scan` |
| `refreshCalendar` (+ `CalendarService.refresh`), `enableCalendar` | `meetings::refresh_calendar`, `enable_calendar` |
| `checkMeetingSuggestions`, `meetingTicket`, `beginMeetingTracking`, `dismissMeeting`, `validateMeeting` | `meetings::check_suggestions`, `ticket`, `begin`, `dismiss`, `validate` |
| `loadProgress`, `targetProgress(at:)` | `progress::load`, `progress::is_due`, `view::progress_slice` |
| `meetingReturnReady`, `checkMeetingReturn`, `returnAfterMeeting`, `dismissMeetingReturn` | `meeting_return::ready`, `check`, `resume`, `dismiss` |
| `quickSwitch`, `toggleFavorite` | `tracking::quick_switch`, `QuickTickets::toggle_favorite` |
| `microphoneEndPrompt`, `canReturnAfterMicrophone`, `validateMicrophoneEnd`, `keepTrackingAfterMicrophone`, `configureMicrophone`, `syncMicrophone`, `dismissMicrophone`, `chooseMicrophoneActivity` | `microphone::end_prompt`, `meeting_return::can_return_after_microphone`, `microphone::validate_end`, `keep_after_end`, `configure`, `sync`, `dismiss`, `choose` |
| `MicrophoneService.configure/checkNow/fresh/selectedInputAppIDs/isActive/validateCurrent` | `microphone::configure`, `check_now`, `MicrophoneState::{fresh, selected_input_ids, is_active}`, `validate_current` |
| `WorkPresenceService` (unavailable map, lock poll, events) | `awareness::{subscribe, record_event, sample}` |
| `dayReviewRecord`, `openDayReview`, `refreshDayReview`, `markDayReviewed`, `snoozeDayReview`, `canSnoozeDayReview`, `checkDayReview` | `day_review_prompt::record`, `open`, `mark_reviewed`, `snooze`, `can_snooze`, `check` |
| `elapsed(at:)`, `menuElapsed`, `showsLocalTimer`, `showsRemoteTimer`, `trackingIndicator` | `connection::elapsed`, `tray::tray_status`, `tray::shows_local_timer`, `view::tracking_slice`, `tray::indicator` |
| `openTicket` | `view::ticket_url` (the controllers' `ticket.openInAzure` opens it) |
| `FigmaModel` (`figmaScope`, `figmaLedger`, `figmaSuggestions`, `configureFigma`, `setFigmaPreferences`, `observeFigma`, `keepFigma`, `validateFigma`, `beginFigmaTracking`, `prefillFigmaTracking`, `linkFigmaFile`, `completeFigmaTracking`, `openFigma`, `clearFigmaHistory`) | `figma::{scope, ledger/store_ledger/persist_ledger, suggestions, configure, set_preferences, poll/observe, keep, validate, begin_tracking, prefill, link, complete_tracking, open, clear_history}` |
| `FigmaService` (loop, status, permission) | `figma::poll`, `status_label`, `request_access`, `refresh_access` |
| `PinPairingModel.begin/cancel` | `pairing::begin`, `cancel` |
| `NotificationService` texts and ids | `announce::{branch, figma, day_review, attention, idle, forgotten, …}` |
| `MenuBarController` title/tooltip | `tray::tray_status` |
| `revealSuggestion()` (19 call sites) | `announce::announce` for prompts; `Shell::show_panel(true)` for user actions |

## Decisions

1. **Samplers.** Presence, microphone and Figma run on their own loops (as the Swift services did),
   spawned by `start`, each sleeping one interval first; a slow 7pace request in the main loop
   cannot stall the debounces. The microphone and Figma intervals are capped at 4 s because their
   engines reset after 10 s and 6 s gaps. `session::sample_presence/sample_microphone/sample_figma`
   are public so tests drive them deterministically.
2. **Onboarding** holds `start` (Swift never started the loop): `tick` starts the session once
   onboarding is done (`app.finishOnboarding` wakes the loop).
3. **Health** is computed on demand (`connection::health`) instead of stored; it equals Swift
   calling `updateConnectionHealth()` before every use.
4. **Surfaces.** The panel and the picker share one flow state. `branch.track`,
   `branch.chooseAnother`, `tracking.chooseTicket`, `tracking.resume` and `completion.switch` take
   an optional `surface` (`panel` | `picker`): the draft opens where the user clicked. Without it
   they act in the picker while it is open, else in the panel, so the 1.14.x sequences
   (`tracking.beginPanel` / `tracking.openPicker` first) keep working. `tracking.chooseTicket`
   with `surface: "panel"` and no open flow starts a panel flow, like a quick ticket in 1.14.x.
5. **Errors.** Failures Swift showed through `error` go to `app.error`; intents resolve to `null`.
   History range, load and CSV export failures go to `history.issue` instead (shown on the
   History page). Writes refused because another write runs, or while an offline upload runs,
   reject with `busy` (Swift ignored the click; the buttons were disabled).
   `app.prepareForRestart` rejects with `busy`/`storage`. No intent returns `needsConfirmation`.
6. **No replay.** Every failed tracking write is followed by exactly one `current` read
   (`reconcile_after_error`), the error is shown and the draft is cleared.
7. **Revalidation.** `validate_context` revalidates every draft source (Figma, microphone, branch
   HEAD, meeting, paused session, meeting return), not only Figma as in 1.14.x (engine rule 4).
8. **Interruptions.** `Off` for tracking attention counts as the default level (it "always
   interrupts"); quiet hours never silence it. `OpenPanel` adds a notification only while the main
   window is hidden (`visiblePage == null`). Prompts without a 1.14.x notification got new ids:
   `meeting:<occurrence>`, `microphone:<session>`, `microphone-end`, `meeting-return`,
   `ticket-completion`. Figma opens the panel at once and notifies after the title loads, as
   1.14.x did.
9. **Workspace identity** is `clients::workspace_identity` (shared with the controllers, trailing
   `/`). 1.14.x stored the URL as typed: on load, paused session, meeting return, quick tickets,
   awareness, microphone links, completion scopes and the `dayReviews`, attention and Figma keys
   are compared ignoring the slash and the default port, and respelled.
10. **Unreadable documents** keep their defaults and are never overwritten (per document instead
    of Swift's whole-file `canPersist`). "Pause & review" refuses when `workAwareness` cannot be
    saved.
11. **Today's worklogs** come from the history fetch when it covers today, else from the week's
    progress fetch (one request instead of 1.14.x's second fetch).
12. **Progress** is published as totals up to the last confirmation, `computedAt = lastSync`, and
    `todayStart`/`weekStart`, so the UI extrapolates without per-second slices.
13. **Titles** load in one Azure batch (`work_items`) or the 7pace search without a PAT; the
    forgotten-timer reminder also loads its branch tickets' titles. History does not load titles
    on its own (1.14.x did not).
14. **Calendar** reads run in three probe calls (access, calendars + events) with deadlines; a
    late or failed read keeps the previous events and shows `agenda.issue`. Titles: empty →
    "Untitled event" (agenda) / "Untitled meeting" (prompts).
15. **Windows:** the tray tooltip starts with the clock; the unavailable reason reads "Computer
    asleep or session inactive"; Figma uses `FigmaObservation::from_window` with the host OS.
16. **Settings save** also keeps the repositories, interruption levels and quiet hours of the
    current configuration (applied immediately elsewhere), besides Figma and appearance.
17. **Preview:** no network, notifications, credential writes, calendar or first-run discovery.
    No "Preview mode" notice at launch (Swift set one): the UI shows a permanent banner from
    `app.preview`.
18. **Shell state.** The shell reports what only it knows: `app.reportShortcutIssue` (the
    quick-switch shortcut could not be registered → `connection.shortcutIssue`) and
    `app.reportNotificationPermission` (→ `settings.notificationsAuthorized`).
19. **Work apps.** `settings.resolveWorkApp {path}` returns `{id, name}` read from the app
    bundle (probe deadline). A `settings.workApps` list with names is not published: the
    platform has no lookup from a stored id back to its app.
20. **Meeting reminders.** No `MeetingPreferences.endReminders` toggle: 1.14.x had none. The
    microphone end prompt follows `microphone.enabled`, the meeting return prompt always runs,
    and both are silenced or raised through their interruption levels.

## Session intents added during the port

`connection.recheck`, `tracking.reloadActivities`, `microphone.checkNow`, `agenda.openCalendar`,
`figma.refreshAccess`, `settings.resolveWorkApp {path}`, `app.reportShortcutIssue {issue?}`,
`app.reportNotificationPermission {authorized}`; `pairing.generatePin` takes an optional
`workspace` (replaces `pairing.begin`); `settings.testBranchPattern` returns `{text, valid}`.

## Not ported

- `setLogin` (launch at login): the Tauri autostart plugin owns it.
- `notifications.enable()` permission request: the shell's notification plugin asks; no
  permission prompt from the engine. The shell reports the answer (decision 18).
- Notification action buttons (keep/switch from a banner): the shell sends plain banners.
- `page = .settings` when tracking needs a connection: the engine does not change the page of a
  closed window.
- `UI_PREVIEW` sample data (`prepareInterfacePreview`): the UI's mock engine replaces it.
- Slack reminders (`slackReminders`): dead code, dropped on import.

## Tests

| File | Covers |
|---|---|
| `session_connection.rs` | connect success and messages, failures, staleness, metadata errors, stale searches and reconnects, `apply` ordering, notices |
| `session_tracking.rs` | branch → prompt → draft → start (stop then start), no replay, HEAD revalidation, remote change, pause/resume, ticket-free resume, stand-ups, integration branches, keep, quick switch, search, picker, busy, flow surfaces |
| `session_prompts.rs` | attention once / keep stopped / continue / activity check, completion flow, meetings → start → return, microphone suggestion and end prompt, failed samples, day review due/snooze/mark |
| `session_awareness.rs` | idle → Pause & review saved before the stop, keep idle, forgotten timer and its eligibility, forgotten tickets |
| `session_figma.rs` | activation → suggestion → Design start with the file name, links, keep, open, search, pausing, title-only on macOS |
| `session_settings.rs` | validation, secrets and accounts, immediate settings, branch tester, quiet hours, interruption levels, onboarding, PIN pairing, shell reports, microphone owner categories |
| `session_persistence.rs` | restart round trip, 1.14.x documents, workspace spelling, unreadable documents, microphone link restore, CSV, history range, repositories, agenda, tray |
