# Engine page controllers (port notes)

Scope: `crates/att-engine/src/controllers/` — ports of `StatisticsModel.swift`,
`TimeEditorModel.swift` (+ `AppModel.saveTimeEdit`/`openIdleCorrection`), `DayReviewModel.swift`,
`WeeklyReportModel` and `TicketContextModel` (ProductivityModels.swift) and
`OfflineDraftModel.swift`, plus the parts of the Swift views that drove them (`.task` loads,
`loadedConflicts`, `CorrectionIssueCard` options, `DayReviewView.summary`). Tests:
`crates/att-engine/tests/controllers_*.rs` with fakes in `tests/support/controllers.rs`.

## Files

| File | Contents |
|---|---|
| `mod.rs` | `ControllerState`, `ControllerIntent`, `handle`, `tick`, page lifecycle, shared helpers |
| `statistics.rs` | `StatisticsModel`, debounced off-thread analysis, title batches, entry pages |
| `time_editor.rs` | `TimeEditorModel`, `saveTimeEdit`, corrections, idle corrections, journal checkpoints |
| `day_review.rs` | `DayReviewModel` |
| `weekly.rs` | `WeeklyReportModel`, throttled draft writer, export |
| `offline.rs` | `OfflineDraftModel` |
| `ticket_context.rs` | `TicketContextModel`, `showContext`, `openTicket` |
| `hooks.rs` | calls the session makes (`configure`, `invalidate`, `cacheActivities`, …) |
| `persist.rs` | `offlineLedger`, `timeEditJournal`, weekly drafts table |
| `view.rs` | the six slices |
| `testing.rs` | doc-hidden seams for the integration tests (see "Requests") |

## Traceability (Swift → Rust)

### StatisticsModel.swift

| Swift | Rust |
|---|---|
| `period`, `anchor`, `filter`, `range`, `bounds`, `window`, `isZoomed` | `StatisticsState` fields and `range/bounds/window`; slice `period/range/bounds/window/isZoomed` |
| `configure(_:targets:)` | `StatisticsState::configure` via `hooks::on_connection_changed` |
| `invalidate()` | `StatisticsState::invalidate` via `hooks::invalidate_worklogs` |
| `move(_:)`, `current()`, DatePicker on `anchor`, period picker | `statistics::move_by`, `current`, `jump_to`, `set_period` (intents `statistics.move/current/jumpTo/setPeriod`) |
| `updateTitles(_:)` + the view's `loadTicketTitle` loop | `statistics::check_title_batch` + `request_titles` (one batch per download) |
| `zoom(to:)`, `scale`, `pan`, `back`, `resetZoom`, `clearFilters` | `zoom_to`, `scale`, `pan`, `back`, `reset_zoom`, `set_filter(default)` |
| `load(force:)` | `statistics::load` (+ `should_load` for the guards) |
| `install(_:range:)` | `statistics::install`, `available_activities` |
| `rebuild()` | `statistics::rebuild` + `analyse` (120 ms debounce, blocking pool) |
| loop L306 `if page == .statistics … load()` | `controllers::tick` |
| view `.task(id: range)`, `.onChange(of: connectionID)` | `after_range_change`, `page_appeared`, `on_connection_changed` |
| view `data.entries` lists (bucket inspector, timeline day, entry list) | `statistics.entries {offset, limit, start?, end?}` → `EntriesPage` |
| `ExplorerPage` (view state) | `statistics.setSection` / slice `section` |

### TimeEditorModel.swift and AppModel

