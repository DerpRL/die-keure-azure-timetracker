//! Injectable time, so engine logic is testable without sleeping.

use std::sync::Mutex;

use jiff::{Timestamp, tz::TimeZone};

use att_core::Cal;

pub trait Clock: Send + Sync {
    fn now(&self) -> Timestamp;
    /// The user's calendar (system zone in production).
    fn cal(&self) -> Cal;
}

/// Wall clock and the current system time zone.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Timestamp {
        Timestamp::now()
    }

    fn cal(&self) -> Cal {
        Cal::system()
    }
}

/// A clock that only moves when told to.
#[derive(Debug)]
pub struct ManualClock {
    now: Mutex<Timestamp>,
    tz: TimeZone,
}

impl ManualClock {
    pub fn new(now: Timestamp, tz: TimeZone) -> Self {
        Self { now: Mutex::new(now), tz }
    }

    pub fn set(&self, now: Timestamp) {
        *self.now.lock().unwrap_or_else(|e| e.into_inner()) = now;
    }

    pub fn advance(&self, seconds: f64) {
        let mut now = self.now.lock().unwrap_or_else(|e| e.into_inner());
        *now = att_core::time::add_secs(*now, seconds);
    }
}

impl Clock for ManualClock {
    fn now(&self) -> Timestamp {
        *self.now.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn cal(&self) -> Cal {
        Cal::new(self.tz.clone())
    }
}
