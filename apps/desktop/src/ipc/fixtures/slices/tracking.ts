import type { HistorySlice, ProgressSlice, SliceMap, TrackingSlice, WorkItemsSlice, WorkLog } from '../../contract';

/** Tracking #4821 for 1 h 23 min, confirmed 20 s before the sample "now" (08:00:00Z). */
export const runningTracking: TrackingSlice = {
  running: true,
  ticketId: 4821,
  title: 'Checkout: retry failed card payments',
  activityId: 'dev',
  activityName: 'Development',
  remark: null,
  elapsedBase: 4_980,
  confirmedAt: '2026-10-06T07:59:40Z',
  extrapolate: true,
  paused: null,
  local: null,
  showsLocalTimer: false,
  showsRemoteTimer: true,
  attention: null,
  todaySeconds: 3_600,
  ticketUrl: 'https://dev.azure.com/contoso/_workitems/edit/4821',
};

/** No timer anywhere. */
export const stoppedTracking: TrackingSlice = {
  ...runningTracking,
  running: false,
  ticketId: null,
  title: 'Unassigned time',
  activityId: null,
  activityName: null,
  elapsedBase: 0,
  confirmedAt: '2026-10-06T07:59:40Z',
  extrapolate: false,
  ticketUrl: null,
};

/** Paused #4790 after 42 minutes: nothing is logged until Resume. */
export const pausedTracking: TrackingSlice = {
  ...stoppedTracking,
  elapsedBase: 2_520,
  paused: {
    ticketId: 4790,
    title: 'Invoice PDF shows the wrong VAT number',
    activityId: 'dev',
    activityName: 'Development',
    remark: null,
    pausedAt: '2026-10-06T07:40:00Z',
    elapsedSeconds: 2_520,
  },
};

/** A ticket-free stand-up running with its comment. */
export const ticketFreeTracking: TrackingSlice = {
  ...runningTracking,
  ticketId: null,
  title: 'daily standup',
  activityId: 'standup',
  activityName: 'Standup',
  remark: 'daily standup',
  elapsedBase: 540,
  ticketUrl: null,
};

/** 7pace stopped the timer after an unanswered activity check. */
export const attentionStoppedTracking: TrackingSlice = {
  ...stoppedTracking,
  attention: {
    id: 'activityCheck:4821:2026-10-06T07:30:00Z',
    reason: 'activityCheck',
    heading: '7pace stopped your timer',
    detail: 'The activity check was not answered in time. Continue to start a new session for this task.',
    ticketId: 4821,
    title: 'Checkout: retry failed card payments',
    stopped: true,
  },
};

/** 7pace asks whether the running timer is still correct. */
export const attentionRunningTracking: TrackingSlice = {
  ...runningTracking,
  attention: {
    id: 'activityCheck:4821:2026-10-06T07:58:00Z',
    reason: 'activityCheck',
    heading: 'Are you still working on this?',
    detail: '7pace asks you to confirm the activity. Without an answer, 7pace stops the timer.',
    ticketId: 4821,
    title: 'Checkout: retry failed card payments',
    stopped: false,
  },
};

/** Offline: the local timer leads; no Azure session is running. */
export const localTracking: TrackingSlice = {
  ...stoppedTracking,
  local: {
    draftId: '3f0b6a52-7c1d-4e9b-a2f4-5d8e9c0b1a23',
    ticketId: 4655,
    title: 'Design system: date picker tokens',
    comment: 'Token audit',
    activityName: 'Design',
    start: '2026-10-06T07:15:00Z',
  },
  showsLocalTimer: true,
  showsRemoteTimer: false,
};

/** The local timer leads while a paused Azure session stays available to resume. */
export const localWithPausedTracking: TrackingSlice = {
  ...pausedTracking,
  local: localTracking.local,
  showsLocalTimer: true,
  showsRemoteTimer: true,
};

/** 7pace unreachable: the last known timer stands still. */
export const unconfirmedTracking: TrackingSlice = { ...runningTracking, extrapolate: false };

export const sampleProgress: ProgressSlice = {
  available: true,
  todaySeconds: 8_580,
  weekSeconds: 36_900,
  todayTarget: 27_360,
  weekTarget: 136_800,
  computedAt: '2026-10-06T07:59:40Z',
  extrapolate: true,
  stale: false,
  loading: false,
  issue: null,
};

/** Before the week's worklogs loaded: never show a misleading 0. */
export const loadingProgress: ProgressSlice = {
  ...sampleProgress,
  available: false,
  todaySeconds: 0,
  weekSeconds: 0,
  computedAt: null,
  extrapolate: false,
  loading: true,
};

export const unavailableProgress: ProgressSlice = {
  ...loadingProgress,
  loading: false,
  issue: 'Worklogs could not be downloaded (HTTP 503).',
};

/** Last known totals after a failed refresh. */
export const staleProgress: ProgressSlice = { ...sampleProgress, extrapolate: false, stale: true };

/** Over target on a short day. */
export const reachedProgress: ProgressSlice = {
  ...sampleProgress,
  todaySeconds: 15_000,
  todayTarget: 14_400,
  extrapolate: false,
};

/** A public holiday: no target today. */
/** A leave day: no target today, and the reason under Today. */
export const leaveProgress: ProgressSlice = {
  ...sampleProgress,
  todaySeconds: 0,
  todayTarget: 0,
  extrapolate: false,
  todayReason: 'Full-day leave · Autumn break',
};

export const noTargetProgress: ProgressSlice = { ...sampleProgress, todaySeconds: 0, todayTarget: 0, extrapolate: false };

export const sampleWorkItems: WorkItemsSlice = {
  '4821': { id: 4821, title: 'Checkout: retry failed card payments', teamProject: 'Webshop', type: 'User Story' },
  '4790': { id: 4790, title: 'Invoice PDF shows the wrong VAT number', teamProject: 'Webshop', type: 'Bug' },
  '4777': { id: 4777, title: 'Sprint ceremonies', teamProject: 'Webshop', type: 'Task' },
  '4655': { id: 4655, title: 'Design system: date picker tokens', teamProject: 'Design', type: 'Task' },
};

/** Today's worklogs (newest first), for tests of the Overview's "Today's time". */
export const sampleTodayLogs: WorkLog[] = [
  {
    id: 'wl-3',
    timestamp: '2026-10-06T06:30:00Z',
    length: 3_600,
    workItemId: 4790,
    comment: null,
    activityType: { id: 'dev', name: 'Development' },
  },
  {
    id: 'wl-2',
    timestamp: '2026-10-06T06:15:00Z',
    length: 900,
    workItemId: null,
    comment: 'daily standup',
    activityType: { id: 'standup', name: 'Standup' },
  },
  {
    id: 'wl-1',
    timestamp: '2026-10-06T05:30:00Z',
    length: 2_700,
    workItemId: 4777,
    comment: 'Sprint planning',
    activityType: { id: 'meeting', name: 'Meeting' },
  },
];

/** A loaded history whose `todayLogs` the Overview lists (the History page owns the real sample). */
export const sampleHistory: HistorySlice = {
  from: '2026-09-29',
  to: '2026-10-06',
  logs: sampleTodayLogs,
  todayLogs: sampleTodayLogs,
  loading: false,
  loaded: true,
  totalSeconds: 7_200,
  audit: [],
};

export const emptyHistory: HistorySlice = { ...sampleHistory, logs: [], todayLogs: [], totalSeconds: 0 };

export default {
  tracking: runningTracking,
  progress: sampleProgress,
  workItems: sampleWorkItems,
} satisfies Partial<SliceMap>;
