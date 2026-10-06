import type { ActivityType, AuditEntry, HistorySlice, SliceMap, WorkLog } from '../../contract';

/** Activities as 7pace returns them on worklogs (same ids as `flow.activityTypes`). */
export const activities = {
  dev: { id: 'dev', name: 'Development', color: '#2f7de1' },
  design: { id: 'design', name: 'Design', color: '#b04fd9' },
  meeting: { id: 'meeting', name: 'Meeting', color: '#e0912f' },
  standup: { id: 'standup', name: 'Standup', color: '#3aa76d' },
  review: { id: 'review', name: 'Code review', color: '#6b7280' },
} satisfies Record<string, ActivityType>;

const user = { id: '5d1f7c9a-3b2e-4f6a-8c1d-9e0b2a4c6d8f' };

function log(
  id: string,
  timestamp: string,
  length: number,
  workItemId: number | null,
  comment: string | null,
  activityType: ActivityType | null,
  extra: Partial<WorkLog> = {},
): WorkLog {
  return {
    id,
    timestamp,
    length,
    workItemId,
    comment,
    activityType,
    isCanEdit: true,
    isCanDelete: true,
    billableLength: null,
    editedTimestamp: null,
    user,
    ...extra,
  };
}

/**
 * Monday 5 October 2026 (Brussels, UTC+2), newest first: a stand-up, a long development session,
 * a lunch gap, two afternoon entries that overlap by ten minutes and an entry locked by 7pace.
 */
export const mondayLogs: WorkLog[] = [
  log('a7c2e9f1-6b3d-4e8a-9f0c-1d2e3f4a5b60', '2026-10-05T15:00:00Z', 1_800, 4821, 'Release notes for card retry', activities.dev, {
    isCanEdit: false,
    isCanDelete: false,
  }),
  log('f3b1d5c7-9e2a-4b6c-8d0e-2f4a6b8c0d15', '2026-10-05T14:20:00Z', 2_400, null, 'Reviewing pull requests', activities.review),
  log('e2a0c4b6-8d1f-4a5b-9c7e-3a5b7c9d1e26', '2026-10-05T13:40:00Z', 3_000, 4655, 'Date picker focus tokens', activities.design),
  log('d1f9b3a5-7c0e-4f4a-8b6d-4b6c8d0e2f37', '2026-10-05T11:30:00Z', 5_700, 4790, 'VAT number on invoice PDF', activities.dev),
  log('c0e8a2f4-6b9d-4e3f-9a5c-5c7d9e1f3a48', '2026-10-05T07:15:00Z', 12_300, 4821, 'Card retry flow', activities.dev),
  log('b9d7f1e3-5a8c-4d2e-8f4b-6d8e0f2a4b59', '2026-10-05T07:00:00Z', 900, 4777, 'Daily stand-up', activities.standup),
];

/** Tuesday 6 October 2026 until the sample "now" (10:00 in Brussels). */
export const todayLogs: WorkLog[] = [
  log('9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', '2026-10-06T06:45:00Z', 1_500, 4790, 'Invoice PDF follow-up', activities.dev),
  log('8b7c6d5e-4f3a-4b2c-9d1e-0f9a8b7c6d5e', '2026-10-06T06:30:00Z', 900, 4777, 'Daily stand-up', activities.standup),
];

const earlierLogs: WorkLog[] = [
  log('7c6d5e4f-3a2b-4c1d-8e0f-9a8b7c6d5e4f', '2026-10-02T13:00:00Z', 7_200, 4655, 'Token review with design', activities.design),
  log('6d5e4f3a-2b1c-4d0e-9f8a-8b7c6d5e4f3a', '2026-10-02T09:00:00Z', 10_800, 4821, 'Card retry API', activities.dev),
  log('5e4f3a2b-1c0d-4e9f-8a7b-7c6d5e4f3a2b', '2026-10-02T07:00:00Z', 3_600, 4777, 'Sprint review', activities.meeting),
  log('4f3a2b1c-0d9e-4f8a-9b6c-6d5e4f3a2b1c', '2026-10-01T11:30:00Z', 12_600, 4790, null, activities.dev),
  log('3a2b1c0d-9e8f-4a7b-8c5d-5e4f3a2b1c0d', '2026-10-01T07:00:00Z', 14_400, 4821, '=SUM(A1) is escaped in the CSV export', activities.dev),
  log('2b1c0d9e-8f7a-4b6c-9d4e-4f3a2b1c0d9e', '2026-09-30T12:00:00Z', 9_000, null, 'Support rotation', null),
  log('1c0d9e8f-7a6b-4c5d-8e3f-3a2b1c0d9e8f', '2026-09-30T07:30:00Z', 14_400, 4655, 'Calendar grid', activities.design),
];

export const historyLogs: WorkLog[] = [...todayLogs, ...mondayLogs, ...earlierLogs];

/** App activity, newest first. */
export const auditEntries: AuditEntry[] = [
  {
    id: 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b',
    date: '2026-10-06T07:58:12Z',
    title: 'Branch change detected',
    detail: 'webshop: feature/AB#4821-card-retry → feature/AB#4790-vat-number',
  },
  {
    id: 'd2e3f4a5-b6c7-4d8e-9f0a-1b2c3d4e5f6a',
    date: '2026-10-06T06:36:40Z',
    title: 'Tracking started',
    detail: '#4821 · Checkout: retry failed card payments · Development',
  },
  {
    id: 'c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f',
    date: '2026-10-05T15:31:05Z',
    title: 'Tracking stopped',
    detail: '#4821 · 30 minutes',
  },
  {
    id: 'b4c5d6e7-f8a9-4b0c-9d1e-3f4a5b6c7d8e',
    date: '2026-10-05T14:52:40Z',
    title: 'Tracking attention',
    detail: '7pace asked whether you are still working on #4655.',
  },
  {
    id: 'a5b6c7d8-e9f0-4a1b-8c2d-4e5f6a7b8c9d',
    date: '2026-10-05T11:02:19Z',
    title: 'Tracked time updated',
    detail: 'Saved a time correction in 7pace',
  },
];

const total = (logs: readonly WorkLog[]) => logs.reduce((sum, entry) => sum + entry.length, 0);

const history: HistorySlice = {
  from: '2026-09-30',
  to: '2026-10-06',
  logs: historyLogs,
  todayLogs,
  loading: false,
  loaded: true,
  totalSeconds: total(historyLogs),
  audit: auditEntries,
};

/** The first download is running. */
export const historyLoading: HistorySlice = { ...history, logs: [], todayLogs: [], loading: true, loaded: false, totalSeconds: 0 };

/** Loaded, but nothing in the range. */
export const historyEmpty: HistorySlice = { ...history, logs: [], todayLogs: [], loaded: true, totalSeconds: 0, audit: [] };

/** Not loaded yet (no 7pace connection). */
export const historyNotLoaded: HistorySlice = { ...historyEmpty, loaded: false };

/** A long range: `count` worklogs, one every 45 minutes going back from the sample "now". */
export function manyHistoryLogs(count: number): WorkLog[] {
  const now = Date.parse('2026-10-06T08:00:00Z');
  return Array.from({ length: count }, (_, index) =>
    log(
      `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      new Date(now - (index + 1) * 45 * 60 * 1000).toISOString(),
      1_800,
      index % 3 === 0 ? null : 4821,
      `Entry ${index + 1}`,
      activities.dev,
    ),
  );
}

export default { history } satisfies Partial<SliceMap>;
