//! The few AppKit and Win32 calls Tauri does not expose. Everything runs on the main thread.

pub use imp::*;

#[cfg(target_os = "macos")]
mod imp {
    use objc2::MainThreadMarker;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{
        NSAccessibility, NSFont, NSFontWeightMedium, NSStatusBarButton, NSStatusItem, NSWindow,
        NSWindowCollectionBehavior,
    };
    use objc2_foundation::NSString;
    use tauri::WebviewWindow;
    use tauri::tray::TrayIcon;

    /// Shows `window` without activating the app or making the window key, so the frontmost app
    /// (or the main window, when the app is active) keeps keyboard focus. Tauri's `show()` is
    /// `makeKeyAndOrderFront:`.
    pub fn show_without_focus(window: &WebviewWindow, _focusable: bool) -> tauri::Result<()> {
        let target = window.clone();
        window.run_on_main_thread(move || {
            if let Some(ns_window) = ns_window(&target) {
                ns_window.orderFrontRegardless();
            }
        })
    }

    /// Lets a floating window appear on the active Space, including over full-screen apps, as
    /// 1.x's popover did. `visibleOnAllWorkspaces` alone does not cover full-screen Spaces.
    pub fn float_on_all_spaces(window: &WebviewWindow) -> tauri::Result<()> {
        let target = window.clone();
        window.run_on_main_thread(move || {
            if let Some(ns_window) = ns_window(&target) {
                let behavior = ns_window.collectionBehavior()
                    | NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::FullScreenAuxiliary;
                ns_window.setCollectionBehavior(behavior);
            }
        })
    }

    /// 1.x styled the status item with a 12-pt medium font with monospaced digits, so the item
    /// keeps its width as the seconds change. tray-icon sets the title with the default font.
    pub fn style_status_item(tray: &TrayIcon, label: &str, value: &str) -> tauri::Result<()> {
        let (label, value) = (label.to_string(), value.to_string());
        tray.with_inner_tray_icon(move |inner| {
            if let Some(button) = button(inner.ns_status_item()) {
                // SAFETY: reading an AppKit constant.
                let weight = unsafe { NSFontWeightMedium };
                let font = NSFont::monospacedDigitSystemFontOfSize_weight(12.0, weight);
                button.setFont(Some(&font));
                describe(&button, &label, &value);
            }
        })
    }

    /// Accessibility label and value of the status item: the tooltip text and the clock.
    pub fn describe_status_item(tray: &TrayIcon, label: &str, value: &str) -> tauri::Result<()> {
        let (label, value) = (label.to_string(), value.to_string());
        tray.with_inner_tray_icon(move |inner| {
            if let Some(button) = button(inner.ns_status_item()) {
                describe(&button, &label, &value);
            }
        })
    }

    /// `with_inner_tray_icon` runs on the main thread, where the marker is available.
    fn button(item: Option<Retained<NSStatusItem>>) -> Option<Retained<NSStatusBarButton>> {
        let mtm = MainThreadMarker::new()?;
        item?.button(mtm)
    }

    fn describe(button: &NSStatusBarButton, label: &str, value: &str) {
        button.setAccessibilityLabel(Some(&NSString::from_str(label)));
        let value = NSString::from_str(value);
        let value: &AnyObject = &value;
        // SAFETY: an NSString is a valid accessibility value for a button.
        unsafe { button.setAccessibilityValue(Some(value)) };
    }

    fn ns_window(window: &WebviewWindow) -> Option<&NSWindow> {
        let pointer = window.ns_window().ok()?;
        // SAFETY: Tauri returns the live NSWindow of this window, which `window` keeps alive; it
        // is only dereferenced on the main thread, inside `run_on_main_thread`.
        unsafe { pointer.cast::<NSWindow>().as_ref() }
    }

    /// Debug builds: draws the status-item button (clock and title) into a PNG and describes it.
    /// In-process drawing needs no Screen Recording permission, unlike `screencapture`.
    #[cfg(debug_assertions)]
    pub fn snapshot_status_item(
        tray: &TrayIcon,
        path: std::path::PathBuf,
    ) -> tauri::Result<Option<String>> {
        tray.with_inner_tray_icon(move |inner| {
            let button = button(inner.ns_status_item())?;
            let bounds = button.bounds();
            let bitmap = button.bitmapImageRepForCachingDisplayInRect(bounds)?;
            button.cacheDisplayInRect_toBitmapImageRep(bounds, &bitmap);
            snapshot::write_png(&bitmap, &path);
            let font = button.font().map(|font| font.fontName().to_string());
            Some(format!(
                "title {:?}, font {font:?}, size {}x{} pt",
                button.title().to_string(),
                bounds.size.width,
                bounds.size.height
            ))
        })
    }

