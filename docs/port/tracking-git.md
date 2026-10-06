# Port: tracking and Git

Scope: the guarded tracking transactions, the tracking indicator and remembered pause, manual
(ticket-free) tracking, branch watching and repository discovery, all in `att-core`.

| Swift source | Rust module | Public API |
|---|---|---|
| `API.swift` › `TrackingTransaction` | `att_core::tracking` | `switch_to`, `stop`, `no_context` |
| `TrackingIndicator.swift` | `att_core::indicator` | `TrackingIndicator`, `IndicatorIcon`, `IndicatorTone`, `PausedSession`, `status_description` |
| `ManualTracking.swift`, `SlackHuddles.swift` › `StandupActivity` | `att_core::manual` | `ManualTrackingKind`, `StandupActivity` |
| `GitWatcher.swift` | `att_core::git` | `BranchPolicy`, `BranchTicket`, `BranchPattern`, `GitSnapshot`, `GitProbe`, `is_absolute_gitdir`, `resolve_gitdir`, `BranchChange`, `BranchDebouncer`, `BranchTransition`, `AuditEntry`, `record_audit`, `DEFAULT_BRANCH_PATTERN`, `HEAD_SIZE_LIMIT`, `AUDIT_LIMIT` |
| `RepositoryDiscovery.swift` | `att_core::discovery` | `RepositoryDiscovery`, `DiscoveredRepository`, `RepositoryScan`, `strip_verbatim_prefix`, `MACOS_PACKAGE_EXTENSIONS` |

Swift static namespaces (`enum BranchPolicy`, …) stay uninhabited Rust enums, so call sites read
the same: `BranchTicket::extract(branch, pattern)`, `GitProbe::read(path)`.

## Persisted types (state.json)

| Key | Rust type | Reads (Swift) | Writes (2.0) |
|---|---|---|---|
| `pausedSession` | `indicator::PausedSession` | `ticketID`, `activityID`, `remark`, `workspace`, `pausedAt` (seconds since 2001), `elapsedSeconds` | camelCase (`ticketId`, `activityId`), RFC 3339 |
| `pending` | `Vec<git::BranchChange>` | `id`, `repositoryID`, `repositoryName`, `branch`, `previousBranch`, `ticketID`, `detectedAt` | camelCase (`repositoryId`, `ticketId`), RFC 3339 |
| `audit` | `Vec<git::AuditEntry>` | `id`, `date`, `title`, `detail` | same keys, RFC 3339 |
| `configuration.repositories` | `Vec<model::Repository>` | `id` (uppercase UUID), `path`, `enabled` | lowercase UUID |

Optional values are omitted when absent, as Swift's `JSONEncoder` did; keys Swift required stay
required. Each type has a test that decodes JSON produced by the 1.14.2 Swift encoder.

## Traceability

Status: **ported** (same cases and assertions, sometimes stronger), **adapted** (changed for a
stated reason), **not ported** (with the owner).

