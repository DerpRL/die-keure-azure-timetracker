import type { FigmaSlice } from '../../ipc/contract';

/** The observation line (1.14 `FigmaService.status`). */
export function observationText(figma: FigmaSlice, watching: boolean): string {
  if (!figma.preferences.enabled) return 'Disabled';
  if (!watching) return 'Paused';
  const seen = figma.currentFile ? ` · Seen: ${figma.currentFile}` : '';
  switch (figma.status) {
    case 'missingAccess':
      return 'Accessibility permission needed';
    case 'waiting':
    case 'notForeground':
      return `Waiting for Figma${seen}`;
    case 'noAddress':
      return 'Figma is active · no file address found';
    case 'file':
      return figma.currentFile ? `File: ${figma.currentFile}` : 'Figma is active';
    default:
      return figma.status;
  }
}

const DATE_TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** "6 Oct 2026, 09:52" in the local time zone. */
export function formatSeen(instant: string | null | undefined): string | null {
  if (!instant) return null;
  const time = Date.parse(instant);
  return Number.isNaN(time) ? null : DATE_TIME.format(time);
}

/** The local calendar day (`YYYY-MM-DD`) of an instant, for `dayReview.setDay`. */
export function localDay(instant: string): string | null {
  const time = Date.parse(instant);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A ticket number as typed in the link sheet: 1…2,147,483,647 (Int32, as 1.14). */
export function parseTicketNumber(text: string): number | null {
  const trimmed = text.trim().replace(/^#/, '');
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 && value <= 2_147_483_647 ? value : null;
}
