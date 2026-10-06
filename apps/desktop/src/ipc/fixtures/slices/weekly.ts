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
};

/** Time loaded, nothing generated yet. */
export const weeklyEmpty: WeeklySlice = { ...weekly, text: '', hasDraft: false };

/** The week's time is loading. */
export const weeklyLoading: WeeklySlice = { ...weekly, text: '', hasDraft: false, hasData: false, loading: true, syncedAt: null };

/** The download failed. */
export const weeklyFailed: WeeklySlice = {
  ...weekly,
  text: '',
  hasDraft: false,
  hasData: false,
  issue: 'Could not load this week from 7pace: the request timed out.',
  syncedAt: null,
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
