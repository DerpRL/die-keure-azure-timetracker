import { startOfWeek, type CalendarDate } from '@internationalized/date';
import type { OfflineDraftView, TrackingSlice, WorkItemsSlice, WorkLog } from '../../../ipc/contract';
import { dayToDate, localDayKey, logEnd, logStart, logTicket } from '../../../features/ticketContext/format';
import { entryOverlaps, type EntryOverlap } from '../day/dayModel';
import { displayedMinute } from '../../../utils/minutes';
import { dateFormat, t } from '../../../i18n';

/*
 * The Timesheet's week calendar, derived from the 7pace worklogs of the week (history slice), the
 * offline drafts not uploaded yet and the running 7pace timer. Gaps, overlaps and long entries are
 * hints for the eye; the engine checks overlaps again before any write.
 */

export const HOUR_MS = 3_600_000;

export type WeekBlockKind = 'log' | 'draft' | 'running';

export interface WeekBlock {
  kind: WeekBlockKind;
  /** The worklog or draft id (`running` for the timer). */
  id: string;
  /** Local day, `YYYY-MM-DD`. */
  day: string;
  /** Epoch milliseconds. */
  start: number;
  end: number;
  ticketId: number | null;
  /** The ticket's title, the comment or the activity: what the block says first. */
  title: string;
  comment: string;
  activityId: string | null;
  activityName: string | null;
  /** Longer than the day check's long-entry threshold. */
  long: boolean;
  /** Shares time with another worklog of the day. */
  overlap: boolean;
  /** 7pace does not allow editing it. */
  locked: boolean;
  log?: WorkLog;
  draft?: OfflineDraftView;
}

export interface WeekGap {
  start: number;
  end: number;
}

export interface WeekDay {
  /** `YYYY-MM-DD`. */
  key: string;
  date: CalendarDate;
  isToday: boolean;
  isFuture: boolean;
  blocks: WeekBlock[];
  gaps: WeekGap[];
  overlaps: EntryOverlap[];
  /** Worklogs (and the running timer) in seconds; drafts are left out. */
  seconds: number;
  draftSeconds: number;
  drafts: WeekBlock[];
  longEntries: WeekBlock[];
}

export interface WeekInput {
  weekStart: CalendarDate;
  today: CalendarDate;
  now: number;
  logs: readonly WorkLog[];
  drafts: readonly OfflineDraftView[];
  tracking: TrackingSlice | undefined;
  /** The time editor's id of the running timer's worklog, if 7pace already has one. */
  runningLogId: string | null;
  items: WorkItemsSlice | undefined;
  longEntryMinutes: number;
  gapMinutes: number;
  /** Ticket number, title or comment text; blocks that do not match are left out. */
  filter: string;
  /** Activity names by id, for drafts (which only carry the id). */
  activityNames?: ReadonlyMap<string, string>;
}

/** Monday of the week that contains `day`. */
export function mondayOf(day: CalendarDate): CalendarDate {
  return startOfWeek(day, 'en-GB');
}

/** The history range of a week: Monday until Sunday, but never after today. */
export function weekRange(weekStart: CalendarDate, today: CalendarDate): { from: string; to: string } {
  const sunday = weekStart.add({ days: 6 });
  const to = sunday.compare(today) > 0 ? today : sunday;
  return { from: weekStart.toString(), to: (to.compare(weekStart) < 0 ? weekStart : to).toString() };
}

/** When the running timer's session started: its confirmed elapsed time back from confirmation. */
export function runningStart(tracking: TrackingSlice | undefined): number | null {
  if (!tracking?.running || !tracking.confirmedAt) return null;
  const confirmed = Date.parse(tracking.confirmedAt);
  if (!Number.isFinite(confirmed) || !Number.isFinite(tracking.elapsedBase)) return null;
  return confirmed - tracking.elapsedBase * 1000;
}

function matches(block: WeekBlock, query: string): boolean {
  if (!query) return true;
  const text = `${block.ticketId ?? ''} #${block.ticketId ?? ''} ${block.title} ${block.comment}`.toLocaleLowerCase();
  return text.includes(query.toLocaleLowerCase());
}

