# Worklogs and offline drafts (port notes)

Scope: `crates/att-core/src/worklog/{edit,ops,corrections}.rs` and `crates/att-core/src/offline.rs`,
ported from `WorkLogEditing.swift`, `WorkLogOperations.swift`, `TimeCorrections.swift` and
`OfflineDrafts.swift` (1.14.2). Tests live in `crates/att-core/tests/{time_editing_tests,
work_operations_tests, time_correction_tests, offline_draft_tests}.rs` with shared fixtures in
`tests/support/worklogs.rs`. `worklog/mod.rs` (`WorkLogTimeEdit`, `WorkLogDraft`) is unchanged.

## API map

Every function that read `Date()` or the current zone in Swift takes `now: Timestamp` and
`cal: &Cal`. Swift namespaces (caseless enums) stay caseless enums so call sites read the same.

| Swift | Rust |
|---|---|
| `WorkLogTimeEdit.validate(now:)`, `.matches(_:)` | `WorkLogTimeEdit::validate(now, cal)`, `matches(log, cal)` (`worklog::edit`) |
| `WorkLogConflict`, `WorkLogOverlap.validateEditableEntry`, `.conflicts` | `edit::WorkLogConflict`, `WorkLogOverlap::validate_editable_entry(id, state)`, `conflicts(edit, excluding, logs, state, now, cal)` |
| `WorkLogEditReview`, `WorkLogEditResult`, `WorkLogEditing.review/save` | same names; `WorkLogEditing::review/save(original, edit, service, now, cal)` |
| `WorkLogDraft(start:end:ticketID:comment:activityID:billable:)` | `WorkLogDraft::from_times(start, end, ticket_id, comment, activity_id, billable, now, cal)` (`worklog::ops`) |
| `WorkLogDraft(_ log:existing:)`, `.validate()`, `.matches(_:)` | `WorkLogDraft::from_log(log, existing, cal)`, `validate(now, cal)`, `matches(log, cal)` |
| `WorkLogPlan.edit/split/merge/undo` | `WorkLogPlan::edit(log, time, now, cal)`, `split(log, at, ticket, comment, activity, now, cal)`, `merge(logs, now, cal)`, `undo(record, cal)` |
| `WorkLogChangeStatus`, `WorkLogChange(plan:workspace:)` | `WorkLogChangeStatus`, `WorkLogChange::new(plan, workspace, now)` |
| `WorkLogOperations.unchanged/apply` | `WorkLogOperations::unchanged(actual, expected)`, `apply(plan, workspace, service, now, cal, checkpoint)` |
| `UUID(uuidString:) != nil` | `ops::is_swift_uuid(text)` (strict 8-4-4-4-12; `Uuid::try_parse` alone is looser) |
| `TimeCorrectionIssue` (`.Kind`, `.id`, `.seconds`) | `corrections::TimeCorrectionIssue` (`TimeCorrectionKind`, `id()`, `seconds()`) |
| `TimeCorrections.issues/fillGap/removeInterval/moveBoundary` | `TimeCorrections::issues(logs, window, minimum_gap, cal)`, `fill_gap(issue, using_earlier, now, cal)`, `remove_interval(log, start, end, separate, now, cal)`, `move_boundary(issue, boundary, now, cal)` |
| `OfflineDraftStatus`, `OfflineDraft`, `.proposal()` | `offline::OfflineDraftStatus`, `OfflineDraft::new(workspace, start, end, ticket_id, comment, activity_id)`, `proposal(now, cal)` |
| `OfflineLedger.replace` | `OfflineLedger::replace`, plus accessors `active()`, `activities_for(workspace)`, `cache_activities(workspace, types)` |
| `OfflineReview(draft:logs:state:)`, `.warningKey` | `OfflineReview::new(draft, logs, state, now, cal)`, `warning_key()` |
| `OfflineSync.review/upload` | `OfflineSync::review(draft, service, now, cal)`, `upload(reviewed, workspace, service, now, cal, checkpoint)` |
| `LocalTimerDisplay.isPrimary/elapsed` | `LocalTimerDisplay::is_primary(local, remote_running, remote_confirmed)`, `elapsed(draft, now)` |
| `OfflineDraftFile` | not ported here; file I/O and 0700/0600 permissions belong to `att-store` |

## Traceability

