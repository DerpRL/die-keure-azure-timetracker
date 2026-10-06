//! The tray icon: the menu-bar clock with its elapsed-time title on macOS, a coloured state icon
//! in the notification area on Windows. Left click toggles the panel; right click opens a short
//! menu. Also holds the macOS app menu, whose key equivalents work while a window is key.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "macos"))]
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::shell::{SETTINGS_PAGE, ShellError, lock, on_main_thread};
use crate::surfaces;

pub const TRAY_ID: &str = "main";

pub const MENU_OPEN_OVERVIEW: &str = "open-overview";
pub const MENU_SETTINGS: &str = "settings";
pub const MENU_QUIT: &str = "quit";

const DEFAULT_TOOLTIP: &str = "Azure timetracker";
/// 1.x showed the clock with a zero timer until the first state arrived.
#[cfg(target_os = "macos")]
const INITIAL_TITLE: &str = " 00:00:00";
/// Longer titles are cut; the engine sends " HH:MM:SS".
const TITLE_LIMIT: usize = 32;
/// `NOTIFYICONDATAW.szTip` holds 128 UTF-16 units including the terminating NUL.
#[cfg(windows)]
const TOOLTIP_LIMIT: usize = 127;

/// What the tray shows. Serialized in lower case: `"running"`, `"paused"`, `"stopped"`,
/// `"disconnected"`, `"connecting"`, `"attention"` (1.x `TrackingIndicator`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TrayState {
    Running,
    Paused,
    Stopped,
    Disconnected,
    Connecting,
    Attention,
}

/// The tray values last applied, so the engine can send the full state every second while only
/// changes reach the OS.
#[derive(Default)]
pub struct TrayModel {
    applied: Mutex<Applied>,
}

#[derive(Default)]
struct Applied {
    title: Option<String>,
    tooltip: Option<String>,
    #[cfg(not(target_os = "macos"))]
    icon: Option<(TrayState, u32)>,
}

/// A rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PxRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub fn create(app: &AppHandle) -> Result<(), ShellError> {
    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&tray_menu(app)?)
        .show_menu_on_left_click(false)
        .tooltip(DEFAULT_TOOLTIP)
        .on_tray_icon_event(|tray, event| on_tray_event(tray.app_handle(), event));

    #[cfg(target_os = "macos")]
    let builder = builder
        .icon(tauri::include_image!("icons/tray/macos-template.png"))
        .icon_as_template(true)
        .title(INITIAL_TITLE);
    #[cfg(not(target_os = "macos"))]
    let pixels = icon_pixels(app);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.icon(state_icon(TrayState::Stopped, pixels));

    let tray = builder.build(app)?;
    #[cfg(target_os = "macos")]
    crate::native::style_status_item(&tray, DEFAULT_TOOLTIP, INITIAL_TITLE.trim())?;
    #[cfg(not(target_os = "macos"))]
    let _ = tray;

    let model = app.state::<TrayModel>();
    let mut applied = lock(&model.applied);
    applied.tooltip = Some(DEFAULT_TOOLTIP.to_string());
    #[cfg(target_os = "macos")]
    {
        applied.title = Some(INITIAL_TITLE.to_string());
    }
    #[cfg(not(target_os = "macos"))]
    {
        applied.icon = Some((TrayState::Stopped, pixels));
    }
    Ok(())
}

/// Applies the engine's tray state. Runs on the main thread (see [`on_main_thread`]), so the
/// cache lock is never held while another thread waits for the main thread.
pub fn set(
    app: &AppHandle,
    title: Option<String>,
    tooltip: String,
    state: TrayState,
) -> Result<(), ShellError> {
    let handle = app.clone();
    on_main_thread(app, move || apply(&handle, title, tooltip, state))?
}

