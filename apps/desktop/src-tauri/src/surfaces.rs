//! The three windows ("surfaces") of the single React bundle, which renders by window label:
//!
//! - `main`: the overview and settings window. Hidden at launch; closing it hides it.
//! - `panel`: the tray panel (1.x's menu-bar popover). Hidden until the tray icon, the shortcut or
//!   the engine shows it; anchored to the tray icon on every show; hides when it loses focus.
//! - `mini`: an optional always-on-top elapsed-time window, created on demand (mainly for Windows,
//!   whose tray cannot show text).

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};
use tauri_plugin_positioner::{Position as Anchor, WindowExt as _};
use tauri_plugin_window_state::{AppHandleExt as _, StateFlags};

use crate::native;
use crate::shell::{
    HideReason, MINI_CLOSED_EVENT, NAVIGATE_EVENT, PANEL_HIDDEN_EVENT, PANEL_SHOWN_EVENT,
    PanelHidden, PanelShown, ShellError, lock,
};
use crate::tray::{self, PxRect};

pub const MAIN: &str = "main";
pub const PANEL: &str = "panel";
pub const MINI: &str = "mini";

/// Logical size of the mini timer window.
const MINI_SIZE: (f64, f64) = (260.0, 72.0);
/// Logical distance of the mini timer from the work-area corner.
const MINI_MARGIN: f64 = 16.0;

/// The panel opens under the menu bar on macOS and above the taskbar on Windows.
#[cfg(target_os = "macos")]
const TRAY_AT_TOP: bool = true;
#[cfg(not(target_os = "macos"))]
const TRAY_AT_TOP: bool = false;
#[cfg(target_os = "macos")]
const TRAY_ANCHOR: Anchor = Anchor::TrayBottomCenter;
#[cfg(not(target_os = "macos"))]
const TRAY_ANCHOR: Anchor = Anchor::TrayCenter;
/// Logical gap between the tray icon and the panel (macOS popover distance, Windows 11 flyout
/// margin), also kept from the work-area edge on the tray side.
#[cfg(target_os = "macos")]
const PANEL_GAP: f64 = 6.0;
#[cfg(not(target_os = "macos"))]
const PANEL_GAP: f64 = 12.0;
/// Logical distance the panel keeps from the left and right work-area edges.
const PANEL_MARGIN: f64 = 8.0;

/// A tray click right after the panel hid itself on losing focus is the click that took the
/// focus away (Windows moves focus to the taskbar on mouse down): it closes, not reopens.
const CLICK_AFTER_BLUR: Duration = Duration::from_millis(400);
/// Windows reports a double click as click, double click, click; the trailing click is ignored.
#[cfg(windows)]
const CLICK_AFTER_DOUBLE_CLICK: Duration = Duration::from_millis(600);
/// macOS may refuse to activate the app when nothing the user did asked for it (an engine
/// prompt with `focus: true`); the panel then resigns key right after showing. A blur this soon
/// after a show leaves the panel open without focus instead of hiding it at once.
const BLUR_GRACE_AFTER_SHOW: Duration = Duration::from_millis(300);

#[derive(Default)]
pub struct PanelState {
    flags: Mutex<PanelFlags>,
}

#[derive(Default)]
struct PanelFlags {
    shown_at: Option<Instant>,
    hidden_by_blur_at: Option<Instant>,
    #[cfg(windows)]
    double_click_at: Option<Instant>,
}

/// One-time window setup after the windows from `tauri.conf.json` exist.
pub fn prepare(app: &AppHandle) -> Result<(), ShellError> {
    native::float_on_all_spaces(&window(app, PANEL)?)?;
    Ok(())
}

