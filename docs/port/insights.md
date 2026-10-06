# Port: targets, statistics and review

Swift 1.14.2 sources → Rust `att-core` modules:

| Swift | Rust |
|---|---|
| `Productivity.swift` › `WorkTargets`, `TargetProgress` | `targets.rs` |
| `Productivity.swift` › `ConnectionHealth`, `MeetingReturn`, `QuickTickets` | `productivity.rs` |
| `Holidays.swift` (incl. the `WorkTargets` extension) | `holidays.rs` |
| `Statistics.swift` | `statistics.rs` |
| `StatisticsExplorer.swift` | `explorer.rs` |
| `ExplorerVisuals.swift` | `explorer_visuals.rs` |
| `WorkInsights.swift` | `insights.rs` |
| `DayReview.swift` | `day_review.rs` |

Not ported: `DetailedStatistics.swift` and `DetailedStatisticsTests.swift` (dead code).

## Traceability

Every Rust test lives in `crates/att-core/tests/` unless noted. "Adapted" means the assertions
are unchanged but the setup differs, with the reason given.

| Swift `File › Suite › test` | Rust `file::test` | Status |
|---|---|---|
| StatisticsTests › StatisticsTests › weekStartsOnMondayAndHandlesYearBoundary | statistics_tests::week_starts_on_monday_and_handles_year_boundary | ported |
| StatisticsTests › StatisticsTests › monthNavigationPreservesCalendarMonthsAndLeapDay | statistics_tests::month_navigation_preserves_calendar_months_and_leap_day | ported |
| StatisticsTests › StatisticsTests › daylightSavingDaysUseCalendarArithmetic | statistics_tests::daylight_saving_days_use_calendar_arithmetic | ported |
| StatisticsTests › StatisticsTests › monthTargetsUseWeekdaysRatherThanFourWeeks | statistics_tests::month_targets_use_weekdays_rather_than_four_weeks | ported |
| StatisticsTests › StatisticsTests › missingDaysAreZeroAndAveragesOnlyUseTrackedDays | statistics_tests::missing_days_are_zero_and_averages_only_use_tracked_days | ported |
| StatisticsTests › StatisticsTests › exclusiveEndAndDuplicateIDsNeverDoubleCount | statistics_tests::exclusive_end_and_duplicate_ids_never_double_count | ported |
| StatisticsTests › StatisticsTests › ticketFreeStandupsAndUnknownActivitiesAreRetained | statistics_tests::ticket_free_standups_and_unknown_activities_are_retained | ported |
| StatisticsTests › StatisticsTests › activityIDsRemainDistinctWhenNamesMatch | statistics_tests::activity_ids_remain_distinct_when_names_match | ported |
| StatisticsTests › StatisticsTests › invalidValuesAreOmittedWithoutPoisoningTotals | statistics_tests::invalid_values_are_omitted_without_poisoning_totals | ported |
| StatisticsTests › StatisticsTests › weekendsCountAsWorkButNeverAddTargetHours | statistics_tests::weekends_count_as_work_but_never_add_target_hours | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › zoomClampsBothDirectionsAndPreservesDuration | statistics_explorer_tests::zoom_clamps_both_directions_and_preserves_duration | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › zoomMinimumMaximumAndPan | statistics_explorer_tests::zoom_minimum_maximum_and_pan | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › zoomSmallerThanMinimumBoundsStillStaysInside | statistics_explorer_tests::zoom_smaller_than_minimum_bounds_still_stays_inside | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › clippingHasConsistentTotalsEverywhere | statistics_explorer_tests::clipping_has_consistent_totals_everywhere | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › overlapUsesUnionIncludingNestedAndAdjacentEntries | statistics_explorer_tests::overlap_uses_union_including_nested_and_adjacent_entries | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › halfOpenBoundariesAndInvalidDuplicates | statistics_explorer_tests::half_open_boundaries_and_invalid_duplicates | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › midnightSegmentsDoNotDoubleCountEntryOrBillable | statistics_explorer_tests::midnight_segments_do_not_double_count_entry_or_billable | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › weekdayFilterClipsOvernightPortion | statistics_explorer_tests::weekday_filter_clips_overnight_portion | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › searchTitleTicketCommentAndCombinedActivityFilter | statistics_explorer_tests::search_title_ticket_comment_and_combined_activity_filter | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › taskFilterAndTicketFreeGrouping | statistics_explorer_tests::task_filter_and_ticket_free_grouping | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › originalLengthBandPersistsWhenZooming | statistics_explorer_tests::original_length_band_persists_when_zooming | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › adaptiveResolutionAndEmptyData | statistics_explorer_tests::adaptive_resolution_and_empty_data | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › hourlyBucketsHandleBothDSTTransitions | statistics_explorer_tests::hourly_buckets_handle_both_dst_transitions | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › leapYearHasTwelveBucketsAndAccurateSchedule | statistics_explorer_tests::leap_year_has_twelve_buckets_and_accurate_schedule | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › contextSwitchesRespectZoomAndExcludedOverlap | statistics_explorer_tests::context_switches_respect_zoom_and_excluded_overlap | ported |
| StatisticsExplorerTests › StatisticsExplorerTests › crossYearWeekKeepsContextFromBothYears | statistics_explorer_tests::cross_year_week_keeps_context_from_both_years | ported |
| ExplorerVisualsTests › ExplorerVisualsTests › dayHeatmapKeepsEmptyDaysAndMidnightClipping | explorer_visuals_tests::day_heatmap_keeps_empty_days_and_midnight_clipping | ported |
| ExplorerVisualsTests › ExplorerVisualsTests › leapYearCalendarHasEveryDateAndCorrectColumns | explorer_visuals_tests::leap_year_calendar_has_every_date_and_correct_columns | ported |
| ExplorerVisualsTests › ExplorerVisualsTests › filteredHeatmapAndProgressMatchTheSelectedTask | explorer_visuals_tests::filtered_heatmap_and_progress_match_the_selected_task | ported |
| ExplorerVisualsTests › ExplorerVisualsTests › daylightSavingHoursStaySeparateWithoutLosingTime | explorer_visuals_tests::daylight_saving_hours_stay_separate_without_losing_time | ported |
| ExplorerVisualsTests › ExplorerVisualsTests › zoomedPartialDaysKeepHourPositionsAndExactDurations | explorer_visuals_tests::zoomed_partial_days_keep_hour_positions_and_exact_durations | adapted: fixed `now` instead of the system clock |
| ExplorerVisualsTests › ExplorerVisualsTests › currentMonthlyBucketRetainsRecordedTimeBeforeMonthEnds | explorer_visuals_tests::current_monthly_bucket_retains_recorded_time_before_month_ends | ported |
| ExplorerVisualsTests › ExplorerVisualsTests › emptyAndFutureWindowsDoNotProjectRecordedTime | explorer_visuals_tests::empty_and_future_windows_do_not_project_recorded_time | ported |
| ExplorerVisualsTests › ExplorerVisualsTests › existingOverlapsRemainVisibleInHeatmapTotals | explorer_visuals_tests::existing_overlaps_remain_visible_in_heatmap_totals | ported |
| ProductivityTests › TargetProgressTests › targetDefaultsAndWeekend | productivity_tests::target_defaults_and_weekend | ported |
| ProductivityTests › TargetProgressTests › mondayWeekAndDaylightSavingUseCalendarBoundaries | productivity_tests::monday_week_and_daylight_saving_use_calendar_boundaries | ported |
| ProductivityTests › TargetProgressTests › activeLogIsCountedOnceAndIdleLogIsNotDropped | productivity_tests::active_log_is_counted_once_and_idle_log_is_not_dropped | ported |
| ProductivityTests › TargetProgressTests › disconnectedTimeDoesNotGrow | productivity_tests::disconnected_time_does_not_grow | ported |
| ProductivityTests › TargetProgressTests › liveTimerCrossingMondayIsClippedToNewWeekAndDay | productivity_tests::live_timer_crossing_monday_is_clipped_to_new_week_and_day | ported |
| ProductivityTests › TargetProgressTests › completedLogAtExclusiveWeekEndIsNotIncluded | productivity_tests::completed_log_at_exclusive_week_end_is_not_included | ported |
| ProductivityTests › TargetProgressTests › unidentifiedLiveTimerUsesReportedLogsWithoutDoubleCounting | productivity_tests::unidentified_live_timer_uses_reported_logs_without_double_counting | ported |
| ProductivityTests › ConnectionHealthTests › staleStateAndPollingIntervals | productivity_tests::stale_state_and_polling_intervals | ported |
| ProductivityTests › ConnectionHealthTests › credentialsAndMissingConfirmationAreExplicit | productivity_tests::credentials_and_missing_confirmation_are_explicit | ported |
| ProductivityTests › MeetingReturnTests › remembersPreviousWorkOnlyAfterARealSwitch | productivity_tests::remembers_previous_work_only_after_a_real_switch | ported |
| ProductivityTests › MeetingReturnTests › manualSwitchStopExpiryAndWorkspaceChangeInvalidateReturn | productivity_tests::manual_switch_stop_expiry_and_workspace_change_invalidate_return | ported |
| ProductivityTests › MeetingReturnTests › consecutiveMeetingsPreserveOriginalTicketIncludingDefaultActivity | productivity_tests::consecutive_meetings_preserve_original_ticket_including_default_activity | ported |
| ProductivityTests › MeetingReturnTests › restartPersistsReminderWithoutCalendarText | productivity_tests::restart_persists_reminder_without_calendar_text | adapted: the plan takes the occurrence key and end instead of a `MeetingEvent`, so the title never reaches it |
| ProductivityTests › MeetingReturnTests › consecutiveMeetingsOnSameTicketAndActivityKeepReturn | productivity_tests::consecutive_meetings_on_same_ticket_and_activity_keep_return | ported |
| ProductivityTests › QuickTicketsTests › recentIsBoundedUniqueAndFavoritesAppearFirst | productivity_tests::recent_is_bounded_unique_and_favorites_appear_first | ported |
| ProductivityTests › DailyScheduleTests › legacySettingsRetainTargetsAndConvertOnFirstEdit | productivity_tests::legacy_settings_retain_targets_and_convert_on_first_edit | ported |
| ProductivityTests › DailyScheduleTests › customScheduleDrivesDailyWeeklyAndMonthlyCharts | productivity_tests::custom_schedule_drives_daily_weekly_and_monthly_charts | ported |
| ProductivityTests › DailyScheduleTests › validatesEachDayAndAllowsDaysOff | productivity_tests::validates_each_day_and_allows_days_off | ported |
| HolidayTargetsTests › HolidayTargetsTests › belgianDates2026And2027 | holiday_targets_tests::belgian_dates_2026_and_2027 | ported |
| HolidayTargetsTests › HolidayTargetsTests › holidaysReduceWeekAndDoNotInventReplacementDates | holiday_targets_tests::holidays_reduce_week_and_do_not_invent_replacement_dates | ported |
| HolidayTargetsTests › HolidayTargetsTests › halfDayCustomAndReplacementPriority | holiday_targets_tests::half_day_custom_and_replacement_priority | ported |
| HolidayTargetsTests › HolidayTargetsTests › oldConfigurationDecodesAndExceptionsRoundTrip | holiday_targets_tests::old_configuration_decodes_and_exceptions_round_trip | ported |
| HolidayTargetsTests › HolidayTargetsTests › invalidHoursDatesAndDuplicatesRejected | holiday_targets_tests::invalid_hours_dates_and_duplicates_rejected | ported |
| HolidayTargetsTests › HolidayTargetsTests › dstCivilDatesAndPartialDayTotals | holiday_targets_tests::dst_civil_dates_and_partial_day_totals | ported |
| DayReviewTests › DayReviewTests › defaultReminderFiresAtLocalFinishTimeAndOnlyOnSelectedDays | day_review_tests::default_reminder_fires_at_local_finish_time_and_only_on_selected_days | ported |
| DayReviewTests › DayReviewTests › promptSnoozeAndCompletionSurviveRoundTrip | day_review_tests::prompt_snooze_and_completion_survive_round_trip | ported |
| DayReviewTests › DayReviewTests › explicitMorningSnoozeDoesNotWaitUntilEvening | day_review_tests::explicit_morning_snooze_does_not_wait_until_evening | ported |
| DayReviewTests › DayReviewTests › reviewKeysIsolateWorkspacesAndLocalDays | day_review_tests::review_keys_isolate_workspaces_and_local_days | ported |
| DayReviewTests › DayReviewTests › invalidPreferencesAreRejectedAndOldConfigurationKeepsDefaults | day_review_tests::invalid_preferences_are_rejected_and_old_configuration_keeps_defaults | adapted: `Configuration` is assembled elsewhere, so a stand-in struct with the optional `endOfDayReview` key is decoded |
| DayReviewTests › DayReviewTests › gapsUseUnionOfOverlapsAndIgnoreDuplicateIDs | day_review_tests::gaps_use_union_of_overlaps_and_ignore_duplicate_ids | ported |
| DayReviewTests › DayReviewTests › leadingTrailingAndMinimumGapsAreHandled | day_review_tests::leading_trailing_and_minimum_gaps_are_handled | ported |
| DayReviewTests › DayReviewTests › overnightAndLongEntriesAreClippedToTheReviewDay | day_review_tests::overnight_and_long_entries_are_clipped_to_the_review_day | ported |
| DayReviewTests › DayReviewTests › midnightEntriesAndUnconfirmedTimersDisableGapClaims | day_review_tests::midnight_entries_and_unconfirmed_timers_disable_gap_claims | ported |
| DayReviewTests › DayReviewTests › activeTimerIsCountedOnceAndFrozenAtConfirmation | day_review_tests::active_timer_is_counted_once_and_frozen_at_confirmation | ported |
| DayReviewTests › DayReviewTests › MissingActiveDurationPreservesReportedWorklog | day_review_tests::missing_active_duration_preserves_reported_worklog | ported |
| DayReviewTests › DayReviewTests › malformedAndZeroEntriesDoNotInventCoveredTime | day_review_tests::malformed_and_zero_entries_do_not_invent_covered_time | ported |
| DayReviewTests › DayReviewTests › daylightSavingReminderUsesLocalClock | day_review_tests::daylight_saving_reminder_uses_local_clock | ported |
| WorkOperationsTests › WorkInsightTests › contextSwitchesIgnoreLongBreaksSameTaskAndDuplicateLogs | work_insight_tests::context_switches_ignore_long_breaks_same_task_and_duplicate_logs | adapted: fixed `now` instead of the system clock |
| WorkOperationsTests › WorkInsightTests › overlapsDoNotPretendToBeSwitchesOrUninterruptedWork | work_insight_tests::overlaps_do_not_pretend_to_be_switches_or_uninterrupted_work | adapted: fixed `now` instead of the system clock |
| WorkOperationsTests › WorkInsightTests › reportUsesRecordedWorkWithoutInventingOutcomesAndDeduplicatesNotes | work_insight_tests::report_uses_recorded_work_without_inventing_outcomes_and_deduplicates_notes | adapted: fixed `now` instead of the system clock |
| WorkOperationsTests › WorkInsightTests › htmlAndTicketDetailsHandleIdentityFieldsAndRejectUnsafeLinks | — | not ported: ticket-context scope |
| DetailedStatisticsTests › * | — | not ported: dead code |

