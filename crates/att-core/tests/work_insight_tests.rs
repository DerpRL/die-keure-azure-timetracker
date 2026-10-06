//! Port of WorkOperationsTests.swift › WorkInsightTests. The ticket-context test in that suite
//! belongs to the ticket-context port.

#[path = "support/insights.rs"]
mod support;

use std::collections::HashMap;

use att_core::insights::{ContextInsights, WeeklyReport};
use att_core::model::{ActivityType, WorkLog};
use att_core::statistics::{StatisticsPeriod, StatisticsRange};
use att_core::targets::WorkTargets;
use jiff::Timestamp;
use support::{EDITABLE_ID, cal, date, editable_log, local_date};

fn range() -> StatisticsRange {
    StatisticsRange::new(StatisticsPeriod::Week, local_date("2026-09-28T09:00:00"), &cal())
}

/// Swift used the system clock; any instant after the week gives the same result.
fn now() -> Timestamp {
    date("2026-10-06T12:00:00Z")
}

#[test]
fn context_switches_ignore_long_breaks_same_task_and_duplicate_logs() {
    let a = editable_log("a", "2026-09-28T09:00:00", 1800.0);
    let b = editable_log("b", "2026-09-28T09:30:00", 1800.0);
    let c = WorkLog { work_item_id: Some(456), ..editable_log("c", "2026-09-28T10:00:00", 1800.0) };
    let d = WorkLog { work_item_id: Some(789), ..editable_log("d", "2026-09-28T12:00:00", 3600.0) };
    let result = ContextInsights::calculate(&[d, b, a.clone(), c, a], &range(), &cal(), now());
    assert!(result.switches() == 1 && result.longest_block() == 3600.0 && result.days.len() == 7);
    assert_eq!(result.average_block(), 3000.0);
}

#[test]
fn overlaps_do_not_pretend_to_be_switches_or_uninterrupted_work() {
    let a = editable_log("a", "2026-09-28T09:00:00", 7200.0);
    let b = editable_log("b", "2026-09-28T09:30:00", 3600.0);
    let result = ContextInsights::calculate(&[a, b], &range(), &cal(), now());
    assert!(
        result.switches() == 0 && result.longest_block() == 0.0 && result.ambiguous_entries == 2
    );
}

#[test]
fn report_uses_recorded_work_without_inventing_outcomes_and_deduplicates_notes() {
    let log = editable_log(EDITABLE_ID, "2026-09-28T09:00:00", 3600.0);
    let titles = HashMap::from([(123, "Test ticket".to_string())]);
    let text = WeeklyReport::draft(
        &[log.clone(), log],
        &range(),
        &WorkTargets::default(),
        &titles,
        &cal(),
        now(),
    );
    assert!(
        text.contains("Tracked: 1h 0m")
            && text.contains("Test ticket")
            && text.contains("[Add outcomes]")
    );
    assert_eq!(text.matches("  - Development").count(), 1);
    assert!(!text.contains("Completed Test ticket"));
}

// Additional coverage beyond the Swift suite.

/// Output of Swift 1.14.2 `WeeklyReport.draft` for the same logs, except the heading date: Swift
/// used the Mac's locale ("28 Sep 2026" here); 2.0 is English only.
const SWIFT_REPORT: &str = "# Weekly status · Sep 28, 2026 – Oct 4, 2026\n\nDraft based on recorded time; add outcomes before sharing.\n\n## Time\n- Tracked: 4h 25m\n- Weekly target: 38h 0m\n\n## Worked on\n- #789 · Azure ticket — 2h 30m\n- #123 · Export \\\\ reliability — 1h 30m\n  - Fix \\`export\\` \\<b\\>\n- #456 · Second — 0h 15m\n  - Line one line \\[two\\]\n- Work without an Azure ticket — 0h 10m\n  - Stand-up\n\n## Activity breakdown\n- Development: 2h 15m\n- Unspecified activity: 2h 0m\n- Meeting\\_\\*notes\\*: 0h 10m\n\n## Work patterns\n- Recorded context switches: 0\n- Longest continuous recorded block: 1h 30m\n- Based on worklogs, not a measurement of concentration. Switches after breaks longer than 15 minutes are excluded.\n- 5 invalid or overlapping segments excluded from work-pattern calculations.\n- 1 invalid worklogs omitted from totals.\n\n## Outcomes\n- [Add outcomes]\n\n## Blockers\n- [Add blockers or none]\n\n## Next week\n- [Add priorities]\n";

#[test]
fn report_matches_swift_output_with_escaping_notes_and_patterns() {
    let dev = ActivityType::new("dev", "Development");
    let meet = ActivityType::new("meet", "Meeting_*notes*");
    let log = |id: &str,
               at: &str,
               length: f64,
               ticket: Option<i64>,
               comment: Option<&str>,
               activity: Option<&ActivityType>| WorkLog {
        work_item_id: ticket,
        comment: comment.map(str::to_string),
        activity_type: activity.cloned(),
        ..WorkLog::new(id, at, length)
    };
    let logs = [
        log("a", "2026-09-28T09:00:00", 3600.0, Some(123), Some("Fix `export` <b>"), Some(&dev)),
        log("b", "2026-09-28T10:00:00", 1800.0, Some(123), Some("Fix `export` <b>"), Some(&dev)),
        log("c", "2026-09-28T10:30:00", 900.0, Some(456), Some("Line one\nline [two]"), Some(&dev)),
        log("d", "2026-09-28T10:40:00", 600.0, None, Some("Stand-up"), Some(&meet)),
        log("e", "2026-09-29T09:00:00", 7200.0, Some(789), None, None),
        log("f", "2026-09-29T09:30:00", 1800.0, Some(789), Some("  "), Some(&dev)),
        log("g", "bad", 60.0, Some(123), Some("Invalid"), Some(&dev)),
    ];
    let titles =
        HashMap::from([(123, "Export \\ reliability".to_string()), (456, "Second".to_string())]);
    let range = StatisticsRange::new(StatisticsPeriod::Week, date("2026-09-30T10:00:00Z"), &cal());
    let text = WeeklyReport::draft(&logs, &range, &WorkTargets::default(), &titles, &cal(), now());
    assert_eq!(text, SWIFT_REPORT);
}

#[test]
fn empty_week_report_and_running_week_clip_patterns_to_now() {
    let empty =
        WeeklyReport::draft(&[], &range(), &WorkTargets::default(), &HashMap::new(), &cal(), now());
    assert!(empty.contains("## Worked on\n- No recorded time in this week.\n\n## Activity breakdown\n\n## Work patterns"));
    assert!(empty.contains("- Weekly target: 38h 0m"));
    // Mid-morning on Monday, a block that is still in the future is not a block yet.
    let log = editable_log("a", "2026-09-28T09:00:00", 3600.0);
    let early =
        ContextInsights::calculate(&[log], &range(), &cal(), local_date("2026-09-28T09:30:00"));
    assert_eq!(early.longest_block(), 1800.0);
}
