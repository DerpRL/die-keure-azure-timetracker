//! Startup switches for trying the shell without the engine. Debug builds only; release builds
//! do not contain this module.
//!
//! - `ATT_DEBUG_SHOW_PANEL=1` opens the panel with focus one second after launch,
//!   `ATT_DEBUG_SHOW_PANEL=nofocus` opens it without taking focus.
//! - `ATT_DEBUG_SHOW_MAIN=1` opens the main window.
//! - `ATT_DEBUG_MINI=1` turns the mini timer on.
//! - `ATT_DEBUG_REPORT=1` prints the monitors, the tray rectangle and the window frames to
//!   stderr afterwards, and every panel show, hide and focus change (there is no log
//!   subscriber before the engine adds one).
//! - `ATT_DEBUG_SNAPSHOT=<dir>` (macOS) writes `status-item.png` and `<label>.png` for every
//!   visible window, drawn in-process, so no Screen Recording permission is needed.

use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::surfaces::{self, MAIN, MINI, PANEL};
use crate::tray;

pub fn apply(app: &AppHandle) {
    let panel = std::env::var("ATT_DEBUG_SHOW_PANEL").ok().filter(|value| !value.is_empty());
    let main = std::env::var_os("ATT_DEBUG_SHOW_MAIN").is_some();
    let mini = std::env::var_os("ATT_DEBUG_MINI").is_some();
    let report = std::env::var_os("ATT_DEBUG_REPORT").is_some();
    let snapshot = std::env::var_os("ATT_DEBUG_SNAPSHOT").map(PathBuf::from);
    if panel.is_none() && !main && !mini && !report && snapshot.is_none() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        // Give the status item and the web views a moment to appear.
        std::thread::sleep(Duration::from_secs(1));
        if main {
            surfaces::show_main_or_log(&app, None);
            // Let the main window become key before anything else appears.
            std::thread::sleep(Duration::from_millis(500));
        }
        if mini && let Err(error) = surfaces::set_mini_timer(&app, true) {
            eprintln!("[att-debug] ATT_DEBUG_MINI failed: {error}");
        }
        if let Some(mode) = panel
            && let Err(error) = surfaces::show_panel(&app, mode != "nofocus")
        {
            eprintln!("[att-debug] ATT_DEBUG_SHOW_PANEL failed: {error}");
        }
        if report || snapshot.is_some() {
            // Let the pages render and the panel's IPC calls finish.
            std::thread::sleep(Duration::from_secs(2));
        }
        if report {
            print_report(&app);
        }
        if let Some(directory) = snapshot {
            write_snapshots(&app, &directory);
        }
    });
}

/// Prints `message` to stderr when `ATT_DEBUG_REPORT` is set.
pub fn trace(message: impl FnOnce() -> String) {
    static START: OnceLock<Option<std::time::Instant>> = OnceLock::new();
    let start = START.get_or_init(|| {
        std::env::var_os("ATT_DEBUG_REPORT").is_some().then(std::time::Instant::now)
    });
    if let Some(start) = start {
        eprintln!("[att-debug +{:>5} ms] {}", start.elapsed().as_millis(), message());
    }
}

fn print_report(app: &AppHandle) {
    for monitor in app.available_monitors().unwrap_or_default() {
        eprintln!(
            "[att-debug] monitor {:?} position {:?} size {:?} work area {:?} scale {}",
            monitor.name(),
            monitor.position(),
            monitor.size(),
            monitor.work_area(),
            monitor.scale_factor()
        );
    }
    eprintln!("[att-debug] tray rect {:?}", tray::current_rect(app));
    for label in [MAIN, PANEL, MINI] {
        let Some(window) = app.get_webview_window(label) else {
            eprintln!("[att-debug] {label}: not created");
            continue;
        };
        eprintln!(
            "[att-debug] {label}: position {:?} size {:?} visible {:?} focused {:?}",
            window.outer_position().ok(),
            window.outer_size().ok(),
            window.is_visible().ok(),
            window.is_focused().ok()
        );
    }
}

#[cfg(target_os = "macos")]
fn write_snapshots(app: &AppHandle, directory: &std::path::Path) {
    if let Err(error) = std::fs::create_dir_all(directory) {
        eprintln!("[att-debug] snapshot directory: {error}");
        return;
    }
    if let Some(tray) = app.tray_by_id(tray::TRAY_ID) {
        match crate::native::snapshot_status_item(&tray, directory.join("status-item.png")) {
            Ok(description) => eprintln!("[att-debug] status item: {description:?}"),
            Err(error) => eprintln!("[att-debug] status item snapshot: {error}"),
        }
    }
    for label in [MAIN, PANEL, MINI] {
        let Some(window) = app.get_webview_window(label) else { continue };
        if window.is_visible().unwrap_or(false) {
            let path = directory.join(format!("{label}.png"));
            if let Err(error) = crate::native::snapshot_webview(&window, path) {
                eprintln!("[att-debug] {label} snapshot: {error}");
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn write_snapshots(_app: &AppHandle, _directory: &std::path::Path) {
    eprintln!("[att-debug] ATT_DEBUG_SNAPSHOT is only implemented on macOS");
}