74 Swift tests ported. Added Rust coverage (no Swift counterpart):

- statistics_tests: `ranges_cover_each_period_and_serialize_period_names`,
  `unnamed_activities_take_a_later_name_and_ties_sort_by_id`, `invalid_targets_contribute_no_target`.
- statistics_explorer_tests: `ticket_free_task_keys_are_length_prefixed_and_titles_fall_back`,
  `buckets_stack_activities_by_id_and_unknown_billable_stays_distinct_from_zero`,
  `entries_sort_ties_by_swift_entry_id`, `full_year_analysis_is_fast` (about 5,100 logs, dataset
  + analysis + visuals + a search, asserted under 2 s in debug; it takes well under 0.1 s).
- explorer_visuals_tests: `heatmap_targets_follow_the_schedule_and_holidays`.
- productivity_tests: Swift-JSON decode tests `swift_work_targets_decode_with_schedule_and_exceptions`,
  `swift_default_and_partial_work_targets_decode`, `swift_meeting_returns_decode`,
  `swift_quick_tickets_decode`; plus `connection_health_labels_and_symbols`,
  `favorites_are_capped_at_twenty`.
- holiday_targets_tests: `computus_edges_and_shared_dates`,
  `reasons_name_exceptions_with_notes_and_holidays`, `exception_keys_are_canonical_dates`.
