# Context engines port

Scope: calendar meetings, microphone meetings, meeting-end prompts, Figma context, time awareness,
ticket completion and appearance preferences, ported from Swift 1.14.2 into `att-core`.

| Swift source | Rust module |
|---|---|
| `MeetingSuggestions.swift` | `att_core::meetings` |
| `MicrophoneMeetings.swift` | `att_core::microphone` |
| `MicrophoneTrackingEnd.swift` | `att_core::microphone_end` |
| `FigmaContext.swift` | `att_core::figma` |
| `WorkAwareness.swift` | `att_core::awareness` |
| `TicketCompletion.swift` (`TicketWorkflowStatus` stays in `att_core::ticket`) | `att_core::completion` |
| `InterfacePreferences.swift` | `att_core::interface_prefs` |

Swift enum namespaces become modules, as `WireDate` → `wire_date` in the foundation:
`MeetingTicket` → `meetings::meeting_ticket`, `MeetingActivity` → `meetings::meeting_activity`,
`DesignActivity` → `figma::design_activity`. `StandupActivity` (SlackHuddles.swift) was ported
by the tracking engineer as `crate::manual::StandupActivity` and is not duplicated here; nothing in
this scope uses it. The rest of `SlackHuddles.swift` is dead code.

## Traceability

Rust paths are `crates/att-core/tests/<file>::<test>`. Shared fixtures (the Swift `state(_:session:)`
and `localDate` helpers) are in `tests/support/context.rs`.

