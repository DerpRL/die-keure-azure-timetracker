import type { UpdateStatus } from './api';
import { dateFormat, mark, numberFormat, t, tn } from '../../i18n';

/** File sizes like macOS (`ByteCountFormatter`, decimal units): "9.8 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return tn(bytes, '{count} byte', '{count} bytes');
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${decimals(bytes / 1_000_000, 1)} MB`;
  return `${decimals(bytes / 1_000_000_000, 2)} GB`;
}

/** `value.toFixed(digits)` with the interface's decimal separator ("9.8", Dutch "9,8"). */
function decimals(value: number, digits: number): string {
  return numberFormat({ minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(value);
}

const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
const DATE: Intl.DateTimeFormatOptions = { dateStyle: 'medium' };

/** "6 Oct 2026, 10:00" in the local time zone; `null` for a missing or unreadable instant. */
export function formatDateTime(instant: string | null): string | null {
  if (!instant) return null;
  const time = Date.parse(instant);
  return Number.isNaN(time) ? null : dateFormat(DATE_TIME).format(time);
}

export function formatDate(instant: string | null): string | null {
  if (!instant) return null;
  const time = Date.parse(instant);
  return Number.isNaN(time) ? null : dateFormat(DATE).format(time);
}

/** "every minute", "every 5 minutes", "every hour" for `cadences.updateCheckSeconds`. */
export function everyText(seconds: number): string {
  const value = Math.min(86_400, Math.max(60, Math.round(seconds)));
  if (value % 3600 === 0) return tn(value / 3600, 'every hour', 'every {count} hours');
  if (value % 60 === 0) return tn(value / 60, 'every minute', 'every {count} minutes');
  return tn(value, 'every second', 'every {count} seconds');
}

/** What the update action does in this phase, or `null` when there is nothing to do. */
export type UpdateAction = 'download' | 'restart' | 'retry';

export function updateAction(status: UpdateStatus): UpdateAction | null {
  if (!status.enabled) return null;
  if (status.phase === 'available') return 'download';
  if (status.phase === 'ready') return 'restart';
  if (status.phase === 'failed' && status.version) return 'retry';
  return null;
}

export const ACTION_LABELS: Record<UpdateAction, string> = {
  download: mark('Download and restart'),
  restart: mark('Restart to update'),
  retry: mark('Try again'),
};

/** An update concerns the user (the banner and the panel show it), not just a failed check. */
export function hasUpdate(status: UpdateStatus | undefined): status is UpdateStatus {
  if (!status?.enabled) return false;
  switch (status.phase) {
    case 'available':
    case 'downloading':
    case 'ready':
    case 'installing':
      return true;
    case 'failed':
      return status.version !== null;
    default:
      return false;
  }
}

/** Whether "Check for updates" can run now (1.14: not while busy or once a download is ready). */
export function canCheck(status: UpdateStatus | undefined): boolean {
  if (!status?.enabled) return false;
  return status.phase === 'idle' || status.phase === 'available' || status.phase === 'failed';
}

/** Download progress in percent, `null` while the size is unknown. */
export function downloadPercent(status: UpdateStatus): number | null {
  if (!status.total || status.total <= 0) return null;
  return Math.min(100, Math.floor((status.downloaded / status.total) * 100));
}

/** "3.2 MB of 9.8 MB" or "3.2 MB downloaded". */
export function downloadText(status: UpdateStatus): string {
  return status.total
    ? t('{done} of {total}', { done: formatBytes(status.downloaded), total: formatBytes(status.total) })
    : t('{size} downloaded', { size: formatBytes(status.downloaded) });
}

/** A polite announcement for a phase change, or `null` when the change is not worth one. */
export function phaseAnnouncement(status: UpdateStatus): string | null {
  switch (status.phase) {
    case 'available':
      return status.version ? t('App update available: version {version}.', { version: status.version }) : null;
    case 'downloading':
      return t('Downloading the app update.');
    case 'installing':
      return t('Installing the app update. The app restarts when it is done.');
    case 'ready':
      return status.error ? `${t('Update ready to install.')} ${status.error}` : t('Update downloaded and verified.');
    case 'failed':
      return status.version && status.error ? `${t('Update needs attention.')} ${status.error}` : null;
    default:
      return null;
  }
}
