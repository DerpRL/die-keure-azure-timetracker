/**
 * Typed calls into the desktop shell (`apps/desktop/src-tauri/src/shell.rs`): windows, the tray
 * panel, the mini timer, the quick-switch shortcut and quitting. Business actions go through
 * `dispatch` (`engine.ts`) instead.
 */
import { invoke, listen, type Unlisten } from './index';
import type { PageId } from '../layout/navigation';

/** `shell_get_shortcut`. */
export interface ShortcutStatus {
  /** The registered accelerator as given, `null` while the shortcut is off. */
  accelerator: string | null;
  /** How to show it, e.g. "⌃⌥T" on macOS or "Ctrl+Alt+Shift+T" on Windows. */
  label: string | null;
  defaultAccelerator: string;
  defaultLabel: string;
  /** Why the last registration failed, e.g. another app owns the default at launch. */
  issue: string | null;
}

export interface PanelShown {
  /** Whether the panel took keyboard focus. */
  focused: boolean;
}

export interface PanelHidden {
  /** `blur`: the panel lost focus; `request`: a command, a tray click or the main window hid it. */
  reason: 'blur' | 'request';
}

export const NAVIGATE_EVENT = 'shell://navigate';
export const QUICK_SWITCH_EVENT = 'shortcut://quick-switch';
export const PANEL_SHOWN_EVENT = 'shell://panel-shown';
export const PANEL_HIDDEN_EVENT = 'shell://panel-hidden';
export const MINI_CLOSED_EVENT = 'shell://mini-closed';

/** Shows the tray panel; `focus: false` leaves keyboard focus with the frontmost app. */
export function showPanel(focus = true): Promise<void> {
  return invoke('shell_show_panel', { focus });
}

export function hidePanel(): Promise<void> {
  return invoke('shell_hide_panel');
}

export function togglePanel(): Promise<void> {
  return invoke('shell_toggle_panel');
}

/** Shows and focuses the main window (hiding the panel), optionally on `page`. */
export function showMain(page?: PageId): Promise<void> {
  return invoke('shell_show_main', { page: page ?? null });
}

/** Turns the always-on-top mini timer window on or off. */
export function setMiniTimer(enabled: boolean): Promise<void> {
  return invoke('shell_set_mini_timer', { enabled });
}

/** Registers the quick-switch accelerator (`"Control+Alt+T"`), or turns it off with `null`. */
export function setShortcut(accelerator: string | null): Promise<void> {
  return invoke('shell_set_shortcut', { accelerator });
}

export function getShortcut(): Promise<ShortcutStatus> {
  return invoke('shell_get_shortcut');
}

/** Quits the app. The 7pace timer keeps running, as in 1.x. */
export function quit(): Promise<void> {
  return invoke('shell_quit');
}

/** The main window was asked to show `page` (tray menu, prompts, `showMain(page)`). */
export function onNavigate(handler: (page: string) => void): Promise<Unlisten> {
  return listen<string>(NAVIGATE_EVENT, handler);
}

export function onPanelShown(handler: (event: PanelShown) => void): Promise<Unlisten> {
  return listen<PanelShown>(PANEL_SHOWN_EVENT, handler);
}

export function onPanelHidden(handler: (event: PanelHidden) => void): Promise<Unlisten> {
  return listen<PanelHidden>(PANEL_HIDDEN_EVENT, handler);
}

/** The quick-switch shortcut showed and focused the panel. */
export function onQuickSwitch(handler: () => void): Promise<Unlisten> {
  return listen<null>(QUICK_SWITCH_EVENT, () => handler());
}

/** The user closed the mini timer window themselves. */
export function onMiniClosed(handler: () => void): Promise<Unlisten> {
  return listen<null>(MINI_CLOSED_EVENT, () => handler());
}
