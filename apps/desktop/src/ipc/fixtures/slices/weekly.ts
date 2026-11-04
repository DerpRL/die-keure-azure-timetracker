import type { SliceMap, WeeklySlice } from '../../contract';

/** The generated draft for the week of 5 October, with one note the user added. */
export const weeklyDraftText = `# Weekly status · 5 Oct 2026 – 11 Oct 2026

Draft based on recorded time; add outcomes before sharing.

## Time
- Tracked: 8h 25m
- Weekly target: 38h 0m

## Worked on
- #4821 · Checkout: retry failed card payments — 4h 25m
  - Card retry flow
  - Release notes for card retry
- #4790 · Invoice PDF shows the wrong VAT number — 2h 0m
  - VAT number on invoice PDF
- #4655 · Design system: date picker tokens — 50m
- Work without an Azure ticket — 40m
  - Reviewing pull requests

## Activity breakdown
- Development: 6h 25m
- Design: 50m
- Code review: 40m

## Outcomes
- Card retry is ready for QA (added by hand).
`;

const weekly: WeeklySlice = {
  range: { period: 'week', start: '2026-10-04T22:00:00Z', end: '2026-10-11T22:00:00Z' },
  text: weeklyDraftText,
  hasData: true,
  hasDraft: true,
  loading: false,
  issue: null,
  storageIssue: null,
  message: null,
  syncedAt: '2026-10-06T07:55:00Z',
  configured: true,
  exportFileName: 'weekly-status-2026-10-05.md',
  // 8h 25m against 38h: Monday and Tuesday so far (Brussels days, UTC instants).
  summary: {
    totalSeconds: 30_300,
    targetSeconds: 136_800,
    days: [
      { date: '2026-10-04T22:00:00Z', seconds: 26_100, targetSeconds: 27_360 },
      { date: '2026-10-05T22:00:00Z', seconds: 4_200, targetSeconds: 27_360 },
      { date: '2026-10-06T22:00:00Z', seconds: 0, targetSeconds: 27_360 },
      { date: '2026-10-07T22:00:00Z', seconds: 0, targetSeconds: 27_360 },
      { date: '2026-10-08T22:00:00Z', seconds: 0, targetSeconds: 27_360 },
      { date: '2026-10-09T22:00:00Z', seconds: 0, targetSeconds: 0 },
      { date: '2026-10-10T22:00:00Z', seconds: 0, targetSeconds: 0 },
    ],
    activities: [
      { activityId: 'dev', name: 'Development', seconds: 23_100 },
      { activityId: 'design', name: 'Design', seconds: 3_000 },
      { activityId: 'review', name: 'Code review', seconds: 2_400 },
      { activityId: 'standup', name: 'Standup', seconds: 1_800 },
    ],
    tickets: [
      { ticketId: 4821, title: 'Checkout: retry failed card payments', seconds: 15_900, activityId: 'dev' },
      { ticketId: 4790, title: 'Invoice PDF shows the wrong VAT number', seconds: 7_200, activityId: 'dev' },
      { ticketId: 4655, title: 'Design system: date picker tokens', seconds: 3_000, activityId: 'design' },
      { ticketId: null, title: 'Reviewing pull requests', seconds: 2_400, activityId: 'review' },
      { ticketId: 4777, title: 'Sprint ceremonies', seconds: 1_800, activityId: 'standup' },
    ],
  },
};

/** Time loaded, nothing generated yet. */
export const weeklyEmpty: WeeklySlice = { ...weekly, text: '', hasDraft: false };

/** The week's time is loading. */
export const weeklyLoading: WeeklySlice = {
  ...weekly,
  text: '',
  hasDraft: false,
  hasData: false,
  loading: true,
  syncedAt: null,
  summary: null,
};

/** The download failed. */
export const weeklyFailed: WeeklySlice = {
  ...weekly,
  text: '',
  hasDraft: false,
  hasData: false,
  issue: 'Could not load this week from 7pace: the request timed out.',
  syncedAt: null,
  summary: null,
};

/** The draft file could not be written. */
export const weeklyStorageIssue: WeeklySlice = {
  ...weekly,
  storageIssue: 'Draft is in memory but could not be saved: the disk is full.',
};

/** Just generated. */
export const weeklyGenerated: WeeklySlice = { ...weekly, message: 'Draft generated. Review outcomes and blockers before sharing.' };

/** The previous week, which is complete. */
export const weeklyPrevious: WeeklySlice = {
  ...weekly,
  range: { period: 'week', start: '2026-09-27T22:00:00Z', end: '2026-10-04T22:00:00Z' },
  text: '',
  hasDraft: false,
  exportFileName: 'weekly-status-2026-09-28.md',
};

/** No 7pace connection. */
export const weeklyUnconfigured: WeeklySlice = { ...weeklyEmpty, hasData: false, configured: false, syncedAt: null };

export default { weekly } satisfies Partial<SliceMap>;
