/**
 * Statistics samples: a full working week, the same week zoomed to one day, a month with more
 * than one page of entries, an empty week and the loading and failure states.
 *
 * The analysis is derived from a small worklog plan with the same rules as `att-core::explorer`
 * (clipping to the window, split at local midnight, buckets per resolution, task grouping,
 * patterns, context switches and visuals), so every number on the page agrees with every other.
 * All sample days are in Brussels summer time (UTC+2); daylight saving ends on 25 October.
 */
import type {
  ActivityType,
  AnalysisView,
  ContextDay,
  ContextView,
  EntriesPage,
  ExplorerActivity,
  ExplorerBucket,
  ExplorerCalendarDay,
  ExplorerEntry,
  ExplorerFilter,
  ExplorerHeatHour,
  ExplorerPattern,
  ExplorerProgressPoint,
  ExplorerRecord,
  ExplorerResolution,
  ExplorerSegment,
  ExplorerTask,
  ExplorerVisuals,
  Interval,
  SliceMap,
  StatisticsPeriod,
  StatisticsSection,
  StatisticsSlice,
  WorkLog,
} from '../../contract';
import { defaultConfiguration } from '../defaults';

const OFFSET_HOURS = 2;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** `SAMPLE_NOW` in `fixtures/index.ts` (not imported: that module globs this file). */
const NOW = Date.parse('2026-10-06T08:00:00Z');
const DAILY_TARGET = defaultConfiguration().targets.dailyHours * 3600;
const SYNCED_AT = '2026-10-06T07:55:00Z';

type ActivityKey = 'dev' | 'review' | 'meeting' | 'standup' | 'design';

/** The activity types of the `flow` sample. */
const ACTIVITIES: Record<ActivityKey, ActivityType> = {
  dev: { id: 'dev', name: 'Development', color: '#2f7de1' },
  review: { id: 'review', name: 'Code review', color: '#6b7280' },
  meeting: { id: 'meeting', name: 'Meeting', color: '#e0912f' },
  standup: { id: 'standup', name: 'Standup', color: '#3aa76d' },
  design: { id: 'design', name: 'Design', color: '#b04fd9' },
};

/** Ticket titles as the engine resolves them (the `workItems` sample has the first four). */
const TITLES: Readonly<Record<number, string>> = {
  4821: 'Checkout: retry failed card payments',
  4790: 'Invoice PDF shows the wrong VAT number',
  4777: 'Sprint ceremonies',
  4655: 'Design system: date picker tokens',
  4702: 'Search: typo tolerance for product names',
  4733: 'Release 3.8 regression testing',
};

interface Planned {
  /** Local clock time, `HH:MM`. */
  at: string;
  minutes: number;
  ticket: number | null;
  activity: ActivityKey;
  comment: string;
  /** Billable share known to 7pace: `true` = fully billable, `false` = 0, `null` = not supplied. */
  billable?: boolean | null;
}

const STANDUP: Planned = { at: '08:30', minutes: 15, ticket: 4777, activity: 'standup', comment: 'Daily stand-up', billable: null };

