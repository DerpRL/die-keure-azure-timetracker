//! Weekly targets and today/this-week progress.
//!
//! Ported from WorkTargets in Productivity.swift. PLACEHOLDER until the statistics and targets
//! port merges; the merge replaces this file wholesale.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct WorkTargets {}

impl WorkTargets {
    pub fn is_valid(&self) -> bool {
        true
    }
}
