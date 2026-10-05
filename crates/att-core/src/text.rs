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
}
