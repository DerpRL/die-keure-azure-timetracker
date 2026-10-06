//! Pure domain logic for Azure timetracker 2.0, ported from the Swift `AzureTimetrackerCore`
//! module (1.14.2). No network or OS-specific I/O lives here; the only filesystem access is the
//! read-only Git HEAD reader and repository scan. Time is always passed in (`now`, [`time::Cal`]).
//!
//! Module owners during the port are noted in each file's header.

// Shared foundation.
pub mod attention;
pub mod config;
pub mod error;
pub mod model;
pub mod service;
pub mod text;
pub mod ticket;
pub mod time;

// Tracking and Git.
pub mod discovery;
pub mod git;
pub mod indicator;
pub mod manual;
pub mod tracking;

// Worklogs and offline drafts.
pub mod offline;
pub mod worklog;

// Targets, statistics and review.
pub mod day_review;
pub mod explorer;
pub mod explorer_visuals;
pub mod holidays;
pub mod insights;
pub mod productivity;
pub mod statistics;
pub mod targets;

// Context engines.
pub mod awareness;
pub mod completion;
pub mod figma;
pub mod interface_prefs;
pub mod meetings;
pub mod microphone;
pub mod microphone_end;

// Azure ticket details.
pub mod ticket_context;

pub use config::Configuration;
pub use error::{AppError, Result};
pub use time::{Cal, Interval};
