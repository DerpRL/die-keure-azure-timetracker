//! Azure ticket details and plain-text HTML. Ported from TicketContext.swift.
//!
//! Owner: network port (`att-net`). [`TicketContext::decode`] reads the
//! `GET …/_apis/wit/workitems/{id}?$expand=Relations` response that `att_net::AzureApi` fetches.
//!
//! Descriptions are reduced to plain text ([`plain_html::text`]): no web view, scripts, remote
//! images or HTML resource loading. Relation links are kept only when they are HTTPS without
//! credentials; work-item REST links inside the organization become the browser link
//! `<organization>/_workitems/edit/<id>`.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::{AppError, Result};

pub use uri::UriParts;

/// A related link shown in the context panel.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketLink {
    pub title: String,
    pub url: String,
}

impl TicketLink {
    /// Stable identity (Swift `id`): the URL.
    pub fn id(&self) -> &str {
        &self.url
    }
}

/// Ticket details for the context panel. Missing text fields are empty strings, as in Swift.
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketContext {
    pub id: i64,
    pub title: String,
    pub state: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub assigned_to: String,
    pub project: String,
    pub iteration: String,
    pub tags: String,
    /// `System.Description` as plain text.
    pub description: String,
    /// `Microsoft.VSTS.Common.AcceptanceCriteria` as plain text.
    pub acceptance_criteria: String,
    pub links: Vec<TicketLink>,
}

impl TicketContext {
    /// Decodes an Azure work item fetched with `$expand=Relations` (Swift `TicketContext.decode`).
    ///
    /// `organization_url` is the `https://dev.azure.com/<organization>` base the request used; it
    /// decides which relation links are rewritten to browser links. Any body that is not a JSON
    /// object with an integer `id` and a `fields` object is rejected without echoing its content.
    pub fn decode(data: &[u8], organization_url: &str) -> Result<Self> {
        let incomplete = || AppError::message("Azure returned incomplete ticket details.");
        let Ok(Value::Object(object)) = serde_json::from_slice::<Value>(data) else {
            return Err(incomplete());
        };
        let id = object.get("id").and_then(swift_int).ok_or_else(incomplete)?;
        let fields = object.get("fields").and_then(Value::as_object).ok_or_else(incomplete)?;
        let field =
            |key: &str| fields.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
        // Identity fields arrive as objects; older payloads use a plain display string.
        let assigned_to = fields
            .get("System.AssignedTo")
            .and_then(Value::as_object)
            .and_then(|identity| identity.get("displayName"))
            .and_then(Value::as_str)
            .map_or_else(|| field("System.AssignedTo"), str::to_string);
        Ok(Self {
            id,
            title: field("System.Title"),
            state: field("System.State"),
            kind: field("System.WorkItemType"),
            assigned_to,
            project: field("System.TeamProject"),
            iteration: field("System.IterationPath"),
            tags: field("System.Tags"),
            description: plain_html::text(&field("System.Description")),
            acceptance_criteria: plain_html::text(&field(
                "Microsoft.VSTS.Common.AcceptanceCriteria",
            )),
            links: links(&object, organization_url),
        })
    }
}

/// Swift `as? Int` on a JSON number: an integer, or a float with an exact integer value.
fn swift_int(value: &Value) -> Option<i64> {
    let number = value.as_number()?;
    number.as_i64().or_else(|| {
        number.as_f64().filter(|f| f.fract() == 0.0 && f.abs() < 9.0e18).map(|f| f as i64)
    })
}