| Swift `File › Suite › test` | Rust `file::test` | Status |
|---|---|---|
| TimeEditingTests.swift › TimeEditingTests › overlapsIncludeContainingAndCrossMidnightEntriesButNotTouchingEdges | time_editing_tests::overlaps_include_containing_and_cross_midnight_entries_but_not_touching_edges | ported |
| › liveTimerIsCountedOnceAndCannotBeEdited | time_editing_tests::live_timer_is_counted_once_and_cannot_be_edited | ported |
| › incompleteDatesAreReportedAndInvalidDraftsAreRejected | time_editing_tests::incomplete_dates_are_reported_and_invalid_drafts_are_rejected | adapted: fixed clock; `.distantFuture`/`.distantPast` as explicit instants |
| › lockedAndExternallyChangedEntriesPreventWrites | time_editing_tests::locked_and_externally_changed_entries_prevent_writes | ported |
| › overlappingEditSavesDirectlyWithoutPriorReview | time_editing_tests::overlapping_edit_saves_directly_without_prior_review | ported |
| › newOverlapAfterOptionalCheckIsReturnedAsNoticeAndDoesNotBlockSave | time_editing_tests::new_overlap_after_optional_check_is_returned_as_notice_and_does_not_block_save | ported |
| › unavailableOverlapHistoryWarnsButDoesNotBlockValidSave | time_editing_tests::unavailable_overlap_history_warns_but_does_not_block_valid_save | ported |
| › unreadableOtherEntryOrOtherTimerStartDoesNotBlockSave | time_editing_tests::unreadable_other_entry_or_other_timer_start_does_not_block_save | ported |
| › selectedRunningEntryAndUnknownRunningEntryStillPreventSaveEvenWithoutHistory | time_editing_tests::selected_running_entry_and_unknown_running_entry_still_prevent_save_even_without_history | ported |
| › cancelledOverlapRequestDoesNotContinueToWrite | time_editing_tests::cancelled_overlap_request_does_not_continue_to_write | adapted: `CancellationError` → `AppError::Cancelled` |
| › changeDuringHistoryFetchIsCaughtBeforeSaving | time_editing_tests::change_during_history_fetch_is_caught_before_saving | ported |
| › permissionRevocationAfterReviewPreventsSave | time_editing_tests::permission_revocation_after_review_prevents_save | ported |
| › failedOrMismatchedWriteIsNeverRetried | time_editing_tests::failed_or_mismatched_write_is_never_retried | ported |
| TimeEditingTests.swift › TrackingAttentionTests (5 tests) | — | not ported here: tracking scope |
| WorkOperationsTests.swift › WorkOperationsTests › splitPreservesExactTimeAndBillableRemainder | work_operations_tests::split_preserves_exact_time_and_billable_remainder | ported |
| › mergePreservesTotalsAndRejectsGapsOverlapsOrDifferentMetadata | work_operations_tests::merge_preserves_totals_and_rejects_gaps_overlaps_or_different_metadata | ported |
| › splitAndUndoRestoreOriginalTimeWithoutDuplicateRequests | work_operations_tests::split_and_undo_restore_original_time_without_duplicate_requests | ported |
| › mergeAndUndoRecreateRemovedEntryWithNewID | work_operations_tests::merge_and_undo_recreate_removed_entry_with_new_id | ported |
| › editCanBeUndoneButExternalChangesPreventUndo | work_operations_tests::edit_can_be_undone_but_external_changes_prevent_undo | ported |
| › missingDeletePermissionAndRunningEntriesPreventEveryWrite | work_operations_tests::missing_delete_permission_and_running_entries_prevent_every_write | ported |
| › lostCreateIsNeverRetriedAndLeavesDurableReviewRecord | work_operations_tests::lost_create_is_never_retried_and_leaves_durable_review_record | ported |
| › failedMergeDoesNotDeleteSourcesAndJournalFailurePreventsWrites | work_operations_tests::failed_merge_does_not_delete_sources_and_journal_failure_prevents_writes | ported |
| › journalRoundTripsAllRecoveryData | work_operations_tests::journal_round_trips_all_recovery_data | ported |
| WorkOperationsTests.swift › WorkInsightTests (4 tests) | — | not ported here: insights scope |
| TimeCorrectionTests.swift › TimeCorrectionTests › unionFindsGapsWithoutFalseGapsInsideNestedEntries | time_correction_tests::union_finds_gaps_without_false_gaps_inside_nested_entries | ported |
| › touchingEntriesDoNotOverlapAndOvernightIsClipped | time_correction_tests::touching_entries_do_not_overlap_and_overnight_is_clipped | ported |
| › leadingTrailingAndThresholdGaps | time_correction_tests::leading_trailing_and_threshold_gaps | ported |
| › invalidIntervalsDoNotInventGaps | time_correction_tests::invalid_intervals_do_not_invent_gaps | ported |
| › removeMiddlePreservesBothWorkSegmentsAndBillableProportion | time_correction_tests::remove_middle_preserves_both_work_segments_and_billable_proportion | ported |
| › separateIntervalPreservesTotalsAndChangesOnlyIdleMetadata | time_correction_tests::separate_interval_preserves_totals_and_changes_only_idle_metadata | ported |
| › boundaryRemovesOnlyOverlappingDuration | time_correction_tests::boundary_removes_only_overlapping_duration | ported |
| › wholeRemovalAndOutOfBoundsCannotDeleteEntries | time_correction_tests::whole_removal_and_out_of_bounds_cannot_delete_entries | ported |
| › correctionUndoRestoresOriginalAndChangedSourceBlocksSave | time_correction_tests::correction_undo_restores_original_and_changed_source_blocks_save | ported |
| › fractionalIdleBoundariesRoundTripThroughSecondPrecisionAPI | time_correction_tests::fractional_idle_boundaries_round_trip_through_second_precision_api | ported |
| › runningEntryCannotBeCorrected | time_correction_tests::running_entry_cannot_be_corrected | ported |
| OfflineDraftTests.swift › OfflineDraftTests › localTimerPersistsAndOnlyOneMayRunAcrossWorkspaces | offline_draft_tests::local_timer_persists_and_only_one_may_run_across_workspaces | adapted: ledger rules and a JSON round trip here; file write/read and the 0600 check moved to att-store |
| › corruptFileIsNotSilentlyReset | — | not ported: moved to att-store (file preservation is a storage rule) |
| › uploadsOnceWithDurableSendingCheckpointThenConfirmation | offline_draft_tests::uploads_once_with_durable_sending_checkpoint_then_confirmation | ported |
| › lostResponseNeedsReconciliationAndCannotReplay | offline_draft_tests::lost_response_needs_reconciliation_and_cannot_replay | ported |
| › checkpointFailureBeforeWritePreventsRequestAndAfterWritePreservesUncertainty | offline_draft_tests::checkpoint_failure_before_write_prevents_request_and_after_write_preserves_uncertainty | ported |
| › workspaceMismatchAndMissingActivityNeverWrite | offline_draft_tests::workspace_mismatch_and_missing_activity_never_write | ported |
| › overlapsAreAdvisoryButChangedOverlapRequiresReview | offline_draft_tests::overlaps_are_advisory_but_changed_overlap_requires_review | ported |
| › duplicateAppearingAfterReviewPreventsAnotherCreate | offline_draft_tests::duplicate_appearing_after_review_prevents_another_create | ported |
| › stoppingWithFractionalSecondsNeverRoundsIntoFuture | offline_draft_tests::stopping_with_fractional_seconds_never_rounds_into_future | adapted: fixed clock, tried with four sub-second fractions |
| › ticketFreeDraftNeedsCommentAndFutureTimeIsRejected | offline_draft_tests::ticket_free_draft_needs_comment_and_future_time_is_rejected | ported |
| ManualTrackingTests.swift › LocalTimerDisplayTests › localClockWhenRemoteIsIdleOrUnavailable | offline_draft_tests::local_clock_when_remote_is_idle_or_unavailable | ported here because `LocalTimerDisplay` lives in `offline.rs` |

