/**
 * Labels for the Statistics page. In the interface language, 24-hour clock, day-month order (en-GB
 * or nl-BE), in the computer's time zone, as 1.14 did. Durations use `DurationText.short` ("3h 20m").
 */
import { CalendarDate } from '@internationalized/date';
import { dateFormat, mark, t } from '../../../i18n';
import type { ExplorerResolution, Interval, StatisticsPeriod } from '../../../ipc/contract';
import { formatShortDuration } from '../../../utils/duration';

const FULL_DATE: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
const DAY_MONTH: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
const DAY_MONTH_YEAR: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
const MONTH_YEAR: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };
const MONTH_SHORT: Intl.DateTimeFormatOptions = { month: 'short' };
const YEAR_ONLY: Intl.DateTimeFormatOptions = { year: 'numeric' };
const WEEKDAY_DAY: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric' };
const WEEKDAY_DAY_MONTH: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
const DAY_MONTH_TIME: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
const DAY_MONTH_YEAR_TIME: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const TIME_ZONE: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
const LONG_DAY_TIME: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' };

const fullDate = () => dateFormat(FULL_DATE);
const dayMonth = () => dateFormat(DAY_MONTH);
const dayMonthYear = () => dateFormat(DAY_MONTH_YEAR);
const monthYear = () => dateFormat(MONTH_YEAR);
const monthShort = () => dateFormat(MONTH_SHORT);
const yearOnly = () => dateFormat(YEAR_ONLY);
const weekdayDay = () => dateFormat(WEEKDAY_DAY);
const weekdayDayMonth = () => dateFormat(WEEKDAY_DAY_MONTH);
const dayMonthTime = () => dateFormat(DAY_MONTH_TIME);
const dayMonthYearTime = () => dateFormat(DAY_MONTH_YEAR_TIME);
const time = () => dateFormat(TIME);
const timeZone = () => dateFormat(TIME_ZONE);
const longDayTime = () => dateFormat(LONG_DAY_TIME);

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
      return fullDate().format(start);
    case 'month':
      return monthYear().format(start);
    case 'year':
      return yearOnly().format(start);
    case 'week':
      return `${dayMonth().format(start)} – ${dayMonthYear().format(last)}`;
  }
}

/** "6 Oct, 10:00 – 6 Oct, 14:00" for a zoomed window. */
export function windowTitle(window: Interval): string {
  return `${dayMonthTime().format(date(window.start))} – ${dayMonthTime().format(date(window.end))}`;
}

/** Short axis label of a time-chart bucket. */
export function bucketLabel(start: Date, resolution: ExplorerResolution): string {
  switch (resolution) {
    case 'Monthly':
      return monthShort().format(start);
    case 'Daily':
      return weekdayDay().format(start);
    default:
      return time().format(start);
  }
}

/** Full label of a time-chart bucket (tooltip, screen reader, table). */
export function bucketLongLabel(start: Date, end: Date, resolution: ExplorerResolution): string {
  switch (resolution) {
    case 'Monthly':
      return monthYear().format(start);
    case 'Daily':
      return weekdayDayMonth().format(start);
    default:
      return `${dayMonthTime().format(start)} – ${timeZone().format(end)}`;
  }
}

export function weekdayDayMonthLabel(value: string | Date): string {
  return weekdayDayMonth().format(typeof value === 'string' ? date(value) : value);
}

export function fullDateLabel(value: string | Date): string {
  return fullDate().format(typeof value === 'string' ? date(value) : value);
}

export function monthLabel(value: string | Date): string {
  return monthYear().format(typeof value === 'string' ? date(value) : value);
}

export function timeLabel(value: string | Date): string {
  return time().format(typeof value === 'string' ? date(value) : value);
}

export function timeZoneLabel(value: string | Date): string {
  return timeZone().format(typeof value === 'string' ? date(value) : value);
}

export function longDayTimeLabel(value: string | Date): string {
  return longDayTime().format(typeof value === 'string' ? date(value) : value);
}

/** "30 Sept, 09:30 – 11:00" for an entry segment (1.14 entry rows). */
export function entryTimes(start: string, end: string): string {
  return `${dayMonthTime().format(date(start))} – ${time().format(date(end))}`;
}

export function syncedLabel(value: string): string {
  return dayMonthYearTime().format(date(value));
}

/** Swift weekday number (1 = Sunday … 7 = Saturday) as a name. 4 January 1970 was a Sunday. */
export function weekdayName(weekday: number): string {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return t('Day {number}', { number: weekday });
  return dateFormat({ weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(1970, 0, 3 + weekday)));
}

/** `ExplorerRecord::BAND_NAMES`, translated where shown. */
export const LENGTH_BANDS = [mark('Under 15 min'), mark('15–30 min'), mark('30–60 min'), mark('1–2 hours'), mark('2+ hours')] as const;

export function lengthBandName(band: number): string {
  const name = LENGTH_BANDS[band];
  return name ? t(name) : t('Band {number}', { number: band + 1 });
}

const CURRENT_PERIOD: Record<StatisticsPeriod, string> = {
  day: mark('Current day'),
  week: mark('Current week'),
  month: mark('Current month'),
  year: mark('Current year'),
};

/** "Current week": back to the period that holds today. */
export function currentPeriodLabel(period: StatisticsPeriod): string {
  return t(CURRENT_PERIOD[period]);
}

const RESOLUTION: Record<ExplorerResolution, string> = {
  Monthly: mark('Monthly'),
  Daily: mark('Daily'),
  Hourly: mark('Hourly'),
  '15 minutes': mark('15 minutes'),
  '5 minutes': mark('5 minutes'),
};

/** The engine's resolution (a raw enum value) as shown. */
export function resolutionLabel(resolution: ExplorerResolution): string {
  const label = RESOLUTION[resolution] as string | undefined;
  return label ? t(label) : resolution;
}