- day_review_tests: `skipped_and_repeated_local_times_match_foundation`,
  `running_timer_covers_time_since_confirmation_for_gaps_only`, `swift_day_review_state_decodes`.
- work_insight_tests: `report_matches_swift_output_with_escaping_notes_and_patterns` (byte-exact
  Swift output apart from the heading date), `empty_week_report_and_running_week_clip_patterns_to_now`.
- Unit tests in `insights.rs`: Markdown escaping and the English date format.

The Swift JSON in the decode tests and the expected weekly report were produced by compiling
`Sources/AzureTimetrackerCore` with a small generator, not written by hand.

## Differential check against Swift

Besides the unit tests, the port was compared with Swift 1.14.2 directly: the Swift core was
compiled with a generator that builds about 1,950 pseudo-random worklogs (February–November
2026, both DST changes, overnight, overlapping, midnight, zero, negative, over-long, invalid and
duplicate logs, local and UTC timestamps, diacritics, every billable variant), and dumps the logs
plus the results of 20 explorer analyses with visuals (every resolution, every filter kind,
search, zoomed and future windows, four target sets), 24 statistics ranges, 18 context runs,
weekly report bodies, a year of daily targets with intervals and reasons, 180 target-progress
cases and 360 day reviews. A Rust program recomputed everything from the same logs. Two seeds,
139,085 and 140,793 compared values: every number, string and flag was identical (floats compared
exactly). The harness lives outside the repository; it can be added under `tools/` if wanted.

