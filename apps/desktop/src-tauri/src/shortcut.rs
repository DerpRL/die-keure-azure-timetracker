//! The global quick-switch shortcut. Pressing it shows and focuses the panel and emits
//! `shortcut://quick-switch`. 1.x registered ⌃⌥T through Carbon `RegisterEventHotKey`, which
//! needs no Accessibility permission; the global-shortcut plugin uses the same API on macOS and
//! `RegisterHotKey` on Windows.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use serde::Serialize;
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::shell::{QUICK_SWITCH_EVENT, lock, on_main_thread};
use crate::surfaces;

/// ⌃⌥T on macOS, as in 1.x. On Windows Ctrl+Alt is AltGr on many layouts (Belgian AZERTY
/// among them), so Shift is added there.
#[cfg(target_os = "macos")]
pub const DEFAULT_ACCELERATOR: &str = "Control+Alt+T";
#[cfg(not(target_os = "macos"))]
pub const DEFAULT_ACCELERATOR: &str = "Control+Alt+Shift+T";

#[derive(Default)]
pub struct ShortcutSlot {
    /// Id of the registered quick-switch shortcut plus one, read by the key handler without a
    /// lock; 0 when none is registered.
    active: AtomicU32,
    state: Mutex<SlotState>,
}

#[derive(Default)]
struct SlotState {
    current: Option<Accelerator>,
    issue: Option<String>,
}

#[derive(Debug, Clone)]
struct Accelerator {
    text: String,
    shortcut: Shortcut,
}

/// Returned by `shell_get_shortcut`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    /// The registered accelerator as it was given, `None` while the shortcut is off.
    pub accelerator: Option<String>,
    /// How to show it, e.g. "⌃⌥T" on macOS or "Ctrl+Alt+Shift+T" on Windows.
    pub label: Option<String>,
    pub default_accelerator: String,
    pub default_label: String,
    /// Why the last registration failed, e.g. another app owns the default at launch.
    pub issue: Option<String>,
}

pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            let active = app.state::<ShortcutSlot>().active.load(Ordering::Acquire);
            if event.state == ShortcutState::Pressed && active == slot_id(shortcut) {
                quick_switch(app);
            }
        })
        .build()
}

/// Registers the platform default at launch. The engine applies the user's setting afterwards
/// through `shell_set_shortcut`. A failure is kept for `shell_get_shortcut`.
pub fn register_default(app: &AppHandle) {
    let result = parse(DEFAULT_ACCELERATOR).and_then(|default| apply(app, Some(default)));
    if let Err(issue) = result {
        tracing::warn!(%issue, "quick-switch shortcut unavailable at launch");
    }
}

/// Replaces the quick-switch shortcut, or turns it off with `None`. The change runs on the main
/// thread, where the hotkey APIs live anyway (see [`on_main_thread`]).
pub fn set(app: &AppHandle, accelerator: Option<&str>) -> Result<(), String> {
    let next = accelerator.map(parse).transpose()?;
    let handle = app.clone();
    on_main_thread(app, move || apply(&handle, next)).map_err(|error| error.to_string())?
}

pub fn status(app: &AppHandle) -> ShortcutStatus {
    let slot = app.state::<ShortcutSlot>();
    let state = lock(&slot.state);
    let default_label =
        DEFAULT_ACCELERATOR.parse::<Shortcut>().map(|s| label(&s)).unwrap_or_default();
    ShortcutStatus {
        accelerator: state.current.as_ref().map(|current| current.text.clone()),
        label: state.current.as_ref().map(|current| label(&current.shortcut)),
        default_accelerator: DEFAULT_ACCELERATOR.to_string(),
        default_label,
        issue: state.issue.clone(),
    }
}

/// Runs on the main thread.
fn apply(app: &AppHandle, next: Option<Accelerator>) -> Result<(), String> {
    let slot = app.state::<ShortcutSlot>();
    let previous = lock(&slot.state).current.clone();
    let same = previous.as_ref().map(|p| p.shortcut.id()) == next.as_ref().map(|n| n.shortcut.id());
    if same {
        store(&slot, next, None);
        return Ok(());
    }

    let shortcuts = app.global_shortcut();
    if let Some(old) = &previous
        && let Err(error) = shortcuts.unregister(old.shortcut)
    {
        tracing::warn!(%error, "could not unregister the quick-switch shortcut");
    }
    let Some(new) = next else {
        store(&slot, None, None);
        return Ok(());
    };
    match shortcuts.register(new.shortcut) {
        Ok(()) => {
            store(&slot, Some(new), None);
            Ok(())
        }
        Err(error) => {
            tracing::warn!(%error, accelerator = %new.text, "could not register the quick-switch shortcut");
            let issue = unavailable(&new.shortcut);
            // A failed change keeps the previous shortcut working.
            let restored = previous.filter(|old| shortcuts.register(old.shortcut).is_ok());
            store(&slot, restored, Some(issue.clone()));
            Err(issue)
        }
    }
}