function logTitle(log: WorkLog, items: WorkItemsSlice | undefined): string {
  const ticket = logTicket(log);
  const name = ticket !== null ? items?.[String(ticket)]?.title : undefined;
  return name || log.comment?.trim() || log.activityType?.name || (ticket !== null ? t('Azure ticket') : t('Work without a ticket'));
}

/** The gaps between a day's worklogs (from its first start to its last end), at least `minutes` long. */
export function dayGaps(spans: ReadonlyArray<{ start: number; end: number }>, minutes: number, now: number): WeekGap[] {
  const sorted = [...spans].filter((span) => span.end > span.start).sort((a, b) => a.start - b.start);
  const gaps: WeekGap[] = [];
  let reach = sorted[0]?.end ?? 0;
  for (const span of sorted.slice(1)) {
    if (span.start - reach >= minutes * 60_000 && span.start <= now) gaps.push({ start: reach, end: span.start });
    reach = Math.max(reach, span.end);
  }
  return gaps;
}

/**
 * Side-by-side lanes for blocks that share a displayed minute: each block gets a lane and the
 * number of lanes of its cluster. Back-to-back blocks that share a few seconds stay full width.
 */
export function blockLanes(blocks: ReadonlyArray<{ id: string; start: number; end: number }>): Map<string, { lane: number; lanes: number }> {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
  const result = new Map<string, { lane: number; lanes: number }>();
  let cluster: Array<{ id: string; lane: number }> = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const member of cluster) result.set(member.id, { lane: member.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const block of sorted) {
    if (displayedMinute(block.start) >= displayedMinute(clusterEnd)) close();
    let lane = laneEnds.findIndex((end) => displayedMinute(end) <= displayedMinute(block.start));
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(block.end);
    } else laneEnds[lane] = block.end;
    cluster.push({ id: block.id, lane });
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  close();
  return result;
}