fn links(object: &Map<String, Value>, organization_url: &str) -> Vec<TicketLink> {
    // Swift casts the whole array to `[[String: Any]]`, so one non-object entry drops every link.
    let relations: Vec<&Map<String, Value>> = match object.get("relations") {
        Some(Value::Array(items)) => {
            items.iter().map(Value::as_object).collect::<Option<_>>().unwrap_or_default()
        }
        _ => Vec::new(),
    };
    let organization = UriParts::parse(organization_url);
    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for relation in relations {
        let Some(raw) = relation.get("url").and_then(Value::as_str) else { continue };
        let Some(parts) = UriParts::parse(raw) else { continue };
        // HTTPS with a host and no user or password; `javascript:`, `http:` and the like are
        // dropped. (Swift accepted an empty host; such a link cannot be opened, so it is dropped.)
        if parts.scheme != Some("https")
            || parts.host.is_none_or(str::is_empty)
            || parts.user_info.is_some()
        {
            continue;
        }
        let url = match organization.as_ref().and_then(|org| work_item_api_ticket(&parts, org)) {
            Some(ticket) => {
                format!("{}/_workitems/edit/{ticket}", organization_url.trim_end_matches('/'))
            }
            None => raw.to_string(),
        };
        if !seen.insert(url.clone()) {
            continue;
        }
        let title = relation
            .get("attributes")
            .and_then(Value::as_object)
            .and_then(|attributes| attributes.get("name"))
            .and_then(Value::as_str)
            .or_else(|| relation.get("rel").and_then(Value::as_str))
            .unwrap_or("Related link");
        links.push(TicketLink { title: title.to_string(), url });
    }
    links
}

/// The ticket number when `link` is a work-item REST URL inside the organization. Swift compares
/// `URL.host` and `URL.path` (both percent-decoded, the path without a trailing slash) and reads
/// the number from `lastPathComponent`.
fn work_item_api_ticket(link: &UriParts<'_>, organization: &UriParts<'_>) -> Option<i64> {
    if link.host_decoded()? != organization.host_decoded()? {
        return None;
    }
    let path = link.path_decoded()?;
    if !path.starts_with(&format!("{}/", organization.path_decoded()?)) {
        return None;
    }
    if !path.to_lowercase().contains("/_apis/wit/workitems/") {
        return None;
    }
    let last = if path == "/" { path.as_str() } else { path.rsplit('/').next().unwrap_or("") };
    last.parse().ok()
}

/// HTML to display text. Ported from `PlainHTML`.
pub mod plain_html {
    use std::borrow::Cow;
    use std::sync::LazyLock;

    use fancy_regex::{Captures, NoExpand, Regex};

    // The Swift NSRegularExpression patterns, rewritten only so they run on the linear-time engine
    // (Azure descriptions can be large):
    // - `<(script|style)\b[^>]*>.*?</\1\s*>` has no back-reference here: each name is its own
    //   alternative, which matches the same text because the closing name always equals the
    //   opening one (case-insensitively, as ICU compares back-references under `(?i)`).
    // - `\b` after a tag name becomes `(?:[^>\w][^>]*)?`: the next character is `>` or a non-word
    //   character, exactly what `\b[^>]*>` accepts.
    // - ICU's `\s` is `[\t\n\f\r\p{Z}]`, spelled out so vertical tab and NEL are not spaces.
    const SPACE: &str = r"[\t\n\f\r\p{Z}]";

    static SCRIPT_OR_STYLE: LazyLock<Regex> = LazyLock::new(|| {
        compile(&format!(
            r"(?is)<script(?:[^>\w][^>]*)?>.*?</script{SPACE}*>|<style(?:[^>\w][^>]*)?>.*?</style{SPACE}*>"
        ))
    });
    static LINE_BREAK: LazyLock<Regex> = LazyLock::new(|| {
        compile(&format!(r"(?i)<br{SPACE}*/?>|</(?:p|div|li|h[1-6]|tr){SPACE}*>"))
    });
    static LIST_ITEM: LazyLock<Regex> = LazyLock::new(|| compile(r"(?i)<li(?:[^>\w][^>]*)?>"));
    static TAG: LazyLock<Regex> = LazyLock::new(|| compile("<[^>]+>"));
    static NUMERIC_ENTITY: LazyLock<Regex> = LazyLock::new(|| compile("&#(x[0-9a-fA-F]+|[0-9]+);"));