pub fn show_panel(app: &AppHandle, focus: bool) -> Result<(), ShellError> {
    let panel = window(app, PANEL)?;
    if panel.is_visible()? {
        if focus {
            panel.set_focus()?;
        }
        return Ok(());
    }
    anchor_panel(app, &panel);
    {
        // Before showing: the focus events of this show may be handled on the main thread
        // before this function returns.
        let state = app.state::<PanelState>();
        let mut flags = lock(&state.flags);
        flags.shown_at = Some(Instant::now());
        flags.hidden_by_blur_at = None;
    }
    if focus {
        panel.show()?;
        panel.set_focus()?;
    } else {
        native::show_without_focus(&panel, true)?;
    }
    #[cfg(debug_assertions)]
    crate::debug::trace(|| format!("panel shown (focus {focus})"));
    app.emit(PANEL_SHOWN_EVENT, PanelShown { focused: focus })?;
    Ok(())
}

/// The panel lost focus: hide it, unless the focus never really arrived (see
/// [`BLUR_GRACE_AFTER_SHOW`]).
fn panel_blurred(app: &AppHandle) -> Result<(), ShellError> {
    let just_shown = lock(&app.state::<PanelState>().flags)
        .shown_at
        .is_some_and(|at| at.elapsed() < BLUR_GRACE_AFTER_SHOW);
    if just_shown {
        #[cfg(debug_assertions)]
        crate::debug::trace(|| "panel blur right after showing: kept open".to_string());
        return Ok(());
    }
    hide_panel_because(app, HideReason::Blur)
}

pub fn hide_panel(app: &AppHandle) -> Result<(), ShellError> {
    hide_panel_because(app, HideReason::Request)
}

pub fn toggle_panel(app: &AppHandle) -> Result<(), ShellError> {
    if window(app, PANEL)?.is_visible()? { hide_panel(app) } else { show_panel(app, true) }
}

fn hide_panel_because(app: &AppHandle, reason: HideReason) -> Result<(), ShellError> {
    let panel = window(app, PANEL)?;
    if !panel.is_visible()? {
        return Ok(());
    }
    panel.hide()?;
    #[cfg(debug_assertions)]
    crate::debug::trace(|| format!("panel hidden ({reason:?})"));
    if reason == HideReason::Blur {
        lock(&app.state::<PanelState>().flags).hidden_by_blur_at = Some(Instant::now());
    }
    app.emit(PANEL_HIDDEN_EVENT, PanelHidden { reason })?;
    Ok(())
}

/// Left click on the tray icon (button released).
pub fn tray_clicked(app: &AppHandle) {
    #[cfg(debug_assertions)]
    crate::debug::trace(|| "tray clicked".to_string());
    {
        let state = app.state::<PanelState>();
        let mut flags = lock(&state.flags);
        #[cfg(windows)]
        if flags.double_click_at.take().is_some_and(|at| at.elapsed() < CLICK_AFTER_DOUBLE_CLICK) {
            return;
        }
        if flags.hidden_by_blur_at.take().is_some_and(|at| at.elapsed() < CLICK_AFTER_BLUR) {
            return;
        }
    }
    if let Err(error) = toggle_panel(app) {
        tracing::warn!(%error, "tray click could not toggle the panel");
    }
}

/// Windows convention: double-clicking a tray icon opens the app's main window.
#[cfg(windows)]
pub fn tray_double_clicked(app: &AppHandle) {
    lock(&app.state::<PanelState>().flags).double_click_at = Some(Instant::now());
    show_main_or_log(app, None);
}

/// Shows and focuses the main window, like 1.x's `showOverview()`, which first dismissed the
/// menu panel.
pub fn show_main(app: &AppHandle, page: Option<&str>) -> Result<(), ShellError> {
    #[cfg(debug_assertions)]
    crate::debug::trace(|| format!("show main (page {page:?})"));
    hide_panel(app)?;
    let main = window(app, MAIN)?;
    if main.is_minimized()? {
        main.unminimize()?;
    }
    main.show()?;
    main.set_focus()?;
    if let Some(page) = page {
        app.emit_to(MAIN, NAVIGATE_EVENT, page)?;
    }
    Ok(())
}

pub fn show_main_or_log(app: &AppHandle, page: Option<&str>) {
    if let Err(error) = show_main(app, page) {
        tracing::warn!(%error, "could not show the main window");
    }
}