/** Three working-day shapes, rotated so the week and the month vary. */
const TEMPLATES: readonly (readonly Planned[])[] = [
  [
    STANDUP,
    { at: '08:45', minutes: 135, ticket: 4821, activity: 'dev', comment: 'Retry queue for declined cards', billable: true },
    { at: '11:00', minutes: 45, ticket: 4790, activity: 'review', comment: 'Review VAT number fix', billable: true },
    { at: '12:30', minutes: 120, ticket: 4821, activity: 'dev', comment: 'Idempotency keys for retries', billable: true },
    { at: '14:30', minutes: 60, ticket: null, activity: 'meeting', comment: 'Team sync', billable: false },
    { at: '15:30', minutes: 90, ticket: 4702, activity: 'dev', comment: 'Fuzzy matching spike', billable: true },
  ],
  [
    STANDUP,
    { at: '08:45', minutes: 50, ticket: 4790, activity: 'dev', comment: 'Fix VAT number lookup', billable: true },
    { at: '09:35', minutes: 10, ticket: 4790, activity: 'dev', comment: 'Unit tests for VAT lookup', billable: true },
    { at: '09:50', minutes: 100, ticket: 4655, activity: 'design', comment: 'Date picker states', billable: true },
    { at: '11:30', minutes: 30, ticket: 4777, activity: 'meeting', comment: 'Backlog refinement', billable: false },
    { at: '13:00', minutes: 150, ticket: 4821, activity: 'dev', comment: 'Card retry UI', billable: true },
    { at: '15:30', minutes: 25, ticket: 4733, activity: 'review', comment: 'Regression checklist', billable: true },
    { at: '15:55', minutes: 65, ticket: 4733, activity: 'dev', comment: 'Release 3.8 smoke tests', billable: null },
  ],
  [
    STANDUP,
    { at: '08:45', minutes: 180, ticket: 4702, activity: 'dev', comment: 'Typo tolerance index', billable: true },
    { at: '11:45', minutes: 20, ticket: 4821, activity: 'review', comment: 'Pull request feedback', billable: true },
    { at: '13:00', minutes: 90, ticket: 4655, activity: 'design', comment: 'Token naming review', billable: true },
    { at: '14:30', minutes: 15, ticket: null, activity: 'meeting', comment: 'One-to-one', billable: false },
    { at: '14:45', minutes: 120, ticket: 4790, activity: 'dev', comment: 'PDF renderer fix', billable: true },
    // Overlaps the previous entry: recorded twice, covered once.
    { at: '16:15', minutes: 30, ticket: null, activity: 'review', comment: 'Pairing on the renderer', billable: false },
  ],
];

/** Work outside the templates: an overnight release (split at midnight) and a Saturday check. */
const EXTRA: Readonly<Record<string, readonly Planned[]>> = {
  '2026-10-01': [{ at: '23:15', minutes: 75, ticket: 4733, activity: 'dev', comment: 'Release 3.8 deployment', billable: true }],
  '2026-09-12': [{ at: '10:00', minutes: 45, ticket: 4733, activity: 'dev', comment: 'Hotfix verification', billable: true }],
};

// -- time helpers (fixed UTC+2) ----------------------------------------------------------------

function iso(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

/** The instant a local `YYYY-MM-DD` starts. */
function localMidnight(day: string): number {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date) - OFFSET_HOURS * HOUR;
}

function localDay(ms: number): string {
  return new Date(ms + OFFSET_HOURS * HOUR).toISOString().slice(0, 10);
}

function dayStart(ms: number): number {
  return localMidnight(localDay(ms));
}

/** Monday = 0 … Sunday = 6. */
function mondayIndex(ms: number): number {
  return (new Date(dayStart(ms) + OFFSET_HOURS * HOUR).getUTCDay() + 6) % 7;
}

/** Swift weekday: Sunday = 1 … Saturday = 7. */
function swiftWeekday(ms: number): number {
  return new Date(dayStart(ms) + OFFSET_HOURS * HOUR).getUTCDay() + 1;
}

function localHour(ms: number): number {
  return new Date(ms + OFFSET_HOURS * HOUR).getUTCHours();
}

function interval(start: number, end: number): Interval {
  return { start: iso(start), end: iso(end) };
}

function days(from: string, to: string): string[] {
  const result: string[] = [];
  for (let cursor = localMidnight(from); cursor < localMidnight(to); cursor += DAY) result.push(localDay(cursor));
  return result;
}

// -- worklogs ------------------------------------------------------------------------------------

