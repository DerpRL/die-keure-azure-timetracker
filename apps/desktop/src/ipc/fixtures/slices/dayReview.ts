import type { DayReviewSlice, ReviewSession, SliceMap } from '../../contract';

function session(
  id: string,
  start: string,
  end: string,
  ticketId: number | null,
  title: string,
  activity: string,
  extra: Partial<ReviewSession> = {},
): ReviewSession {
  return { id, start, end, ticketId, title, activity, isRunning: false, isLong: false, ...extra };
}

/** Monday 5 October, sorted by start: a long morning session, a lunch gap and an afternoon gap. */
export const mondaySessions: ReviewSession[] = [
  session('b9d7f1e3-5a8c-4d2e-8f4b-6d8e0f2a4b59', '2026-10-05T07:00:00Z', '2026-10-05T07:15:00Z', 4777, 'Sprint ceremonies', 'Standup'),
  session(
    'c0e8a2f4-6b9d-4e3f-9a5c-5c7d9e1f3a48',
    '2026-10-05T07:15:00Z',
    '2026-10-05T10:40:00Z',
    4821,
    'Checkout: retry failed card payments',
    'Development',
    { isLong: true },
  ),
  session(
    'd1f9b3a5-7c0e-4f4a-8b6d-4b6c8d0e2f37',
    '2026-10-05T11:30:00Z',
    '2026-10-05T13:05:00Z',
    4790,
    'Invoice PDF shows the wrong VAT number',
    'Development',
  ),
  session('e2a0c4b6-8d1f-4a5b-9c7e-3a5b7c9d1e26', '2026-10-05T13:40:00Z', '2026-10-05T14:30:00Z', 4655, 'Design system: date picker tokens', 'Design'),
  session('f3b1d5c7-9e2a-4b6c-8d0e-2f4a6b8c0d15', '2026-10-05T14:20:00Z', '2026-10-05T15:00:00Z', null, 'Reviewing pull requests', 'Code review'),
  session('a7c2e9f1-6b3d-4e8a-9f0c-1d2e3f4a5b60', '2026-10-05T15:00:00Z', '2026-10-05T15:30:00Z', 4821, 'Checkout: retry failed card payments', 'Development'),
];

const dayReview: DayReviewSlice = {
  selectedDay: '2026-10-05',
  summary: {
    day: '2026-10-04T22:00:00Z',
    sessions: mondaySessions,
    gaps: [
      { start: '2026-10-05T10:40:00Z', end: '2026-10-05T11:30:00Z' },
      { start: '2026-10-05T13:05:00Z', end: '2026-10-05T13:40:00Z' },
    ],
    omittedLogs: 0,
    gapsUnavailable: false,
    timerRunning: false,
    timerUnconfirmed: false,
  },
  record: { promptedAt: '2026-10-05T15:00:00Z', snoozedUntil: null, reviewedAt: null },
  targetSeconds: 27_360,
  longEntryMinutes: 180,
  loading: false,
  issue: null,
  syncedAt: '2026-10-06T07:55:00Z',
  gapMinutes: 20,
  configured: true,
};

/** Today until 10:00, with the 7pace timer still running. */
export const dayReviewToday: DayReviewSlice = {
  ...dayReview,
  selectedDay: '2026-10-06',
  summary: {
    day: '2026-10-05T22:00:00Z',
    sessions: [
      session('8b7c6d5e-4f3a-4b2c-9d1e-0f9a8b7c6d5e', '2026-10-06T06:30:00Z', '2026-10-06T06:45:00Z', 4777, 'Sprint ceremonies', 'Standup'),
      session('9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', '2026-10-06T06:45:00Z', '2026-10-06T07:10:00Z', 4790, 'Invoice PDF shows the wrong VAT number', 'Development'),
      session('running', '2026-10-06T07:10:00Z', '2026-10-06T07:59:40Z', 4821, 'Checkout: retry failed card payments', 'Development', {
        isRunning: true,
      }),
    ],
    gaps: [],
    omittedLogs: 0,
    gapsUnavailable: false,
    timerRunning: true,
    timerUnconfirmed: false,
  },
  record: null,
};

/** Already reviewed. */
export const dayReviewReviewed: DayReviewSlice = {
  ...dayReview,
  record: { promptedAt: '2026-10-05T15:00:00Z', snoozedUntil: null, reviewedAt: '2026-10-05T15:42:00Z' },
};

/** The refresh failed; the last sync is still shown, gap estimates are unavailable. */
export const dayReviewFailed: DayReviewSlice = {
  ...dayReview,
  issue: 'The 7pace request timed out.',
  summary: { ...dayReview.summary!, gapsUnavailable: true, omittedLogs: 1 },
};

/** The first load of a day. */
export const dayReviewLoading: DayReviewSlice = { ...dayReview, summary: null, record: null, loading: true, syncedAt: null };

/** Not connected: nothing to review. */
export const dayReviewUnconfigured: DayReviewSlice = { ...dayReview, summary: null, record: null, syncedAt: null, configured: false };

/** A day without entries. */
export const dayReviewEmptyDay: DayReviewSlice = {
  ...dayReview,
  summary: { ...dayReview.summary!, sessions: [], gaps: [] },
};

export default { dayReview } satisfies Partial<SliceMap>;