    /// Debug builds: writes what the window's web view currently shows to a PNG (asynchronously).
    #[cfg(debug_assertions)]
    pub fn snapshot_webview(window: &WebviewWindow, path: std::path::PathBuf) -> tauri::Result<()> {
        window.with_webview(move |webview| snapshot::web_view(webview.inner(), path))
    }

    #[cfg(debug_assertions)]
    mod snapshot {
        use std::path::{Path, PathBuf};

        use block2::RcBlock;
        use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
        use objc2_foundation::{NSDictionary, NSError, NSString};
        use objc2_web_kit::WKWebView;

        pub fn web_view(pointer: *mut std::ffi::c_void, path: PathBuf) {
            // SAFETY: on macOS Tauri's platform web view is the window's live WKWebView; this runs
            // on the main thread inside `with_webview`.
            let Some(web_view) = (unsafe { pointer.cast::<WKWebView>().as_ref() }) else { return };
            let handler = RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
                // SAFETY: WebKit passes a valid image or null.
                let Some(image) = (unsafe { image.as_ref() }) else { return };
                if let Some(tiff) = image.TIFFRepresentation()
                    && let Some(bitmap) = NSBitmapImageRep::imageRepWithData(&tiff)
                {
                    write_png(&bitmap, &path);
                }
            });
            // SAFETY: a nil configuration snapshots the visible bounds; the block outlives the call.
            unsafe { web_view.takeSnapshotWithConfiguration_completionHandler(None, &handler) };
        }

        pub fn write_png(bitmap: &NSBitmapImageRep, path: &Path) {
            let properties = NSDictionary::new();
            // SAFETY: an empty property dictionary is valid for PNG output.
            let data = unsafe {
                bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
            };
            if let Some(data) = data {
                data.writeToFile_atomically(&NSString::from_str(&path.to_string_lossy()), true);
            }
        }
    }
}

#[cfg(windows)]
mod imp {
    use tauri::WebviewWindow;
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

    /// Shows `window` without taking the foreground from the app the user is working in.
    ///
    /// Tauri's `show()` uses `ShowWindow(SW_SHOW)`, which activates the window. While the window
    /// is not focusable (`WS_EX_NOACTIVATE`) the system does not activate it; `focusable` restores
    /// clicking into it afterwards. Should it still have been activated, the previous foreground
    /// window gets the focus back.
    pub fn show_without_focus(window: &WebviewWindow, focusable: bool) -> tauri::Result<()> {
        let target = window.clone();
        window.run_on_main_thread(move || {
            // SAFETY: plain Win32 calls without pointers.
            let previous = unsafe { GetForegroundWindow() };
            let shown = target
                .set_focusable(false)
                .and_then(|()| target.show())
                .and_then(|()| if focusable { target.set_focusable(true) } else { Ok(()) });
            if let Err(error) = shown {
                tracing::warn!(%error, "could not show the window without focus");
            }
            if let Ok(hwnd) = target.hwnd() {
                // SAFETY: as above; `previous` was the foreground window a moment ago.
                unsafe {
                    if !previous.is_invalid() && previous != hwnd && GetForegroundWindow() == hwnd {
                        let _ = SetForegroundWindow(previous);
                    }
                }
            }
        })
    }

    /// Nothing to do: a hidden window appears on the current virtual desktop when it is shown
    /// again, which covers the panel. The mini timer stays on the desktop it was created on.
    pub fn float_on_all_spaces(_window: &WebviewWindow) -> tauri::Result<()> {
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod imp {
    use tauri::WebviewWindow;

    pub fn show_without_focus(window: &WebviewWindow, _focusable: bool) -> tauri::Result<()> {
        window.show()
    }

    pub fn float_on_all_spaces(_window: &WebviewWindow) -> tauri::Result<()> {
        Ok(())
    }
}
