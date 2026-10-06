//! Figma Desktop file context, links and suggestions. Ported from FigmaContext.swift.
//!
//! Files are identified by the key in their address (`figma.com/design/<key>/<slug>`), exactly
//! as in 1.14.2. Windows may only expose the window title, so a file can also be identified by
//! title: its key is `title:<name>` and it has no address. Title keys cannot collide with real
//! keys (which are alphanumeric) and flow through the same dwell, activation and suggestion
//! logic, but they cannot be opened by address.

use std::collections::BTreeMap;

use jiff::Timestamp;
use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::meetings::percent_decode;
use crate::model::{ActivityType, HostOs};
use crate::text::NonEmpty;
use crate::time::{add_secs, diff_secs};

/// Figma context settings. Persisted as `Configuration.figmaDetection`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FigmaPreferences {
    pub enabled: bool,
    /// "Keep tracking" hides a suggestion for this long (0–120; 0 hides nothing).
    pub dismissal_minutes: i64,
    /// History retention (1–365).
    pub history_days: i64,
}

impl Default for FigmaPreferences {
    fn default() -> Self {
        Self { enabled: false, dismissal_minutes: 15, history_days: 30 }
    }
}

/// A Figma file seen in the foreground.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FigmaDocument {
    pub key: String,
    pub name: String,
}

impl FigmaDocument {
    /// Names keep at most this many characters.
    pub const NAME_LIMIT: usize = 500;
    /// Prefix of keys derived from a window title.
    pub const TITLE_KEY_PREFIX: &'static str = "title:";

    /// Keeps the first 500 characters of `name`.
    pub fn new(key: impl Into<String>, name: impl AsRef<str>) -> Self {
        Self { key: key.into(), name: prefix_characters(name.as_ref(), Self::NAME_LIMIT) }
    }

    /// A Figma file key: ASCII letters and digits only.
    pub fn valid_key(value: &str) -> bool {
        !value.is_empty() && value.bytes().all(|b| b.is_ascii_alphanumeric())
    }

    /// A key made by [`FigmaDocument::from_window_title`].
    pub fn is_title_key(value: &str) -> bool {
        value
            .strip_prefix(Self::TITLE_KEY_PREFIX)
            .is_some_and(|name| name.non_empty().is_some() && !name.contains('\0'))
    }

    /// Either kind of key; title keys are accepted wherever a file can be linked.
    pub fn known_key(value: &str) -> bool {
        Self::valid_key(value) || Self::is_title_key(value)
    }

    /// Parses a file address: `https://` on `figma.com` or `www.figma.com` (port 443 at most),
    /// no user info, path `/design|file|board|slides/<key>/<slug>`. The name is `title` when it
    /// is not blank, else the slug with dashes as spaces, else `Figma file · <key>`. A leading
    /// `figma.com/` without scheme is accepted.
    pub fn parse(address: &str, title: &str) -> Option<Self> {
        let mut address = address.trim().to_string();
        if address.to_lowercase().starts_with("figma.com/") {
            address = format!("https://{address}");
        }
        let url = Components::parse(&address)?;
        let host = url.host.to_lowercase();
        if !url.scheme.eq_ignore_ascii_case("https")
            || !(host == "figma.com" || host == "www.figma.com")
            || url.user_info
            || url.port.is_some_and(|port| port != 443)
        {
            return None;
        }
        let parts: Vec<&str> = url.path.split('/').filter(|part| !part.is_empty()).collect();
        if parts.len() < 3
            || !["design", "file", "board", "slides"].contains(&parts[0])
            || !Self::valid_key(parts[1])
        {
            return None;
        }
        let key = parts[1];
        let slug =
            percent_decode(parts[2]).unwrap_or_else(|| parts[2].to_string()).replace('-', " ");
        let name = match (title.non_empty(), slug.non_empty()) {
            (Some(title), _) => title.to_string(),
            (None, Some(slug)) => slug.to_string(),
            (None, None) => format!("Figma file · {key}"),
        };
        Some(Self::new(key, name))
    }

    /// A file identified only by its window title (Windows). A trailing " – Figma" or
    /// " - Figma" is removed; blank titles and the bare app name identify nothing.
    pub fn from_window_title(title: &str) -> Option<Self> {
        let name = window_title_name(title)?;
        let name = prefix_characters(name, Self::NAME_LIMIT);
        Some(Self { key: format!("{}{name}", Self::TITLE_KEY_PREFIX), name })
    }

