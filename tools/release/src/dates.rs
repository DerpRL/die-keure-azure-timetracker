//! Timestamps in the `YYYY-MM-DDTHH:MM:SS` + `Z`/`±HH:MM` form that both feeds use.

use anyhow::{Context, Result};

/// Internet date-time without fractional seconds. Accepted by Foundation's default
/// `ISO8601DateFormatter` (legacy feed) and by RFC 3339 parsers (Tauri feed).
pub fn is_internet_date_time(text: &str) -> bool {
    if !text.is_ascii() {
        return false;
    }
    let bytes = text.as_bytes();
    let digit = |index: usize| bytes.get(index).is_some_and(u8::is_ascii_digit);
    let at = |index: usize, expected: u8| bytes.get(index) == Some(&expected);
    let date_time = (0..4).all(digit)
        && at(4, b'-')
        && (5..7).all(digit)
        && at(7, b'-')
        && (8..10).all(digit)
        && at(10, b'T')
        && (11..13).all(digit)
        && at(13, b':')
        && (14..16).all(digit)
        && at(16, b':')
        && (17..19).all(digit);
    if !date_time {
        return false;
    }
    let zone_ok = &text[19..] == "Z"
        || (bytes.len() == 25
            && (at(19, b'+') || at(19, b'-'))
            && (20..22).all(digit)
            && at(22, b':')
            && (23..25).all(digit));
    zone_ok && text.parse::<jiff::Timestamp>().is_ok()
}

/// The current time in UTC, whole seconds, e.g. `2026-10-06T09:30:00Z`.
pub fn now_utc() -> Result<String> {
    let now = jiff::Timestamp::now();
    let whole = jiff::Timestamp::from_second(now.as_second()).context("clock out of range")?;
    Ok(whole.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_whole_second_internet_times() {
        assert!(is_internet_date_time("2026-10-05T14:48:05Z"));
        assert!(is_internet_date_time("2026-10-05T14:48:05+02:00"));
        assert!(!is_internet_date_time("2026-10-05T14:48:05.123Z"));
        assert!(!is_internet_date_time("2026-10-05 14:48:05Z"));
        assert!(!is_internet_date_time("not a date"));
        assert!(!is_internet_date_time("2026-13-05T14:48:05Z"));
        assert!(!is_internet_date_time("2026-10-05T14:48:05"));
    }

    #[test]
    fn now_is_well_formed() {
        assert!(is_internet_date_time(&now_utc().unwrap()));
    }
}
