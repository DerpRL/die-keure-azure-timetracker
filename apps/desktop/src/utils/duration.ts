/** Duration formatting, ported from Swift `DurationText` with the same output. */

function wholeSeconds(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `DurationText.clock`: "HH:MM:SS"; hours grow past two digits instead of wrapping. */
export function formatClock(seconds: number): string {
  const s = wholeSeconds(seconds);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** `DurationText.short`: "3h 20m" (minutes truncated, never rounded up). */
export function formatShortDuration(seconds: number): string {
  const minutes = Math.floor(wholeSeconds(seconds) / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function unit(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? '' : 's'}`;
}

/** Screen-reader friendly form: "1 hour 2 minutes 3 seconds"; zero parts are omitted. */
export function formatSpokenDuration(seconds: number, { includeSeconds = true } = {}): string {
  const s = wholeSeconds(seconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const parts: string[] = [];
  if (hours) parts.push(unit(hours, 'hour'));
  if (minutes) parts.push(unit(minutes, 'minute'));
  if (includeSeconds && rest) parts.push(unit(rest, 'second'));
  if (parts.length === 0) return includeSeconds ? '0 seconds' : '0 minutes';
  return parts.join(' ');
}

/** Whole-number percentage, as Swift's `Int(fraction * 100)` (truncating). */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '0%';
  return `${Math.trunc(fraction * 100)}%`;
}