    /// `https://www.figma.com/file/<key>`, or `None` for an invalid or title key.
    pub fn web_url(key: &str) -> Option<String> {
        Self::valid_key(key).then(|| format!("https://www.figma.com/file/{key}"))
    }

    /// `figma://file/<key>` for Figma Desktop, or `None` for an invalid or title key.
    pub fn desktop_url(key: &str) -> Option<String> {
        Self::valid_key(key).then(|| format!("figma://file/{key}"))
    }
}

/// The file name in a Figma window title.
fn window_title_name(title: &str) -> Option<&str> {
    let title = title.trim();
    let name = title
        .strip_suffix(" – Figma")
        .or_else(|| title.strip_suffix(" - Figma"))
        .unwrap_or(title)
        .trim();
    (!name.is_empty() && name != "Figma" && !name.contains('\0')).then_some(name)
}

/// The result of one read of the Figma window.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "document", rename_all = "camelCase")]
pub enum FigmaObservation {
    MissingAccess,
    /// Figma is not in front, or the read went stale.
    Waiting,
    /// Figma is in front but no file was identified.
    NoAddress,
    File(FigmaDocument),
}

impl FigmaObservation {
    pub fn document(&self) -> Option<&FigmaDocument> {
        match self {
            Self::File(file) => Some(file),
            _ => None,
        }
    }

    /// Figma was in front (a file or no address).
    pub fn foreground(&self) -> bool {
        matches!(self, Self::File(_) | Self::NoAddress)
    }

    /// Classifies a read of the foreground Figma window. The address wins and keeps the 1.14.2
    /// rules. On Windows the title loses its " – Figma" suffix and, without a usable address,
    /// identifies the file by title. On other systems the title is used as is and a missing
    /// address means [`FigmaObservation::NoAddress`], as in 1.14.2.
    pub fn from_window(url: Option<&str>, title: Option<&str>, os: HostOs) -> Self {
        let raw_title = title.unwrap_or("");
        let windows = os == HostOs::Windows;
        let title = if windows { window_title_name(raw_title).unwrap_or("") } else { raw_title };
        if let Some(document) = url.and_then(|url| FigmaDocument::parse(url, title)) {
            return Self::File(document);
        }
        if windows && let Some(document) = FigmaDocument::from_window_title(raw_title) {
            return Self::File(document);
        }
        Self::NoAddress
    }
}

/// Pure detection state: it cannot start timers or write hours.
///
/// A file activates after 2 s of continuous focus, once per visit: the same file activates
/// again only after another file activated or after 15 min away from Figma files. A gap of more
/// than 6 s between samples restarts the dwell and counts as time away.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FigmaActivation {
    candidate: Option<String>,
    candidate_since: Option<Timestamp>,
    last_activated: Option<String>,
    away_since: Option<Timestamp>,
    last_sample: Option<Timestamp>,
}

impl FigmaActivation {
    pub const DWELL_SECONDS: f64 = 2.0;
    pub const MAX_SAMPLE_GAP_SECONDS: f64 = 6.0;
    pub const REACTIVATE_AFTER_AWAY_SECONDS: f64 = 15.0 * 60.0;

    pub fn new() -> Self {
        Self::default()
    }

    /// Returns `true` when `document` activates at `now`.
    pub fn observe(&mut self, document: Option<&FigmaDocument>, now: Timestamp) -> bool {
        if let Some(last) = self.last_sample
            && diff_secs(now, last) > Self::MAX_SAMPLE_GAP_SECONDS
        {
            self.candidate = None;
            self.candidate_since = None;
            self.away_since.get_or_insert(last);
        }
        self.last_sample = Some(now);
        let Some(document) = document else {
            self.candidate = None;
            self.candidate_since = None;
            self.away_since.get_or_insert(now);
            return false;
        };
        if let Some(away) = self.away_since
            && diff_secs(now, away) >= Self::REACTIVATE_AFTER_AWAY_SECONDS
        {
            self.last_activated = None;
        }
        self.away_since = None;
        if self.candidate.as_deref() != Some(document.key.as_str()) {
            self.candidate = Some(document.key.clone());
            self.candidate_since = Some(now);
            return false;
        }
        let dwelled =
            self.candidate_since.is_some_and(|since| diff_secs(now, since) >= Self::DWELL_SECONDS);
        if !dwelled || self.last_activated.as_deref() == Some(document.key.as_str()) {
            return false;
        }
        self.last_activated = Some(document.key.clone());
        true
    }
}