pub fn validate_page(page: &str) -> Result<String, ShellError> {
    let valid = (1..=64).contains(&page.len())
        && page.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'/'));
    if valid {
        Ok(page.to_string())
    } else {
        Err(ShellError::Invalid(format!(
            "“{page}” is not a page id. Use 1–64 letters, digits, '-', '_' or '/'."
        )))
    }
}

pub fn set_mini_timer(app: &AppHandle, enabled: bool) -> Result<(), ShellError> {
    match (enabled, app.get_webview_window(MINI)) {
        (true, Some(mini)) => {
            if !mini.is_visible()? {
                native::show_without_focus(&mini, false)?;
            }
        }
        (true, None) => {
            // Not focusable: clicking the timer never takes focus from the app being worked in.
            let mini = WebviewWindowBuilder::new(app, MINI, WebviewUrl::App("index.html".into()))
                .title("Azure timetracker")
                .inner_size(MINI_SIZE.0, MINI_SIZE.1)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .shadow(true)
                .visible_on_all_workspaces(true)
                .accept_first_mouse(true)
                .focusable(false)
                .focused(false)
                .visible(false)
                .build()?;
            native::float_on_all_spaces(&mini)?;
            place_mini(app, &mini)?;
            native::show_without_focus(&mini, false)?;
        }
        (false, Some(mini)) => mini.destroy()?,
        (false, None) => {}
    }
    Ok(())
}

/// Window events of all three surfaces.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let app = window.app_handle();
    #[cfg(debug_assertions)]
    if let WindowEvent::Focused(focused) = event {
        crate::debug::trace(|| format!("{} focused: {focused}", window.label()));
    }
    match (window.label(), event) {
        (MAIN, WindowEvent::CloseRequested { api, .. }) => {
            // Closing the overview returns to tray-only operation, as in 1.x.
            api.prevent_close();
            if let Err(error) = window.hide() {
                tracing::warn!(%error, "could not hide the main window");
            }
            // The plugin saves on exit only; saving now also covers a forced quit.
            if let Err(error) = app.save_window_state(StateFlags::SIZE | StateFlags::POSITION) {
                tracing::warn!(%error, "could not save the main window frame");
            }
        }
        (PANEL, WindowEvent::CloseRequested { api, .. }) => {
            api.prevent_close();
            log_hide(hide_panel(app));
        }
        (PANEL, WindowEvent::Focused(false)) => log_hide(panel_blurred(app)),
        (MINI, WindowEvent::CloseRequested { .. }) => {
            if let Err(error) = app.emit(MINI_CLOSED_EVENT, ()) {
                tracing::warn!(%error, "could not report the closed mini timer");
            }
        }
        _ => {}
    }
}

fn log_hide(result: Result<(), ShellError>) {
    if let Err(error) = result {
        tracing::warn!(%error, "could not hide the panel");
    }
}

fn window(app: &AppHandle, label: &'static str) -> Result<WebviewWindow, ShellError> {
    app.get_webview_window(label).ok_or(ShellError::MissingWindow(label))
}

/// Puts the hidden panel next to the tray icon.
///
/// The positioner plugin anchors to the tray position it last saw. It is refreshed from the live
/// tray rectangle first, because pointer events over the icon are its only other source and the
/// shortcut can open the panel before the pointer ever touched the icon. Its result moves the
/// panel onto the tray's monitor, so the size read afterwards is in that monitor's scale. The
/// final position is then computed here: positioner aligns the panel with the top of the menu
/// bar on macOS and clamps to the whole monitor rather than the work area (taskbar, Dock).
fn anchor_panel(app: &AppHandle, panel: &WebviewWindow) {
    let tray_rect = tray::current_rect(app);
    let anchored = tray_rect.is_some() && panel.move_window(TRAY_ANCHOR).is_ok();
    if let Err(error) = place_panel(app, panel, tray_rect, anchored) {
        tracing::warn!(%error, "could not position the panel");
    }
}