| Swift | Rust |
|---|---|
| `init()` journal read + `applying → needsReview` (L43–52) | `persist::load` (`INTERRUPTED_DETAIL`), written back by the next `persist::save` |
| `recentChanges`, `requiresReview`, `visibleLogs`, `proposedPlan()`, `validationIssue` | `TimeEditorState::recent_changes`, `requires_review`, `visible_logs`, `proposed_plan`; slice `validationIssue` |
| `configure(_:)` | `TimeEditorState::configure` |
| `cancel()`, `load()`, `select(_:)` | `time_editor::cancel`, `load`, `select` (+ `open_entry`) |
| `beginMerge()`, `beginUndo(_:)` | `begin_merge`, `begin_undo` |
| `loadCorrections(preferences:)` | `load_corrections` |
| `prepareCorrection(_:)` + `CorrectionIssueCard` plans | `prepare_correction` + `correction_plan`/`correction_options` (slice `corrections.choices`) |
| `prepareIdleCorrection(id:start:end:)` + `openIdleCorrection` (L1017–1022) | `hooks::prepare_idle_correction_for` / `prepare_idle_correction` → `time_editor::prepare_idle` |
| `check(_:)`, `checkChanges()` | `overlap_review` + `plan_conflicts`, `check_changes` |
| `checkpoint(_:)`, `acknowledge(_:)` | `time_editor::checkpoint` (durable store write), `acknowledge` |
| `save()` + `AppModel.saveTimeEdit()` (L1025–1040) | `save` + `save_time_edit` |
| view `loadedConflicts` | slice `loadedConflicts` (`time_editor::loaded_conflicts`) |
| `didSet { review = nil }` on the form fields | `edit_form` (`setMode/setTimes/setSplit/setSecondEntry/setSeparateIdle`) |

### DayReviewModel.swift

| Swift | Rust |
|---|---|
| `selectedDay`, `day`, `configure`, `invalidate`, `load(force:)` | `DayReviewState`, `configure`, `invalidate`, `day_review::load` (+ `should_load`) |
| `DayReviewView.summary` (`DayReviewSummary.calculate`) | slice builder `view::day_review` (now rounded down to the minute) |
| view `.task(id: review.day)` / `refreshDayReview` | `dayReview.setDay` (loads while shown) / `dayReview.refresh` |
| loop L307 | `controllers::tick` |

### WeeklyReportModel (ProductivityModels.swift)

| Swift | Rust |
|---|---|
| `range`, `hasData`, `key` (L61) | `WeeklyState::range`, `has_data`, `weekly::draft_key` |
| `configure`, `invalidate`, `changeDate`, `move` | `weekly::configure`, `invalidate`, `change_date`, `move_by`/`jump_to` |
| `text` `didSet` → `saveDraft()` | `weekly.setText` → throttled `flush_state`/`save_soon`; `persist_pending` per tick |
| `load()`, `generate(targets:titles:)`, `export()` | `weekly::load`, `generate`, `export` (+ `write_atomically`) |
| view's confirmation dialog | `weekly.generate {replace:false}` → `IpcError { kind: "needsConfirmation" }` |
| `copy()` | stays in the UI (clipboard plugin) |

### OfflineDraftModel.swift

| Swift | Rust |
|---|---|
| `init()` read, `readable` | `persist::load` (`unreadable`, issue text) |
| `drafts`, `active`, `activities`, `readyCount`, `canCreate` | `OfflineState::drafts/activities/ready_count/can_create`, `ledger.active()` |
| `configure(_:workspace:)` | `OfflineState::configure` |
| `commit`, `checkpoint`, `cacheActivities` | `offline::commit`, `checkpoint`, `cache_activities` (`hooks::cache_activities`) |
| `save(_:)` | `offline.save` / `offline.startLocal` (`save_draft` + `validate`) |
| `stop()`, `remove(_:)` | `offline::stop`, `remove` |
| `check(_:)` | `offline::review` + `check` |
| `upload()` | `offline::upload` + `send` |
| `link(_:)`, `allowRetryAfterManualCheck()` | `offline::link`, `allow_retry_after_manual_check` |
| view `showSynced` | `offline.setShowSynced` / slice `showSynced` |

### TicketContextModel and AppModel

| Swift | Rust |
|---|---|
| `configure(_:)`, `load(_:)`, `contextRequest` | `TicketContextState::configure`, `ticket_context::show`, `request` |
| `contextRequest = nil` | `ticket.closeContext` |
| `openTicket(_:)` | `ticket.openInAzure` → `Shell::open_url(<org URL>/_workitems/edit/<id>)` |