/// A file in the register.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FigmaFile {
    pub key: String,
    pub name: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "crate::time::flex_date::option"
    )]
    pub last_seen: Option<Timestamp>,
}

impl FigmaFile {
    pub fn new(key: impl Into<String>, name: impl Into<String>) -> Self {
        Self { key: key.into(), name: name.into(), last_seen: None }
    }

    /// The placeholder name for a file known only by its key.
    fn placeholder(key: &str) -> Self {
        let name = match key.strip_prefix(FigmaDocument::TITLE_KEY_PREFIX) {
            Some(title) if FigmaDocument::is_title_key(key) => title.to_string(),
            _ => format!("Figma file · {key}"),
        };
        Self::new(key, name)
    }
}

/// "Start Design for this file?"
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FigmaSuggestion {
    #[serde(default = "uuid::Uuid::new_v4")]
    pub id: Uuid,
    pub file: String,
    pub name: String,
    #[serde(alias = "ticketID", default, skip_serializing_if = "Option::is_none")]
    pub ticket_id: Option<i64>,
    #[serde(with = "crate::time::flex_date")]
    pub created: Timestamp,
}

impl FigmaSuggestion {
    /// Suggestions are offered for 24 hours.
    pub const FRESH_SECONDS: f64 = 86_400.0;

    pub fn new(
        file: impl Into<String>,
        name: impl Into<String>,
        ticket_id: Option<i64>,
        created: Timestamp,
    ) -> Self {
        Self { id: Uuid::new_v4(), file: file.into(), name: name.into(), ticket_id, created }
    }

    /// `file NUL ticket NUL name`: the key of a dismissal.
    pub fn signature(&self) -> String {
        let ticket = self.ticket_id.map(|id| id.to_string()).unwrap_or_default();
        format!("{}\0{ticket}\0{}", self.file, self.name)
    }

    pub fn is_fresh(&self, now: Timestamp) -> bool {
        now >= self.created && diff_secs(now, self.created) <= Self::FRESH_SECONDS
    }
}

/// One activation in the history.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FigmaContextEvent {
    #[serde(default = "uuid::Uuid::new_v4")]
    pub id: Uuid,
    #[serde(with = "crate::time::flex_date")]
    pub timestamp: Timestamp,
    pub kind: String,
    pub file: String,
    pub name: String,
    #[serde(alias = "ticketID", default, skip_serializing_if = "Option::is_none")]
    pub ticket_id: Option<i64>,
}

/// Files, ticket links, suggestions, dismissals and history of one workspace.
///
/// Decoding is tolerant like the Swift `init(from:)`: a missing or `null` key becomes empty, so
/// mapping-only storage (`{"links":{…}}`) from older versions still loads.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct FigmaLedger {
    #[serde(deserialize_with = "null_as_default")]
    pub files: BTreeMap<String, FigmaFile>,
    /// File key → Azure ticket.
    #[serde(deserialize_with = "null_as_default")]
    pub links: BTreeMap<String, i64>,
    #[serde(deserialize_with = "null_as_default")]
    pub suggestions: Vec<FigmaSuggestion>,
    /// Suggestion signature (`file NUL ticket NUL name`) → hidden until.
    #[serde(with = "nullable_dates")]
    pub dismissals: BTreeMap<String, Timestamp>,
    #[serde(deserialize_with = "null_as_default")]
    pub history: Vec<FigmaContextEvent>,
}

impl FigmaLedger {
    pub const MAX_SUGGESTIONS: usize = 12;
    pub const MAX_HISTORY: usize = 5_000;
    pub const MAX_DISMISSAL_MINUTES: i64 = 120;

    pub fn new() -> Self {
        Self::default()
    }

    /// Every known file, most recently activated first (then by key). Linked keys without a
    /// file entry, from mapping-only storage, appear with a placeholder name.
    pub fn register(&self) -> Vec<FigmaFile> {
        let mut result = self.files.clone();
        for key in self.links.keys() {
            if !result.contains_key(key) && FigmaDocument::known_key(key) {
                result.insert(key.clone(), FigmaFile::placeholder(key));
            }
        }
        let mut files: Vec<FigmaFile> = result.into_values().collect();
        files.sort_by(|a, b| b.last_seen.cmp(&a.last_seen).then_with(|| a.key.cmp(&b.key)));
        files
    }

