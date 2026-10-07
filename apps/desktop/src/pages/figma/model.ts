import type { FigmaSlice } from '../../ipc/contract';

const DATE_TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const TIME = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short' });
const WAITING = 'Waiting for Figma · ';

/**
 * The observation line: the engine's `label` (1.14 `FigmaService.status`), with the time Figma
 * was last in front after "Waiting for Figma" ("Waiting for Figma · 10:02 · Seen: …").
 */
export function observationText(figma: FigmaSlice): string {
  const time = figma.lastForegroundAt ? Date.parse(figma.lastForegroundAt) : Number.NaN;
  if (!figma.label.startsWith(WAITING) || Number.isNaN(time)) return figma.label;
  return `${WAITING}${TIME.format(time)} · ${figma.label.slice(WAITING.length)}`;
}

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