function worklogs(from: string, to: string): WorkLog[] {
  const logs: WorkLog[] = [];
  days(from, to).forEach((day, index) => {
    const weekday = mondayIndex(localMidnight(day));
    const planned = [...(weekday < 5 ? (TEMPLATES[index % TEMPLATES.length] ?? []) : []), ...(EXTRA[day] ?? [])];
    planned.forEach((plan, position) => {
      const [hours = 0, minutes = 0] = plan.at.split(':').map(Number);
      const start = localMidnight(day) + hours * HOUR + minutes * MINUTE;
      const length = plan.minutes * 60;
      logs.push({
        id: `wl-${day}-${position + 1}`,
        timestamp: iso(start),
        length,
        workItemId: plan.ticket,
        comment: plan.comment,
        activityType: ACTIVITIES[plan.activity],
        isCanEdit: true,
        isCanDelete: true,
        editedTimestamp: null,
        billableLength: plan.billable === null || plan.billable === undefined ? null : plan.billable ? length : 0,
        user: null,
      });
    });
  });
  return logs;
}

function record(log: WorkLog): ExplorerRecord {
  const start = Date.parse(log.timestamp);
  const ticketId = log.workItemId && log.workItemId > 0 ? log.workItemId : null;
  const activityId = log.activityType?.id ? `activity:${log.activityType.id}` : 'unspecified';
  const comment = log.comment ?? '';
  return {
    log,
    start: iso(start),
    end: iso(start + log.length * 1000),
    taskId: ticketId ? `ticket:${ticketId}` : `free:${activityId.length}:${activityId}${comment}`,
    ticketId,
    activityId,
    activityName: log.activityType?.name ?? 'Unspecified activity',
  };
}

function fallbackTitle(item: ExplorerRecord): string {
  if (item.ticketId) return TITLES[item.ticketId] ?? `Azure ticket #${item.ticketId}`;
  return item.log.comment || item.activityName;
}

const BAND_NAMES = ['Under 15 min', '15–30 min', '30–60 min', '1–2 hours', '2+ hours'];
const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function band(seconds: number): number {
  if (seconds < 900) return 0;
  if (seconds < 1800) return 1;
  if (seconds < 3600) return 2;
  if (seconds < 7200) return 3;
  return 4;
}

export const NO_FILTER: ExplorerFilter = { query: '', activityId: null, taskId: null, weekday: null, lengthBand: null };

function filterActive(filter: ExplorerFilter): boolean {
  return (
    filter.query.trim() !== '' ||
    filter.activityId !== null ||
    filter.taskId !== null ||
    filter.weekday !== null ||
    filter.lengthBand !== null
  );
}