    /// The files linked to the ticket of the most recently activated linked file.
    pub fn last_worked(&self) -> Vec<FigmaFile> {
        let register = self.register();
        let Some(ticket) = register.iter().find_map(|file| self.links.get(&file.key).copied())
        else {
            return Vec::new();
        };
        register.into_iter().filter(|file| self.links.get(&file.key) == Some(&ticket)).collect()
    }

    /// Records the file and its current name; nothing else.
    pub fn observe(&mut self, document: &FigmaDocument) {
        let file = self
            .files
            .entry(document.key.clone())
            .or_insert_with(|| FigmaFile::new(document.key.clone(), document.name.clone()));
        file.name = document.name.clone();
    }

    /// Keeps the 12 newest fresh suggestions, live dismissals and `history_days` (1–365) of at
    /// most 5,000 history events.
    pub fn prune(&mut self, now: Timestamp, preferences: &FigmaPreferences) {
        self.suggestions.retain(|suggestion| suggestion.is_fresh(now));
        keep_last(&mut self.suggestions, Self::MAX_SUGGESTIONS);
        self.dismissals.retain(|_, until| *until > now);
        let days = preferences.history_days.clamp(1, 365) as f64;
        self.history.retain(|event| diff_secs(now, event.timestamp) < days * 86_400.0);
        keep_last(&mut self.history, Self::MAX_HISTORY);
    }

    /// Records an activation and returns a new suggestion when one should be shown. No
    /// suggestion when the running timer already tracks the linked ticket, when the same
    /// suggestion is pending (it is refreshed) or while it is dismissed.
    pub fn activate(
        &mut self,
        document: &FigmaDocument,
        now: Timestamp,
        active_ticket: Option<i64>,
        preferences: &FigmaPreferences,
    ) -> Option<FigmaSuggestion> {
        self.prune(now, preferences);
        self.suggestions.retain(|suggestion| suggestion.file == document.key);
        // Only this file's dismissals survive: switching to another file clears them.
        let prefix = format!("{}\0", document.key);
        self.dismissals.retain(|signature, _| signature.starts_with(&prefix));
        self.observe(document);
        if let Some(file) = self.files.get_mut(&document.key) {
            file.last_seen = Some(now);
        }
        let linked = self.links.get(&document.key).copied();
        self.history.push(FigmaContextEvent {
            id: Uuid::new_v4(),
            timestamp: now,
            kind: "figma".to_string(),
            file: document.key.clone(),
            name: document.name.clone(),
            ticket_id: linked,
        });
        keep_last(&mut self.history, Self::MAX_HISTORY);
        if active_ticket.is_some() && linked == active_ticket {
            self.suggestions.retain(|suggestion| suggestion.file != document.key);
            return None;
        }
        let proposal = FigmaSuggestion::new(&document.key, &document.name, linked, now);
        let signature = proposal.signature();
        if let Some(existing) = self.suggestions.iter_mut().find(|s| s.signature() == signature) {
            existing.created = now;
            return None;
        }
        if self.dismissals.get(&signature).is_some_and(|until| *until > now) {
            return None;
        }
        self.suggestions.retain(|suggestion| suggestion.file != document.key);
        self.suggestions.push(proposal.clone());
        Some(proposal)
    }

    /// Revalidates a suggestion before acting on it: it must still exist, be fresh and match
    /// the file's current link.
    pub fn validate(&self, id: Uuid, now: Timestamp) -> Result<FigmaSuggestion> {
        self.suggestions
            .iter()
            .find(|suggestion| suggestion.id == id)
            .filter(|proposal| {
                proposal.is_fresh(now) && self.links.get(&proposal.file).copied() == proposal.ticket_id
            })
            .cloned()
            .ok_or_else(|| {
                AppError::message(
                    "This Figma suggestion is outdated or its ticket link changed. Review the latest suggestion.",
                )
            })
    }

    /// Removes a suggestion and hides it for `minutes` (at most 120; 0 hides nothing).
    pub fn dismiss(&mut self, id: Uuid, now: Timestamp, minutes: i64) {
        let Some(suggestion) = self.suggestions.iter().find(|s| s.id == id) else { return };
        if minutes > 0 {
            let until = add_secs(now, minutes.min(Self::MAX_DISMISSAL_MINUTES) as f64 * 60.0);
            self.dismissals.insert(suggestion.signature(), until);
        }
        self.suggestions.retain(|s| s.id != id);
    }

