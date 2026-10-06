//! Calendar meeting suggestions, ticket and activity matching.
//!
//! Ported from MeetingSuggestions.swift. `StandupActivity` (SlackHuddles.swift) lives in
//! `crate::manual` with the tracking port; the rest of SlackHuddles.swift is dead code.

use std::collections::{BTreeMap, BTreeSet};

use jiff::Timestamp;
use serde::{Deserialize, Serialize};

use crate::model::ActivityType;
use crate::time::{add_secs, diff_secs};

/// Meeting suggestion settings. Persisted as `Configuration.meetingSuggestions`.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MeetingPreferences {
    pub enabled: bool,
    /// Ticket used when the meeting itself names none (free text, trimmed when used).
    pub default_ticket: String,
    #[serde(alias = "activityTypeID")]
    pub activity_type_id: String,
}

impl Default for MeetingPreferences {
    fn default() -> Self {
        Self { enabled: true, default_ticket: String::new(), activity_type_id: String::new() }
    }
}

/// One calendar occurrence, as the calendar probe reports it.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingEvent {
    /// Identifies one occurrence, so a recurring meeting can prompt again the next day.
    pub id: String,
    pub title: String,
    #[cfg_attr(feature = "ts", ts(as = "Timestamp"))]
    #[serde(with = "crate::time::flex_date")]
    pub start: Timestamp,
    #[cfg_attr(feature = "ts", ts(as = "Timestamp"))]
    #[serde(with = "crate::time::flex_date")]
    pub end: Timestamp,
    #[serde(default)]
    pub calendar: String,
    #[serde(default, alias = "ticketID")]
    pub ticket_id: Option<i64>,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub cancelled: bool,
    #[serde(default)]
    pub declined: bool,
    #[serde(default)]
    pub free: bool,
}

impl MeetingEvent {
    /// An event in no calendar, without a ticket, that is neither all-day, cancelled, declined
    /// nor free (the Swift initialiser defaults).
    pub fn new(
        id: impl Into<String>,
        title: impl Into<String>,
        start: Timestamp,
        end: Timestamp,
    ) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            start,
            end,
            calendar: String::new(),
            ticket_id: None,
            all_day: false,
            cancelled: false,
            declined: false,
            free: false,
        }
    }

    /// Meeting time right now: not all-day, cancelled, declined or free, and `start <= now < end`.
    pub fn is_active(&self, now: Timestamp) -> bool {
        !self.all_day
            && !self.cancelled
            && !self.declined
            && !self.free
            && self.start <= now
            && self.end > now
    }
}

/// Decides which meetings to suggest. Persisted as the bare `seen` map (`meetingReminders` in
/// the 1.14.x `state.json`): occurrence id → occurrence end.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MeetingSuggestionEngine {
    #[cfg_attr(feature = "ts", ts(as = "BTreeMap<String, Timestamp>"))]
    #[serde(with = "crate::time::flex_date::map")]
    seen: BTreeMap<String, Timestamp>,
}

impl MeetingSuggestionEngine {
    /// Seen occurrences are kept until 48 hours after they end.
    pub const SEEN_RETENTION_SECONDS: f64 = 172_800.0;
    /// A five-minute grace catches wake and reconnect without prompting for old meetings.
    pub const GRACE_SECONDS: f64 = 300.0;

    pub fn new(seen: BTreeMap<String, Timestamp>) -> Self {
        Self { seen }
    }

    /// Occurrence id → end of every occurrence already suggested.
    pub fn seen(&self) -> &BTreeMap<String, Timestamp> {
        &self.seen
    }

    /// The active events that started at most five minutes ago and were not suggested before,
    /// ordered by start and id. Each occurrence is suggested once.
    pub fn due(&mut self, events: &[MeetingEvent], now: Timestamp) -> Vec<MeetingEvent> {
        let horizon = add_secs(now, -Self::SEEN_RETENTION_SECONDS);
        self.seen.retain(|_, end| *end > horizon);
        let mut ordered: Vec<&MeetingEvent> = events.iter().collect();
        ordered.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| a.id.cmp(&b.id)));
        let mut result = Vec::new();
        for event in ordered {
            if !event.is_active(now)
                || diff_secs(now, event.start) > Self::GRACE_SECONDS
                || self.seen.contains_key(&event.id)
            {
                continue;
            }
            self.seen.insert(event.id.clone(), event.end);
            result.push(event.clone());
        }
        result
    }
}

/// Ticket numbers named by a meeting. Ported from `MeetingTicket`.
pub mod meeting_ticket {
    use super::*;
    use fancy_regex::Regex;
    use std::sync::LazyLock;