## Test traceability

The Swift app models had no unit tests (the 297 Swift tests cover `AzureTimetrackerCore`, ported
in att-core). Every test here is new and checks a Swift app rule:

| Rust test | Rule |
|---|---|
| `controllers_statistics::the_week_and_its_preceding_day_load_when_the_page_appears` | range + preceding day, appear load, slice without the entry list |
| `…::refreshes_wait_five_minutes_and_a_failed_refresh_keeps_the_data` | 300 s / 60 s throttle, forced refresh, data kept on failure |
| `…::a_stale_download_is_dropped_when_the_period_or_the_connection_changes` | generation and connection-generation drops |
| `…::zoom_filters_and_entry_pages_follow_the_window` | zoom stack, scale, back, reset, filters, entry pages, 120 ms debounce |
| `…::missing_titles_are_requested_in_one_batch_and_analysed_once_when_they_arrive` | one title batch, one re-analysis |
| `…::an_inaccessible_title_ends_the_batch_after_a_quiet_period` | batch timeout |
| `…::the_period_and_anchor_move_and_reset_the_zoom` | period/anchor navigation, no downloads while hidden |
| `controllers_time_editor::an_edit_is_journalled_before_the_write_and_confirmed_after_it` | durable checkpoint before the write, message, reload |
| `…::a_split_creates_the_second_part_first_and_undo_restores_the_entry` | split order, undo, parent `undone` |
| `…::a_merge_removes_the_later_entry_and_undo_recreates_it` | merge, undo recreates with a new id |
| `…::a_failed_write_is_never_retried_and_the_change_waits_for_review` | partial failure → `needsReview`, no retry, `needsReload`, acknowledge |
| `…::an_interrupted_change_needs_review_after_a_restart_and_blocks_saving` | `applying → needsReview` load rule (Swift JSON) |
| `…::an_unreadable_journal_blocks_saving_before_anything_is_sent` | failed first checkpoint sends nothing |
| `…::an_idle_correction_separates_the_idle_time_and_reports_the_review` | idle correction, separate entry, review id |
| `…::an_idle_correction_for_a_running_entry_is_refused` | running entry guard |
| `…::gaps_and_overlaps_offer_their_valid_corrections` | correction options, guided plan, boundary |
| `…::corrections_wait_for_a_timer_that_crosses_the_review_window` | running timer guard |
| `…::overlap_checks_are_advisory_and_never_block_a_save` | optional check, saved conflicts |
| `…::the_filter_matches_ticket_numbers_and_comments` | `visibleLogs`, selection reset |
| `controllers_day_review::*` (6) | summary with targets/preferences, today unconfirmed, 60 s throttle, failure keeps data, stale day dropped, no connection |
| `controllers_weekly::*` (6) | generate/confirm, needs data, throttled saves + page-change flush, export, keys per week incl. 1.14.x key, no workspace |
| `controllers_offline::*` (9) | start/stop, one running timer across workspaces, validation, `sending` checkpoint before create, lost response flagged/linked, retry after manual check, unreadable ledger preserved, activity cache, no connection |
| `controllers_ticket_context::*` (4) | stale answer dropped, close drops, Azure missing text, open URL |
| `controllers_persistence::*` (3) | restart round trip, 1.14.x ledger with the URL as typed, loop saves the load rule |
| unit: `statistics::tests` (2), `persist::tests` (1) | title batch state machine, 1.14.x weekly key spelling |

## Decisions

1. **Background work runs on its own task** (`controllers::detached`): an intent awaits it, but a
   dropped IPC call never leaves `loading`/`working` set and never interrupts a write between
   checkpoints. Tick loads are spawned so the main loop never waits for the network (Swift's loop
   awaited `statistics.load()`).
2. **Page lifecycle.** SwiftUI `.task` loads become "page appeared" loads in `controllers::tick`
   (statistics, day review, time editor, weekly) plus loads after a connection change while the
   page is shown. Range/day changes load only while their page is shown.