| Swift `File › Suite › test` | Rust `file::test` | Status |
|---|---|---|
| MeetingAndStatusTests › MeetingSuggestionTests › startsOnceAndSurvivesRestart | meeting_and_status_tests::starts_once_and_survives_restart | ported |
| MeetingAndStatusTests › MeetingSuggestionTests › doesNotPromptBeforeStart | meeting_and_status_tests::does_not_prompt_before_start | ported |
| MeetingAndStatusTests › MeetingSuggestionTests › gracePeriodAndExpiredEvents | meeting_and_status_tests::grace_period_and_expired_events | ported |
| MeetingAndStatusTests › MeetingSuggestionTests › ignoresNonMeetingTimeAndDeclinedInvitations | meeting_and_status_tests::ignores_non_meeting_time_and_declined_invitations | ported |
| MeetingAndStatusTests › MeetingSuggestionTests › recurringOccurrencesAndOverlappingMeetingsRemainIndependent | meeting_and_status_tests::recurring_occurrences_and_overlapping_meetings_remain_independent | ported |
| MeetingAndStatusTests › MeetingSuggestionTests › prunesOldReminderKeys | meeting_and_status_tests::prunes_old_reminder_keys | ported |
| MeetingAndStatusTests › MeetingSuggestionTests › calendarRemovalOrCancellationMakesEventInactive | meeting_and_status_tests::calendar_removal_or_cancellation_makes_event_inactive | ported |
| MeetingAndStatusTests › MeetingTicketTests › explicitTitleMarkers (3 cases) | meeting_and_status_tests::explicit_title_markers | ported |
| MeetingAndStatusTests › MeetingTicketTests › ambiguousAndUnmarkedNumbersRequireManualSelection (6 cases) | meeting_and_status_tests::ambiguous_and_unmarked_numbers_require_manual_selection | ported |
| MeetingAndStatusTests › MeetingTicketTests › azureLinksUseTheConfiguredOrganization | meeting_and_status_tests::azure_links_use_the_configured_organization | ported |
| MeetingAndStatusTests › MeetingTicketTests › notesLinksAndLegacyAzureHosts | meeting_and_status_tests::notes_links_and_legacy_azure_hosts | ported |
| MeetingAndStatusTests › MeetingTicketTests › conflictingTitleAndURLAreNotGuessed | meeting_and_status_tests::conflicting_title_and_url_are_not_guessed | ported |
| MeetingAndStatusTests › MeetingTicketTests › oldSettingsStillDecode | — | not ported: decodes the whole `Configuration`, assembled after the merge. `MeetingPreferences` decoding is covered by `swift_meeting_preferences_decode` |
| MeetingAndStatusTests › MeetingActivityTests › suggestsMeetingActivitiesAndHonorsExplicitDefault | meeting_and_status_tests::suggests_meeting_activities_and_honors_explicit_default | ported |
| MeetingAndStatusTests › MeetingActivityTests › missingOrRemovedActivityRequiresUserChoice | meeting_and_status_tests::missing_or_removed_activity_requires_user_choice | ported |
| MeetingAndStatusTests › TrackingIndicatorTests › * | — | not in scope (indicator port) |
| MicrophoneTests › shortUseDoesNotSuggestAndSustainedUseSuggestsOnce | microphone_tests::short_use_does_not_suggest_and_sustained_use_suggests_once | ported |
| MicrophoneTests › shortInterruptionDoesNotSplitMeeting | microphone_tests::short_interruption_does_not_split_meeting | ported |
| MicrophoneTests › confirmedAbsenceEndsEpisodeAndNextUseIsNew | microphone_tests::confirmed_absence_ends_episode_and_next_use_is_new | ported |
| MicrophoneTests › missingSamplesAndSleepCannotProveEnd | microphone_tests::missing_samples_and_sleep_cannot_prove_end | ported |
| MicrophoneTests › failedAndInterruptedSamplesResetStartDebounce | microphone_tests::failed_and_interrupted_samples_reset_start_debounce | ported |
| MicrophoneTests › multipleHelpersDoNotProduceDuplicateSessions | microphone_tests::multiple_helpers_do_not_produce_duplicate_sessions | ported |
| MicrophoneTests › restoredMeetingWaitsForConfirmedAbsenceWithoutRepeatingSuggestion | microphone_tests::restored_meeting_waits_for_confirmed_absence_without_repeating_suggestion | ported |
| MicrophoneTests › applicationCategoriesUseBoundariesAndSupportBrowsers | microphone_tests::application_categories_use_boundaries_and_support_browsers | ported |
| MicrophoneTests › requestedMeetingAppsAreEnabledByDefaultWithoutChangingSavedPreferences | microphone_tests::requested_meeting_apps_are_enabled_by_default_without_changing_saved_preferences | adapted: round-trips `MicrophonePreferences` alone; the `Configuration` round trip waits for `Configuration` |
| MicrophoneTests › legacySlackSettingsMigrateWithoutRequiringIDsOrTokens | — | not ported: `Configuration` with `SlackPreferences` (dead code); belongs to the `Configuration`/importer port, which drops `slackHuddles` |
| MicrophoneTrackingEndTests › standaloneTicketFreeMeetingOffersEndWithoutPreviousTicket | microphone_tracking_end_tests::standalone_ticket_free_meeting_offers_end_without_previous_ticket | ported |
| MicrophoneTrackingEndTests › currentWorkCanBeTrackedThroughACallWithoutUsingStartSuggestion | microphone_tracking_end_tests::current_work_can_be_tracked_through_a_call_without_using_start_suggestion | ported |
| MicrophoneTrackingEndTests › idleAndUnboundTimersDoNotPrompt | microphone_tracking_end_tests::idle_and_unbound_timers_do_not_prompt | ported |
| MicrophoneTrackingEndTests › shortMuteWaitsForEngineToConfirmEnd | microphone_tracking_end_tests::short_mute_waits_for_engine_to_confirm_end | ported |
| MicrophoneTrackingEndTests › failuresAndDisconnectedStateNeverEstablishEnd | microphone_tracking_end_tests::failures_and_disconnected_state_never_establish_end | ported |
| MicrophoneTrackingEndTests › anotherAppStillUsingInputDefersEnding | microphone_tracking_end_tests::another_app_still_using_input_defers_ending | ported |
| MicrophoneTrackingEndTests › newerTimerDuringAbsenceCannotBeStoppedByOldReminder | microphone_tracking_end_tests::newer_timer_during_absence_cannot_be_stopped_by_old_reminder | ported |
| MicrophoneTrackingEndTests › switchDuringActiveInputBindsNewTimerAndOldPromptExpires | microphone_tracking_end_tests::switch_during_active_input_binds_new_timer_and_old_prompt_expires | ported |
| MicrophoneTrackingEndTests › keepDoesNotRepeatAndInputResumptionDismissesPrompt | microphone_tracking_end_tests::keep_does_not_repeat_and_input_resumption_dismisses_prompt | ported |
| MicrophoneTrackingEndTests › restartsPreserveAssociationsAndPromptDeduplication | microphone_tracking_end_tests::restarts_preserve_associations_and_prompt_deduplication | ported |
| MicrophoneTrackingEndTests › stoppedTrackingWorkspaceChangesAndDisabledCategoriesClearBindings | microphone_tracking_end_tests::stopped_tracking_workspace_changes_and_disabled_categories_clear_bindings | ported |
| FigmaContextTests › exactHostAndFileURLsOnly | figma_context_tests::exact_host_and_file_urls_only | ported |
| FigmaContextTests › dwellSwitchReturnAndLongAbsence | figma_context_tests::dwell_switch_return_and_long_absence | ported |
| FigmaContextTests › interruptionsResetDwellAndMissedPollIsNotContinuous | figma_context_tests::interruptions_reset_dwell_and_missed_poll_is_not_continuous | ported |
| FigmaContextTests › observeIsMetadataOnlyAndActivationsArePersistable | figma_context_tests::observe_is_metadata_only_and_activations_are_persistable | ported |
| FigmaContextTests › suppressionExpiresButFileSwitchClearsIt | figma_context_tests::suppression_expires_but_file_switch_clears_it | ported |
| FigmaContextTests › linksInvalidateOldChoicesAndCurrentTicketSuppresses | figma_context_tests::links_invalidate_old_choices_and_current_ticket_suppresses | ported |
| FigmaContextTests › lastWorkedUsesActivationsAndMigratesMappingOnlyStorage | figma_context_tests::last_worked_uses_activations_and_migrates_mapping_only_storage | ported |
| FigmaContextTests › historyRetentionAndWorkspaceIsolation | figma_context_tests::history_retention_and_workspace_isolation | ported |
| FigmaContextTests › outdatedContextNeverMutatesTracking | — | not ported: tests `TrackingTransaction.switchTo` with `validateContext`; moves to the tracking port |
| FigmaContextTests › ticketFreeCompletionClearsSuggestionAndPreservesSavedLinks | figma_context_tests::ticket_free_completion_clears_suggestion_and_preserves_saved_links | ported |
| FigmaContextTests › ticketFreeDesignStartsWithFileComment (2 cases) | — | not ported: tests `TrackingTransaction.switchTo`; moves to the tracking port |
| WorkAwarenessTests › inactivityUsesLastInputAndPromptsOnlyOnReturn | work_awareness_tests::inactivity_uses_last_input_and_prompts_only_on_return | ported |
| WorkAwarenessTests › lockPromptsEvenBelowIdleThresholdAndDoesNotEndUntilUnlocked | work_awareness_tests::lock_prompts_even_below_idle_threshold_and_does_not_end_until_unlocked | ported |
| WorkAwarenessTests › meetingSuppressesPassiveIdleAndDisabledFeaturesClearEvidence | work_awareness_tests::meeting_suppresses_passive_idle_and_disabled_features_clear_evidence | ported |
| WorkAwarenessTests › changedTimerDiscardsIdleEvidenceAndStartIsClamped | work_awareness_tests::changed_timer_discards_idle_evidence_and_start_is_clamped | ported |
| WorkAwarenessTests › pendingAndSleepEvidenceSurviveRestartButWorkspaceChangesClearIt | work_awareness_tests::pending_and_sleep_evidence_survive_restart_but_workspace_changes_clear_it | ported |
| WorkAwarenessTests › forgottenRequiresContinuousEligibleWorkAndResetsForInactivity | work_awareness_tests::forgotten_requires_continuous_eligible_work_and_resets_for_inactivity | ported |
| WorkAwarenessTests › sleepAndClockChangesDoNotCountAsWork | work_awareness_tests::sleep_and_clock_changes_do_not_count_as_work | ported |
| WorkAwarenessTests › snoozeIgnoreTodayAndNextDayUseLocalCalendar | work_awareness_tests::snooze_ignore_today_and_next_day_use_local_calendar | ported (Brussels) |
| WorkAwarenessTests › missingStartUsesConfirmedDurationWithoutExtrapolating | work_awareness_tests::missing_start_uses_confirmed_duration_without_extrapolating | ported |
| WorkAwarenessTests › oldConfigurationDecodesDefaults | work_awareness_tests::old_configuration_decodes_defaults | adapted: round-trips `WorkAwarenessPreferences` (macOS defaults), not `Configuration` |
| TicketCompletionTests › customCompletedStatePromptsOnlyForTrackedTicket | ticket_completion_tests::custom_completed_state_prompts_only_for_tracked_ticket | ported |
| TicketCompletionTests › stateNameAloneNeverImpliesCompletion (5 cases) | ticket_completion_tests::state_name_alone_never_implies_completion | ported |
| TicketCompletionTests › idleAndUnconfirmedStatesDoNotPrompt | ticket_completion_tests::idle_and_unconfirmed_states_do_not_prompt | ported |
| TicketCompletionTests › repeatedPollingPreservesPromptAndNotificationIdentity | ticket_completion_tests::repeated_polling_preserves_prompt_and_notification_identity | ported |
| TicketCompletionTests › keepSurvivesRestartButNewSessionsCanPrompt | ticket_completion_tests::keep_survives_restart_but_new_sessions_can_prompt | ported |
| TicketCompletionTests › reopenedTicketClearsPromptAndAllowsLaterCompletion | ticket_completion_tests::reopened_ticket_clears_prompt_and_allows_later_completion | ported |
| TicketCompletionTests › stopSwitchAndWorkspaceChangesInvalidatePrompt (3 cases) | ticket_completion_tests::stop_switch_and_workspace_changes_invalidate_prompt | ported |
| TicketCompletionTests › defaultsAndExplicitOptOutRoundTrip | — | not ported: `Configuration.completionRemindersEnabled` (`ticketCompletionReminders`, default true) waits for `Configuration` |
| InterfacePreferencesTests › oldConfigurationsKeepAccountsAndUseSystemDefaults | interface_preferences_tests::old_configurations_keep_accounts_and_use_system_defaults | adapted: defaults and the onboarding rule only; accounts, update checks and `interfaceSetupCompleted` wait for `Configuration` |
| InterfacePreferencesTests › firstRunAndInterruptedOnboardingPromptButCompletedSetupDoesNot | interface_preferences_tests::first_run_and_interrupted_onboarding_prompt_but_completed_setup_does_not | ported |
| InterfacePreferencesTests › themeOverridesOnlyWhenExplicit (3 cases) | interface_preferences_tests::theme_overrides_only_when_explicit | ported |
| InterfacePreferencesTests › contrastFollowsSystemOrExplicitChoice (3 cases) | interface_preferences_tests::contrast_follows_system_or_explicit_choice | ported |
| InterfacePreferencesTests › preferencesAndCompletionSurviveRestart (5 cases) | interface_preferences_tests::preferences_and_completion_survive_restart | adapted: round-trips `InterfacePreferences`; `interfaceSetupCompleted` waits for `Configuration` |
| InterfacePreferencesTests › invalidOrFuturePreferencesDoNotBreakConfiguration (4 cases) | interface_preferences_tests::invalid_or_future_preferences_do_not_break_configuration | ported (+3 Rust-only cases) |
| InterfacePreferencesTests › partialPreferencesPreserveValidChoices | interface_preferences_tests::partial_preferences_preserve_valid_choices | ported |

