//! Context switches, focus blocks and the weekly report draft. Ported from WorkInsights.swift.
//!
//! These describe recorded worklogs, not attention: overlapping entries are ambiguous and are
//! left out instead of being guessed at.

use std::collections::{BTreeSet, HashMap, HashSet};

use jiff::{Timestamp, civil::Date};
use serde::Serialize;

use crate::model::WorkLog;
use crate::statistics::{ActivityStatistics, DayTable, StatisticsRange, sum};
use crate::targets::WorkTargets;
use crate::text::{NonEmpty, duration_text};
use crate::time::{Cal, add_secs, diff_secs};

/// Switches within this gap count; longer breaks start afresh.
const SWITCH_GAP: f64 = 15.0 * 60.0;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextDay {
    /// The instant the local day starts.
    pub date: Timestamp,
    pub switches: i64,
    /// Durations of continuous same-context work, in order.
    pub blocks: Vec<f64>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextInsights {
    pub days: Vec<ContextDay>,
    /// Invalid logs plus every segment in an overlapping cluster.
    pub ambiguous_entries: i64,
}

/// One clipped, single-day piece of a worklog.
#[derive(Clone, Debug)]
pub(crate) struct ContextSegment {
    pub(crate) start: Timestamp,
    pub(crate) end: Timestamp,
    pub(crate) context: String,
}

impl ContextInsights {
    pub fn switches(&self) -> i64 {
        self.days.iter().map(|day| day.switches).sum()
    }

    pub fn longest_block(&self) -> f64 {
        self.days.iter().flat_map(|day| day.blocks.iter().copied()).reduce(f64::max).unwrap_or(0.0)
    }

    pub fn average_block(&self) -> f64 {
        let blocks: Vec<f64> =
            self.days.iter().flat_map(|day| day.blocks.iter().copied()).collect();
        if blocks.is_empty() { 0.0 } else { sum(blocks.iter().copied()) / blocks.len() as f64 }
    }

    /// Segments are clipped to the range and to `now`, then split at local midnight. Within a day,
    /// overlapping segments form an ambiguous cluster that also breaks the chain. A switch is a
    /// change of context after a gap of at most 15 minutes; same-context segments less than a
    /// second apart extend the current block.
    pub fn calculate(logs: &[WorkLog], range: &StatisticsRange, cal: &Cal, now: Timestamp) -> Self {
        let days = DayTable::covering(cal, range.interval());
        let mut by_day: Vec<Vec<ContextSegment>> = (0..days.len()).map(|_| Vec::new()).collect();
        let mut seen = HashSet::new();
        let mut omitted = 0;
        let limit = range.end.min(now);
        for log in logs {
            if !seen.insert(log.id.as_str()) {
                continue;
            }
            let length = log.length;
            let valid = length.is_finite() && length > 0.0 && length <= i32::MAX as f64;
            let Some(start) = log.date(cal.tz()).filter(|_| valid) else {
                omitted += 1;
                continue;
            };
            let end = add_secs(start, length).min(limit);
            let mut cursor = start.max(range.start);
            let context = context_key(log);
            while cursor < end {
                let Some(day) = days.index(cursor) else { break };
                let next = days.end(day);
                by_day[day].push(ContextSegment {
                    start: cursor,
                    end: end.min(next),
                    context: context.clone(),
                });
                cursor = next;
            }
        }
        Self::from_segments(&days, by_day, omitted)
    }

    /// Summarises per-day segments (one list per day of `days`, in insertion order).
    pub(crate) fn from_segments(
        days: &DayTable,
        by_day: Vec<Vec<ContextSegment>>,
        ambiguous: i64,
    ) -> Self {
        let mut result =
            Self { days: Vec::with_capacity(days.len()), ambiguous_entries: ambiguous };
        for (index, mut segments) in by_day.into_iter().enumerate() {
            // Stable, like Swift's sort.
            segments.sort_by_key(|segment| segment.start);
            let mut day = ContextDay { date: days.start(index), switches: 0, blocks: Vec::new() };
            let mut previous: Option<&ContextSegment> = None;
            let mut first = 0;
            while first < segments.len() {
                let mut cluster_end = segments[first].end;
                let mut last = first + 1;
                while last < segments.len() && segments[last].start < cluster_end {
                    cluster_end = cluster_end.max(segments[last].end);
                    last += 1;
                }
                if last - first != 1 {
                    result.ambiguous_entries += (last - first) as i64;
                    previous = None;
                } else {
                    let next = &segments[first];
                    let duration = diff_secs(next.end, next.start);
                    let merged = match previous {
                        Some(prior) => {
                            let gap = diff_secs(next.start, prior.end);
                            if gap <= SWITCH_GAP && prior.context != next.context {
                                day.switches += 1;
                            }
                            gap < 1.0 && prior.context == next.context
                        }
                        None => false,
                    };
                    match day.blocks.last_mut() {
                        Some(block) if merged => *block += duration,
                        _ => day.blocks.push(duration),
                    }
                    previous = Some(next);
                }
                first = last;
            }
            result.days.push(day);
        }
        result
    }
}

/// `ticket:<id>`, or the raw activity ID and comment for ticket-free work.
pub(crate) fn context_key(log: &WorkLog) -> String {
    match log.ticket_id() {
        Some(id) => format!("ticket:{id}"),
        None => format!(
            "activity:{}|{}",
            log.activity_type.as_ref().map_or("", |a| a.id.as_str()),
            log.comment.as_deref().unwrap_or("")
        ),
    }
}

/// The Markdown weekly status draft.
pub struct WeeklyReport;

impl WeeklyReport {
    /// A draft from recorded time only. Outcomes, blockers and priorities stay placeholders for
    /// the user. `now` clips a running week's work patterns (Swift read the system clock here).
    pub fn draft(
        logs: &[WorkLog],
        range: &StatisticsRange,
        targets: &WorkTargets,
        titles: &HashMap<i64, String>,
        cal: &Cal,
        now: Timestamp,
    ) -> String {
        let data = ActivityStatistics::calculate(logs, range, targets, cal);
        let insights = ContextInsights::calculate(logs, range, cal, now);
        let last_day = cal.add_date_days(cal.date(range.end), -1);
        let mut lines: Vec<String> = vec![
            format!(
                "# Weekly status · {} – {}",
                abbreviated_date(cal.date(range.start)),
                abbreviated_date(last_day)
            ),
            String::new(),
            "Draft based on recorded time; add outcomes before sharing.".into(),
            String::new(),
            "## Time".into(),
            format!("- Tracked: {}", duration_text::short(data.total_seconds())),
            format!("- Weekly target: {}", duration_text::short(data.target_seconds())),
            String::new(),
            "## Worked on".into(),
        ];
        // Comment notes per ticket, deduplicated after escaping and sorted.
        let mut notes: HashMap<Option<i64>, BTreeSet<String>> = HashMap::new();
        for log in logs {
            let Some(date) = log.date(cal.tz()) else { continue };
            let counted = date >= range.start
                && date < range.end
                && log.length.is_finite()
                && log.length > 0.0;
            if let Some(comment) = log.comment.non_empty().filter(|_| counted) {
                notes.entry(log.ticket_id()).or_default().insert(plain(comment));
            }
        }
        for ticket in &data.tickets {
            let title = match ticket.ticket_id {
                Some(id) => {
                    format!("#{id} · {}", titles.get(&id).map_or("Azure ticket", String::as_str))
                }
                None => "Work without an Azure ticket".to_string(),
            };
            lines.push(format!("- {} — {}", plain(&title), duration_text::short(ticket.seconds)));
            if let Some(notes) = notes.get(&ticket.ticket_id) {
                lines.extend(notes.iter().map(|note| format!("  - {note}")));
            }
        }
        if data.tickets.is_empty() {
            lines.push("- No recorded time in this week.".into());
        }
        lines.extend([String::new(), "## Activity breakdown".into()]);
        lines.extend(data.activities.iter().map(|activity| {
            format!("- {}: {}", plain(&activity.name), duration_text::short(activity.seconds))
        }));
        lines.extend([
            String::new(),
            "## Work patterns".into(),
            format!("- Recorded context switches: {}", insights.switches()),
            format!(
                "- Longest continuous recorded block: {}",
                duration_text::short(insights.longest_block())
            ),
            "- Based on worklogs, not a measurement of concentration. Switches after breaks longer than 15 minutes are excluded.".into(),
        ]);
        if insights.ambiguous_entries > 0 {
            lines.push(format!(
                "- {} invalid or overlapping segments excluded from work-pattern calculations.",
                insights.ambiguous_entries
            ));
        }
        if data.omitted_logs > 0 {
            lines.push(format!("- {} invalid worklogs omitted from totals.", data.omitted_logs));
        }
        lines.extend(
            [
                "",
                "## Outcomes",
                "- [Add outcomes]",
                "",
                "## Blockers",
                "- [Add blockers or none]",
                "",
                "## Next week",
                "- [Add priorities]",
                "",
            ]
            .map(String::from),
        );
        lines.join("\n")
    }
}

/// English `Date.formatted(date: .abbreviated, time: .omitted)`, e.g. `Sep 29, 2026`.
fn abbreviated_date(date: Date) -> String {
    date.strftime("%b %-d, %Y").to_string()
}

/// One line of Markdown-safe text: newlines become spaces and `\ * _ [ ] < >` and backticks are
/// escaped with a backslash.
fn plain(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '\n' | '\u{0B}' | '\u{0C}' | '\r' | '\u{85}' | '\u{2028}' | '\u{2029}' => {
                result.push(' ')
            }
            '\\' | '*' | '_' | '[' | ']' | '<' | '>' | '`' => {
                result.push('\\');
                result.push(c);
            }
            _ => result.push(c),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_escapes_markdown_and_flattens_newlines() {
        assert_eq!(plain("a\\b*c_d[e]f<g>h`i"), "a\\\\b\\*c\\_d\\[e\\]f\\<g\\>h\\`i");
        assert_eq!(plain("one\r\ntwo\u{2028}three"), "one  two three");
        assert_eq!(plain("Café #1 — done"), "Café #1 — done");
    }

    #[test]
    fn abbreviated_dates_match_foundation_english() {
        assert_eq!(abbreviated_date(jiff::civil::date(2026, 9, 29)), "Sep 29, 2026");
        assert_eq!(abbreviated_date(jiff::civil::date(2026, 5, 4)), "May 4, 2026");
    }
}