function matches(item: ExplorerRecord, filter: ExplorerFilter): boolean {
  if (filter.activityId !== null && item.activityId !== filter.activityId) return false;
  if (filter.taskId !== null && item.taskId !== filter.taskId) return false;
  if (filter.lengthBand !== null && band(item.log.length) !== filter.lengthBand) return false;
  const query = filter.query.trim().toLowerCase();
  if (!query) return true;
  const haystack = [item.ticketId ? String(item.ticketId) : '', fallbackTitle(item), item.log.comment ?? '', item.activityName]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

// -- analysis ----------------------------------------------------------------------------------

function seconds(entry: ExplorerEntry): number {
  return (Date.parse(entry.end) - Date.parse(entry.start)) / 1000;
}

function overlap(entry: ExplorerEntry, start: number, end: number): number {
  return Math.max(0, (Math.min(end, Date.parse(entry.end)) - Math.max(start, Date.parse(entry.start))) / 1000);
}

/** Records inside the window, clipped to it and split at local midnight. */
function clip(records: readonly ExplorerRecord[], window: { start: number; end: number }, filter: ExplorerFilter): ExplorerEntry[] {
  const entries: ExplorerEntry[] = [];
  for (const item of records) {
    if (!matches(item, filter)) continue;
    let cursor = Math.max(Date.parse(item.start), window.start);
    const end = Math.min(Date.parse(item.end), window.end);
    while (cursor < end) {
      const next = Math.min(end, dayStart(cursor) + DAY);
      if (filter.weekday === null || filter.weekday === swiftWeekday(cursor)) {
        entries.push({ record: item, start: iso(cursor), end: iso(next) });
      }
      cursor = next;
    }
  }
  return entries.sort((a, b) => a.start.localeCompare(b.start) || a.record.log.id.localeCompare(b.record.log.id));
}

function resolutionFor(durationSeconds: number): ExplorerResolution {
  if (durationSeconds > 100 * 86_400) return 'Monthly';
  if (durationSeconds > 36 * 3600) return 'Daily';
  if (durationSeconds > 6 * 3600) return 'Hourly';
  if (durationSeconds > 3600) return '15 minutes';
  return '5 minutes';
}

function nextBoundary(ms: number, resolution: ExplorerResolution): number {
  switch (resolution) {
    case 'Monthly': {
      const local = new Date(ms + OFFSET_HOURS * HOUR);
      return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - OFFSET_HOURS * HOUR;
    }
    case 'Daily':
      return dayStart(ms) + DAY;
    case 'Hourly':
      return Math.floor(ms / HOUR) * HOUR + HOUR;
    case '15 minutes':
      return Math.floor(ms / (15 * MINUTE)) * 15 * MINUTE + 15 * MINUTE;
    case '5 minutes':
      return Math.floor(ms / (5 * MINUTE)) * 5 * MINUTE + 5 * MINUTE;
  }
}

function buckets(entries: readonly ExplorerEntry[], window: { start: number; end: number }, resolution: ExplorerResolution, activityIds: readonly string[], names: ReadonlyMap<string, string>): ExplorerBucket[] {
  const result: ExplorerBucket[] = [];
  for (let cursor = window.start; cursor < window.end; ) {
    const end = Math.min(window.end, nextBoundary(cursor, resolution));
    let bottom = 0;
    const segments: ExplorerSegment[] = [];
    for (const activityId of activityIds) {
      const value = entries.filter((entry) => entry.record.activityId === activityId).reduce((sum, entry) => sum + overlap(entry, cursor, end), 0);
      if (value <= 0) continue;
      segments.push({ activityId, name: names.get(activityId) ?? activityId, bottom, top: bottom + value });
      bottom += value;
    }
    result.push({ start: iso(cursor), end: iso(end), segments });
    cursor = end;
  }
  return result;
}

function windowDays(window: { start: number; end: number }): number[] {
  const result: number[] = [];
  for (let cursor = dayStart(window.start); cursor < window.end; cursor += DAY) result.push(cursor);
  return result;
}

function context(entries: readonly ExplorerEntry[], window: { start: number; end: number }): ContextView {
  const result: ContextDay[] = [];
  let ambiguous = 0;
  for (const day of windowDays(window)) {
    const segments = entries
      .filter((entry) => dayStart(Date.parse(entry.start)) === day)
      .map((entry) => ({
        start: Date.parse(entry.start),
        end: Math.min(Date.parse(entry.end), NOW),
        context: entry.record.ticketId ? `ticket:${entry.record.ticketId}` : `activity:${entry.record.activityId}|${entry.record.log.comment ?? ''}`,
      }))
      .filter((segment) => segment.start < segment.end)
      .sort((a, b) => a.start - b.start);
    const clusters: (typeof segments)[] = [];
    let clusterEnd = -Infinity;
    for (const segment of segments) {
      const last = clusters[clusters.length - 1];
      if (last && segment.start < clusterEnd) {
        last.push(segment);
        clusterEnd = Math.max(clusterEnd, segment.end);
      } else {
        clusters.push([segment]);
        clusterEnd = segment.end;
      }
    }
    const entry: ContextDay = { date: iso(day), switches: 0, blocks: [] };
    let previous: (typeof segments)[number] | null = null;
    for (const cluster of clusters) {
      const next = cluster[0];
      if (cluster.length !== 1 || !next) {
        ambiguous += cluster.length;
        previous = null;
        continue;
      }
      const length = (next.end - next.start) / 1000;
      if (previous) {
        const gap = (next.start - previous.end) / 1000;
        if (gap <= 15 * 60 && previous.context !== next.context) entry.switches += 1;
        if (gap < 1 && previous.context === next.context && entry.blocks.length > 0) {
          entry.blocks[entry.blocks.length - 1] = (entry.blocks[entry.blocks.length - 1] ?? 0) + length;
        } else entry.blocks.push(length);
      } else entry.blocks.push(length);
      previous = next;
    }
    result.push(entry);
  }
  const blocks = result.flatMap((day) => day.blocks);
  return {
    days: result,
    ambiguousEntries: ambiguous,
    switches: result.reduce((sum, day) => sum + day.switches, 0),
    longestBlock: blocks.length ? Math.max(...blocks) : 0,
    averageBlock: blocks.length ? blocks.reduce((sum, value) => sum + value, 0) / blocks.length : 0,
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function scheduled(day: number): number {
  return mondayIndex(day) < 5 ? DAILY_TARGET : 0;
}

interface Explored {
  analysis: AnalysisView;
  visuals: ExplorerVisuals;
  entries: ExplorerEntry[];
  available: ExplorerActivity[];
}

function explore(logs: readonly WorkLog[], bounds: { start: number; end: number }, window: { start: number; end: number }, filter: ExplorerFilter): Explored {
  const records = logs.map(record).sort((a, b) => a.start.localeCompare(b.start) || a.log.id.localeCompare(b.log.id));
  const entries = clip(records, window, filter);
  const resolution = resolutionFor((window.end - window.start) / 1000);
  const names = new Map(records.map((item) => [item.activityId, item.activityName]));
  const activityIds = [...new Set(entries.map((entry) => entry.record.activityId))].sort();
  const bucketList = buckets(entries, window, resolution, activityIds, names);

  const taskMap = new Map<string, { item: ExplorerRecord; seconds: number; logs: Set<string>; days: Set<string>; last: number }>();
  const activityMap = new Map<string, number>();
  const weekdaySeconds = new Map<number, number>();
  const hourSeconds = Array.from({ length: 24 }, () => 0);
  const bandSeconds = Array.from({ length: 5 }, () => 0);
  const bandLogs = Array.from({ length: 5 }, () => new Set<string>());
  const logSeconds = new Map<string, number>();
  let billable = 0;
  const billableLogs = new Set<string>();
  for (const entry of entries) {
    const value = seconds(entry);
    const start = Date.parse(entry.start);
    const task = taskMap.get(entry.record.taskId) ?? { item: entry.record, seconds: 0, logs: new Set(), days: new Set(), last: 0 };
    task.seconds += value;
    task.logs.add(entry.record.log.id);
    task.days.add(localDay(start));
    task.last = Math.max(task.last, Date.parse(entry.end));
    taskMap.set(entry.record.taskId, task);
    activityMap.set(entry.record.activityId, (activityMap.get(entry.record.activityId) ?? 0) + value);
    weekdaySeconds.set(swiftWeekday(start), (weekdaySeconds.get(swiftWeekday(start)) ?? 0) + value);
    for (let cursor = start; cursor < Date.parse(entry.end); ) {
      const next = Math.min(Date.parse(entry.end), Math.floor(cursor / HOUR) * HOUR + HOUR);
      hourSeconds[localHour(cursor)] = (hourSeconds[localHour(cursor)] ?? 0) + (next - cursor) / 1000;
      cursor = next;
    }
    const lengthBand = band(entry.record.log.length);
    bandSeconds[lengthBand] = (bandSeconds[lengthBand] ?? 0) + value;
    bandLogs[lengthBand]?.add(entry.record.log.id);
    logSeconds.set(entry.record.log.id, (logSeconds.get(entry.record.log.id) ?? 0) + value);
    const known = entry.record.log.billableLength;
    if (known !== null && known !== undefined) {
      billable += entry.record.log.length > 0 ? (known / entry.record.log.length) * value : 0;
      billableLogs.add(entry.record.log.id);
    }
  }

  const tasks: ExplorerTask[] = [...taskMap.entries()]
    .map(([id, task]) => ({
      id,
      ticketId: task.item.ticketId,
      title: fallbackTitle(task.item),
      seconds: task.seconds,
      count: task.logs.size,
      days: task.days.size,
      lastWorked: iso(task.last),
    }))
    .sort((a, b) => b.seconds - a.seconds || a.id.localeCompare(b.id));
  const activities: ExplorerActivity[] = [...activityMap.entries()]
    .map(([id, value]) => ({ id, name: names.get(id) ?? id, seconds: value }))
    .sort((a, b) => b.seconds - a.seconds || a.id.localeCompare(b.id));

  const dayList = windowDays(window);
  const occurrences = new Map<number, number>();
  for (const day of dayList) if (day <= NOW) occurrences.set(swiftWeekday(day), (occurrences.get(swiftWeekday(day)) ?? 0) + 1);
  const weekdays: ExplorerPattern[] = [2, 3, 4, 5, 6, 7, 1].map((id) => ({
    id,
    label: SHORT_WEEKDAYS[id - 1] ?? '',
    seconds: weekdaySeconds.get(id) ?? 0,
    count: occurrences.get(id) ?? 0,
  }));
  const hours: ExplorerPattern[] = hourSeconds.map((value, hour) => ({ id: hour, label: `${String(hour).padStart(2, '0')}:00`, seconds: value, count: 0 }));
  const lengths: ExplorerPattern[] = BAND_NAMES.map((label, id) => ({ id, label, seconds: bandSeconds[id] ?? 0, count: bandLogs[id]?.size ?? 0 }));

  let covered = 0;
  let coveredEnd = -Infinity;
  for (const entry of [...entries].sort((a, b) => a.start.localeCompare(b.start))) {
    const start = Math.max(Date.parse(entry.start), coveredEnd);
    const end = Date.parse(entry.end);
    if (end > start) covered += (end - start) / 1000;
    coveredEnd = Math.max(coveredEnd, end);
  }
  const total = entries.reduce((sum, entry) => sum + seconds(entry), 0);

  // Visuals (`ExplorerVisuals::new`).
  const firstDay = dayStart(window.start);
  const firstWeek = firstDay - mondayIndex(firstDay) * DAY;
  const calendar: ExplorerCalendarDay[] = [];
  const targetProgress: ExplorerProgressPoint[] = [{ date: iso(window.start), seconds: 0, target: 0 }];
  let cumulativeTarget = 0;
  for (const day of dayList) {
    const own = entries.filter((entry) => dayStart(Date.parse(entry.start)) === day);
    const offset = Math.round((day - firstWeek) / DAY);
    const part = { start: Math.max(day, window.start), end: Math.min(day + DAY, window.end) };
    calendar.push({
      date: iso(day),
      interval: interval(part.start, part.end),
      seconds: own.reduce((sum, entry) => sum + seconds(entry), 0),
      entries: new Set(own.map((entry) => entry.record.log.id)).size,
      target: scheduled(day),
      week: Math.floor(offset / 7),
      weekday: offset % 7,
      future: day > NOW,
    });
    cumulativeTarget += scheduled(day);
    targetProgress.push({ date: iso(part.end), seconds: 0, target: cumulativeTarget });
  }
  const heat: ExplorerHeatHour[] = [];
  if (calendar.length <= 8) {
    for (const day of calendar) {
      const own = entries.filter((entry) => dayStart(Date.parse(entry.start)) === Date.parse(day.date));
      let position = Date.parse(day.interval.start);
      let slot = Math.round((position - Date.parse(day.date)) / HOUR);
      while (position < Date.parse(day.interval.end)) {
        const end = Math.min(Date.parse(day.interval.end), Math.floor(position / HOUR) * HOUR + HOUR);
        heat.push({ interval: interval(position, end), day: day.date, seconds: own.reduce((sum, entry) => sum + overlap(entry, position, end), 0), slot });
        position = end;
        slot += 1;
      }
    }
  }
  const lastEnd = entries.reduce((latest, entry) => Math.max(latest, Date.parse(entry.end)), window.start);
  const recordedThrough = Math.min(window.end, Math.max(window.start, Math.max(NOW, lastEnd)));
  const progress: ExplorerProgressPoint[] = [{ date: iso(window.start), seconds: 0, target: 0 }];
  let recorded = 0;
  for (const bucket of bucketList) {
    if (Date.parse(bucket.start) >= recordedThrough) break;
    recorded += bucket.segments[bucket.segments.length - 1]?.top ?? 0;
    progress.push({ date: iso(Math.min(Date.parse(bucket.end), recordedThrough)), seconds: recorded, target: 0 });
  }

  const inBounds = records.filter((item) => Date.parse(item.start) < bounds.end && Date.parse(item.end) > bounds.start);
  const available = [...new Map(inBounds.map((item) => [item.activityId, item.activityName])).entries()]
    .map(([id, name]) => ({ id, name, seconds: 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    entries,
    available,
    analysis: {
      window: interval(window.start, window.end),
      tasks,
      activities,
      buckets: bucketList,
      weekdays,
      hours,
      lengths,
      resolution,
      total,
      covered,
      count: logSeconds.size,
      trackedDays: new Set(entries.map((entry) => localDay(Date.parse(entry.start)))).size,
      median: median([...logSeconds.values()]),
      billable,
      billableKnownCount: billableLogs.size,
      target: dayList.reduce((sum, day) => sum + scheduled(day), 0),
      overlap: Math.max(0, total - covered),
      context: context(entries, window),
      entryCount: entries.length,
      entriesPreview: entries.slice(0, 8),
    },
    visuals: { days: calendar, hours: heat, progress, targetProgress, weekCount: (calendar[calendar.length - 1]?.week ?? 0) + 1 },
  };
}

interface SampleOptions {
  period: StatisticsPeriod;
  /** Local `YYYY-MM-DD`, inclusive. */
  from: string;
  /** Local `YYYY-MM-DD`, exclusive. */
  to: string;
  /** Zoomed window, local days `[from, to)`; defaults to the period. */
  zoom?: { from: string; to: string; depth: number };
  filter?: ExplorerFilter;
  section?: StatisticsSection;
  /** Plan the worklogs from these days instead (an empty week uses a range without work). */
  logs?: readonly WorkLog[];
}

function sample({ period, from, to, zoom, filter = NO_FILTER, section = 'time', logs }: SampleOptions): { slice: StatisticsSlice; entries: ExplorerEntry[] } {
  const bounds = { start: localMidnight(from), end: localMidnight(to) };
  const window = zoom ? { start: localMidnight(zoom.from), end: localMidnight(zoom.to) } : bounds;
  // One preceding day is downloaded to include overnight work (as the engine does).
  const source = logs ?? worklogs(localDay(bounds.start - DAY), to);
  const explored = explore(source, bounds, window, filter);
  // The engine lists every task of the period, unfiltered and unzoomed, by title.
  const availableTasks = explore(source, bounds, bounds, NO_FILTER).analysis.tasks.sort(
    (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );
  return {
    entries: explored.entries,
    slice: {
      period,
      range: { period, start: iso(bounds.start), end: iso(bounds.end) },
      bounds: interval(bounds.start, bounds.end),
      window: interval(window.start, window.end),
      isZoomed: !!zoom,
      zoomDepth: zoom?.depth ?? 0,
      filter,
      section,
      loading: false,
      analyzing: false,
      issue: null,
      syncedAt: SYNCED_AT,
      omitted: 0,
      availableActivities: explored.available,
      availableTasks,
      analysis: explored.analysis,
      visuals: explored.visuals,
      targetComparable: !zoom && !filterActive(filter),
      configured: true,
    },
  };
}

// -- exported states ---------------------------------------------------------------------------

const week = sample({ period: 'week', from: '2026-09-28', to: '2026-10-05' });
/** Monday 28 September – Sunday 4 October 2026: five working days, six tickets, five activities. */
export const weekStatistics: StatisticsSlice = week.slice;
/** Every entry of `weekStatistics`, for a `statistics.entries` handler. */
export const weekEntries: readonly ExplorerEntry[] = week.entries;

const zoomed = sample({ period: 'week', from: '2026-09-28', to: '2026-10-05', zoom: { from: '2026-09-30', to: '2026-10-01', depth: 1 } });
/** The same week zoomed to Wednesday 30 September (hourly buckets, one "Back" step). */
export const zoomedWeekStatistics: StatisticsSlice = zoomed.slice;
export const zoomedWeekEntries: readonly ExplorerEntry[] = zoomed.entries;

const filtered = sample({
  period: 'week',
  from: '2026-09-28',
  to: '2026-10-05',
  filter: { ...NO_FILTER, activityId: 'activity:dev', taskId: 'ticket:4821' },
});
/** The week filtered to Development on #4821 (targets are not comparable). */
export const filteredWeekStatistics: StatisticsSlice = filtered.slice;

const month = sample({ period: 'month', from: '2026-09-01', to: '2026-10-01' });
/** September 2026: 22 working days, more than one page (100) of entries, one invalid worklog. */
export const monthStatistics: StatisticsSlice = { ...month.slice, omitted: 1 };
export const monthEntries: readonly ExplorerEntry[] = month.entries;

const empty = sample({ period: 'week', from: '2026-08-17', to: '2026-08-24', logs: [] });
/** A holiday week without any worklogs. */
export const emptyWeekStatistics: StatisticsSlice = empty.slice;

/** The first download of a period (no analysis yet). */
export const loadingStatistics: StatisticsSlice = {
  ...weekStatistics,
  loading: true,
  syncedAt: null,
  analysis: null,
  visuals: null,
  availableActivities: [],
  availableTasks: [],
};

/** A failed refresh keeps the last downloaded worklogs. */
export const failedRefreshStatistics: StatisticsSlice = {
  ...weekStatistics,
  issue: 'The 7pace API did not respond in time. Check your connection and try again.',
};

/** A failed first download: nothing to show yet. */
export const failedStatistics: StatisticsSlice = {
  ...loadingStatistics,
  loading: false,
  issue: 'The 7pace API did not respond in time. Check your connection and try again.',
};

/** Not connected: nothing was downloaded and nothing is loading. */
export const idleStatistics: StatisticsSlice = { ...loadingStatistics, loading: false };

/** No 7pace connection: nothing to download and Refresh is unavailable. */
export const unconfiguredStatistics: StatisticsSlice = { ...idleStatistics, configured: false };

/**
 * A page of `entries`, as `statistics.entries {offset, limit, start?, end?}` returns it: with an
 * interval, only the entries overlapping `[start, end)`, unclipped (as the engine does).
 */
export function entriesPage(
  entries: readonly ExplorerEntry[],
  offset: number,
  limit: number,
  start?: string | null,
  end?: string | null,
): EntriesPage {
  const matching = entries.filter(
    (entry) => (!end || Date.parse(entry.start) < Date.parse(end)) && (!start || Date.parse(entry.end) > Date.parse(start)),
  );
  return { offset, total: matching.length, entries: matching.slice(offset, offset + Math.min(limit, 500)) };
}

export default {
  statistics: weekStatistics,
} satisfies Partial<SliceMap>;
