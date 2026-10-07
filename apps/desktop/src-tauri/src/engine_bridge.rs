//! Connects the engine to the desktop shell.
//!
//! - [`TauriShell`] implements the engine's [`Shell`] contract with the shell's tray, panel,
//!   window, notification and opener functions. The engine calls it from its own tasks.
//! - [`start`] opens the store, builds the engine on the native platform and production
//!   clients, forwards changed slices to every window as `engine://slices`, applies the
//!   settings the shell owns (mini timer, quick-switch shortcut) and starts the engine loops.
//! - [`engine_dispatch`], [`engine_resync`] and [`engine_snapshot`] are the commands the UI calls.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

use att_core::model::HostOs;
use att_engine::clients::NetClientFactory;
use att_engine::clock::SystemClock;
use att_engine::publish::SliceUpdate;
use att_engine::shell::{Notification, Shell, TrayState as EngineTrayState, TrayStatus};
use att_engine::{Engine, IpcError, Services};
use att_platform::Platform;
use att_store::Store;

use crate::shell::lock;
use crate::tray::TrayState;
use crate::{shortcut, surfaces, tray};

/// The event that carries changed slices to the windows.
pub const SLICES_EVENT: &str = "engine://slices";

pub struct TauriShell {
    app: AppHandle,
}

fn tray_state(state: EngineTrayState) -> TrayState {
    match state {
        EngineTrayState::Running => TrayState::Running,
        EngineTrayState::Paused => TrayState::Paused,
        EngineTrayState::Stopped => TrayState::Stopped,
        EngineTrayState::Disconnected => TrayState::Disconnected,
        EngineTrayState::Connecting => TrayState::Connecting,
        EngineTrayState::Attention => TrayState::Attention,
    }
}

impl Shell for TauriShell {
    fn show_panel(&self, focus: bool) {
        if let Err(error) = surfaces::show_panel(&self.app, focus) {
            tracing::warn!(%error, "could not show the panel");
        }
    }

    fn hide_panel(&self) {
        if let Err(error) = surfaces::hide_panel(&self.app) {
            tracing::warn!(%error, "could not hide the panel");
        }
    }

    fn show_main(&self, page: Option<&str>) {
        surfaces::show_main_or_log(&self.app, page);
    }

    fn set_tray(&self, status: &TrayStatus) {
        let result = tray::set(
            &self.app,
            status.title.clone(),
            status.tooltip.clone(),
            tray_state(status.state),
        );
        if let Err(error) = result {
            tracing::warn!(%error, "could not update the tray");
        }
    }

    fn notify(&self, notification: &Notification) {
        let result = self
            .app
            .notification()
            .builder()
            .title(&notification.title)
            .body(&notification.body)
            .show();
        if let Err(error) = result {
            tracing::warn!(%error, id = %notification.id, "could not show a notification");
        }
    }

    fn remove_notification(&self, _id: &str) {
        // The desktop notification plugin cannot withdraw a delivered banner; 1.x removed
        // pending ones. Banners expire on their own.
    }

    fn open_url(&self, url: &str) {
        if let Err(error) = self.app.opener().open_url(url, None::<&str>) {
            tracing::warn!(%error, "could not open a link");
        }
    }
}

/// The shell settings last applied, so slice updates only touch the OS when they change.
#[derive(Default)]
pub struct AppliedShellSettings {
    applied: Mutex<Option<(bool, Option<String>)>>,
}

/// Applies the mini timer and the quick-switch shortcut from the configuration.
fn apply_shell_settings(app: &AppHandle, mini_timer: bool, shortcut: Option<String>) {
    let model = app.state::<AppliedShellSettings>();
    let mut applied = lock(&model.applied);
    let next = (mini_timer, shortcut);
    if applied.as_ref() == Some(&next) {
        return;
    }
    let previous = applied.replace(next.clone());
    drop(applied);
    if previous.as_ref().map(|p| p.0) != Some(next.0) {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = surfaces::set_mini_timer(&handle, mini_timer) {
                tracing::warn!(%error, "could not apply the mini timer setting");
            }
        });
    }
    if previous.as_ref().map(|p| &p.1) != Some(&next.1) {
        let issue = match shortcut::set(app, next.1.as_deref()) {
            Ok(()) => shortcut::status(app).issue,
            Err(error) => {
                tracing::warn!(%error, "could not apply the quick-switch shortcut");
                Some(error)
            }
        };
        report_shortcut_issue(app, issue);
    }
}

