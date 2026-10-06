//! Figma Desktop window observer through UI Automation (experimental on Windows).
//!
//! Title first: the window title is always read. The document URL is best effort: Figma Desktop
//! is an Electron app whose web documents expose their address as the ValuePattern value of a
//! Document element a few levels below the window. The search is bounded like the macOS reader:
//! at most 200 elements, a 120 ms UI Automation transaction timeout per call and 1.8 s overall.
//! Windows has no permission for this, so `has_access` is always true.

use std::time::{Duration, Instant};

use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance};
use windows::Win32::System::Registry::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER};
use windows::Win32::System::Variant::{VARIANT, VT_BSTR};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, CUIAutomation8, IUIAutomation, IUIAutomation2, IUIAutomationCacheRequest,
    IUIAutomationCondition, IUIAutomationElement, TreeScope_Children, UIA_IsOffscreenPropertyId,
    UIA_NamePropertyId, UIA_ValueValuePropertyId,
};
use windows::core::Interface;

use super::apps;
use super::com::ComScope;
use super::registry::key_exists;
use crate::windows_parse::{FIGMA_EXE, UiElement, exe_name, figma_window_title, find_figma_url};
use crate::{FigmaObserver, WindowObservation};

const MAX_ELEMENTS: usize = 200;
/// Per-call deadline (UI Automation transaction timeout), as on macOS.
const CALL_TIMEOUT_MS: u32 = 120;
/// First contact with Figma's provider; Chromium builds its accessibility tree on demand.
const CONNECTION_TIMEOUT_MS: u32 = 500;
const OVERALL_TIMEOUT: Duration = Duration::from_millis(1_800);

/// Reads the foreground Figma Desktop window.
#[derive(Debug, Default)]
pub struct WindowsFigma {
    _private: (),
}

impl WindowsFigma {
    pub fn new() -> Self {
        Self::default()
    }
}

impl FigmaObserver for WindowsFigma {
    fn has_access(&self) -> bool {
        true
    }

    fn request_access(&self) -> bool {
        true
    }

    fn observe(&self) -> WindowObservation {
        let Some(window) = apps::foreground_window() else {
            return WindowObservation::NotForeground;
        };
        if !is_figma_window(window) {
            return WindowObservation::NotForeground;
        }
        let read = read_window(window, Instant::now() + OVERALL_TIMEOUT);
        // Discard a stale result if focus changed while the tree was being read.
        match apps::foreground_window() {
            Some(current) if current == window => {}
            Some(current) if is_figma_window(current) => return WindowObservation::Waiting,
            _ => return WindowObservation::NotForeground,
        }
        let title = |raw: Option<String>| {
            raw.or_else(|| apps::window_text(window)).and_then(|text| figma_window_title(&text))
        };
        match read {
            Ok(found) => WindowObservation::Window { title: title(found.title), url: found.url },
            Err(error) => {
                tracing::debug!(%error, "Figma window could not be read with UI Automation");
                // Title first: the window text alone still identifies the file by name.
                match apps::window_text(window) {
                    Some(text) => {
                        WindowObservation::Window { title: figma_window_title(&text), url: None }
                    }
                    None => WindowObservation::Waiting,
                }
            }
        }
    }

    /// The per-user installer puts Figma in `%LOCALAPPDATA%\Figma`; machine-wide installs are
    /// found through the `figma:` URL protocol.
    fn figma_installed(&self) -> bool {
        let per_user = dirs::data_local_dir()
            .is_some_and(|local| local.join("Figma").join("Figma.exe").is_file());
        per_user
            || key_exists(HKEY_CURRENT_USER, r"Software\Classes\figma")
            || key_exists(HKEY_CLASSES_ROOT, "figma")
    }
}

fn is_figma_window(window: HWND) -> bool {
    apps::window_process_id(window)
        .and_then(apps::process_path)
        .and_then(|path| exe_name(&path))
        .is_some_and(|name| name == FIGMA_EXE)
}

struct FigmaWindow {
    title: Option<String>,
    url: Option<String>,
}

fn read_window(window: HWND, deadline: Instant) -> windows::core::Result<FigmaWindow> {
    let _com = ComScope::enter()?;
    // All COM objects live inside this call and are released before `_com` leaves COM.
    read_with_automation(window, deadline)
}