71 Swift tests in scope: 62 ported, 4 adapted, 5 not ported (all need `Configuration` or
`TrackingTransaction`). `SlackHuddleTests.swift` is not ported (dead code).

Rust-only tests (40): Swift-format decoding of every persisted type (`swift_*`), the
cross-platform additions (`windows_*`, `web_view_*`, `work_apps_default_per_operating_system`,
`window_*`, `title_identified_*`), and boundaries Swift did not pin (48 h seen retention, URL
details, sample gaps, `ended` trimming, history/suggestion/dismissal caps, thresholds, 30-day keep).
Private helpers have unit tests in `figma.rs` (character prefix, strict URL parsing) and
`meetings.rs` (percent decoding).

## Persistence

All types decode the exact JSON 1.14.2 wrote: Swift keys are read through aliases (`ticketID`,
`sessionID`, `appID`, `workLogID`, `workAppIDs`, `activityTypeID`), dates through
`time::flex_date` (Swift numbers or RFC 3339), upper-case Swift UUID strings through `uuid`.
Writes use camelCase keys and RFC 3339 dates and omit `None` fields like Swift's
`encodeIfPresent`. Every dictionary in scope is keyed by `String`, so none uses Swift's flat-array
encoding (checked: `links`, `files`, `dismissals`, `dismissed`, `workspaces`, `meetingReminders`).