| Swift `File › Suite › test` | Rust `file::test` | Status |
|---|---|---|
| CoreTests › BranchTests › integrationBranchesSuggestABreak | `core_tests::branch_tests::integration_branches_suggest_a_break` | ported |
| CoreTests › BranchTests › ordinaryTicketBranchesKeepTheirSuggestions | `core_tests::branch_tests::ordinary_ticket_branches_keep_their_suggestions` | ported |
| CoreTests › BranchTests › restoredIntegrationSuggestionIgnoresItsPreviouslyExtractedTicket | `core_tests::branch_tests::restored_integration_suggestion_ignores_its_previously_extracted_ticket` | ported |
| CoreTests › BranchTests › extractsTicket | `core_tests::branch_tests::extracts_ticket` | ported |
| CoreTests › BranchTests › ambiguousAndNonTicketBranches | `core_tests::branch_tests::ambiguous_and_non_ticket_branches` | ported |
| CoreTests › BranchTests › rejectsPatternWithoutGroup | `core_tests::branch_tests::rejects_pattern_without_group` | ported |
| CoreTests › BranchTests › debouncesRapidCheckout | `core_tests::branch_tests::debounces_rapid_checkout` | adapted: asserts the exact baseline transition; Swift's `?.old == nil` also passed on `nil` |
| CoreTests › BranchTests › repositoryAndRelativeWorktree | `core_tests::branch_tests::repository_and_relative_worktree` | ported |
| CoreTests › TransactionTests › switchStopsThenStarts | `core_tests::transaction_tests::switch_stops_then_starts` | ported |
| CoreTests › TransactionTests › sameTicketDoesNotRestart | `core_tests::transaction_tests::same_ticket_does_not_restart` | ported |
| CoreTests › TransactionTests › changedRemoteSessionPreventsAllWrites | `core_tests::transaction_tests::changed_remote_session_prevents_all_writes` | ported, asserts `RemoteChanged` |
| CoreTests › TransactionTests › failedStopNeverStarts | `core_tests::transaction_tests::failed_stop_never_starts` | ported, `URLError(.timedOut)` → `AppError::Timeout` |
| CoreTests › TransactionTests › unconfirmedStopNeverStarts | `core_tests::transaction_tests::unconfirmed_stop_never_starts` | ported, asserts the message |
| CoreTests › TransactionTests › timedOutStartIsNotReplayed | `core_tests::transaction_tests::timed_out_start_is_not_replayed` | ported |
| CoreTests › TransactionTests › forbiddenStartDoesNotStopCurrentTimer | `core_tests::transaction_tests::forbidden_start_does_not_stop_current_timer` | ported, asserts the message |
| CoreTests › TransactionTests › idleStartsWithoutStop | `core_tests::transaction_tests::idle_starts_without_stop` | ported |
| CoreTests › TransactionTests › stopRespectsRemoteChange | `core_tests::transaction_tests::stop_respects_remote_change` | ported |
| CoreTests › TransactionTests › selectedActivityIsUsedForTheNewSession | `core_tests::transaction_tests::selected_activity_is_used_for_the_new_session` | ported |
| CoreTests › TransactionTests › sameTicketWithDifferentActivityStartsANewSession | `core_tests::transaction_tests::same_ticket_with_different_activity_starts_a_new_session` | ported |
| CoreTests › TransactionTests › sameTicketAndActivityKeepsCurrentSession | `core_tests::transaction_tests::same_ticket_and_activity_keeps_current_session` | ported |
| CoreTests › ActivityChoiceTests › selectionIsRequiredWhenActivityTypesExist | `core_tests::activity_choice_tests::selection_is_required_when_activity_types_exist` | ported |
| CoreTests › ActivityChoiceTests › staleActivityIsRejected | `core_tests::activity_choice_tests::stale_activity_is_rejected` | ported |
| CoreTests › ActivityChoiceTests › explicitChoiceIsPreserved | `core_tests::activity_choice_tests::explicit_choice_is_preserved` | ported |
| CoreTests › ActivityChoiceTests › workspacesWithoutActivityTypesUseServerDefault | `core_tests::activity_choice_tests::workspaces_without_activity_types_use_server_default` | ported |
| CoreTests › DecodingTests › errorsInHTTP200AreRejected | `core_tests::decoding_tests::errors_in_http200_are_rejected` | ported |
| CoreTests › DecodingTests › numericEnumsAndActivityChecks | `core_tests::decoding_tests::numeric_enums_and_activity_checks` | ported |
| CoreTests › DecodingTests › missingStateIsNotTreatedAsIdle | `core_tests::decoding_tests::missing_state_is_not_treated_as_idle` | ported |
| CoreTests › DecodingTests › dateFormats | `core_tests::decoding_tests::date_formats` | ported, `Europe/Brussels` pinned for the offset-free value |
| CoreTests › DecodingTests › rejectsUnsafeEndpoints (5 cases) | — | not ported: moved to att-net with `Endpoint` |
| MeetingAndStatusTests › TrackingIndicatorTests › pauseRequiresConfirmedIdleState | `tracking_indicator_tests::pause_requires_confirmed_idle_state` | ported |
| MeetingAndStatusTests › TrackingIndicatorTests › pausedSessionPreservesTicketActivityAndWorkspaceAcrossRestart | `tracking_indicator_tests::paused_session_preserves_ticket_activity_and_workspace_across_restart` | ported |
| MeetingAndStatusTests › TrackingIndicatorTests › runningStoppedAndDisconnectedAreDistinct | `tracking_indicator_tests::running_stopped_and_disconnected_are_distinct` | ported |
| MeetingAndStatusTests › TrackingIndicatorTests › serverActivityCheckGetsAnAttentionIndicator | `tracking_indicator_tests::server_activity_check_gets_an_attention_indicator` | ported |
| MeetingAndStatusTests › TrackingIndicatorTests › malformedRemoteStateIsNotShownAsStopped | `tracking_indicator_tests::malformed_remote_state_is_not_shown_as_stopped` | ported |
| TimeEditingTests › TrackingAttentionTests › limitStopUsesServerReasonAndPreservesTaskSelection | `tracking_attention_tests::limit_stop_uses_server_reason_and_preserves_task_selection` | ported |
| TimeEditingTests › TrackingAttentionTests › manualStopsOtherClientsAndElapsedTimeAloneDoNotTriggerPrompt | `tracking_attention_tests::manual_stops_other_clients_and_elapsed_time_alone_do_not_trigger_prompt` | ported |
| TimeEditingTests › TrackingAttentionTests › activityCheckAndTimeoutAreDistinctPrompts | `tracking_attention_tests::activity_check_and_timeout_are_distinct_prompts` | ported |
| TimeEditingTests › TrackingAttentionTests › staleStopPromptCannotResumeDifferentStoppedTask | `tracking_attention_tests::stale_stop_prompt_cannot_resume_different_stopped_task` | ported |
| TimeEditingTests › TrackingAttentionTests › continuingConfirmedLimitStopStartsNewSessionWithoutStoppingAgain | `tracking_attention_tests::continuing_confirmed_limit_stop_starts_new_session_without_stopping_again` | ported |
| ManualTrackingTests › ManualTrackingTests › noTicketOrTitleRequired | `manual_tracking_tests::no_ticket_or_title_required` | ported |
| ManualTrackingTests › LocalTimerDisplayTests › localClockWhenRemoteIsIdleOrUnavailable | — | not ported: tests `OfflineDraft`/`LocalTimerDisplay`, owned by `att_core::offline` |
| RepositoryDiscoveryTests › nestedRepositoriesWorktreesAndRoot | `repository_discovery_tests::nested_repositories_worktrees_and_root` | ported |
| RepositoryDiscoveryTests › ignoresGitMetadataAndDirectoryLinksAndReportsInvalidRoots | `repository_discovery_tests::ignores_git_metadata_and_directory_links_and_reports_invalid_roots` | ported |
| RepositoryDiscoveryTests › emptyInvalidAndCancelledScans | `repository_discovery_tests::empty_invalid_and_cancelled_scans` | ported, `CancellationError` → `AppError::Cancelled` |
| RepositoryDiscoveryTests › selectedPathsDoNotDuplicateOrEnableExistingPausedRepositories | `repository_discovery_tests::selected_paths_do_not_duplicate_or_enable_existing_paused_repositories` | adapted: skips where the OS cannot create directory links (Windows without the privilege) |
| SlackHuddleTests › onlyStandupActivityMatches | `manual_tracking_tests::only_standup_activity_matches` | ported: `StandupActivity` is live code |
| SlackHuddleTests › noTicketTrackingPreservesExactActivityAndComment | `core_tests::transaction_extras::no_ticket_tracking_preserves_exact_activity_and_comment` | ported: tests `TrackingTransaction` |
| SlackHuddleTests › emptyUnassignedTrackingIsRejectedBeforeNetwork | `core_tests::transaction_extras::empty_unassigned_tracking_is_rejected_before_network` | ported: tests `TrackingTransaction` |
| SlackHuddleTests › standupPauseRoundTripPreservesCommentWithoutFakeTicket | `tracking_indicator_tests::standup_pause_round_trip_preserves_comment_without_fake_ticket` | ported: tests `PausedSession` |
| SlackHuddleTests › all other tests | — | not ported: huddle detection is dead code |
| FigmaContextTests › outdatedContextNeverMutatesTracking, ticketFreeDesignStartsWithFileComment | — | owned by the Figma port; same transaction path covered by `transaction_extras::outdated_context_before_any_write_prevents_all_writes` and `no_ticket_tracking_preserves_exact_activity_and_comment` |