fn place_panel(
    app: &AppHandle,
    panel: &WebviewWindow,
    tray_rect: Option<PxRect>,
    anchored: bool,
) -> Result<(), ShellError> {
    let monitor = match if anchored { panel.current_monitor()? } else { None } {
        Some(monitor) => Some(monitor),
        None => target_monitor(app, tray_rect)?,
    };
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let work = work_area(&monitor);
    let size = panel.outer_size()?;
    let panel_size = (f64::from(size.width), f64::from(size.height));
    let (x, y) = match tray_rect {
        Some(tray) => anchored_origin(
            tray,
            panel_size,
            work,
            PANEL_GAP * scale,
            PANEL_MARGIN * scale,
            TRAY_AT_TOP,
        ),
        None => corner_origin(panel_size, work, PANEL_GAP * scale, TRAY_AT_TOP),
    };
    panel.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))?;
    Ok(())
}

fn target_monitor(
    app: &AppHandle,
    tray_rect: Option<PxRect>,
) -> Result<Option<Monitor>, ShellError> {
    if let Some(tray) = tray_rect
        && let Some(monitor) =
            app.monitor_from_point(tray.x + tray.w / 2.0, tray.y + tray.h / 2.0)?
    {
        return Ok(Some(monitor));
    }
    Ok(app.primary_monitor()?)
}

/// The mini timer starts in the bottom-right corner of the primary work area (above the
/// taskbar on Windows, above the Dock on macOS). Its position is not remembered.
fn place_mini(app: &AppHandle, mini: &WebviewWindow) -> Result<(), ShellError> {
    let Some(monitor) = app.primary_monitor()? else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let work = work_area(&monitor);
    let size = (MINI_SIZE.0 * scale, MINI_SIZE.1 * scale);
    let (x, y) = corner_origin(size, work, MINI_MARGIN * scale, false);
    mini.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))?;
    Ok(())
}

fn work_area(monitor: &Monitor) -> PxRect {
    let area = monitor.work_area();
    PxRect {
        x: f64::from(area.position.x),
        y: f64::from(area.position.y),
        w: f64::from(area.size.width),
        h: f64::from(area.size.height),
    }
}

/// Top-left corner for a window of `size` next to the tray icon `tray`: centred on the icon,
/// `gap` below it when `below` (macOS menu bar) or above it otherwise (Windows taskbar), on the
/// other side when the preferred side has no room, and kept inside `work`: `margin` from the
/// left and right edges and `gap` from the top and bottom edges. All values in physical pixels.
pub(crate) fn anchored_origin(
    tray: PxRect,
    size: (f64, f64),
    work: PxRect,
    gap: f64,
    margin: f64,
    below: bool,
) -> (f64, f64) {
    let (width, height) = size;
    let x = tray.x + tray.w / 2.0 - width / 2.0;
    let under = tray.y + tray.h + gap;
    let over = tray.y - gap - height;
    let fits_under = under + height <= work.y + work.h;
    let fits_over = over >= work.y;
    let y = if below {
        if fits_under || !fits_over { under } else { over }
    } else if fits_over || !fits_under {
        over
    } else {
        under
    };
    (
        clamp(x, work.x + margin, work.x + work.w - margin - width),
        clamp(y, work.y + gap, work.y + work.h - gap - height),
    )
}

/// Top-left corner for a window of `size` in the right-hand corner of `work`, at the top or the
/// bottom, `margin` from both edges.
pub(crate) fn corner_origin(size: (f64, f64), work: PxRect, margin: f64, top: bool) -> (f64, f64) {
    let (width, height) = size;
    let x = work.x + work.w - margin - width;
    let y = if top { work.y + margin } else { work.y + work.h - margin - height };
    (clamp(x, work.x, work.x + work.w - width), clamp(y, work.y, work.y + work.h - height))
}

