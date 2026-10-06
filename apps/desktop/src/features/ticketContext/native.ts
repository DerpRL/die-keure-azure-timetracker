/**
 * Native file dialogs, the clipboard and external links for the worklog pages and the ticket
 * context sheet. Each call goes to its Tauri plugin first (tests mock the plugin modules with
 * `vi.mock`); outside the Tauri web view (browser preview) the plugin call fails and a browser
 * fallback is used instead. The engine writes exported files: the UI only asks for the path.
 */
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { save, type DialogFilter } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauri } from '../../ipc';

export interface SavePathOptions {
  /** Suggested file name, e.g. "azure-time-history.csv". */
  defaultPath: string;
  filters?: DialogFilter[];
  title?: string;
}

/**
 * Asks where to save a file. Resolves with the chosen path, or `null` when the user cancelled
 * (or outside the desktop app, where there is no native dialog).
 */
export async function chooseSavePath({ defaultPath, filters, title }: SavePathOptions): Promise<string | null> {
  try {
    return await save({ defaultPath, filters, title });
  } catch (error) {
    if (isTauri()) throw error;
    console.info('No native save dialog outside the desktop app.', error);
    return null;
  }
}

/** Copies plain text to the system clipboard. */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch (error) {
    if (isTauri() || typeof navigator === 'undefined' || !navigator.clipboard) throw error;
    await navigator.clipboard.writeText(text);
  }
}

/** Only these schemes may be opened (the opener capability allows https and figma URLs). */
export function isOpenableUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'figma:';
  } catch {
    return false;
  }
}

/** Opens an https (or figma) URL in the default browser or app. Other schemes are refused. */
export async function openExternalUrl(url: string): Promise<void> {
  if (!isOpenableUrl(url)) throw new Error('Only https links can be opened.');
  try {
    await openUrl(url);
  } catch (error) {
    if (isTauri() || typeof window === 'undefined') throw error;
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
