/**
 * Deterministic sample data for the gallery and chart tests. Shapes match the chart props, which
 * the Statistics page will fill from `att-core::explorer` / `explorer_visuals` results.
 */
import type { ActivityBucket } from '../charts/ActivityBars';
import type { HeatmapDay } from '../charts/CalendarHeatmap';
import type { ProgressPoint } from '../charts/CumulativeProgress';
import type { DonutSlice } from '../charts/Donut';
import type { HourHeatmapCell, HourHeatmapRow } from '../charts/HourHeatmap';
import type { ChartSeries } from '../charts/palette';
import type { TimelineEntry } from '../charts/Timeline';

export const ACTIVITIES: ChartSeries[] = [
  { id: 'dev', name: 'Development', colorIndex: 0 },
  { id: 'meeting', name: 'Meeting', colorIndex: 1 },
  { id: 'review', name: 'Code review', colorIndex: 2 },
  { id: 'design', name: 'Design', colorIndex: 3 },
  { id: 'testing', name: 'Testing', colorIndex: 4 },
  { id: 'standup', name: 'Stand-up', colorIndex: 5 },
  { id: 'support', name: 'Support', colorIndex: 6 },
  { id: 'other', name: 'Other', colorIndex: 7 },
];

/** mulberry32: small, fast, deterministic. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3600;
const DAY_MS = 86_400_000;
const dayLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const shortDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' });
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Monday 5 – Sunday 11 October 2026, local time. */
export const WEEK_START = new Date(2026, 9, 5);

function split(total: number, next: () => number): Record<string, number> {
  const values: Record<string, number> = {};
  const picks = ACTIVITIES.slice(0, 6);
  let left = total;
  picks.forEach((activity, index) => {
    const share = index === picks.length - 1 ? left : Math.round((left * (0.25 + next() * 0.45)) / 300) * 300;
    values[activity.id] = Math.max(0, Math.min(left, share));
    left -= values[activity.id] ?? 0;
  });
  return values;
}

export function weekBuckets(): ActivityBucket[] {
  const next = random(7);
  return Array.from({ length: 7 }, (_, day) => {
    const start = new Date(WEEK_START.getFullYear(), WEEK_START.getMonth(), WEEK_START.getDate() + day);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    const weekend = day >= 5;
    const total = weekend ? (day === 5 ? 1.25 * HOUR : 0) : Math.round((5.5 + next() * 3) * 12) * 300;
    return {
      id: `day-${day}`,
      start,
      end,
      label: shortDay.format(start),
      longLabel: dayLabel.format(start),
      values: total ? split(total, next) : {},
    };
  });
}

/** Tuesday 6 October, 08:00–19:00 in hourly buckets. */
export function dayBuckets(): ActivityBucket[] {
  const next = random(11);
  return Array.from({ length: 11 }, (_, index) => {
    const start = new Date(2026, 9, 6, 8 + index);
    const end = new Date(2026, 9, 6, 9 + index);
    const lunch = index === 4;
    const total = lunch ? 900 : Math.round((0.6 + next() * 0.4) * 12) * 300;
    return {
      id: `hour-${index}`,
      start,
      end,
      label: time.format(start),
      longLabel: `${dayLabel.format(start)}, ${time.format(start)} – ${time.format(end)}`,
      values: index === 1 ? { standup: 900, dev: total - 900 } : lunch ? { other: 900 } : split(total, next),
    };
  });
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Calendar days from `start` to `end` inclusive; days after `today` are future. */
export function calendarDays(start: Date, end: Date, today = new Date(2026, 9, 6)): HeatmapDay[] {
  const next = random(start.getMonth() * 31 + start.getDate());
  const days: HeatmapDay[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)) {
    const weekday = (cursor.getDay() + 6) % 7;
    const future = cursor.getTime() > today.getTime();
    const holiday = next() < 0.06;
    const value = future || weekday >= 5 || holiday ? 0 : Math.round((3 + next() * 6) * 4) * 900;
    days.push({
      date: iso(cursor),
      value,
      future,
      detail: future ? undefined : `${value ? Math.max(1, Math.round(value / 5400)) : 0} entries`,
    });
  }
  return days;
}

export function yearDays(): HeatmapDay[] {
  return calendarDays(new Date(2026, 0, 1), new Date(2026, 11, 31));
}

export function monthDays(): HeatmapDay[] {
  return calendarDays(new Date(2026, 9, 1), new Date(2026, 9, 31));
}

/**
 * Three days around the end of daylight saving time in Brussels (Sunday 25 October 2026):
 * that day has 25 hourly slots and two distinct 02:00 hours.
 */