fn apply(
    app: &AppHandle,
    title: Option<String>,
    tooltip: String,
    state: TrayState,
) -> Result<(), ShellError> {
    let tray = app.tray_by_id(TRAY_ID).ok_or(ShellError::MissingTray)?;
    let title = title.map(|title| truncate_chars(&title, TITLE_LIMIT));
    #[cfg(windows)]
    let tooltip = truncate_utf16(&tooltip, TOOLTIP_LIMIT);

    let model = app.state::<TrayModel>();
    let mut applied = lock(&model.applied);
    let title_changed = applied.title != title;
    let tooltip_changed = applied.tooltip.as_deref() != Some(tooltip.as_str());

    #[cfg(target_os = "macos")]
    {
        let _ = state; // The menu-bar clock is a template image in every state, as in 1.x.
        if title_changed {
            tray.set_title(title.as_deref())?;
        }
        if tooltip_changed {
            tray.set_tooltip(Some(&tooltip))?;
        }
        if title_changed || tooltip_changed {
            // VoiceOver reads the tooltip text as the label and the clock as the value, like 1.x.
            let value = title.as_deref().map(str::trim).unwrap_or_default();
            crate::native::describe_status_item(&tray, &tooltip, value)?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = title_changed; // The notification area cannot show text.
        if tooltip_changed {
            tray.set_tooltip(Some(&tooltip))?;
        }
        let icon = (state, icon_pixels(app));
        if applied.icon != Some(icon) {
            tray.set_icon(Some(state_icon(icon.0, icon.1)))?;
            applied.icon = Some(icon);
        }
    }

    applied.title = title;
    applied.tooltip = Some(tooltip);
    Ok(())
}

/// The tray icon's current frame in physical pixels, also handed to the positioner plugin,
/// which otherwise only learns it from pointer events over the icon.
pub fn current_rect(app: &AppHandle) -> Option<PxRect> {
    let tray = app.tray_by_id(TRAY_ID)?;
    let rect = tray.rect().ok().flatten()?;
    let position = rect.position.to_physical::<f64>(1.0);
    let size = rect.size.to_physical::<f64>(1.0);
    if size.width <= 0.0 || size.height <= 0.0 {
        return None;
    }
    let event = TrayIconEvent::Enter { id: tray.id().clone(), position, rect };
    tauri_plugin_positioner::on_tray_event(app, &event);
    Some(PxRect { x: position.x, y: position.y, w: size.width, h: size.height })
}

fn on_tray_event(app: &AppHandle, event: TrayIconEvent) {
    tauri_plugin_positioner::on_tray_event(app, &event);
    match event {
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } => surfaces::tray_clicked(app),
        #[cfg(windows)]
        TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => {
            surfaces::tray_double_clicked(app)
        }
        _ => {}
    }
}

fn tray_menu(app: &AppHandle) -> Result<Menu<Wry>, ShellError> {
    #[cfg(target_os = "macos")]
    let (settings, quit) = ("Settings…", "Quit Azure timetracker");
    #[cfg(not(target_os = "macos"))]
    let (settings, quit) = ("Settings", "Quit");
    Ok(Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, MENU_OPEN_OVERVIEW, "Open overview", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_SETTINGS, settings, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_QUIT, quit, true, None::<&str>)?,
        ],
    )?)
}

/// The macOS app menu. With the accessory activation policy it is never drawn, but its key
/// equivalents are: ⌘, opens Settings (1.x replaced the app-settings command group the same
/// way), ⌘Q quits, ⌘W closes (hides) the key window, and the Edit items give the web views
/// undo, cut, copy, paste and select all.
#[cfg(target_os = "macos")]
pub fn app_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    use tauri::menu::{AboutMetadata, Submenu};

    let about = AboutMetadata {
        name: Some("Azure timetracker".into()),
        version: Some(app.package_info().version.to_string()),
        ..Default::default()
    };
    let application = Submenu::with_items(
        app,
        "Azure timetracker",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Azure timetracker"), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_SETTINGS, "Settings…", true, Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Quit Azure timetracker"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::close_window(app, None)?],
    )?;
    Menu::with_items(app, &[&application, &edit, &window])
}

