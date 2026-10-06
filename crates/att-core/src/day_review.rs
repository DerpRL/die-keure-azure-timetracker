//! End-of-day review schedule and summary.
//!
//! Ported from DayReview.swift. PLACEHOLDER until the statistics and targets port merges; the
//! merge replaces this file wholesale.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct DayReviewPreferences {}

impl DayReviewPreferences {
    pub fn is_valid(&self) -> bool {
        true
    }
}
