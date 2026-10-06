/**
 * Calls into the desktop shell and Tauri plugins, wrapped so tests can mock them (`vi.mock`) and
 * the browser preview, which has no shell, never shows an unhandled rejection.
 */
import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauri } from '../../ipc';
import { hidePanel, quit, showMain, togglePanel } from '../../ipc/shell';
import type { PageId } from '../../layout/navigation';

function settle(promise: Promise<unknown>, what: string): void {
  promise.catch((error: unknown) => {
    // Outside Tauri the mock IPC has no shell; inside Tauri a failure is worth a log line only.
    if (isTauri()) console.warn(`Could not ${what}`, error);
  });
}

/** Only https and Figma links leave the app. */
export function isAllowedExternalUrl(url: string): boolean {
  return /^https:\/\//i.test(url) || /^figma:\/\//i.test(url);
}

/** Opens `url` in the default browser (or Figma). Other schemes are ignored. */
export function openExternal(url: string): void {
  if (!isAllowedExternalUrl(url)) return;
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  settle(openUrl(url), 'open the link');
}

/** Shows the main window on `page` (hides the panel). */
export function openMainPage(page?: PageId): void {
  settle(showMain(page), 'show the main window');
}

export function closePanel(): void {
  settle(hidePanel(), 'hide the panel');
}

export function togglePanelWindow(): void {
  settle(togglePanel(), 'toggle the panel');
}

/** Quits the app; the 7pace timer keeps running. */
export function quitApp(): void {
  settle(quit(), 'quit');
}