/// Like `f64::clamp`, but a window larger than the area sticks to the start edge instead of
/// panicking.
fn clamp(value: f64, low: f64, high: f64) -> f64 {
    if high < low { low } else { value.clamp(low, high) }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1512×982 pt MacBook screen at 2x with a 37 pt menu bar.
    const MAC_WORK: PxRect = PxRect { x: 0.0, y: 74.0, w: 3024.0, h: 1890.0 };
    /// A 1920×1080 screen at 100 % with a 48 px taskbar at the bottom.
    const WIN_WORK: PxRect = PxRect { x: 0.0, y: 0.0, w: 1920.0, h: 1032.0 };

    #[test]
    fn panel_hangs_centred_under_a_menu_bar_icon() {
        let tray = PxRect { x: 2400.0, y: 0.0, w: 120.0, h: 74.0 };
        let (x, y) = anchored_origin(tray, (840.0, 1280.0), MAC_WORK, 12.0, 16.0, true);
        assert_eq!((x, y), (2460.0 - 420.0, 86.0));
    }

    #[test]
    fn panel_stays_inside_the_right_edge() {
        let tray = PxRect { x: 2950.0, y: 0.0, w: 60.0, h: 74.0 };
        let (x, _) = anchored_origin(tray, (840.0, 1280.0), MAC_WORK, 12.0, 16.0, true);
        assert_eq!(x, 3024.0 - 16.0 - 840.0);
    }

    #[test]
    fn panel_sits_above_the_taskbar_on_windows() {
        // The notification-area icon lies inside the taskbar, below the work area.
        let tray = PxRect { x: 1500.0, y: 1040.0, w: 24.0, h: 32.0 };
        let (x, y) = anchored_origin(tray, (420.0, 640.0), WIN_WORK, 12.0, 8.0, false);
        assert_eq!(y, 1032.0 - 12.0 - 640.0, "bottom edge is the gap above the taskbar");
        assert_eq!(x, 1512.0 - 210.0);
    }

    #[test]
    fn panel_flips_below_a_top_taskbar() {
        let work = PxRect { x: 0.0, y: 48.0, w: 1920.0, h: 1032.0 };
        let tray = PxRect { x: 1700.0, y: 8.0, w: 24.0, h: 32.0 };
        let (_, y) = anchored_origin(tray, (420.0, 640.0), work, 12.0, 8.0, false);
        assert_eq!(y, 48.0 + 12.0);
    }

    #[test]
    fn panel_moves_beside_a_vertical_taskbar() {
        // Taskbar on the right: the icon is right of the work area.
        let work = PxRect { x: 0.0, y: 0.0, w: 1872.0, h: 1080.0 };
        let tray = PxRect { x: 1880.0, y: 1000.0, w: 32.0, h: 24.0 };
        let (x, y) = anchored_origin(tray, (420.0, 640.0), work, 12.0, 8.0, false);
        assert_eq!(x, 1872.0 - 8.0 - 420.0);
        assert_eq!(y, 1000.0 - 12.0 - 640.0);
    }

    #[test]
    fn oversized_panel_sticks_to_the_top_left_of_the_work_area() {
        let work = PxRect { x: 0.0, y: 25.0, w: 400.0, h: 500.0 };
        let tray = PxRect { x: 300.0, y: 0.0, w: 20.0, h: 25.0 };
        let (x, y) = anchored_origin(tray, (420.0, 640.0), work, 6.0, 8.0, true);
        assert_eq!((x, y), (8.0, 31.0));
    }

    #[test]
    fn corner_origin_uses_the_margin_from_both_edges() {
        assert_eq!(corner_origin((260.0, 72.0), WIN_WORK, 16.0, false), (1644.0, 944.0));
        assert_eq!(corner_origin((840.0, 1280.0), MAC_WORK, 12.0, true), (2172.0, 86.0));
    }

    #[test]
    fn page_ids_are_short_slugs() {
        for page in ["settings", "day-review", "statistics/time", "timeEditor", "offline_drafts"] {
            assert!(validate_page(page).is_ok(), "{page}");
        }
        for page in ["", "Day review", "../settings?x=1", &"a".repeat(65)] {
            assert!(validate_page(page).is_err(), "{page}");
        }
    }
}
