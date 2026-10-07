/**
 * The Tauri plugins and shell calls Settings uses, wrapped so tests can `vi.mock` this module
 * and the browser preview degrades gracefully (outside Tauri the plugins are unavailable).
 */
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauri } from '../../ipc';
import { getShortcut, type ShortcutStatus } from '../../ipc/shell';

/** Launch at login through `@tauri-apps/plugin-autostart`; `null` when not available here. */
export async function readLaunchAtLogin(): Promise<boolean | null> {
  if (!isTauri()) return null;
  return isEnabled();
}

/** Turns launch at login on or off and returns the state the OS reports afterwards. */
export async function writeLaunchAtLogin(enabled: boolean): Promise<boolean> {
  if (!isTauri()) throw new Error('Launch at login is available in the desktop app only.');
  if (enabled) await enable();
  else await disable();
  return isEnabled();
}

/** Opens an https link in the default browser. Other schemes are refused. */
export async function openExternalLink(url: string): Promise<void> {
  if (!url.startsWith('https://')) throw new Error('Only https links can be opened.');
  if (isTauri()) {
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Lets the user pick work applications: `.app` bundles in /Applications on macOS (1.14
 * `NSOpenPanel`), executables on Windows. Returns the chosen paths for `settings.resolveWorkApp`.
 */
export async function chooseApplications(os: 'macos' | 'windows'): Promise<string[]> {
  if (!isTauri()) return [];
  const selection = await open({
    title: 'Add work applications',
    multiple: true,
    directory: false,
    defaultPath: os === 'macos' ? '/Applications' : undefined,
    filters: [{ name: 'Applications', extensions: [os === 'macos' ? 'app' : 'exe'] }],
  });
  if (selection === null) return [];
  return Array.isArray(selection) ? selection : [selection];
}

/** Copies text with `@tauri-apps/plugin-clipboard-manager` (the browser clipboard outside Tauri). */
export async function copyText(text: string): Promise<void> {
  if (isTauri()) {
    await writeText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

/** The defaults the shell uses when it cannot be asked (browser preview). */
export function fallbackShortcut(os: 'macos' | 'windows'): ShortcutStatus {
  return os === 'windows'
    ? {
        accelerator: 'Control+Alt+Shift+T',
        label: 'Ctrl+Alt+Shift+T',
        defaultAccelerator: 'Control+Alt+Shift+T',
        defaultLabel: 'Ctrl+Alt+Shift+T',
        issue: null,
      }
    : { accelerator: 'Control+Alt+T', label: '⌃⌥T', defaultAccelerator: 'Control+Alt+T', defaultLabel: '⌃⌥T', issue: null };
}

/** The registered quick-switch shortcut (label and registration problem) from the shell. */
export async function readShortcut(os: 'macos' | 'windows'): Promise<ShortcutStatus> {
  if (!isTauri()) return fallbackShortcut(os);
  return getShortcut();
}
