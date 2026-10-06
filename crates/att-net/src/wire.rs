//! Request building and response decoding shared by the clients.

use std::fmt::Write as _;

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderValue};
use reqwest::{Method, Request, Url};
use serde::Serialize;
use serde::de::DeserializeOwned;

use att_core::{AppError, Result};

pub(crate) const JSON: &str = "application/json";
pub(crate) const FORM: &str = "application/x-www-form-urlencoded";

/// Foundation's text for undecodable JSON, which 1.14.x showed for malformed responses. Decoder
/// errors are never shown because they can quote the payload.
pub(crate) const UNREADABLE: &str =
    "The data couldn’t be read because it isn’t in the correct format.";

pub(crate) fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T> {
    serde_json::from_slice(bytes).map_err(|_| AppError::message(UNREADABLE))
}

pub(crate) fn encode<T: Serialize>(body: &T) -> Result<Vec<u8>> {
    // Plain structs of strings and numbers always serialize; keep a message instead of a panic.
    serde_json::to_vec(body)
        .map_err(|_| AppError::message("The request could not be prepared. Try again."))
}

/// `base` plus `segments`, each percent-encoded as exactly one path segment (so a `/` or `?` in a
/// project or work-item type name cannot change the request), and `query` in the given order.
///
/// `None` when the base cannot have a path or a segment is empty, `.` or `..` (URL parsers
/// silently drop or resolve those, which would send the request elsewhere).
pub(crate) fn url<'a>(
    base: &Url,
    segments: impl IntoIterator<Item = &'a str>,
    query: &[(&str, &str)],
) -> Option<Url> {
    let mut url = base.clone();
    url.set_query(None);
    url.set_fragment(None);
    {
        let mut path = url.path_segments_mut().ok()?;
        path.pop_if_empty();
        for segment in segments {
            if matches!(segment, "" | "." | "..") {
                return None;
            }
            path.push(segment);
        }
    }
    if !query.is_empty() {
        let pairs: Vec<String> = query
            .iter()
            .map(|(name, value)| {
                format!(
                    "{}={}",
                    percent_encode(name, query_safe),
                    percent_encode(value, query_safe)
                )
            })
            .collect();
        url.set_query(Some(&pairs.join("&")));
    }
    Some(url)
}

/// A request with `Accept: application/json`, the optional `Authorization` and, only when there
/// is a body, its `Content-Type`.
pub(crate) fn request(
    method: Method,
    url: Url,
    authorization: Option<HeaderValue>,
    body: Option<(&'static str, Vec<u8>)>,
) -> Request {
    let mut request = Request::new(method, url);
    let headers = request.headers_mut();
    if let Some(authorization) = authorization {
        headers.insert(AUTHORIZATION, authorization);
    }
    headers.insert(ACCEPT, HeaderValue::from_static(JSON));
    if let Some((content_type, body)) = body {
        headers.insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
        *request.body_mut() = Some(body.into());
    }
    request
}

/// A header value marked sensitive, so it is never printed by `Debug` or HTTP/2 indexed.
pub(crate) fn secret_header(value: &str) -> Result<HeaderValue> {
    let mut header = HeaderValue::from_str(value).map_err(|_| {
        AppError::message(
            "The saved credential contains characters that cannot be sent. Replace it in Settings.",
        )
    })?;
    header.set_sensitive(true);
    Ok(header)
}

/// Percent-encodes every UTF-8 byte for which `keep` is false, with upper-case hex digits.
pub(crate) fn percent_encode(text: &str, keep: fn(u8) -> bool) -> String {
    let mut encoded = String::with_capacity(text.len());
    for byte in text.bytes() {
        if keep(byte) {
            encoded.push(char::from(byte));
        } else {
            // Writing to a String cannot fail.
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

/// RFC 3986 unreserved characters (Swift's allowed set for OAuth form values).
pub(crate) fn unreserved(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~')
}

/// What `URLComponents.queryItems` leaves readable (`$expand`, `2026-09-29T10:00:00`,
/// `System.Title,System.State`), minus the pair delimiters `&`, `=` and `+`.
fn query_safe(byte: u8) -> bool {
    unreserved(byte)
        || matches!(byte, b'$' | b':' | b',' | b'!' | b'\'' | b'(' | b')' | b'*' | b';' | b'@')
        || matches!(byte, b'/' | b'?')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments_are_encoded_one_by_one_and_dot_segments_rejected() {
        let base = Url::parse("https://dev.azure.com/example").unwrap();
        let url = url(&base, ["A Project/x?", "_apis"], &[("api-version", "7.1")]).unwrap();
        assert_eq!(
            url.as_str(),
            "https://dev.azure.com/example/A%20Project%2Fx%3F/_apis?api-version=7.1"
        );
        for bad in ["", ".", ".."] {
            assert_eq!(super::url(&base, [bad], &[]), None, "{bad:?}");
        }
        let root = Url::parse("https://org.timehub.7pace.com/").unwrap();
        let url = super::url(&root, ["api", "rest"], &[]).unwrap();
        assert_eq!(url.as_str(), "https://org.timehub.7pace.com/api/rest");
    }

    #[test]
    fn query_keeps_odata_names_and_timestamps_readable() {
        let base = Url::parse("https://org.timehub.7pace.com/").unwrap();
        let url = url(
            &base,
            ["api"],
            &[("$fromTimestamp", "2026-09-29T10:00:00"), ("fields", "A.B,C"), ("q", "a&b=c+d e")],
        )
        .unwrap();
        assert_eq!(
            url.query(),
            Some("$fromTimestamp=2026-09-29T10:00:00&fields=A.B,C&q=a%26b%3Dc%2Bd%20e")
        );
    }

    #[test]
    fn form_values_keep_only_unreserved_characters() {
        assert_eq!(percent_encode("secret+/= &", unreserved), "secret%2B%2F%3D%20%26");
        assert_eq!(percent_encode("é~._-", unreserved), "%C3%A9~._-");
    }
}