    /// Links a file to a ticket (`None` unlinks) and clears its suggestions and dismissals.
    pub fn link(&mut self, key: &str, ticket: Option<i64>) -> Result<()> {
        let valid_ticket = ticket.is_none_or(|id| id > 0 && id <= i32::MAX as i64);
        if !FigmaDocument::known_key(key) || !valid_ticket {
            return Err(AppError::message("Choose a valid file and Azure ticket number."));
        }
        self.files.entry(key.to_string()).or_insert_with(|| FigmaFile::placeholder(key));
        match ticket {
            Some(id) => self.links.insert(key.to_string(), id),
            None => self.links.remove(key),
        };
        self.suggestions.retain(|suggestion| suggestion.file != key);
        let prefix = format!("{key}\0");
        self.dismissals.retain(|signature, _| !signature.starts_with(&prefix));
        Ok(())
    }

    /// After tracking started from a file: a ticket becomes its link; ticket-free tracking only
    /// clears its suggestions and keeps any saved link.
    pub fn complete_tracking(&mut self, key: &str, ticket_id: Option<i64>) -> Result<()> {
        match ticket_id {
            Some(id) => self.link(key, Some(id)),
            None => {
                self.suggestions.retain(|suggestion| suggestion.file != key);
                Ok(())
            }
        }
    }
}

/// The Design activity used when tracking from Figma. Ported from `DesignActivity`.
pub mod design_activity {
    use super::*;

    /// Named "design", ignoring case and surrounding whitespace.
    pub fn matches(activity: &ActivityType) -> bool {
        activity.name.as_deref().is_some_and(|name| name.trim().to_lowercase() == "design")
    }

    pub fn selected(activities: &[ActivityType]) -> Option<&str> {
        activities.iter().find(|a| matches(a)).map(|a| a.id.as_str())
    }
}

/// Every workspace's ledger, keyed by `organization|7pace URL`. Persisted as `figmaStore`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct FigmaStore {
    pub workspaces: BTreeMap<String, FigmaLedger>,
}

fn keep_last<T>(items: &mut Vec<T>, limit: usize) {
    if items.len() > limit {
        items.drain(..items.len() - limit);
    }
}

/// Swift `decodeIfPresent(…) ?? default`: `null` decodes like a missing key.
fn null_as_default<'de, D, T>(d: D) -> std::result::Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

/// `flex_date::map` that also reads `null` as an empty map.
mod nullable_dates {
    use super::*;
    use serde::Serializer;