3. **Intent results.** Only `statistics.entries` returns a value (`EntriesPage`). Failures Swift
   reported through a `false` return (`offline.save`, `offline.startLocal`) reject with the Swift
   message (also set as the slice `issue`); `weekly.generate {replace:false}` rejects with
   `needsConfirmation`; a 7pace write while another runs (`timeEditor.save`, `offline.upload`)
   rejects with `busy`; unknown change/correction ids reject with `notFound`. Everything else
   resolves `null` and reports through slices, as Swift did through the model.
4. **Durability.** The journal and the ledger are written to the store before memory changes
   (Swift `commit`/`checkpoint`), independently of the configuration's `can_persist` flag (Swift's
   files were independent too). Unreadable documents disable writes and keep the original.
5. **Weekly drafts** are written at most once per 500 ms (first edit at once, later ones
   together) and immediately when the page, the week or the connection changes; `persist::save`
   writes a pending draft when the interval allows (covers `prepareForRestart`).
6. **Weekly invalidation** keeps the loaded week visible and reloads it while the page is shown
   (Swift cleared it until "Refresh time"); another day of the same week changes nothing (Swift
   dropped the logs without reloading).
7. **Statistics**: titles in one batch, one re-analysis per batch (complete, or 10 s without new
   titles); targets read from the configuration at analysis time; the zoom resets as soon as the
   period changes; analyses use `now` when they run.
8. **Day review summary** is computed in the slice builder with `now` rounded down to the minute
   so the slice does not change on every publish. The confirmation time of a running timer is not
   available from `session::hooks` yet: the summary then reports the timer and hides gaps (never
   guesses).
9. **Workspace identity.** 1.14.x stored the 7pace URL as typed (`https://org.timehub.7pace.com`);
   2.0's `workspace_identity` adds a trailing slash. Drafts, journal records, cached activities and
   weekly draft keys compare with `same_workspace` (ignores the trailing slash and `:443`), and
   weekly drafts are also read under the other spelling. Uploads pass the draft's own spelling to
   `OfflineSync::upload`.
10. **Time editor slice**: `logs` newest first (contract doc), `start/end/splitAt` only while an
    entry is open, `validationIssue` only while an entry is open, `loadedConflicts` only with a
    known tracking state (Swift `guard let state`).
11. **Upload follow-up**: an unconfirmed upload (`sending`) also triggers `worklogs_changed` and
    invalidation, because the create may have reached 7pace (Swift only after success).
12. **Busy guard** is released before `worklogs_changed`, so the session's reloads are never
    refused by a guard the controllers still hold.

## Requests

For the session engineer:

- Call `controllers::hooks::prepare_idle_correction_for(engine, correction.id, …)` (new) instead
  of `prepare_idle_correction`, so a saved correction can call
  `session::hooks::idle_correction_applied(engine, id)`.
- Add `session::hooks::tracking_confirmation(&AppState) -> Option<(TrackingState, Timestamp, bool)>`
  (state, `lastSync`, `health == confirmed`) for the day review summary, and
  `day_review_record(&AppState, Date) -> Option<DayReviewRecord>` for the `dayReview.record` field.
- Refuse `connect()`/`settings.save` while `hooks::offline_working` (Swift did).
- `dayReview.open` can call `controllers::handle(engine, ControllerIntent::SetDayReviewDay {…})`
  and `RefreshDayReview` after `connection.refresh`.

For the lead:

- `TestEngine::new()` imports the developer machine's real
  `~/Library/Application Support/Azure timetracker` (and writes the import marker there): set
  `legacyImportedAt` in `TestEngine::with_store`, as `tests/support/controllers.rs::store_with`
  does.
- Move `controllers::testing::install_clients` into `testing.rs` (e.g. `TestEngine::connect`).
- Decide whether `workspace_identity` should keep the URL as typed (1.14.x) instead of adding a
  slash; the session's keys (`dayReviews`, `quickTickets`, `pausedSession`, `meetingReturn`) have
  the same mismatch.