| `state.json` / `Configuration` key | Rust type |
|---|---|
| `meetingReminders` | `MeetingSuggestionEngine` (`#[serde(transparent)]`: the bare `seen` map) |
| `microphoneTracking` | `MicrophoneTrackingMonitor` (`{links, pending}`) |
| `figmaStore` | `FigmaStore` |
| `workAwareness` | `WorkAwarenessLedger` |
| `ticketCompletion` | `TicketCompletionMonitor` (including the private `dismissed` map) |
| `Configuration.meetingSuggestions` | `MeetingPreferences` |
| `Configuration.microphoneMeetings` | `MicrophonePreferences` |
| `Configuration.figmaDetection` | `FigmaPreferences` |
| `Configuration.workAwareness` | `WorkAwarenessPreferences` |
| `Configuration.interfacePreferences` (+ `interfaceSetupCompleted: Bool?`) | `InterfacePreferences` |
| `Configuration.ticketCompletionReminders` | `Option<bool>`, default true (for the `Configuration` owner) |

The Swift `Configuration` stores each of these as an optional and substitutes the default when it
is missing; the Rust `Configuration` should do the same.

## Decisions

1. **Tolerance.** Swift's synthesized decoders require every key. The Rust types use
   `#[serde(default)]` so missing keys take the defaults (a superset of what Swift accepts).
   `FigmaLedger` mirrors the tolerant Swift `init(from:)` exactly: missing or `null` keys are empty,
   a malformed value is still an error. `InterfacePreferences` never fails, field by field, as in
   Swift. `MicrophonePreferences.apps` skips unknown names instead of failing the settings.
