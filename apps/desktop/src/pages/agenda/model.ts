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

export const HOUR_MS = 3_600_000;

/** The local day as `[start, end)` epoch milliseconds (23 or 25 hours on a DST change). */
export function dayBounds(day: CalendarDate): { start: number; end: number } {
  const zone = getLocalTimeZone();
  return { start: day.toDate(zone).getTime(), end: day.add({ days: 1 }).toDate(zone).getTime() };
}

export interface TimeSpan {
  id: string;
  /** Epoch milliseconds. */
  start: number;
  end: number;
}

/**
 * Side-by-side lanes for overlapping spans, as a day calendar draws them: spans that overlap
 * (directly or through a chain) form a cluster, each gets the first free lane, and every span in
 * the cluster shares the cluster's lane count.
 */
export function overlapLanes(spans: readonly TimeSpan[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
  const result = new Map<string, { lane: number; lanes: number }>();
  let cluster: string[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const id of cluster) result.set(id, { lane: result.get(id)?.lane ?? 0, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const span of sorted) {
    if (span.start >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= span.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(span.end);
    } else {
      laneEnds[lane] = span.end;
    }
    result.set(span.id, { lane, lanes: 0 });
    cluster.push(span.id);
    clusterEnd = cluster.length === 1 ? span.end : Math.max(clusterEnd, span.end);
  }
  close();
  return result;
}