New tests without a Swift counterpart:

- `core_tests::git_tests`: `default_pattern_matches_swift_results` and `custom_patterns_match_swift_results`
  (43 branches and 17 custom patterns, expected values produced by running GitWatcher.swift's
  `BranchTicket.extract` under Swift 6.4), `default_pattern_keeps_the_unicode_minus_sign`,
  `invalid_patterns_report_the_swift_message_except_on_integration_branches`,
  `tester_result_texts`, `pathological_patterns_fail_instead_of_hanging`,
  `compiled_pattern_is_reusable`,
  `gitdir_pointers_with_windows_absolute_paths_are_not_joined_to_the_worktree`,
  `absolute_gitdir_pointer_is_followed`, `head_size_encoding_and_format_limits`,
  `probe_errors_use_the_swift_messages`, `branch_changes_decode_swift_json`,
  `audit_entries_decode_swift_json`, `audit_log_keeps_the_newest_2000_entries`,
  `flicker_back_to_the_committed_branch_cancels_the_candidate`,
  `debouncer_forgets_unwatched_repositories`.
- `core_tests::transaction_extras`: `invalid_tickets_and_blank_comments_are_rejected_before_network`,
  `same_ticket_free_comment_keeps_current_session`,
  `outdated_context_before_any_write_prevents_all_writes`,
  `context_is_validated_again_between_stop_and_start`,
  `successful_switch_validates_the_context_twice_and_a_no_op_once`,
  `unknown_or_rejected_remote_state_stops_before_writes`,
  `start_must_confirm_ticket_activity_and_comment`,
  `stop_leaves_an_idle_timer_alone_and_requires_confirmation`,
  `transactions_accept_trait_objects_and_are_send`.
