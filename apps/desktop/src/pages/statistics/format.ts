/**
 * Labels for the Statistics page. English only, 24-hour clock, day-month order (en-GB), in the
 * computer's time zone, as 1.14 did. Durations use `DurationText.short` ("3h 20m").
 */
import { CalendarDate } from '@internationalized/date';
import type { ExplorerResolution, Interval, StatisticsPeriod } from '../../ipc/contract';
import { formatShortDuration } from '../../utils/duration';

const LOCALE = 'en-GB';
const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(LOCALE, options);

const fullDate = format({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dayMonth = format({ day: 'numeric', month: 'short' });
const dayMonthYear = format({ day: 'numeric', month: 'short', year: 'numeric' });
const monthYear = format({ month: 'long', year: 'numeric' });
const monthShort = format({ month: 'short' });
const yearOnly = format({ year: 'numeric' });
const weekdayDay = format({ weekday: 'short', day: 'numeric' });
const weekdayDayMonth = format({ weekday: 'short', day: 'numeric', month: 'short' });
const dayMonthTime = format({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayMonthYearTime = format({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const time = format({ hour: '2-digit', minute: '2-digit' });
const timeZone = format({ hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
const longDayTime = format({ weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export const duration = formatShortDuration;

export function percent(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : '0%';
}

export function date(value: string): Date {
  return new Date(value);
}

function ms(value: string): number {
  return Date.parse(value);
}

export function seconds(range: Interval): number {
  return Math.max(0, (ms(range.end) - ms(range.start)) / 1000);
}

/** The local calendar day an instant falls on, as `YYYY-MM-DD`. */
export function localDay(value: string | Date): string {
  const instant = typeof value === 'string' ? new Date(value) : value;
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`;
}

export function calendarDate(value: string | Date): CalendarDate {
  const instant = typeof value === 'string' ? new Date(value) : value;
  return new CalendarDate(instant.getFullYear(), instant.getMonth() + 1, instant.getDate());
}

/** RFC 3339 for the engine, without milliseconds when there are none. */
export function instant(value: Date): string {
  return value.toISOString().replace('.000Z', 'Z');
}

/** The period title above the charts: "Wednesday, 30 September 2026", "28 Sept – 4 Oct 2026". */
export function rangeTitle(period: StatisticsPeriod, range: Interval): string {
  const start = date(range.start);
  // The range end is exclusive; the last second belongs to the period.
  const last = new Date(ms(range.end) - 1000);
  switch (period) {
    case 'day':
      return fullDate.format(start);
    case 'month':
      return monthYear.format(start);
    case 'year':
      return yearOnly.format(start);
    case 'week':
      return `${dayMonth.format(start)} – ${dayMonthYear.format(last)}`;
  }
}

/** "6 Oct, 10:00 – 6 Oct, 14:00" for a zoomed window. */
export function windowTitle(window: Interval): string {
  return `${dayMonthTime.format(date(window.start))} – ${dayMonthTime.format(date(window.end))}`;
}

/** 1.14 `dateRange`: a day, a span of days, or a year. */
export function intervalTitle(range: Interval, includeTime = false): string {
  if (includeTime) return windowTitle(range);
  const start = date(range.start);
  const last = new Date(ms(range.end) - 1000);
  if (seconds(range) > 300 * 86_400) return yearOnly.format(start);
  if (localDay(start) === localDay(last)) return fullDate.format(start);
  return `${dayMonth.format(start)} – ${dayMonthYear.format(last)}`;
}

export function periodNoun(period: StatisticsPeriod): string {
  return period;
}

/** Short axis label of a time-chart bucket. */
export function bucketLabel(start: Date, resolution: ExplorerResolution): string {
  switch (resolution) {
    case 'Monthly':
      return monthShort.format(start);
    case 'Daily':
      return weekdayDay.format(start);
    default:
      return time.format(start);
  }
}

/** Full label of a time-chart bucket (tooltip, screen reader, table). */
export function bucketLongLabel(start: Date, end: Date, resolution: ExplorerResolution): string {
  switch (resolution) {
    case 'Monthly':
      return monthYear.format(start);
    case 'Daily':
      return weekdayDayMonth.format(start);
    default:
      return `${dayMonthTime.format(start)} – ${timeZone.format(end)}`;
  }
}

export function weekdayDayMonthLabel(value: string | Date): string {
  return weekdayDayMonth.format(typeof value === 'string' ? date(value) : value);
}

export function fullDateLabel(value: string | Date): string {
  return fullDate.format(typeof value === 'string' ? date(value) : value);
}

export function monthLabel(value: string | Date): string {
  return monthYear.format(typeof value === 'string' ? date(value) : value);
}

export function timeLabel(value: string | Date): string {
  return time.format(typeof value === 'string' ? date(value) : value);
}

export function timeZoneLabel(value: string | Date): string {
  return timeZone.format(typeof value === 'string' ? date(value) : value);
}

export function longDayTimeLabel(value: string | Date): string {
  return longDayTime.format(typeof value === 'string' ? date(value) : value);
}

/** "30 Sept, 09:30 – 11:00" for an entry segment (1.14 entry rows). */
export function entryTimes(start: string, end: string): string {
  return `${dayMonthTime.format(date(start))} – ${time.format(date(end))}`;
}

export function syncedLabel(value: string): string {
  return dayMonthYearTime.format(date(value));
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Swift weekday number (1 = Sunday … 7 = Saturday) as a name. */
export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday - 1] ?? `Day ${weekday}`;
}

/** `ExplorerRecord::BAND_NAMES`. */
export const LENGTH_BANDS = ['Under 15 min', '15–30 min', '30–60 min', '1–2 hours', '2+ hours'] as const;

export function lengthBandName(band: number): string {
  return LENGTH_BANDS[band] ?? `Band ${band + 1}`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