/// Tells the engine why the quick-switch shortcut is not registered (`None` clears it), for
/// Settings and the connection details. Before the engine is managed (the first apply at
/// launch), `start` reports the status itself.
fn report_shortcut_issue(app: &AppHandle, issue: Option<String>) {
    let Some(engine) = app.try_state::<Engine>().map(|engine| engine.inner().clone()) else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let intent = serde_json::json!({ "type": "app.reportShortcutIssue", "issue": issue });
        if let Err(error) = engine.dispatch(intent).await {
            tracing::warn!(%error, "could not report the shortcut status");
        }
    });
}

/// The shortcut the configuration asks for: `None` turns it off; the default when unset.
fn configured_shortcut(config: &att_core::Configuration) -> Option<String> {
    if !config.quick_switch_enabled {
        return None;
    }
    Some(
        config
            .quick_switch_shortcut
            .clone()
            .unwrap_or_else(|| shortcut::DEFAULT_ACCELERATOR.to_string()),
    )
}

/// Reacts to the `settings` slice: the shell owns the mini timer and the shortcut.
fn on_slices(app: &AppHandle, updates: &[SliceUpdate]) {
    if let Some(settings) = updates.iter().find(|update| update.name == "settings")
        && let Some(config) = settings.value.get("configuration")
        && let Ok(config) = serde_json::from_value::<att_core::Configuration>(config.clone())
    {
        apply_shell_settings(app, config.mini_timer, configured_shortcut(&config));
    }
}

/// `--data-dir <path>` keeps a separate data folder (previews, tests); `--preview` disables
/// network requests, credential writes and calendar access, as in 1.x.
fn launch_options() -> (Option<PathBuf>, bool) {
    let args: Vec<String> = std::env::args().collect();
    let data_dir = args
        .iter()
        .position(|arg| arg == "--data-dir")
        .and_then(|index| args.get(index + 1))
        .map(PathBuf::from);
    (data_dir, args.iter().any(|arg| arg == "--preview"))
}

/// Builds the engine, registers it as managed state and starts it.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let (custom_dir, preview) = launch_options();
    // 1.14.x data is imported only into the default data folder (not with `--data-dir`,
    // `AZURE_TIME_DATA_DIR` or `--preview`).
    let legacy_dir =
        (custom_dir.is_none() && std::env::var_os("AZURE_TIME_DATA_DIR").is_none() && !preview)
            .then(att_platform::paths::legacy_data_dir)
            .flatten();
    let data_dir = custom_dir.unwrap_or_else(att_platform::data_dir);
    let store = Store::open(&data_dir).map_err(|error| error.to_string())?;
    let clients = NetClientFactory::new().map_err(|error| error.to_string())?;
    let services = Services {
        platform: Platform::native(),
        store: Arc::new(store),
        shell: Arc::new(TauriShell { app: app.clone() }),
        clock: Arc::new(SystemClock),
        clients: Arc::new(clients),
        preview,
        os: HostOs::current(),
        legacy_dir,
    };
    let engine = Engine::new(services).map_err(|error| error.message)?;
    app.manage(AppliedShellSettings::default());
    let config = engine.configuration();
    apply_shell_settings(app, config.mini_timer, configured_shortcut(&config));

    let handle = app.clone();
    engine.set_sink(Arc::new(move |updates: Vec<SliceUpdate>| {
        on_slices(&handle, &updates);
        if let Err(error) = handle.emit(SLICES_EVENT, &updates) {
            tracing::warn!(%error, "could not send state to the windows");
        }
    }));
    app.manage(engine.clone());
    report_shortcut_issue(app, shortcut::status(app).issue);
    tauri::async_runtime::spawn(async move { engine.start() });
    Ok(())
}

/// Called by the quick-switch shortcut (Rust side, no web view round trip).
pub fn quick_switch(app: &AppHandle) {
    if let Some(engine) = app.try_state::<Engine>() {
        let engine = engine.inner().clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = engine.dispatch(serde_json::json!({"type": "quick.switch"})).await {
                tracing::debug!(kind = %error.kind, "quick switch: {}", error.message);
            }
        });
    }
}

/// Handles one UI intent: `{ type: "<namespace>.<name>", …args }`.
#[tauri::command]
pub async fn engine_dispatch(engine: State<'_, Engine>, intent: Value) -> Result<Value, IpcError> {
    engine.dispatch(intent).await
}

/// Every slice as a return value (diagnostics and tests; windows use [`engine_resync`]).
#[tauri::command]
pub fn engine_snapshot(engine: State<'_, Engine>) -> Vec<SliceUpdate> {
    engine.snapshot()
}

/// Re-sends every slice as `engine://slices`, for a window that just subscribed.
#[tauri::command]
pub fn engine_resync(engine: State<'_, Engine>) {
    engine.resync();
}