- `tracking_indicator_tests`: `paused_sessions_decode_swift_json`,
  `paused_sessions_write_camel_case_and_rfc3339`, `paused_session_from_state_and_title`,
  `labels_symbols_icons_and_tones`, `status_description_matches_the_menu_bar_tooltip`.
- `tracking_attention_tests`: `prompt_that_disappeared_blocks_the_switch`, `prompt_texts`.
- `manual_tracking_tests`: `kinds_keep_their_menu_order_labels_and_raw_values`,
  `comments_are_kept_verbatim_and_blank_activity_names_fall_back`,
  `standup_names_ignore_case_spacing_and_punctuation`.
- `repository_discovery_tests`: `invalid_roots_and_cancellation_mid_scan`,
  `packages_are_skipped_on_macos_only`, `results_are_in_finder_order`,
  `canonical_paths_are_standardized_and_resolved`, `macos_private_prefix_reads_like_foundation`
  (macOS only), `unreadable_folders_are_reported_and_skipped` (Unix only),
  `verbatim_prefixes_are_removed`, `repositories_decode_swift_json`.

The Swift fakes live in `crates/att-core/tests/support/tracking.rs` (`StateSpec`/`state`, the
Swift `state(...)` helper with its defaults, and `StubTracker` with `tokio::sync::Mutex` state).
Other suites can include it with `#[path = "support/tracking.rs"] mod support;`.

## Decisions

1. **Transaction API.** `switch_to(ticket_id, expected_identity, activity_type, remark,
   expected_attention, service, validate_context)` keeps Swift's argument order.
   `validate_context` is any `Fn() -> impl Future<Output = Result<()>>`; pass `no_context` for
   Swift's default `{}`. It runs before the first write and again between stop and start. `service`
   may be `&dyn TrackingService`; the returned futures are `Send` when the closure's are.
2. **Exact step order** as in Swift, including `.checked()` on every service response (the
   7pace client already checks, the second check is idempotent) and the start-allowed check
   before the stop. No write is retried.
3. **Error texts.** Every Swift message is copied verbatim. Swift surfaced some Foundation
   errors through `localizedDescription`; their wording was captured on macOS 27 with Swift 6.4
   and reproduced: `The value “<pattern>” is invalid.` (NSRegularExpression), `The file “HEAD”
   couldn’t be opened because there is no such file.`, `… because you don’t have permission to
   view it.`, the generic `The file “HEAD” couldn’t be opened.` (also for a file where a folder
   is expected), and `The file couldn’t be opened because it isn’t in the correct format.`
   (invalid UTF-8 in `.git`).