## Decisions

1. **Days are keyed by civil date.** Swift keyed days by repeatedly adding one day to the range
   start. In zones whose DST change happens at midnight (America/Santiago) that drifts to 01:00
   and the lookups `indices[startOfDay(date)]` silently dropped logs (verified with Foundation).
   The port uses a precomputed table of local days (`statistics::DayTable`). Identical for
   Europe/Brussels.
2. **Explorer context uses the clipped entries directly.** Swift rebuilt worklogs from entries
   with `WireDate.localString` and parsed them again per calendar year. That round trip drops
   sub-second precision and moves an entry starting in the repeated DST hour to the second
   occurrence (DateFormatter picks the later instant). The port feeds the exact segments to the
   same algorithm; results are otherwise identical (see the differential check).
3. **No hidden clocks.** Swift defaulted `now` to `Date()` in `ExplorerDataset.analyze`,
   `ExplorerVisuals.init` and `ContextInsights.calculate` (which `WeeklyReport.draft` called
   without `now`). Every Rust function takes `now: Timestamp` and `cal: &Cal`.
4. **`ExplorerOptions`** bundles Swift's default arguments (`filter`, `titles`, `targets`,
   `resolution`) and implements `Default`. `DayReviewSummary::calculate` keeps the 8-argument
   Swift signature (`#[allow(clippy::too_many_arguments)]`).