2. **No system clock.** Swift defaults `now: Date = Date()` and `Calendar.current` become explicit
   parameters: `keep_tracking(now)`, `observe(…, now)`, `ForgottenDeferral::suppresses(now, cal)`,
   `ForgottenTimerMonitor::observe(…, cal)`, `IdleTrackingSession::from_state(state, confirmed_at,
   cal)` (offset-free start times are local in `cal`).
3. **Argument structs.** `MicrophoneTrackingMonitor::observe` and `IdleMonitor::observe` take
   `MicrophoneEndObservation` / `IdleObservation` structs with the Swift labels as fields, instead
   of eight positional arguments with two adjacent bools.
4. **URL parsing without a URL crate.** `MeetingTicket` follows Foundation's `URL(string:)` on
   macOS 14+ (lenient: unsupported characters are encoded, only a malformed scheme or port fails;
   path segments split before percent-decoding). `FigmaDocument::parse` follows the strict
   `URLComponents(string:)`: RFC 3986 characters only, valid escapes, host percent-decoded,
   `percentEncodedPath` split on `/` without empty parts.
5. **Character counts.** Swift `String.prefix(500)` counts grapheme clusters. Without a
   segmentation crate, `prefix_characters` approximates them (combining marks, ZWJ sequences,
   variation selectors, emoji modifiers, tags, flags, CR LF). Exotic clusters (Hangul jamo,
   prepend marks) may count differently; names that long do not occur in practice.