    const NAMED_ENTITIES: [(&str, &str); 6] = [
        ("&nbsp;", " "),
        ("&quot;", "\""),
        ("&apos;", "'"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        // Last, so `&amp;lt;` becomes `&lt;` and not `<`, as in Swift.
        ("&amp;", "&"),
    ];

    fn compile(pattern: &str) -> Regex {
        // Invariant: the patterns are constants exercised by the tests, so they always compile.
        Regex::new(pattern).expect("plain-text HTML pattern compiles")
    }

    /// Plain text of an HTML fragment: scripts and styles removed, line breaks for `<br>` and
    /// closing block tags, `• ` for list items, other tags removed, numeric and basic named
    /// entities decoded, surrounding whitespace trimmed. Never loads anything.
    pub fn text(source: &str) -> String {
        let text = replace(&SCRIPT_OR_STYLE, source, "");
        let text = replace(&LINE_BREAK, &text, "\n");
        let text = replace(&LIST_ITEM, &text, "• ");
        let text = replace(&TAG, &text, "");
        let mut text = decode_numeric_entities(&text);
        for (entity, decoded) in NAMED_ENTITIES {
            text = text.replace(entity, decoded);
        }
        text.trim().to_string()
    }

    fn replace(regex: &Regex, text: &str, with: &str) -> String {
        // These patterns have no look-around or back-references, so matching cannot fail; keep
        // the text unchanged rather than panicking if it ever did.
        regex
            .try_replacen(text, 0, NoExpand(with))
            .map(Cow::into_owned)
            .unwrap_or_else(|_| text.to_string())
    }

    /// `&#NNN;` and `&#xHH;` (lower-case `x` only, like the Swift pattern). Values that are not a
    /// Unicode scalar (surrogates, beyond U+10FFFF, overflow) stay as written.
    fn decode_numeric_entities(text: &str) -> String {
        let decode = |captures: &Captures<'_, str>| -> String {
            let value = &captures[1];
            let code = match value.strip_prefix('x') {
                Some(hex) => u32::from_str_radix(hex, 16).ok(),
                None => value.parse::<u32>().ok(),
            };
            code.and_then(char::from_u32).map_or_else(|| captures[0].to_string(), |c| c.to_string())
        };
        NUMERIC_ENTITY
            .try_replacen(text, 0, decode)
            .map(Cow::into_owned)
            .unwrap_or_else(|_| text.to_string())
    }
}