5. **`MeetingReturn::after_starting` takes the occurrence key and end** instead of a
   `MeetingEvent`, which belongs to `meetings.rs`; callers pass `&event.id, event.end`. The plan
   can no longer see calendar text at all. `MeetingReturn::open_end()` is Swift's
   `Date.distantFuture` (4001-01-01), which the microphone flow stores and compares against.
   The Slack fields (`slackCallID`, `slackTeamID`, `slackWasJoined`) are dropped on read.
6. **Persisted types** (`WorkTargets` with `TargetException`, `MeetingReturn`, `QuickTickets`,
   `DayReviewRecord`, `DayReviewPreferences`) write camelCase and RFC 3339 and read the Swift
   JSON, including `…ID` keys (serde aliases) and seconds-since-2001 dates. Decoding is tolerant
   where a default exists (Swift's synthesized decoders required every non-optional key):
   missing `weeklyHours`/`dailyHours` → 38/7.6, missing preferences keys → defaults, missing
   `hours`/`note`/`notified`/`recent`/`favorites`/`workspace` → empty. Optional fields are
   omitted when `None`, like Swift. Day-review map keys stay `workspace|y-m-d` without padding.
7. **Foundation `.nextTime` for day-review times.** `DayReviewPreferences::time` resolves a time
   skipped by DST to the end of the gap (02:30 → 03:00) and a repeated time to its first
   occurrence, exactly as `Calendar.date(bySettingHour:minute:second:of:)` (verified with
   Swift). Out-of-range minutes count on from midnight instead of trapping.
8. **Weekday numbering stays Swift's** (1 = Sunday … 7 = Saturday) wherever it is persisted or
   crosses to the UI: `WorkTargets::hours`/`set_hours`, `hoursByWeekday` (Sunday first),
   `DayReviewPreferences::weekdays`, `ExplorerFilter::weekday` and the weekday pattern IDs.
   `ExplorerCalendarDay::weekday` is Monday = 0, as in Swift.
9. **English only.** Weekday labels are `Mon`…`Sun`; the weekly report heading uses
   `Sep 29, 2026` (Swift used the Mac's locale, e.g. `28 Sep 2026`).
10. **`BelgianHoliday::date` is a civil date** (Swift stored the local midnight `Date`), and
    `BelgianHoliday::all(year)` needs no calendar. `TargetException::is_valid` accepts canonical
    `yyyy-MM-dd` dates in years 1–9999 of the proleptic Gregorian calendar; Swift's formatter
    switched to the Julian calendar before 1582 (it accepted `1000-02-29`).
11. **Entry IDs and ordering match Swift**: `ExplorerEntry::id()` is `<log id>:<Unix seconds>`
    formatted like Swift's `Double` description (`1790924400.0`), and entries sort by start, then
    by that full ID (so `a1:…` precedes `a:…`).
12. **Performance.** Analyses are linear in entries plus buckets: days come from one table,
    buckets and hours are found by binary search, tasks/activities/logs are grouped in one pass
    in entry order (so floating-point sums match Swift's order exactly). Swift scanned every
    entry per bucket. A full year analyses in milliseconds even in debug builds.
13. **Clock hours** use the UTC offset at the instant, exact for whole-hour DST shifts on hour
    boundaries; a half-hour shift (Lord Howe Island) can misplace one bucket by 30 minutes.
14. `ConnectionHealth::symbol()` keeps the SF Symbol names for the UI to map.

## Notes for other scopes

- Foundation (`time.rs`): `wire_date::parse` resolves an offset-free time in the repeated DST
  hour to the earlier instant and moves a skipped time forward. Swift's `WireDate.parse`
  (DateFormatter) picks the later instant and returns `nil` for skipped times (the log is then
  omitted as invalid). The doc comment on `Cal` says folds match Foundation; that holds for
  `Calendar` arithmetic, not for this parser. Affects only 7pace local timestamps between 02:00
  and 03:00 on DST days.
- `Configuration` should carry `workTargets: Option<WorkTargets>` and
  `endOfDayReview: Option<DayReviewPreferences>` with defaulting accessors, as in Swift.
- The importer can decode `SavedState.meetingReturn`, `quickTickets` and
  `dayReviews: BTreeMap<String, DayReviewRecord>` directly with these types.