4. **Ticket patterns.** `fancy_regex`, case-insensitive, at least one capture group, all distinct
   group-1 integers in 1…`i32::MAX`, a ticket only when exactly one remains. The break policy runs
   before compiling, as in Swift. `BranchPattern` compiles once for repeated use. Guards: a
   backtracking budget of 1,000,000 steps (the `fancy_regex` default, set explicitly) and a 1 MiB
   compiled-size limit. A search that exceeds the budget fails with the new message `The branch
   pattern is too complex to check this branch. Simplify the pattern.` (ICU had no limit and could
   hang). `DEFAULT_BRANCH_PATTERN` keeps U+2212.
5. **Branch policy.** Swift's `split(separator:)` drops empty pieces, so `/develop` is the
   develop family; reproduced.
6. **HEAD reading.** At most 8,192 bytes are read; a file of 8,192 bytes or more is rejected
   (same outcome as Swift's read-then-check `count < 8192`, without reading large files). A leading
   UTF-8 byte-order mark is dropped, as Foundation does. A detached HEAD is 40 to 64 hex digits.
   The `.git` pointer file is read whole, as in Swift. Git is never executed.
7. **Windows `gitdir` fix.** Besides a leading `/`, drive paths (`C:\…`, `C:/…`) and UNC paths
   (`\\server\…`, which also covers `\\?\…`) are absolute. Everything else is joined to the
   working tree, so drive-relative `C:x` and Windows-rooted `\x` follow `Path::join` on Windows.
8. **Canonical paths** mirror Foundation's `standardizedFileURL.resolvingSymlinksInPath()`:
   relative paths resolve against the current directory, `.`/`..` are removed lexically first,
   existing paths are then resolved with `std::fs::canonicalize`, missing paths stay unresolved
   (no partial resolution). On macOS `/private/…` is reported without `/private` when that path
   exists (Foundation does this, so 1.14.x stored `/var/…` and `/tmp/…`). The Windows verbatim
   prefix is removed (`\\?\C:\…` → `C:\…`, `\\?\UNC\s\…` → `\\s\…`); other verbatim forms stay.
9. **Scan.** Depth-first and read-only. Links are never followed (Rust's `is_symlink` also
   covers Windows junctions). `.git` entries are never entered. Packages are detected by a
   documented, case-insensitive extension list (`MACOS_PACKAGE_EXTENSIONS`) and skipped on macOS
   only, as the plan's capability map says; `scan_with` makes the policy explicit for tests.
   Each folder's entries are visited in `natural_cmp` order so issue lists are deterministic.
   Results are sorted by `natural_cmp` with a byte-order tie-break.
10. **`StandupActivity`** moved from the dead SlackHuddles.swift into `manual.rs`; its
    letter filter keeps combining marks with their letter, like Swift's `Character.isLetter`
    over grapheme clusters.
11. **Indicator.** `TrackingIndicator::resolve` is unchanged; the app's extra rule (a confirmed
    connection with an open attention prompt shows Attention) stays with the caller. Added for
    both platforms: `IndicatorIcon` (asset key per state), `IndicatorTone` (Swift `tint`), and
    `status_description` (the tray tooltip text from MenuBarController.swift; the connection
    health label is an input because `ConnectionHealth` belongs to the productivity port).
12. **Small helpers** for logic that lived in AppModel and has fixed strings:
    `PausedSession::{from_state, title}`, `BranchTicket::tester_result`, `record_audit` with
    `AUDIT_LIMIT` (2,000). Debounce baselines (`BranchTransition::old == None`), audit texts and
    branch re-validation before acting remain engine work.
13. **Foundation changes** (`model.rs`): `Repository::name()` returned `""` for `/`; it now
    returns `/` like `lastPathComponent`. The logic moved to `pub(crate) last_path_component`,
    shared with `GitProbe` messages and `DiscoveredRepository::name`. Public API unchanged.
    `attention.rs` was reviewed against TrackingAttention.swift; no change was needed.

## Known gaps

- User patterns are compiled by `fancy_regex`, not ICU. The default pattern and the corpus above
  match; exotic ICU syntax (for example `\Q…\E`) may be rejected, and Settings then shows
  `Invalid pattern: …`.
- Package detection uses extensions only. Foundation also honours the bundle bit and package
  types registered by installed apps.
- `natural_cmp` orders punctuation by code point and folds case completely; ICU's
  `localizedStandardCompare` orders `_` before `-` before `.` and lowercase first. This only
  changes the display order of scan results.
- Path deduplication compares strings. Windows paths that do not exist keep the case they were
  given.