fn store(slot: &ShortcutSlot, current: Option<Accelerator>, issue: Option<String>) {
    let mut state = lock(&slot.state);
    slot.active.store(current.as_ref().map_or(0, |c| slot_id(&c.shortcut)), Ordering::Release);
    state.current = current;
    state.issue = issue;
}

fn slot_id(shortcut: &Shortcut) -> u32 {
    shortcut.id().wrapping_add(1)
}

fn quick_switch(app: &AppHandle) {
    if let Err(error) = surfaces::show_panel(app, true) {
        tracing::warn!(%error, "quick switch could not show the panel");
    }
    if let Err(error) = app.emit(QUICK_SWITCH_EVENT, ()) {
        tracing::warn!(%error, "could not emit the quick-switch event");
    }
}

fn parse(text: &str) -> Result<Accelerator, String> {
    let text = text.trim();
    let shortcut: Shortcut = text.parse().map_err(|_| {
        format!("“{text}” is not a valid shortcut. Use modifiers and one key, for example {DEFAULT_ACCELERATOR}.")
    })?;
    // F1–F24 may stand alone; any other key needs a modifier besides Shift.
    let key = shortcut.key.to_string();
    let function_key = key.strip_prefix('F').is_some_and(|number| number.parse::<u8>().is_ok());
    let has_command_modifier =
        shortcut.mods.intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER);
    if !function_key && !has_command_modifier {
        return Err(format!(
            "{} would capture normal typing. Add Control, {} or {}.",
            label(&shortcut),
            if cfg!(target_os = "macos") { "Option" } else { "Alt" },
            if cfg!(target_os = "macos") { "Command" } else { "the Windows key" },
        ));
    }
    Ok(Accelerator { text: text.to_string(), shortcut })
}

/// 1.x: "⌃⌥T is unavailable or already used by another app. Use Switch ticket in the menu bar."
fn unavailable(shortcut: &Shortcut) -> String {
    let place = if cfg!(target_os = "macos") { "in the menu bar" } else { "from the tray icon" };
    format!(
        "{} is unavailable or already used by another app. Use Switch ticket {place}.",
        label(shortcut)
    )
}

/// "⌃⌥⇧⌘T" on macOS (Apple's modifier order), "Ctrl+Alt+Shift+Win+T" elsewhere.
pub fn label(shortcut: &Shortcut) -> String {
    let mods = shortcut.mods;
    let key = key_label(shortcut.key);
    if cfg!(target_os = "macos") {
        let mut text = String::new();
        for (modifier, symbol) in [
            (Modifiers::CONTROL, '⌃'),
            (Modifiers::ALT, '⌥'),
            (Modifiers::SHIFT, '⇧'),
            (Modifiers::SUPER, '⌘'),
        ] {
            if mods.contains(modifier) {
                text.push(symbol);
            }
        }
        text + &key
    } else {
        let mut parts: Vec<&str> = [
            (Modifiers::CONTROL, "Ctrl"),
            (Modifiers::ALT, "Alt"),
            (Modifiers::SHIFT, "Shift"),
            (Modifiers::SUPER, "Win"),
        ]
        .into_iter()
        .filter(|(modifier, _)| mods.contains(*modifier))
        .map(|(_, name)| name)
        .collect();
        parts.push(&key);
        parts.join("+")
    }
}

fn key_label(code: Code) -> String {
    let name = code.to_string();
    name.strip_prefix("Key").or_else(|| name.strip_prefix("Digit")).unwrap_or(&name).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_accelerator_parses() {
        let default = parse(DEFAULT_ACCELERATOR).expect("default parses");
        assert_eq!(default.shortcut.key, Code::KeyT);
        assert!(default.shortcut.mods.contains(Modifiers::CONTROL | Modifiers::ALT));
        if cfg!(target_os = "macos") {
            assert_eq!(label(&default.shortcut), "⌃⌥T");
        } else {
            assert_eq!(label(&default.shortcut), "Ctrl+Alt+Shift+T");
        }
    }

    #[test]
    fn invalid_or_typing_shortcuts_are_rejected() {
        assert!(parse("Control+Alt+").is_err());
        assert!(parse("Banana+T").is_err());
        assert!(parse("Shift+T").is_err(), "Shift alone would capture typing");
        assert!(parse("T").is_err());
        assert!(parse("F8").is_ok(), "function keys may stand alone");
        assert!(parse(" Control+Shift+9 ").is_ok());
    }

    #[test]
    fn labels_follow_the_platform_conventions() {
        let shortcut: Shortcut = "Super+Shift+Control+Alt+Digit1".parse().expect("parses");
        let expected =
            if cfg!(target_os = "macos") { "⌃⌥⇧⌘1" } else { "Ctrl+Alt+Shift+Win+1" };
        assert_eq!(label(&shortcut), expected);
        let message = unavailable(&shortcut);
        assert!(message.starts_with(expected));
        assert!(message.contains("is unavailable or already used by another app"));
    }

    #[test]
    fn slot_ids_are_never_zero() {
        let shortcut: Shortcut = "Backquote".parse().expect("parses");
        assert_ne!(slot_id(&shortcut), 0);
    }
}