    #[derive(Deserialize)]
    struct Dates(#[serde(with = "crate::time::flex_date::map")] BTreeMap<String, Timestamp>);

    pub fn serialize<S: Serializer>(
        map: &BTreeMap<String, Timestamp>,
        s: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        crate::time::flex_date::map::serialize(map, s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(
        d: D,
    ) -> std::result::Result<BTreeMap<String, Timestamp>, D::Error> {
        Ok(Option::<Dates>::deserialize(d)?.map(|dates| dates.0).unwrap_or_default())
    }
}

/// The first `limit` user-perceived characters (Swift `String.prefix` counts `Character`s).
/// Approximates extended grapheme clusters: combining marks, variation selectors, emoji
/// modifiers, tags and joined (ZWJ) sequences stay with their base, a regional-indicator pair
/// is one flag and CR LF is one character.
fn prefix_characters(text: &str, limit: usize) -> String {
    use unicode_normalization::char::is_combining_mark;
    let regional = |c: char| ('\u{1F1E6}'..='\u{1F1FF}').contains(&c);
    let mut count = 0;
    let mut previous: Option<char> = None;
    let mut regional_run = 0;
    for (index, c) in text.char_indices() {
        let extends = previous.is_some_and(|p| {
            is_combining_mark(c)
                || p == '\u{200D}'
                || matches!(c, '\u{200D}' | '\u{FE00}'..='\u{FE0F}' | '\u{1F3FB}'..='\u{1F3FF}')
                || ('\u{E0020}'..='\u{E007F}').contains(&c)
                || (regional(c) && regional_run % 2 == 1)
                || (p == '\r' && c == '\n')
        });
        regional_run = if regional(c) { regional_run + 1 } else { 0 };
        if !extends {
            if count == limit {
                return text[..index].to_string();
            }
            count += 1;
        }
        previous = Some(c);
    }
    text.to_string()
}

/// The parts of an address read by [`FigmaDocument::parse`], parsed like Foundation's strict
/// `URLComponents(string:)`: only RFC 3986 characters and valid percent-escapes are accepted.
struct Components<'a> {
    scheme: &'a str,
    user_info: bool,
    /// Percent-decoded.
    host: String,
    port: Option<u64>,
    /// Still percent-encoded.
    path: &'a str,
}

impl<'a> Components<'a> {
    fn parse(address: &'a str) -> Option<Self> {
        let bytes = address.as_bytes();
        for (index, &b) in bytes.iter().enumerate() {
            let allowed = b.is_ascii_alphanumeric() || b"-._~:/?#[]@!$&'()*+,;=%".contains(&b);
            let escape_ok = b != b'%'
                || bytes
                    .get(index + 1..index + 3)
                    .is_some_and(|hex| hex.iter().all(u8::is_ascii_hexdigit));
            if !allowed || !escape_ok {
                return None;
            }
        }
        let (scheme, rest) = address.split_once(':')?;
        let mut scheme_chars = scheme.bytes();
        if !scheme_chars.next().is_some_and(|b| b.is_ascii_alphabetic())
            || !scheme_chars.all(|b| b.is_ascii_alphanumeric() || b"+-.".contains(&b))
        {
            return None;
        }
        // A file address always has a host, so it needs "//".
        let rest = rest.strip_prefix("//")?;
        let (authority, tail) = rest.split_at(rest.find(['/', '?', '#']).unwrap_or(rest.len()));
        let (path, query_and_fragment) = tail.split_at(tail.find(['?', '#']).unwrap_or(tail.len()));
        // Brackets only delimit IP literals in the host; '#' starts the only fragment.
        let fragment = query_and_fragment.split_once('#').map_or("", |(_, fragment)| fragment);
        if tail.contains(['[', ']']) || fragment.contains('#') {
            return None;
        }
        let (user_info, host_and_port) = match authority.rsplit_once('@') {
            Some((user_info, host_and_port)) => {
                if user_info.contains(['@', '[', ']']) {
                    return None;
                }
                (true, host_and_port)
            }
            None => (false, authority),
        };
        // An IP literal can never be a Figma host.
        if host_and_port.contains(['[', ']']) {
            return None;
        }
        let (host, port) = match host_and_port.split_once(':') {
            Some((host, "")) => (host, None),
            Some((host, port)) if port.bytes().all(|b| b.is_ascii_digit()) => {
                (host, Some(port.parse::<u64>().ok()?))
            }
            Some(_) => return None,
            None => (host_and_port, None),
        };
        let host = percent_decode(host)?;
        Some(Self { scheme, user_info, host, port, path })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_counts_user_perceived_characters() {
        assert_eq!(prefix_characters("abc", 2), "ab");
        assert_eq!(prefix_characters("abc", 5), "abc");
        // "é" as e + combining acute counts once.
        assert_eq!(prefix_characters("e\u{301}xy", 2), "e\u{301}x");
        // A flag is two regional indicators; a family emoji is one ZWJ sequence.
        assert_eq!(
            prefix_characters("\u{1F1E7}\u{1F1EA}\u{1F1F3}\u{1F1F1}", 1),
            "\u{1F1E7}\u{1F1EA}"
        );
        let family = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}";
        assert_eq!(prefix_characters(&format!("{family}z"), 1), family);
        assert_eq!(prefix_characters("\r\nx", 1), "\r\n");
    }

    #[test]
    fn strict_components_follow_rfc_3986() {
        let url = Components::parse("https://figma.com:443/design/A1/x?node-id=1-2#frag").unwrap();
        assert_eq!((url.scheme, url.host.as_str(), url.port), ("https", "figma.com", Some(443)));
        assert_eq!(url.path, "/design/A1/x");
        assert!(!url.user_info);
        assert!(Components::parse("https://figma.com/design/A1/My File").is_none());
        assert!(Components::parse("https://figma.com/design/A1/%zz").is_none());
        assert!(Components::parse("https://figma.com/design/A1/x#a#b").is_none());
        assert!(Components::parse("https://figma.com:/design/A1/x").unwrap().port.is_none());
        assert!(Components::parse("https://figma.com:44a/design/A1/x").is_none());
        assert!(Components::parse("https://[::1]/design/A1/x").is_none());
        assert_eq!(Components::parse("https://figma%2Ecom/x").unwrap().host, "figma.com");
    }
}