/// Strict URI splitting, shared with `att_net::Endpoint`.
pub mod uri {
    /// A URI reference split per RFC 3986 §3, as strictly as Foundation's
    /// `URLComponents(string:)`: every character must be legal in its component and `%` must
    /// start a two-digit hex escape. Nothing is decoded or normalised, so validation sees exactly
    /// the text that would be sent. (WHATWG parsers such as `url::Url` silently repair input, for
    /// example by dropping an empty `user@` or accepting `https:host`, so they are not used to
    /// validate.)
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct UriParts<'a> {
        pub scheme: Option<&'a str>,
        /// The text before `@` in the authority. Any `@`, even in `https://@host`, is a user.
        pub user_info: Option<&'a str>,
        /// `Some` exactly when the reference has an authority (`//…`). May be empty.
        pub host: Option<&'a str>,
        /// The digits after `:` in the authority. May be empty.
        pub port: Option<&'a str>,
        pub path: &'a str,
        pub query: Option<&'a str>,
        pub fragment: Option<&'a str>,
    }

    impl<'a> UriParts<'a> {
        /// `None` when `text` is not a valid RFC 3986 URI reference.
        pub fn parse(text: &'a str) -> Option<Self> {
            let (rest, fragment) = split_off(text, '#');
            let (rest, query) = split_off(rest, '?');
            let (scheme, rest) = match rest.find([':', '/']) {
                Some(index) if rest.as_bytes()[index] == b':' => {
                    let scheme = &rest[..index];
                    if !valid_scheme(scheme) {
                        return None;
                    }
                    (Some(scheme), &rest[index + 1..])
                }
                _ => (None, rest),
            };
            let (authority, path) = match rest.strip_prefix("//") {
                Some(after) => {
                    let end = after.find('/').unwrap_or(after.len());
                    (Some(&after[..end]), &after[end..])
                }
                None => (None, rest),
            };
            let (user_info, host, port) = match authority {
                None => (None, None, None),
                Some(authority) => {
                    let (user_info, host_port) = match authority.split_once('@') {
                        Some((user_info, host_port)) => (Some(user_info), host_port),
                        None => (None, authority),
                    };
                    let (host, port) = if host_port.starts_with('[') {
                        let (host, after) = host_port.split_at(host_port.find(']')? + 1);
                        if after.is_empty() {
                            (host, None)
                        } else {
                            (host, Some(after.strip_prefix(':')?))
                        }
                    } else {
                        match host_port.split_once(':') {
                            Some((host, port)) => (host, Some(port)),
                            None => (host_port, None),
                        }
                    };
                    (user_info, Some(host), port)
                }
            };
            let valid = user_info.is_none_or(|text| valid_chars(text, b":"))
                && host.is_none_or(valid_host)
                && port.is_none_or(|text| text.bytes().all(|b| b.is_ascii_digit()))
                && valid_chars(path, b":@/")
                && query.is_none_or(|text| valid_chars(text, b":@/?"))
                && fragment.is_none_or(|text| valid_chars(text, b":@/?"));
            valid.then_some(Self { scheme, user_info, host, port, path, query, fragment })
        }

        /// The percent-decoded host (Foundation `URL.host`).
        pub fn host_decoded(&self) -> Option<String> {
            self.host.and_then(percent_decode)
        }

        /// The percent-decoded path without a trailing slash, `/` staying `/` (Foundation
        /// `URL.path`). `None` when the escapes are not UTF-8.
        pub fn path_decoded(&self) -> Option<String> {
            let decoded = percent_decode(self.path)?;
            let trimmed = decoded.trim_end_matches('/');
            Some(if trimmed.is_empty() && !decoded.is_empty() {
                "/".into()
            } else {
                trimmed.into()
            })
        }
    }

    fn split_off(text: &str, delimiter: char) -> (&str, Option<&str>) {
        match text.split_once(delimiter) {
            Some((before, after)) => (before, Some(after)),
            None => (text, None),
        }
    }

    fn valid_scheme(text: &str) -> bool {
        let mut bytes = text.bytes();
        bytes.next().is_some_and(|b| b.is_ascii_alphabetic())
            && bytes.all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.'))
    }

    fn valid_host(text: &str) -> bool {
        match text.strip_prefix('[').and_then(|inner| inner.strip_suffix(']')) {
            // IP literal: IPv6 or IPvFuture characters, no escapes.
            Some(inner) => {
                !inner.is_empty()
                    && inner.bytes().all(|b| unreserved(b) || sub_delim(b) || b == b':')
            }
            None => valid_chars(text, b""),
        }
    }

    fn unreserved(b: u8) -> bool {
        b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~')
    }

    fn sub_delim(b: u8) -> bool {
        matches!(b, b'!' | b'$' | b'&' | b'\'' | b'(' | b')' | b'*' | b'+' | b',' | b';' | b'=')
    }

    /// Unreserved, sub-delims, `%HH` escapes and the component's `extra` characters only.
    fn valid_chars(text: &str, extra: &[u8]) -> bool {
        let bytes = text.as_bytes();
        let mut index = 0;
        while index < bytes.len() {
            let b = bytes[index];
            if b == b'%' {
                let escape = bytes.get(index + 1..index + 3);
                if !escape.is_some_and(|hex| hex.iter().all(u8::is_ascii_hexdigit)) {
                    return false;
                }
                index += 3;
            } else if unreserved(b) || sub_delim(b) || extra.contains(&b) {
                index += 1;
            } else {
                return false;
            }
        }
        true
    }

    fn percent_decode(text: &str) -> Option<String> {
        let bytes = text.as_bytes();
        let mut decoded = Vec::with_capacity(bytes.len());
        let mut index = 0;
        while index < bytes.len() {
            if bytes[index] == b'%' {
                let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
                decoded.push(u8::from_str_radix(hex, 16).ok()?);
                index += 3;
            } else {
                decoded.push(bytes[index]);
                index += 1;
            }
        }
        String::from_utf8(decoded).ok()
    }
}
