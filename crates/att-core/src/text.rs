//! Small string helpers. Ported from `String.nonEmpty` and `DurationText` in Models.swift.

/// Swift `nonEmpty`: the original string when it contains a non-whitespace character.
pub trait NonEmpty {
    fn non_empty(&self) -> Option<&str>;
}

impl NonEmpty for str {
    fn non_empty(&self) -> Option<&str> {
        if self.trim().is_empty() { None } else { Some(self) }
    }
}

impl NonEmpty for String {
    fn non_empty(&self) -> Option<&str> {
        self.as_str().non_empty()
    }
}

impl NonEmpty for Option<String> {
    fn non_empty(&self) -> Option<&str> {
        self.as_deref().and_then(NonEmpty::non_empty)
    }
}

impl NonEmpty for Option<&str> {
    fn non_empty(&self) -> Option<&str> {
        self.and_then(NonEmpty::non_empty)
    }
}

/// Duration formatting. Values round down to whole seconds and never go below zero.
pub mod duration_text {
    fn whole(seconds: f64) -> i64 {
        if seconds.is_finite() { seconds.max(0.0) as i64 } else { 0 }
    }

    /// `HH:MM:SS`.
    pub fn clock(seconds: f64) -> String {
        let s = whole(seconds);
        format!("{:02}:{:02}:{:02}", s / 3600, (s % 3600) / 60, s % 60)
    }

    /// `Xh Ym`.
    pub fn short(seconds: f64) -> String {
        let minutes = whole(seconds) / 60;
        format!("{}h {}m", minutes / 60, minutes % 60)
    }
}

/// Case- and diacritic-insensitive form of `text` (Swift `.caseInsensitive, .diacriticInsensitive`).
pub fn fold(text: &str) -> String {
    use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};
    text.nfd().filter(|c| !is_combining_mark(*c)).collect::<String>().to_lowercase()
}

/// Whether `haystack` contains `needle`, ignoring case and diacritics.
pub fn contains_folded(haystack: &str, needle: &str) -> bool {
    fold(haystack).contains(&fold(needle))
}

/// Finder-style ordering (Swift `localizedStandardCompare`): case-insensitive, with digit runs
/// compared by numeric value.
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (a, b) = (fold(a), fold(b));
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(c), Some(d)) if c.is_ascii_digit() && d.is_ascii_digit() => {
                let mut left = String::new();
                while let Some(c) = x.peek().copied().filter(char::is_ascii_digit) {
                    left.push(c);
                    x.next();
                }
                let mut right = String::new();
                while let Some(d) = y.peek().copied().filter(char::is_ascii_digit) {
                    right.push(d);
                    y.next();
                }
                let (l, r) = (left.trim_start_matches('0'), right.trim_start_matches('0'));
                let order = l.len().cmp(&r.len()).then_with(|| l.cmp(r));
                if order != Ordering::Equal {
                    return order;
                }
            }
            (Some(c), Some(d)) => {
                if c != d {
                    return c.cmp(&d);
                }
                x.next();
                y.next();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_empty_keeps_the_original_text() {
        assert_eq!(" a ".non_empty(), Some(" a "));
        assert_eq!(" \n".non_empty(), None);
        assert_eq!(None::<String>.non_empty(), None);
    }

    #[test]
    fn durations_round_down() {
        assert_eq!(duration_text::clock(3_725.9), "01:02:05");
        assert_eq!(duration_text::clock(-5.0), "00:00:00");
        assert_eq!(duration_text::short(5_400.0), "1h 30m");
    }

    #[test]
    fn folding_and_natural_order() {
        assert_eq!(fold("Réunion ÉQUIPE"), "reunion equipe");
        assert!(contains_folded("Café overleg", "CAFE"));
        let mut names = vec!["repo10", "Repo2", "repo1"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, ["repo1", "Repo2", "repo10"]);
    }
}