export function dstHourHeatmap(): { rows: HourHeatmapRow[]; cells: HourHeatmapCell[] } {
  const next = random(25);
  const rows: HourHeatmapRow[] = [
    { id: '2026-10-24', label: 'Sat 24 Oct', longLabel: 'Saturday 24 October' },
    { id: '2026-10-25', label: 'Sun 25 Oct', longLabel: 'Sunday 25 October' },
    { id: '2026-10-26', label: 'Mon 26 Oct', longLabel: 'Monday 26 October' },
  ];
  const cells: HourHeatmapCell[] = [];
  for (const row of rows) {
    const dst = row.id === '2026-10-25';
    const labels = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
    if (dst) labels.splice(2, 1, '02:00 CEST', '02:00 CET');
    labels.forEach((label, slot) => {
      const working = row.id === '2026-10-26' ? slot >= 8 && slot <= 17 : slot >= 9 && slot <= 12;
      cells.push({
        id: `${row.id}-${slot}`,
        rowId: row.id,
        slot,
        label,
        longLabel: `${row.longLabel ?? row.label}, ${label}`,
        value: working ? Math.round(next() * 12) * 300 : dst && slot === 3 ? 1200 : 0,
      });
    });
  }
  return { rows, cells };
}

const TASKS = [
  '#33624 · Improve loading',
  '#33984 · Daily standup',
  '#34001 · Fix CSV export',
  '#34012 · Figma: Settings redesign',
  'Meeting · Sprint planning',
  '#33871 · Review: worklog cache',
  '#34020 · Calendar permissions',
  'Support · Belgian holidays question',
];

/** Tuesday 6 October with 16 entries, two of which overlap. */
export function timelineEntries(): TimelineEntry[] {
  const next = random(6);
  const entries: TimelineEntry[] = [];
  let cursor = new Date(2026, 9, 6, 8, 30).getTime();
  for (let index = 0; index < 16; index++) {
    const minutes = 15 + Math.round(next() * 6) * 10;
    const start = new Date(cursor);
    const end = new Date(cursor + minutes * 60_000);
    const activity = ACTIVITIES[Math.floor(next() * 6)] ?? ACTIVITIES[0];
    entries.push({
      id: `entry-${index}`,
      start,
      end,
      label: TASKS[index % TASKS.length] ?? 'Entry',
      detail: index === 3 ? 'Overlaps the next entry' : undefined,
      seriesId: activity?.id ?? 'dev',
    });
    // Entry 3 and 4 overlap by 20 minutes; the rest leave small gaps.
    cursor = end.getTime() + (index === 3 ? -20 * 60_000 : Math.round(next() * 2) * 5 * 60_000);
  }
  return entries;
}

export function weekProgress(): { points: ProgressPoint[]; target: ProgressPoint[] } {
  const buckets = weekBuckets();
  let recorded = 0;
  const points: ProgressPoint[] = [{ date: WEEK_START, value: 0 }];
  for (const bucket of buckets.slice(0, 2)) {
    recorded += Object.values(bucket.values).reduce((sum, value) => sum + value, 0);
    points.push({ date: bucket.end, value: recorded });
  }
  // Today (Tuesday) is the last recorded point: no projection into the future.
  let target = 0;
  const targets: ProgressPoint[] = [{ date: WEEK_START, value: 0 }];
  for (let day = 0; day < 7; day++) {
    target += day < 5 ? 7 * HOUR + 36 * 60 : 0;
    targets.push({ date: new Date(WEEK_START.getTime() + (day + 1) * DAY_MS), value: target });
  }
  return { points, target: targets };
}

export function activitySlices(): DonutSlice[] {
  const totals = new Map<string, number>();
  for (const bucket of weekBuckets()) {
    for (const [id, value] of Object.entries(bucket.values)) totals.set(id, (totals.get(id) ?? 0) + value);
  }
  return ACTIVITIES.filter((activity) => (totals.get(activity.id) ?? 0) > 0).map((activity) => ({
    id: activity.id,
    name: activity.name,
    value: totals.get(activity.id) ?? 0,
    colorIndex: activity.colorIndex,
  }));
}

export interface SampleWorklog {
  id: string;
  task: string;
  activity: string;
  start: Date;
  end: Date;
  comment: string;
}

export function sampleWorklogs(): SampleWorklog[] {
  return timelineEntries()
    .slice(0, 8)
    .map((entry, index) => ({
      id: entry.id,
      task: entry.label,
      activity: ACTIVITIES.find((activity) => activity.id === entry.seriesId)?.name ?? 'Development',
      start: entry.start,
      end: entry.end,
      comment: index % 3 === 0 ? 'Pairing with Lotte' : '',
    }));
}

export interface SampleTicket {
  id: number;
  title: string;
}

export const SAMPLE_TICKETS: SampleTicket[] = [
  { id: 33624, title: 'Improve loading' },
  { id: 33871, title: 'Review: worklog cache' },
  { id: 33984, title: 'Daily standup board' },
  { id: 34001, title: 'Fix CSV export' },
  { id: 34012, title: 'Figma: Settings redesign' },
  { id: 34020, title: 'Calendar permissions on first run' },
];

/** Ticket search with simulated latency, honouring cancellation. */
export function searchTickets(query: string, signal: AbortSignal, latencyMs = 250): Promise<SampleTicket[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const q = query.trim().toLowerCase();
      resolve(SAMPLE_TICKETS.filter((ticket) => !q || `${ticket.id} ${ticket.title}`.toLowerCase().includes(q)));
    }, latencyMs);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}