6. **Letters.** `Character.isLetter` is approximated by `char::is_alphabetic` after
   `text::fold`; they differ only for rare symbols (circled letters, Roman numerals).
7. **Ordering.** Swift dictionaries iterate in random order; Rust uses `BTreeMap`/`BTreeSet`, so
   ties (equal session start times, equal `lastSeen`) resolve by key. Microphone session ids keep
   Swift's upper-case `uuidString` form, so the 200 → 100 `ended` trim (greatest ids in string
   order, as Swift's `sorted().suffix(100)`) behaves the same on mixed old and new ids.
8. **Ported oddities, kept on purpose.** Activating a Figma file drops the dismissals of every
   other file; a backwards clock does not interrupt the Figma dwell (only a forward gap > 6 s
   does); the meeting-end monitor removes completed links by `sessionID`, not by map key.

## Cross-platform additions

- **Microphone owners.** `MicrophoneApp::classify` keeps the bundle-ID rules and then matches
  Windows executable file names, ignoring case (a full path is reduced to its file name): Slack
  `slack.exe`; Teams `ms-teams.exe`, `teams.exe`, `msteams.exe`; Zoom `zoom.exe`; browsers
  `chrome.exe`, `msedge.exe`, `firefox.exe`, `brave.exe`, `opera.exe`, `vivaldi.exe`, `arc.exe`;
  `msedgewebview2.exe` as browsers (like `com.apple.webkit`); Webex `webex.exe`,
  `ciscocollabhost.exe`, `atmgr.exe`; Discord `discord.exe`.
  `MicrophoneOwner::web_view_name(id)` gives "WebKit (browser or web view)" for
  `com.apple.webkit.*` (the 1.14.2 `MicrophoneReader.owner` rule) and
  "WebView2 (browser or web view)" for `msedgewebview2.exe`; probes should use it as the owner name.
- **Work apps.** `WorkAwarenessPreferences::default_for(HostOs)`; `Default` uses
  `HostOs::current()`. macOS keeps the six Swift bundle IDs; Windows defaults to `code.exe`,
  `cursor.exe`, `windowsterminal.exe`, `pwsh.exe`, `powershell.exe`, `devenv.exe`; other systems
  have none. Stored lists are kept as decoded. `watches` matches bundle IDs exactly (Swift) and
  `.exe` entries by file name ignoring case.
- **Figma by window title.** `FigmaDocument::from_window_title` strips a trailing " – Figma" or
  " - Figma" and returns a document with key `title:<name>` (blank titles and the bare "Figma"
  identify nothing). Title keys contain `:`, so they never equal an alphanumeric file key;
  `known_key` accepts them for links and the register (placeholder name: the title), while
  `valid_key`, `web_url` and `desktop_url` reject them, so they cannot be opened by address.
  `FigmaObservation::from_window(url, title, os)` maps one window read: the address wins with the
  1.14.2 rules; on Windows the title loses its suffix and identifies the file when no address
  parses; elsewhere a missing address is `NoAddress`, as in 1.14.2.

## For other scopes

- **Configuration / importer:** the keys in the persistence table; port the five deferred tests.
- **Tracking:** port `outdatedContextNeverMutatesTracking` and `ticketFreeDesignStartsWithFileComment`.
- **Engine:** map `att_platform::WindowObservation` with `FigmaObservation::from_window(…,
  HostOs::current())` (`MissingAccess` → `MissingAccess`, `NotForeground`/`Waiting` → `Waiting`).
  Calendar occurrence ids must stay `sha256("<calendarId>|<calendarItemId>|<start seconds>")` in
  lower-case hex, as `CalendarService` built them, or imported `meetingReminders` stop matching
  (impact: at most one repeated prompt for a meeting in progress during the upgrade).
- **Platform:** Windows microphone and foreground ids are lower-case executable file names (as the
  `InputOwner`/`AppIdentity` contracts say); classification also tolerates other cases and paths.
