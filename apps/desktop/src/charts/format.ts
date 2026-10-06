import { formatShortDuration } from '../utils/duration';

/** English-only fixed formats (rewrite plan §8); 24-hour clock and day-month order (en-GB). */
const LOCALE = 'en-GB';

const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const dayMonthFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export const defaultFormatValue = (seconds: number): string => formatShortDuration(seconds);

export function formatTime(date: Date): string {
  return timeFormat.format(date);
}

export function formatDayMonth(date: Date): string {
  return dayMonthFormat.format(date);
}

export function formatDateTime(date: Date): string {
  return dateTimeFormat.format(date);
}

/** Axis ticks: times for windows up to 36 h (as in 1.14), dates beyond. */
export function defaultTickFormatter(domain: { start: Date; end: Date }): (date: Date) => string {
  const span = domain.end.getTime() - domain.start.getTime();
  return span <= 36 * 3600 * 1000 ? formatTime : formatDayMonth;
}

/** "5h" / "30m" for value axes. */
export function formatAxisValue(seconds: number, unit: 'hours' | 'minutes'): string {
  if (unit === 'minutes') return `${Math.round(seconds / 60)}m`;
  const hours = seconds / 3600;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}
