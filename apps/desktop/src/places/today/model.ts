import { getLocalTimeZone, parseDate, type CalendarDate } from '@internationalized/date';
import { useMemo } from 'react';
import { activityColorIndex, useActivityColors } from '../../features/activity';
import { secondsBetween } from '../../features/ticketContext/format';
import type { ReviewSession, WorkItemsSlice } from '../../ipc/contract';
import { useSlice } from '../../state/hooks';
import { displayedMinute, spansMinute } from '../../utils/minutes';

export const HOUR_MS = 3_600_000;

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const DAY_TITLE = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const DAY_SHORT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** "09:30" in the local time zone; empty for an unreadable instant. */
export function formatTime(instant: string | number): string {
  const time = typeof instant === 'number' ? instant : Date.parse(instant);
  return Number.isNaN(time) ? '' : TIME.format(time);
}

/** The local date of a `YYYY-MM-DD` day, at midnight. */
export function dayDate(day: string): Date {
  return parseDate(day).toDate(getLocalTimeZone());
}

/** "Tuesday 6 October" (the view's title). */
export function formatDayTitle(day: string): string {
  return DAY_TITLE.format(dayDate(day));
}

/** "Monday" ("Monday isn’t reviewed", "Mark Monday reviewed"). */
export function formatWeekday(day: string): string {
  return WEEKDAY.format(dayDate(day));
}

/** "Mon 5 Oct". */
export function formatDayShort(day: string): string {
  return DAY_SHORT.format(dayDate(day));
}

export function shiftDay(day: string, amount: number): string {
  return parseDate(day).add({ days: amount }).toString();
}

/** The local day as `[start, end)` epoch milliseconds (23 or 25 hours on a DST change). */
export function dayBounds(day: CalendarDate | string): { start: number; end: number } {
  const date = typeof day === 'string' ? parseDate(day) : day;
  const zone = getLocalTimeZone();
  return { start: date.toDate(zone).getTime(), end: date.add({ days: 1 }).toDate(zone).getTime() };
}

/** A calendar colour from the engine (`#rrggbb`), or `null` when it is not a plain hex colour. */
export function safeColor(color: string | null | undefined): string | null {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

export interface TimeSpan {
  id: string;
  /** Epoch milliseconds. */
  start: number;
  end: number;
}

/**
 * Side-by-side lanes for overlapping spans, as a day calendar draws them: spans that overlap at
 * the displayed minute (directly or through a chain) form a cluster, each gets the first free lane, and every span in
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
    if (displayedMinute(span.start) >= displayedMinute(clusterEnd)) close();
    let lane = laneEnds.findIndex((end) => displayedMinute(end) <= displayedMinute(span.start));
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

export interface Overlap {
  /** The two spans, earlier start first. */
  first: string;
  second: string;
  start: number;
  end: number;
}

/**
 * Every pair of spans that cover the same displayed minute, in start order (back-to-back spans
 * that share a few seconds of one minute do not overlap). The day review's engine summary
 * has no overlaps, so the view finds them in the sessions it already has (the Time editor's
 * corrections resolve them).
 */
export function findOverlaps(spans: readonly TimeSpan[]): Overlap[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const result: Overlap[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (displayedMinute(b.start) >= displayedMinute(a.end)) break;
      const end = Math.min(a.end, b.end);
      if (spansMinute(b.start, end)) result.push({ first: a.id, second: b.id, start: b.start, end });
    }
  }
  return result;
}

/** The visible hours: 08:00–18:00, widened to whole hours around every time, within the day. */
export function visibleRange(day: string, times: readonly number[]): { from: number; to: number } {
  const { start, end } = dayBounds(day);
  let from = start + 8 * HOUR_MS;
  let to = start + 18 * HOUR_MS;
  for (const time of times) {
    if (!Number.isFinite(time) || time < start || time > end) continue;
    from = Math.min(from, start + Math.floor((time - start) / HOUR_MS) * HOUR_MS);
    to = Math.max(to, start + Math.ceil((time - start) / HOUR_MS) * HOUR_MS);
  }
  return { from: Math.max(from, start), to: Math.min(to, end) };
}

export function sessionSeconds(session: ReviewSession): number {
  return secondsBetween(session.start, session.end);
}

export function sessionTitle(session: ReviewSession, items: WorkItemsSlice | undefined): string {
  return session.ticketId !== null ? (items?.[String(session.ticketId)]?.title ?? session.title) : session.title;
}

/** "#4821 Checkout: retry…" or the free entry's title. */
export function sessionName(session: ReviewSession, items: WorkItemsSlice | undefined): string {
  const title = sessionTitle(session, items);
  return session.ticketId !== null ? `#${session.ticketId} ${title}` : title;
}

/**
 * Palette index per activity name. Review sessions carry the activity's name, so it is matched to
 * the workspace's activity types to get the same colour as everywhere else; an unknown name keeps
 * a stable colour of its own, and work without an activity is grey.
 */
export function useActivityIndex(): (activity: string) => number {
  const flow = useSlice('flow');
  const offline = useSlice('offline');
  const colors = useActivityColors();
  return useMemo(() => {
    const ids = new Map<string, string>();
    for (const activity of [...(flow?.activityTypes ?? []), ...(offline?.activities ?? [])]) {
      if (activity.name && !ids.has(activity.name)) ids.set(activity.name, activity.id);
    }
    return (activity: string) => activityColorIndex(colors, activity ? (ids.get(activity) ?? activity) : null);
  }, [flow?.activityTypes, offline?.activities, colors]);
}

export interface TicketRow {
  id: string;
  ticketId: number | null;
  title: string;
  /** The activity with the most time on this ticket, for its swatch. */
  activity: string;
  count: number;
  seconds: number;
}

/** Time per ticket (free entries per title), most time first. */
export function ticketRows(sessions: readonly ReviewSession[], items: WorkItemsSlice | undefined): TicketRow[] {
  const groups = new Map<string, TicketRow & { perActivity: Map<string, number> }>();
  for (const session of sessions) {
    const id = session.ticketId !== null ? `ticket:${session.ticketId}` : `free:${session.title}`;
    const group = groups.get(id) ?? {
      id,
      ticketId: session.ticketId,
      title: sessionTitle(session, items),
      activity: session.activity,
      count: 0,
      seconds: 0,
      perActivity: new Map<string, number>(),
    };
    const seconds = sessionSeconds(session);
    group.count += 1;
    group.seconds += seconds;
    group.perActivity.set(session.activity, (group.perActivity.get(session.activity) ?? 0) + seconds);
    groups.set(id, group);
  }
  return [...groups.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .map(({ perActivity, ...row }) => ({
      ...row,
      activity: [...perActivity.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? row.activity,
    }));
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
