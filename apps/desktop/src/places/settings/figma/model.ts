import type { FigmaSlice } from '../../../ipc/contract';
import { dateFormat, t } from '../../../i18n';

const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
const TIME: Intl.DateTimeFormatOptions = { timeStyle: 'short' };
/** The engine keeps this form English so it can be matched here; it is translated on display. */
const WAITING = 'Waiting for Figma · ';
const SEEN = 'Seen: ';

/** The engine's English text after "Waiting for Figma · ", in the interface language. */
function waitingDetail(rest: string): string {
  if (rest.startsWith(SEEN)) return t('Seen: {name}', { name: rest.slice(SEEN.length) });
  return rest === 'No file address found' ? t('No file address found') : rest;
}

/** The engine's `label`, with its English "Waiting for Figma · …" form translated. */
export function figmaLabel(figma: FigmaSlice): string {
  if (!figma.label.startsWith(WAITING)) return figma.label;
  return `${t('Waiting for Figma')} · ${waitingDetail(figma.label.slice(WAITING.length))}`;
}

/**
 * The observation line: the engine's `label` (1.14 `FigmaService.status`), with the time Figma
 * was last in front after "Waiting for Figma" ("Waiting for Figma · 10:02 · Seen: …").
 */
export function observationText(figma: FigmaSlice): string {
  const time = figma.lastForegroundAt ? Date.parse(figma.lastForegroundAt) : Number.NaN;
  if (!figma.label.startsWith(WAITING) || Number.isNaN(time)) return figmaLabel(figma);
  return `${t('Waiting for Figma')} · ${dateFormat(TIME).format(time)} · ${waitingDetail(figma.label.slice(WAITING.length))}`;
}

/** "6 Oct 2026, 09:52" in the local time zone. */
export function formatSeen(instant: string | null | undefined): string | null {
  if (!instant) return null;
  const time = Date.parse(instant);
  return Number.isNaN(time) ? null : dateFormat(DATE_TIME).format(time);
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