Rust-only tests (rules without a Swift test, all cross-checked against the Swift sources): validation
bounds and the repeated-hour rule; `matches` tolerance; Swift journal/ledger decoding
(`swift_journal_decodes_with_plans_and_worklog_snapshots`, `swift_ledger_decodes_drafts_statuses_and_cached_activities`);
Rust plans equal to the plans Swift built from the same entries; tolerant decoding; checkpoint order
for split and merge; duplicate/unknown/empty plans; existing restoration target; unconfirmed
removal; undo status guard; draft constructors and `matches`; correction identities and
tie-breaks, zero-length entries, gap filling, leading separate intervals, staggered boundaries;
offline status raw values, ledger accessors, titles, overlap notices, activity re-resolution,
unconfirmed creates; `Send` checks for the `save`, `apply` and `upload` futures.

The JSON fixtures were produced by compiling the 1.14.2 Swift sources with a small program that
encodes real `WorkLogChange`, `WorkLogPlan` and `OfflineLedger` values with `JSONEncoder()`; the
same program confirmed every Rust-only expectation above against the Swift implementation.

## Decisions

1. **Repeated local hour (DST).** The round-trip check uses `wire_date` as instructed, so
   validation agrees with `WorkLog::date` and `matches` (otherwise an edit in that hour could
   never be confirmed). Swift's `DateFormatter` resolved `2025-10-26T02:30:00` (Brussels) to the
   *later* instant: 1.14.2 rejected the first (CEST) occurrence and accepted the second.
   `wire_date::parse` resolves to the *earlier* instant, so 2.0 accepts the first and rejects the
   second. Swift also returned `nil` for local times inside the spring-forward gap, where
   `wire_date` moves them forward. Both are foundation choices (see the report).