/** The week's days: Monday to Friday, plus Saturday and Sunday when they have blocks. */
export function buildWeek(input: WeekInput): WeekDay[] {
  const { weekStart, today, now, items, longEntryMinutes, gapMinutes } = input;
  const query = input.filter.trim();
  const byDay = new Map<string, WeekBlock[]>();
  const add = (block: WeekBlock) => {
    const list = byDay.get(block.day);
    if (list) list.push(block);
    else byDay.set(block.day, [block]);
  };

  const runningLog = input.runningLogId;
  for (const log of input.logs) {
    const start = logStart(log)?.getTime();
    const end = logEnd(log)?.getTime();
    if (start === undefined || end === undefined || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    add({
      kind: log.id === runningLog ? 'running' : 'log',
      id: log.id,
      day: localDayKey(new Date(start)),
      start,
      end: log.id === runningLog ? Math.max(end, now) : Math.max(end, start),
      ticketId: logTicket(log),
      title: logTitle(log, items),
      comment: log.comment?.trim() ?? '',
      activityId: log.activityType?.id ?? null,
      activityName: log.activityType?.name ?? null,
      long: log.length >= longEntryMinutes * 60,
      overlap: false,
      locked: log.isCanEdit === false,
      log,
    });
  }

  const timerStart = runningStart(input.tracking);
  if (timerStart !== null && !runningLog && input.tracking) {
    const tracking = input.tracking;
    add({
      kind: 'running',
      id: 'running',
      day: localDayKey(new Date(timerStart)),
      start: timerStart,
      end: Math.max(now, timerStart),
      ticketId: tracking.ticketId,
      title: tracking.title,
      comment: tracking.remark ?? '',
      activityId: tracking.activityId,
      activityName: tracking.activityName,
      long: false,
      overlap: false,
      locked: true,
    });
  }

  for (const draft of input.drafts) {
    if (draft.status === 'Synced to 7pace') continue;
    const start = Date.parse(draft.start);
    const end = draft.end ? Date.parse(draft.end) : now;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const name = draft.ticketId ? items?.[String(draft.ticketId)]?.title : undefined;
    add({
      kind: 'draft',
      id: draft.id,
      day: localDayKey(new Date(start)),
      start,
      end: Math.max(end, start),
      ticketId: draft.ticketId ?? null,
      title: name || draft.comment.trim() || draft.title,
      comment: draft.comment,
      activityId: draft.activityId ?? null,
      activityName: draft.activityId ? (input.activityNames?.get(draft.activityId) ?? null) : null,
      long: false,
      overlap: false,
      locked: false,
      draft,
    });
  }

  const days: WeekDay[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const date = weekStart.add({ days: offset });
    const key = date.toString();
    const all = (byDay.get(key) ?? []).sort((a, b) => a.start - b.start);
    const weekend = offset >= 5;
    if (weekend && all.length === 0) continue;
    const logs = all.filter((block) => block.kind !== 'draft');
    const overlaps = entryOverlaps(logs.filter((block) => block.log && block.kind === 'log').map((block) => block.log!));
    const overlapping = new Set(overlaps.flatMap((overlap) => [overlap.earlierId, overlap.laterId]));
    for (const block of logs) block.overlap = overlapping.has(block.id);
    const seconds = logs.reduce((sum, block) => sum + Math.max(block.end - block.start, 0) / 1000, 0);
    const drafts = all.filter((block) => block.kind === 'draft');
    days.push({
      key,
      date,
      isToday: date.compare(today) === 0,
      isFuture: date.compare(today) > 0,
      blocks: all.filter((block) => matches(block, query)),
      gaps: dayGaps(
        logs.filter((block) => block.kind === 'log'),
        gapMinutes,
        now,
      ),
      overlaps,
      seconds,
      draftSeconds: drafts.reduce((sum, block) => sum + Math.max(block.end - block.start, 0) / 1000, 0),
      drafts,
      longEntries: logs.filter((block) => block.long),
    });
  }
  return days;
}

/** The hours the calendar shows: 08:00–18:00, widened to whole hours around every block. */
export function visibleHours(days: readonly WeekDay[]): { from: number; to: number } {
  let from = 8;
  let to = 18;
  for (const day of days) {
    const midnight = dayToDate(day.key).getTime();
    for (const block of day.blocks) {
      from = Math.min(from, Math.floor((block.start - midnight) / HOUR_MS));
      to = Math.max(to, Math.ceil((Math.min(block.end, midnight + 24 * HOUR_MS) - midnight) / HOUR_MS));
    }
  }
  return { from: Math.max(0, from), to: Math.min(24, Math.max(to, from + 1)) };
}

/** Whether the day has anything worth a second look: overlaps, gaps, long entries or drafts. */
export function needsLook(day: WeekDay): boolean {
  return day.overlaps.length > 0 || day.gaps.length > 0 || day.longEntries.length > 0 || day.drafts.length > 0;
}

/** The day the "needs a look" card is about: the chosen day, else the latest past day with issues. */
export function dayToLookAt(days: readonly WeekDay[], chosen: string | null): WeekDay | null {
  if (chosen) {
    const day = days.find((entry) => entry.key === chosen);
    return day && needsLook(day) ? day : null;
  }
  const past = days.filter((day) => !day.isToday && !day.isFuture && needsLook(day));
  return past.at(-1) ?? null;
}

/** "5 – 9 October 2026", "28 September – 2 October 2026", "29 December 2025 – 2 January 2026". */
export function formatWeekTitle(first: CalendarDate, last: CalendarDate): string {
  const month = (date: CalendarDate) => dateFormat({ month: 'long' }).format(new Date(date.year, date.month - 1, date.day));
  if (first.year !== last.year) return `${first.day} ${month(first)} ${first.year} – ${last.day} ${month(last)} ${last.year}`;
  if (first.month !== last.month) return `${first.day} ${month(first)} – ${last.day} ${month(last)} ${last.year}`;
  return `${first.day} – ${last.day} ${month(last)} ${last.year}`;
}

