/**
 * Typed calls into the shell's updater (`apps/desktop/src-tauri/src/updates.rs`). The shell owns
 * the Tauri updater: it checks automatically while `automaticUpdateChecks` is on, and downloads
 * and installs only when the user asks (`installUpdate`). Every change arrives as
 * `shell://update` with the full status.
 */
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke, isTauri, listen, type Unlisten } from '../../ipc';

/** The 1.14 update phases (`AppUpdatePhase`). */
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'failed';

/** `UpdateStatus` in updates.rs (camelCase JSON). */
export interface UpdateStatus {
  phase: UpdatePhase;
  /** The installed version. */
  currentVersion: string;
  /** The offered version, while one is known. */
  version: string | null;
  notes: string | null;
  /** Publication date of the offered version (RFC 3339). */
  date: string | null;
  downloaded: number;
  /** Download size, when the server sends it. */
  total: number | null;
  /** One line for the current phase, shown verbatim. */
  message: string;
  /** A failed check or download, or why the restart was refused; shown verbatim. */
  error: string | null;
  /** When the last check finished (RFC 3339). */
  checkedAt: string | null;
  /** `Configuration.automaticUpdateChecks`. */
  automatic: boolean;
  /** False in development builds and preview mode. */
  enabled: boolean;
}

export const UPDATE_EVENT = 'shell://update';

/** Where the installers live (1.14 `UpdateTrust.downloadsURL`). */
export const DOWNLOADS_URL = 'https://github.com/DerpRL/die-keure-azure-timetracker/tree/main/releases/latest';

export const DISABLED_MESSAGE = 'Updates are disabled in preview and development builds.';

/** What the browser preview and the gallery show: there is no updater outside the app. */
export function previewUpdateStatus(): UpdateStatus {
  return {
    phase: 'idle',
    currentVersion: '',
    version: null,
    notes: null,
    date: null,
    downloaded: 0,
    total: null,
    message: DISABLED_MESSAGE,
    error: null,
    checkedAt: null,
    automatic: true,
    enabled: false,
  };
}

/** `shell_update_status`. Outside the app (browser preview) this is the disabled preview status. */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  try {
    return await invoke<UpdateStatus>('shell_update_status');
  } catch (error) {
    if (!isTauri()) return previewUpdateStatus();
    throw error;
  }
}

/** `shell_update_check`: checks now and resolves with the resulting status. */
export function checkForUpdates(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>('shell_update_check');
}

/**
 * `shell_update_install`: downloads the offered update with progress if needed, asks the engine
 * to prepare for the restart, installs and restarts. Resolves as soon as the step started.
 */
export function installUpdate(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>('shell_update_install');
}

/** Every status change (`shell://update`). */
export function onUpdateStatus(handler: (status: UpdateStatus) => void): Promise<Unlisten> {
  return listen<UpdateStatus>(UPDATE_EVENT, handler);
}

/** Opens the installers page in the browser. */
export function openDownloadsPage(): Promise<void> {
  return openUrl(DOWNLOADS_URL);
}
