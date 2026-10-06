//! Azure timetracker 2.0 desktop shell.
//!
//! The shell owns what the operating system sees of the app: the tray icon (the menu-bar clock on
//! macOS), the three windows (`main`, `panel`, `mini`), the quick-switch shortcut, the macOS
//! activation policy and the plugin wiring. It holds no tracking state. The engine decides what
//! the tray shows and when the panel opens through [`engine_bridge`], which also registers the
//! engine commands next to the shell commands.

#[cfg(debug_assertions)]
mod debug;
mod engine_bridge;
mod native;
pub mod shell;
mod shortcut;
mod surfaces;
mod tray;

use tauri::{AppHandle, RunEvent};
use tauri_plugin_window_state::StateFlags;

/// Passed to the app when the OS starts it at login, so the engine can tell a login launch from
/// a manual one.
pub const AUTOSTART_ARG: &str = "--autostart";

/// Builds and runs the app. Returns when the app quits.
pub fn run() {
    let builder = tauri::Builder::default()
        // First, so a second launch hands over to the running instance and exits before any
        // other plugin, window or tray icon is created.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            surfaces::show_main_or_log(app, None);
        }))
        .plugin(
            // Only the main window remembers its frame, like the Swift frame autosave name. The
            // panel is re-anchored on every show and the mini timer has a fixed corner.
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION)
                .with_filter(|label| label == surfaces::MAIN)
                .build(),
        )
        // Launch at login: the Run registry key on Windows; on macOS the plugin's default
        // LaunchAgent plist until SMAppService parity with 1.x lands (see docs/port/tauri-shell.md).
        .plugin(tauri_plugin_autostart::Builder::new().arg(AUTOSTART_ARG).build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_positioner::init())
        .plugin(shortcut::plugin())
        .manage(surfaces::PanelState::default())
        .manage(tray::TrayModel::default())
        .manage(shortcut::ShortcutSlot::default())
        .on_menu_event(|app, event| tray::on_menu_event(app, event.id().as_ref()))
        .on_window_event(surfaces::on_window_event)
        .invoke_handler(tauri::generate_handler![
            shell::shell_show_panel,
            shell::shell_hide_panel,
            shell::shell_toggle_panel,
            shell::shell_show_main,
            shell::shell_set_tray,
            shell::shell_set_mini_timer,
            shell::shell_set_shortcut,
            shell::shell_get_shortcut,
            shell::shell_quit,
            engine_bridge::engine_dispatch,
            engine_bridge::engine_snapshot,
        ])
        .setup(|app| {
            setup(app.handle())?;
            Ok(())
        });

    // macOS keeps an app menu even without a menu bar: its key equivalents (⌘, ⌘Q ⌘W and the
    // Edit shortcuts the web views rely on) work while one of the windows is key. tao activates
    // the app at launch by default, which would take focus from the frontmost app at login and
    // after every update; a tray agent only activates when no other app is active.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(tray::app_menu).activate_ignoring_other_apps(false);

    match builder.build(tauri::generate_context!()) {
        Ok(app) => app.run(on_run_event),
        Err(error) => {
            eprintln!("Azure timetracker could not start: {error}");
            std::process::exit(1);
        }
    }
}

fn setup(app: &AppHandle) -> Result<(), shell::ShellError> {
    // No Dock icon and no Command-Tab entry, as in 1.x. LSUIElement in Info.plist already does this
    // for the bundled app before anything is drawn; the call covers `cargo run` as well.
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory)?;
    tray::create(app)?;
    surfaces::prepare(app)?;
    shortcut::register_default(app);
    // The engine decides what the tray shows and when the panel opens from here on.
    engine_bridge::start(app).map_err(shell::ShellError::Invalid)?;
    #[cfg(debug_assertions)]
    debug::apply(app);
    Ok(())
}

#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
fn on_run_event(app: &AppHandle, event: RunEvent) {
    match event {
        // Closing or destroying the last window must not quit a tray app. Explicit quits
        // (`shell_quit`, the tray menu, ⌘Q) carry an exit code and are not affected.
        RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
        // Opening the app again from Finder, Spotlight or Launchpad while it is running.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            #[cfg(debug_assertions)]
            debug::trace(|| "reopen".to_string());
            surfaces::show_main_or_log(app, None);
        }
        _ => {}
    }
}
