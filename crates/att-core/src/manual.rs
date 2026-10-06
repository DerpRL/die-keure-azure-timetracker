//! Ticket-free manual tracking kinds. Ported from ManualTracking.swift, plus `StandupActivity`
//! from SlackHuddles.swift: the huddle detector there is dead code, but the stand-up activity
//! rules are used by manual, meeting and microphone tracking.
//!
//! Owner during the port: tracking and Git.

use serde::{Deserialize, Serialize};
use unicode_normalization::char::is_combining_mark;

use crate::model::ActivityType;
use crate::text::NonEmpty;

/// What the user tracks without an Azure ticket (Swift `ManualTrackingKind`).
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ManualTrackingKind {
    Activity,
    Meeting,
    Standup,
}

impl ManualTrackingKind {
    /// Swift `allCases`, in menu order.
    pub const ALL: [Self; 3] = [Self::Activity, Self::Meeting, Self::Standup];

    /// The Swift raw value.
    pub fn id(self) -> &'static str {
        match self {
            Self::Activity => "activity",
            Self::Meeting => "meeting",
            Self::Standup => "standup",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Activity => "Other activity",
            Self::Meeting => "Meeting",
            Self::Standup => "Stand-up",
        }
    }

    /// The 7pace tracking comment: the user's comment when it has text, otherwise a default per
    /// kind (for other activities, the chosen activity's name).
    pub fn remark(self, comment: &str, activity: Option<&ActivityType>) -> String {
        if let Some(comment) = comment.non_empty() {
            return comment.to_string();
        }
        match self {
            Self::Standup => StandupActivity::REMARK.to_string(),
            Self::Meeting => "Meeting".to_string(),
            Self::Activity => activity
                .and_then(|activity| activity.name.non_empty())
                .unwrap_or("Unassigned work")
                .to_string(),
        }
    }
}

/// The 7pace activity used for daily stand-ups (Swift `StandupActivity`).
pub enum StandupActivity {}

impl StandupActivity {
    /// The tracking comment for stand-ups.
    pub const REMARK: &'static str = "daily standup";

    /// An activity named "Standup", "Stand-up", "STAND UP" and so on: only its letters count.
    pub fn matches(activity: &ActivityType) -> bool {
        letters(&activity.name.as_deref().unwrap_or("").to_lowercase()) == "standup"
    }

    /// The first matching activity's id.
    pub fn selected(activities: &[ActivityType]) -> Option<&str> {
        activities
            .iter()
            .find(|activity| Self::matches(activity))
            .map(|activity| activity.id.as_str())
    }
}

/// Swift `filter(\.isLetter)` keeps whole characters whose first scalar is alphabetic, so
/// combining marks stay with a kept letter.
fn letters(text: &str) -> String {
    let mut kept = String::new();
    let mut keeping = false;
    for scalar in text.chars() {
        if !is_combining_mark(scalar) {
            keeping = scalar.is_alphabetic();
        }
        if keeping {
            kept.push(scalar);
        }
    }
    kept
}