2. **Checkpoints** are generic async callbacks, `F: FnMut(T) -> Fut, Fut: Future<Output =
   Result<()>>`, receiving the record by value like Swift's struct copy. `FnMut` is looser than
   Swift's `@Sendable` closure; the returned futures are `Send` whenever the callback is (tested).
3. **Cancellation.** There is no `checkCancellation`; a dropped future stops at its next `.await`.
   `WorkLogEditing::review` propagates `AppError::Cancelled` from the history query instead of
   turning it into a notice. Inside `apply`, a `Cancelled` error from a service is treated like
   any other failure (`needsReview`), as Swift's catch-all did. A dropped `apply` future leaves
   the journal record `applying` and a dropped `upload` leaves the draft `sending`; the engine
   must treat a lingering `applying` record as needing review (below).
4. **Services** are `&dyn` trait objects like Swift's `any`. Trait upcasting lets an
   `OfflineDraftService` stand in for the mutation service.
5. **`current_tracking()` is `checked()` again**, as Swift did, even if the client already checks.
6. **Serialization.** `WorkLogChange`, `WorkLogPlan`, `OfflineDraft` and `OfflineLedger` decode
   the exact Swift JSON (dates as seconds since 2001, uppercase UUIDs, `\/` escapes, Swift key
   aliases, raw status strings) and write camelCase with RFC 3339 dates, omitting `None`s. Keys with
   a Swift property default (`status`, `detail`, `comment`, `billable`, the lists, a ledger's
   `drafts`/`activities`) decode to that default when missing, where Swift failed the whole file.
7. **Swift `Double` text.** `TimeCorrectionIssue::id()` and `OfflineReview::warning_key()` format
   seconds with `{:?}`, which matches Swift's description (`1790578800.0`) for real timestamps.
   Both are in-memory identities; only the ordering of ties depends on them.
8. **Activity cache key** is the workspace identity string (Swift
   `Endpoint.sevenPace(url).absoluteString.lowercased()`), the same value stored in
   `OfflineDraft::workspace`. The ledger takes it as given; whoever computes the identity
   normalizes it.
9. **`WorkLogEditing`** is ported in full even though plan §2 lists it as dead code, because its
   advisory-overlap semantics are tested and the engine will use them.

## Left to the engine (app rules, not ported here)

From `TimeEditorModel.swift`:

- On load, every `applying` record becomes `needsReview` with detail "The app closed during this
  change. Check the affected entries in 7pace; no request will be replayed." Apply the same after
  an `apply` future is dropped.
- Persisting a checkpoint replaces the record with the same ID; when a `complete` record has
  `undo_of`, the parent record becomes `undone`.
- Acknowledge: status `reviewed`, detail + " User acknowledged checking the entries in 7pace."
- Recent edits are filtered by workspace and sorted newest first; saving is blocked while any of
  them is `needsReview` or `applying`. An unreadable journal blocks every save ("Edit history
  could not be read. " + error).
- The editor's own pre-save overlap advice unions conflicts across all desired drafts, excluding
  every source entry, with the prefix "Overlap check incomplete. ".
- Before guided corrections, every source is re-read and compared with `WorkLogOperations::unchanged`;
  the review window ends at `min(now, finish)` and is refused while a running timer started before
  its end ("Pause or stop the timer that crosses this review window, so its boundaries are confirmed.").

From `OfflineDraftModel.swift`: saving a draft (workspace must match, status `draft`, an uploaded
or unconfirmed draft cannot be edited, ticket in range or a comment, start not in the future,
stopped drafts must have a valid proposal), stopping the timer at `now`, removing (never while
`sending`), linking an existing match (re-read, `proposal().matches`, mark `synced` with the
remote ID), unlocking a `sending` draft after a manual check (only when the review has no
matches), and caching activities after each successful activity fetch.
