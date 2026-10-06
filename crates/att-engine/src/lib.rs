//! Orchestration for Azure timetracker 2.0: the Rust replacement for the Swift `AppModel` and
//! its sub-models.
//!
//! Concurrency model (mirrors the Swift `@MainActor` model):
//! - All mutable state lives in one `AppState` behind a short-lived lock that is never held
//!   across an `.await`. Async operations read what they need, release the lock, await the
//!   network, then re-lock and apply — exactly where Swift interleaved at `await` points.
//! - Stale results are dropped with [`guard::Generation`] tokens (Swift's `UUID` generations).
//! - Remote writes are serialized by [`guard::Busy`] (Swift's `busy` flag): a second write while
//!   one is in flight is refused, never queued.
//! - Probes and SQLite run on the blocking pool; nothing blocks the Tauri UI thread.
//! - After every state change the [`publish::Publisher`] emits only the view slices whose JSON
//!   changed, so the UI re-renders what changed and nothing else.
//!
//! The Tauri app implements [`shell::Shell`] (tray, panel, windows, notifications) and forwards
//! UI intents to the engine.

// TODO(engine port): remove once the session and controllers use every skeleton item.
#![allow(dead_code)]

pub mod cadence;
pub mod clients;
pub mod clock;
pub mod controllers;
pub mod engine;
pub mod guard;
pub mod intent;
pub mod ipc;
mod persist;
pub mod probes;
pub mod publish;
pub mod services;
pub mod session;
pub mod shell;
pub mod state;
pub mod testing;
mod view;

pub use engine::Engine;
pub use ipc::IpcError;
pub use services::Services;