/// Handles tray-menu and app-menu items.
pub fn on_menu_event(app: &AppHandle, id: &str) {
    match id {
        MENU_OPEN_OVERVIEW => surfaces::show_main_or_log(app, None),
        MENU_SETTINGS => surfaces::show_main_or_log(app, Some(SETTINGS_PAGE)),
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}

/// 16-px icons at 100 % scaling, 32-px ones (scaled down by the shell) above.
#[cfg(not(target_os = "macos"))]
fn icon_pixels(app: &AppHandle) -> u32 {
    let scale = app.primary_monitor().ok().flatten().map_or(1.0, |monitor| monitor.scale_factor());
    if scale > 1.0 { 32 } else { 16 }
}

#[cfg(not(target_os = "macos"))]
fn state_icon(state: TrayState, pixels: u32) -> Image<'static> {
    use tauri::include_image;
    match (state, pixels >= 32) {
        (TrayState::Running, false) => include_image!("icons/tray/running-16.png"),
        (TrayState::Running, true) => include_image!("icons/tray/running-32.png"),
        (TrayState::Paused, false) => include_image!("icons/tray/paused-16.png"),
        (TrayState::Paused, true) => include_image!("icons/tray/paused-32.png"),
        (TrayState::Stopped, false) => include_image!("icons/tray/stopped-16.png"),
        (TrayState::Stopped, true) => include_image!("icons/tray/stopped-32.png"),
        (TrayState::Disconnected, false) => include_image!("icons/tray/disconnected-16.png"),
        (TrayState::Disconnected, true) => include_image!("icons/tray/disconnected-32.png"),
        (TrayState::Connecting, false) => include_image!("icons/tray/connecting-16.png"),
        (TrayState::Connecting, true) => include_image!("icons/tray/connecting-32.png"),
        (TrayState::Attention, false) => include_image!("icons/tray/attention-16.png"),
        (TrayState::Attention, true) => include_image!("icons/tray/attention-32.png"),
    }
}

/// Keeps at most `limit` characters, ending with "…" when text was cut.
fn truncate_chars(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(limit.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

/// Keeps at most `limit` UTF-16 units (never splitting a character), ending with "…" when text
/// was cut.
#[cfg_attr(not(windows), allow(dead_code))]
fn truncate_utf16(text: &str, limit: usize) -> String {
    if text.encode_utf16().count() <= limit {
        return text.to_string();
    }
    let mut used = 1; // the ellipsis
    let mut cut = String::new();
    for character in text.chars() {
        used += character.len_utf16();
        if used > limit {
            break;
        }
        cut.push(character);
    }
    cut.push('…');
    cut
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_state_uses_lower_case_names() {
        let states: Vec<TrayState> = serde_json::from_str(
            r#"["running","paused","stopped","disconnected","connecting","attention"]"#,
        )
        .expect("all six states parse");
        assert_eq!(states.len(), 6);
        assert!(serde_json::from_str::<TrayState>(r#""Running""#).is_err());
    }

    #[test]
    fn titles_are_cut_with_an_ellipsis() {
        assert_eq!(truncate_chars(" 01:23:45", TITLE_LIMIT), " 01:23:45");
        let long = "x".repeat(40);
        let cut = truncate_chars(&long, TITLE_LIMIT);
        assert_eq!(cut.chars().count(), TITLE_LIMIT);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn tooltips_fit_the_windows_buffer_without_splitting_characters() {
        let text =
            format!("Azure timetracker — Tracking · Confirmed\n#33624 · {}", "😀".repeat(80));
        let cut = truncate_utf16(&text, 127);
        assert!(cut.encode_utf16().count() <= 127);
        assert!(cut.ends_with('…'));
        assert!(!cut.contains('\u{FFFD}'));
        assert_eq!(truncate_utf16("Azure timetracker", 127), "Azure timetracker");
    }
}