fn read_with_automation(window: HWND, deadline: Instant) -> windows::core::Result<FigmaWindow> {
    let automation = automation()?;
    // SAFETY: COM is initialised on this thread; the interfaces are released on return.
    let (cache, condition, root) = unsafe {
        let cache = automation.CreateCacheRequest()?;
        cache.AddProperty(UIA_NamePropertyId)?;
        cache.AddProperty(UIA_ValueValuePropertyId)?;
        cache.AddProperty(UIA_IsOffscreenPropertyId)?;
        let condition = automation.CreateTrueCondition()?;
        let root = automation.ElementFromHandleBuildCache(window, &cache)?;
        (cache, condition, root)
    };
    let root = cached(root);
    let title = root.name.clone();
    let url = find_figma_url(
        root,
        MAX_ELEMENTS,
        |element| children(element, &condition, &cache),
        || Instant::now() >= deadline,
    );
    Ok(FigmaWindow { title, url })
}

/// `CUIAutomation8` (Windows 8+) also implements `IUIAutomation2`, whose timeouts bound each call.
fn automation() -> windows::core::Result<IUIAutomation> {
    // SAFETY: COM is initialised on this thread by the caller.
    unsafe {
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)
                .or_else(|_| CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER))?;
        if let Ok(timeouts) = automation.cast::<IUIAutomation2>() {
            let _ = timeouts.SetConnectionTimeout(CONNECTION_TIMEOUT_MS);
            let _ = timeouts.SetTransactionTimeout(CALL_TIMEOUT_MS);
        }
        Ok(automation)
    }
}

/// Direct children (raw view) with their cached properties; empty on any error or timeout.
fn children(
    element: &IUIAutomationElement,
    condition: &IUIAutomationCondition,
    cache: &IUIAutomationCacheRequest,
) -> Vec<UiElement<IUIAutomationElement>> {
    // SAFETY: COM is initialised on this thread (the search runs inside `read_window`).
    unsafe {
        let Ok(found) = element.FindAllBuildCache(TreeScope_Children, condition, cache) else {
            return Vec::new();
        };
        let count = found.Length().unwrap_or(0);
        (0..count).filter_map(|index| found.GetElement(index).ok()).map(cached).collect()
    }
}

fn cached(element: IUIAutomationElement) -> UiElement<IUIAutomationElement> {
    // SAFETY: reads properties cached by the request; no cross-process calls.
    let (name, value, offscreen) = unsafe {
        let name = element.CachedName().ok().map(|name| name.to_string());
        let value = element
            .GetCachedPropertyValue(UIA_ValueValuePropertyId)
            .ok()
            .and_then(|value| variant_text(&value));
        let offscreen = element.CachedIsOffscreen().is_ok_and(|offscreen| offscreen.as_bool());
        (name, value, offscreen)
    };
    let non_empty = |text: Option<String>| text.filter(|text| !text.trim().is_empty());
    UiElement { handle: element, name: non_empty(name), value: non_empty(value), offscreen }
}

/// The string in a VARIANT; `None` for other types, including UI Automation's "not supported"
/// sentinel (an IUnknown) for elements without a ValuePattern.
fn variant_text(value: &VARIANT) -> Option<String> {
    if value.vt() != VT_BSTR {
        return None;
    }
    // SAFETY: `vt` is VT_BSTR, so the union holds a BSTR owned by `value`.
    let text = unsafe { &value.Anonymous.Anonymous.Anonymous.bstrVal };
    Some(text.to_string())
}

#[cfg(test)]
mod tests {
    //! Run on Windows: `cargo test -p att-platform`.

    use super::*;

    #[test]
    fn access_needs_no_permission() {
        let figma = WindowsFigma::new();
        assert!(figma.has_access());
        assert!(figma.request_access());
    }

    #[test]
    fn observe_and_install_check_return_quickly() {
        let figma = WindowsFigma::new();
        let started = Instant::now();
        let observation = figma.observe();
        assert!(started.elapsed() < Duration::from_millis(2_500), "{observation:?}");
        println!("{observation:?}, installed: {}", figma.figma_installed());
    }
}
