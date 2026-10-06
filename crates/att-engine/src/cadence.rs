//! Named periodic work with user-adjustable intervals (the Swift loop's `lastXCheck` dates).

use jiff::Timestamp;

use att_core::time::diff_secs;

/// Tracks when a periodic job last ran.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cadence {
    pub interval: f64,
    last: Option<Timestamp>,
}

impl Cadence {
    pub fn every(seconds: f64) -> Self {
        Self { interval: seconds, last: None }
    }

    /// Due when it never ran, the interval elapsed, or the clock moved backwards.
    pub fn is_due(&self, now: Timestamp) -> bool {
        match self.last {
            None => true,
            Some(last) => {
                let elapsed = diff_secs(now, last);
                elapsed >= self.interval || elapsed < 0.0
            }
        }
    }

    pub fn mark(&mut self, now: Timestamp) {
        self.last = Some(now);
    }

    /// Makes the job due on the next check (Swift `lastX = .distantPast`).
    pub fn reset(&mut self) {
        self.last = None;
    }

    pub fn last(&self) -> Option<Timestamp> {
        self.last
    }

    /// Returns true and marks the run when due.
    pub fn take(&mut self, now: Timestamp) -> bool {
        let due = self.is_due(now);
        if due {
            self.mark(now);
        }
        due
    }
}

/// Default intervals in seconds. Every value is user-adjustable within the bounds in the plan.
pub mod defaults {
    /// Engine tick: Git HEAD, presence, microphone, Figma, prompts.
    pub const TICK: f64 = 2.0;
    pub const CALENDAR: f64 = 30.0;
    pub const TICKET_COMPLETION: f64 = 60.0;
    pub const PROGRESS: f64 = 300.0;
    pub const HISTORY: f64 = 300.0;
    pub const UPDATE_FEED: f64 = 60.0;
}

#[cfg(test)]
mod tests {
    use super::*;
    use att_core::time::add_secs;

    #[test]
    fn due_after_interval_and_after_clock_changes() {
        let start = Timestamp::from_second(1_000_000).unwrap();
        let mut cadence = Cadence::every(60.0);
        assert!(cadence.take(start));
        assert!(!cadence.is_due(add_secs(start, 59.0)));
        assert!(cadence.is_due(add_secs(start, 60.0)));
        assert!(cadence.is_due(add_secs(start, -5.0)), "backwards clock reruns");
        cadence.reset();
        assert!(cadence.is_due(start));
    }
}
