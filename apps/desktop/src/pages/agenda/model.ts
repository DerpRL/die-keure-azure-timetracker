import { getLocalTimeZone, parseDate, today, type CalendarDate } from '@internationalized/date';
import type { AgendaEventView } from '../../ipc/contract';

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** "09:30" in the local time zone. */
export function formatTime(instant: string): string {
  const time = Date.parse(instant);
  return Number.isNaN(time) ? '' : TIME.format(time);
}

/** "All day" or "09:30 – 10:30" (1.14 `EventRow`). */
export function eventTimeText(event: AgendaEventView): string {
  return event.allDay ? 'All day' : `${formatTime(event.start)} – ${formatTime(event.end)}`;
}

/** The agenda day as a calendar date, `null` when the engine sent something unreadable. */
export function parseDay(day: string): CalendarDate | null {
  try {
    return parseDate(day);
  } catch {
    return null;
  }
}

/** "Tuesday, 6 October 2026". */
export function formatDay(day: CalendarDate): string {
  return DAY.format(day.toDate(getLocalTimeZone()));
}

export function todayDate(): CalendarDate {
  return today(getLocalTimeZone());
}

/** A calendar colour from the engine (`#rrggbb`), or `null` when it is not a plain hex colour. */
export function safeColor(color: string | null | undefined): string | null {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}
