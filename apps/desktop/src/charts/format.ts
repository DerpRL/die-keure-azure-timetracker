import { dateFormat, numberFormat, t } from '../i18n';
import { formatShortDuration } from '../utils/duration';

/** Fixed formats in the interface locale: 24-hour clock and day-month order (en-GB or nl-BE). */
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const DAY_MONTH: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
const DATE_TIME: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
};

export const defaultFormatValue = (seconds: number): string => formatShortDuration(seconds);

export function formatTime(date: Date): string {
  return dateFormat(TIME).format(date);
}

export function formatDayMonth(date: Date): string {
  return dateFormat(DAY_MONTH).format(date);
}

export function formatDateTime(date: Date): string {
  return dateFormat(DATE_TIME).format(date);
}

/** Axis ticks: times for windows up to 36 h (as in 1.14), dates beyond. */
export function defaultTickFormatter(domain: { start: Date; end: Date }): (date: Date) => string {
  const span = domain.end.getTime() - domain.start.getTime();
  return span <= 36 * 3600 * 1000 ? formatTime : formatDayMonth;
}

/** "5h" / "30m" for value axes (Dutch "5u" / "30m"). */
export function formatAxisValue(seconds: number, unit: 'hours' | 'minutes'): string {
  if (unit === 'minutes') return t('{minutes}m', { minutes: Math.round(seconds / 60) });
  const hours = seconds / 3600;
  const digits = Number.isInteger(hours) ? 0 : 1;
  return t('{hours}h', { hours: numberFormat({ minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(hours) });
}
