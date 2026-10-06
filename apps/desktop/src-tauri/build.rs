/// Every command registered with `tauri::generate_handler!` in `src/lib.rs`.
///
/// Listing them gives the app an ACL manifest: tauri-build generates `allow-<command>` /
/// `deny-<command>` permissions, and a window may only call a command that a file in
/// `capabilities/` grants it. Add engine commands here and to `capabilities/default.json` when
/// they are registered; an unlisted command is rejected at runtime.
const COMMANDS: &[&str] = &[
    "shell_show_panel",
    "shell_hide_panel",
    "shell_toggle_panel",
    "shell_show_main",
    "shell_set_tray",
    "shell_set_mini_timer",
    "shell_set_shortcut",
    "shell_get_shortcut",
    "shell_quit",
    "engine_dispatch",
    "engine_snapshot",
];

fn main() {
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    if let Err(error) = tauri_build::try_build(attributes) {
        panic!("tauri-build failed: {error:#}");
    }
}
