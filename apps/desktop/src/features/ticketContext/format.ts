/**
 * Presentation helpers shared by the worklog pages (Time editor, Day review, History, Weekly
 * report, Offline drafts) and the ticket context sheet. English only, en-GB order and the 24-hour
 * clock, as the rest of the app (rewrite plan §8). Nothing here makes a tracking decision: it only
 * turns engine values into text.
 */
import {
  fromDate,
  getLocalTimeZone,
  parseAbsoluteToLocal,
  parseDate,
  toCalendarDate,
  today,
  type CalendarDate,
  type ZonedDateTime,
} from '@internationalized/date';
import type { HostOs, WorkItemsSlice, WorkLog } from '../../ipc/contract';

const LOCALE = 'en-GB';

const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const secondsTimeFormat = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dayLongFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
const dayCompleteFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dayShortFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });

/** An RFC 3339 instant (or a 7pace timestamp without offset, read as local time) as a Date. */
export function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

/** The start of a worklog, `null` when 7pace sent an unreadable date. */
export function logStart(log: WorkLog): Date | null {
  return parseInstant(log.timestamp);
}

/** The end of a worklog (start + length). */
export function logEnd(log: WorkLog): Date | null {
  const start = logStart(log);
  if (!start || !Number.isFinite(log.length)) return null;
  return new Date(start.getTime() + log.length * 1000);
}

/** "09:30". */
export function formatClockTime(date: Date | null, fallback = 'Unknown'): string {
  return date ? timeFormat.format(date) : fallback;
}

/** "09:30:15". */
export function formatClockTimeWithSeconds(date: Date | null, fallback = 'Unknown'): string {
  return date ? secondsTimeFormat.format(date) : fallback;
}

/** "5 Oct 2026, 09:30" (Swift `.abbreviated` date with `.shortened` time). */
export function formatDateTime(date: Date | null, fallback = 'Unknown'): string {
  return date ? dateTimeFormat.format(date) : fallback;
}

/** Same as `formatDateTime` for an RFC 3339 string. */
export function formatInstant(value: string | null | undefined, fallback = 'Unknown'): string {
  return formatDateTime(parseInstant(value), fallback);
}

/** "09:30 – 11:00". */
export function formatTimeRange(start: Date | null, end: Date | null): string {
  return `${formatClockTime(start)} – ${formatClockTime(end)}`;
}

/** A calendar day `YYYY-MM-DD` at local midnight. */
export function dayToDate(day: string): Date {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}

/** The local calendar day `YYYY-MM-DD` of an instant. */
export function localDayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "Monday 5 October" (Swift `.weekday(.wide).day().month(.wide)`). */
export function formatDayLong(day: string | Date): string {
  return dayLongFormat.format(typeof day === 'string' ? dayToDate(day) : day);
}

/** "Monday, 5 October 2026" (Swift `.complete`). */
export function formatDayComplete(day: string | Date): string {
  return dayCompleteFormat.format(typeof day === 'string' ? dayToDate(day) : day);
}

/** "5 Oct 2026". */
export function formatDayShort(day: string | Date): string {
  return dayShortFormat.format(typeof day === 'string' ? dayToDate(day) : day);
}

/** Today's local calendar day for date fields. Read at render time, so it follows midnight on the next render. */
export function localToday(): CalendarDate {
  return today(getLocalTimeZone());
}

/** A `YYYY-MM-DD` day as a date-field value, `null` when it is not a valid day. */
export function toCalendarDay(day: string | null | undefined): CalendarDate | null {
  if (!day) return null;
  try {
    return parseDate(day);
  } catch {
    return null;
  }
}

/** An RFC 3339 instant as a local date-and-time field value. */
export function toZoned(value: string | null | undefined): ZonedDateTime | null {
  if (!value) return null;
  try {
    return parseAbsoluteToLocal(value);
  } catch {
    const parsed = parseInstant(value);
    return parsed ? fromDate(parsed, getLocalTimeZone()) : null;
  }
}

/** The local calendar day of an RFC 3339 instant (e.g. the start of a report week). */
export function instantToDay(value: string | null | undefined): CalendarDate | null {
  const zoned = toZoned(value);
  return zoned ? toCalendarDate(zoned) : null;
}

/** The ticket of a worklog, ignoring the 0 / negative placeholders 7pace sometimes sends. */
export function logTicket(log: { workItemId?: number | null }): number | null {
  const id = log.workItemId;
  return typeof id === 'number' && id > 0 ? id : null;
}

/** `#4821 · Title` (Time editor), "No Azure ticket" without one. */
export function timeEditorTitle(log: WorkLog, items: WorkItemsSlice | undefined): string {
  const ticket = logTicket(log);
  if (ticket === null) return 'No Azure ticket';
  return `#${ticket} · ${items?.[String(ticket)]?.title ?? 'Azure task'}`;
}

/** The History row title: the ticket title, the comment, "Azure ticket #id" or "Unassigned time". */
export function historyTitle(log: WorkLog, items: WorkItemsSlice | undefined): string {
  const ticket = logTicket(log);
  const title = ticket === null ? undefined : items?.[String(ticket)]?.title;
  const comment = log.comment?.trim();
  return title ?? (comment || (ticket === null ? 'Unassigned time' : `Azure ticket #${ticket}`));
}

/** "#4821 · " or an empty string, as a prefix for conflict and draft rows. */
export function ticketPrefix(ticket: number | null | undefined): string {
  return typeof ticket === 'number' && ticket > 0 ? `#${ticket} · ` : '';
}

/** "this Mac" on macOS, "this computer" elsewhere, for the 1.14 "stays on this Mac" texts. */
export function deviceName(os: HostOs | undefined): string {
  return os === 'windows' || os === 'other' ? 'this computer' : 'this Mac';
}

/** Sum of worklog lengths in seconds, skipping invalid ones. */
export function totalLength(logs: readonly WorkLog[]): number {
  return logs.reduce((sum, log) => sum + (Number.isFinite(log.length) && log.length > 0 ? log.length : 0), 0);
}

/** Seconds between two RFC 3339 instants (0 when either is unreadable). */
export function secondsBetween(start: string | null | undefined, end: string | null | undefined): number {
  const a = parseInstant(start);
  const b = parseInstant(end);
  return a && b ? Math.max(0, (b.getTime() - a.getTime()) / 1000) : 0;
}