    /// `#123` or `AB#123` that is not part of a word, a longer number or a decimal.
    static MARKER: LazyLock<Regex> = LazyLock::new(|| {
        // Invariant: a constant, tested pattern.
        Regex::new(r"(?i)(?<![\w#])(?:AB#|#)([1-9][0-9]{0,9})(?!\d|\.\d)")
            .expect("valid meeting marker pattern")
    });
    static LINK: LazyLock<Regex> = LazyLock::new(|| {
        // Invariant: a constant, tested pattern.
        Regex::new(r#"(?i)https://[^\s<>"']+"#).expect("valid link pattern")
    });

    /// Only explicit title markers and work-item URLs in the configured organization count.
    /// Arbitrary numbers in dates, Teams links and notes are not ticket IDs. Returns an ID only
    /// when exactly one distinct ID is found.
    pub fn extract(
        title: &str,
        url: Option<&str>,
        notes: Option<&str>,
        organization: &str,
    ) -> Option<i64> {
        let mut ids = BTreeSet::new();
        for captures in MARKER.captures_iter(title) {
            // A matcher error (backtracking limit) ends the scan, like a regex without matches.
            let Ok(captures) = captures else { break };
            if let Some(id) = captures.get(1).and_then(|m| m.as_str().parse::<i64>().ok())
                && id <= i32::MAX as i64
            {
                ids.insert(id);
            }
        }
        let mut links: Vec<String> = url.map(str::to_string).into_iter().collect();
        let text = format!("{title}\n{}", notes.unwrap_or(""));
        for found in LINK.find_iter(&text) {
            let Ok(found) = found else { break };
            links.push(found.as_str().trim_matches(|c| ").,;]".contains(c)).to_string());
        }
        let org = organization.trim().to_lowercase();
        if !org.is_empty() {
            ids.extend(links.iter().filter_map(|link| work_item_id(link, &org)));
        }
        if ids.len() == 1 { ids.pop_first() } else { None }
    }

    /// `https://dev.azure.com/<org>/…/_workitems/edit/<id>` or
    /// `https://<org>.visualstudio.com/…/_workitems/edit/<id>`, without user info.
    fn work_item_id(link: &str, org: &str) -> Option<i64> {
        let address = WebAddress::parse(link)?;
        if !address.scheme.eq_ignore_ascii_case("https") || address.user_info {
            return None;
        }
        let parts = address.path_components();
        let azure = (address.host == "dev.azure.com"
            && parts.first().is_some_and(|first| first.to_lowercase() == org))
            || address.host == format!("{org}.visualstudio.com");
        if !azure {
            return None;
        }
        let marker = parts.iter().position(|part| part == "_workitems")?;
        if parts.get(marker + 1).map(String::as_str) != Some("edit") {
            return None;
        }
        let id = parts.get(marker + 2)?.parse::<i64>().ok()?;
        (id > 0 && id <= i32::MAX as i64).then_some(id)
    }

    /// The parts of a web address that the ticket rules read, parsed like Foundation's
    /// `URL(string:)` on macOS 14+, which percent-encodes characters it does not allow instead
    /// of rejecting the address. Only a malformed scheme or port makes parsing fail.
    struct WebAddress<'a> {
        scheme: &'a str,
        user_info: bool,
        /// Lower-cased and percent-decoded.
        host: String,
        /// Still percent-encoded.
        path: &'a str,
    }

    impl<'a> WebAddress<'a> {
        fn parse(text: &'a str) -> Option<Self> {
            let (scheme, rest) = text.split_once(':')?;
            let mut chars = scheme.chars();
            if !chars.next().is_some_and(|c| c.is_ascii_alphabetic())
                || !chars.all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))
            {
                return None;
            }
            // Without "//" there is no host, so no Azure link.
            let rest = rest.strip_prefix("//")?;
            let (authority, tail) = rest.split_at(rest.find(['/', '?', '#']).unwrap_or(rest.len()));
            let path = &tail[..tail.find(['?', '#']).unwrap_or(tail.len())];
            let (user_info, host_and_port) = match authority.rsplit_once('@') {
                Some((_, host_and_port)) => (true, host_and_port),
                None => (false, authority),
            };
            let host = match host_and_port.rsplit_once(':') {
                Some((host, port)) if port.bytes().all(|b| b.is_ascii_digit()) => host,
                Some(_) => return None,
                None => host_and_port,
            };
            let host = percent_decode(host).unwrap_or_else(|| host.to_string()).to_lowercase();
            Some(Self { scheme, user_info, host, path })
        }

        /// Non-empty path segments, each percent-decoded (Swift `pathComponents` minus "/").
        fn path_components(&self) -> Vec<String> {
            self.path
                .split('/')
                .filter(|part| !part.is_empty())
                .map(|part| percent_decode(part).unwrap_or_else(|| part.to_string()))
                .collect()
        }
    }
}

/// Activity suggested for a meeting. Ported from `MeetingActivity`.
pub mod meeting_activity {
    use super::*;
    use crate::text::fold;

    /// An explicit default wins (and yields nothing when it no longer exists). Otherwise the
    /// first activity named "overleg", "meeting" or "meetings", ignoring case, diacritics and
    /// non-letters; stand-ups and daily scrums try "standup" first.
    pub fn suggested_id<'a>(
        title: &str,
        preferred_id: &str,
        available: &'a [ActivityType],
    ) -> Option<&'a str> {
        if !preferred_id.is_empty() {
            return available.iter().find(|a| a.id == preferred_id).map(|a| a.id.as_str());
        }
        let meeting = letters(title);
        let names: &[&str] = if meeting.contains("standup") || meeting.contains("dailyscrum") {
            &["standup", "overleg", "meeting", "meetings"]
        } else {
            &["overleg", "meeting", "meetings"]
        };
        names.iter().find_map(|name| {
            available
                .iter()
                .find(|a| letters(a.name.as_deref().unwrap_or("")) == *name)
                .map(|a| a.id.as_str())
        })
    }

    fn letters(value: &str) -> String {
        fold(value).chars().filter(|c| c.is_alphabetic()).collect()
    }
}

/// Swift `removingPercentEncoding`: `None` for a malformed escape or invalid UTF-8.
pub(crate) fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = bytes.get(index + 1..index + 3)?;
            if !hex.iter().all(u8::is_ascii_hexdigit) {
                return None;
            }
            let digits = std::str::from_utf8(hex).ok()?;
            decoded.push(u8::from_str_radix(digits, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decoding_matches_foundation() {
        assert_eq!(percent_decode("Design%20Review").as_deref(), Some("Design Review"));
        assert_eq!(percent_decode("plain").as_deref(), Some("plain"));
        assert_eq!(percent_decode("caf%C3%A9").as_deref(), Some("café"));
        assert_eq!(percent_decode("%+1"), None);
        assert_eq!(percent_decode("%4"), None);
        assert_eq!(percent_decode("%FF"), None);
    }
}
